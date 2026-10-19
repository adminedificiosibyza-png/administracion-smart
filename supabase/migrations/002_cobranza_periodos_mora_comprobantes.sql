-- ==============================================================================
-- MIGRACIÓN 002: COBRANZA POR PERÍODO, MORA CALCULADA EN EL SERVIDOR Y
--                REGISTRO DE PAGOS CON COMPROBANTE
-- ------------------------------------------------------------------------------
-- Aplicar sobre una base creada con schema.sql + rls.sql + storage.sql
-- (y la migración 001). Es idempotente.
--
-- NO modifica: políticas RLS existentes, bucket/políticas de Storage, auth.
-- Reutiliza:   interest_rules, calculate_late_interest (se amplía, no se duplica),
--              payments.proof_file_path y el bucket privado 'comprobantes-pagos'
--              (ruta: <unit_id>/<payment_id>/<archivo>).
-- ==============================================================================

-- 1. PERÍODO REAL (fecha, no texto) -------------------------------------------
ALTER TABLE public.maintenance_fees ADD COLUMN IF NOT EXISTS period_month DATE;
UPDATE public.maintenance_fees
   SET period_month = date_trunc('month', due_date)::date
 WHERE period_month IS NULL;
ALTER TABLE public.maintenance_fees ALTER COLUMN period_month SET NOT NULL;

-- Una sola cuota por departamento y mes (si falla, hay cuotas duplicadas a depurar)
CREATE UNIQUE INDEX IF NOT EXISTS uq_fees_unit_period
    ON public.maintenance_fees(unit_id, period_month);
CREATE INDEX IF NOT EXISTS idx_fees_building_period
    ON public.maintenance_fees(building_id, period_month);

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS period_month DATE;
UPDATE public.payments p
   SET period_month = f.period_month
  FROM public.maintenance_fees f
 WHERE p.fee_id = f.id AND p.period_month IS NULL;

-- 2. MORA: UNA SOLA LÓGICA, EN EL SERVIDOR ---------------------------------------
-- Se amplía la función existente: fecha de referencia, días de gracia y tipo de regla.
-- days = max(0, fecha_referencia - vencimiento - gracia)
-- (la mora empieza el día siguiente al vencimiento; applied_from_day se conserva
--  por compatibilidad: vencimiento día 5 => mora desde el día 6)
DROP FUNCTION IF EXISTS public.calculate_late_interest(DECIMAL, DATE, DECIMAL, INT);

CREATE OR REPLACE FUNCTION public.calculate_late_interest(
    p_fee_amount DECIMAL(10,2),
    p_due_date DATE,
    p_rate_percent DECIMAL(5,2),
    p_applied_from_day INT,
    p_ref_date DATE DEFAULT CURRENT_DATE,
    p_grace_days INT DEFAULT 0,
    p_type TEXT DEFAULT 'PORCENTAJE_DIARIO',
    p_fixed_amount DECIMAL(10,2) DEFAULT 0
)
RETURNS TABLE (
    days_late INT,
    interest_amount DECIMAL(10,2),
    total_amount DECIMAL(10,2)
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_days INT;
    v_interest DECIMAL(10,2);
BEGIN
    v_days := GREATEST(0, p_ref_date - p_due_date - COALESCE(p_grace_days, 0));
    IF v_days > 0 THEN
        IF p_type = 'MONTO_FIJO' THEN
            v_interest := ROUND(COALESCE(p_fixed_amount, 0), 2);
        ELSE
            v_interest := ROUND(p_fee_amount * (p_rate_percent / 100.00) * v_days, 2);
        END IF;
    ELSE
        v_interest := 0.00;
    END IF;

    RETURN QUERY SELECT v_days, v_interest, (p_fee_amount + v_interest);
END;
$$;

-- Aplica la regla vigente del edificio (interest_rules) a una cuota
CREATE OR REPLACE FUNCTION public.calc_fee_late(
    p_building_id UUID,
    p_fee_amount DECIMAL(10,2),
    p_due_date DATE,
    p_ref_date DATE
)
RETURNS TABLE (days_late INT, interest_amount DECIMAL(10,2))
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    r public.interest_rules;
BEGIN
    SELECT * INTO r FROM public.interest_rules WHERE building_id = p_building_id;

    IF r.id IS NULL OR r.is_active IS NOT TRUE THEN
        RETURN QUERY SELECT GREATEST(0, p_ref_date - p_due_date)::INT, 0.00::DECIMAL(10,2);
        RETURN;
    END IF;

    RETURN QUERY
    SELECT c.days_late, c.interest_amount
      FROM public.calculate_late_interest(
               p_fee_amount, p_due_date, r.rate_percent, r.applied_from_day,
               p_ref_date, r.grace_days, r.type, r.fixed_amount) c;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.calc_fee_late(UUID, DECIMAL, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calc_fee_late(UUID, DECIMAL, DATE, DATE) TO authenticated;

-- Fecha de referencia de una cuota:
--   pagada / por verificar con fecha de pago -> la fecha REAL del pago
--   pendiente                                -> hoy (hora de Lima)
CREATE OR REPLACE FUNCTION public.fee_reference_date(p_status TEXT, p_payment_date DATE)
RETURNS DATE
LANGUAGE sql STABLE AS $$
    SELECT CASE
        WHEN p_status IN ('PAGADO', 'POR_VERIFICAR') AND p_payment_date IS NOT NULL THEN p_payment_date
        ELSE (now() AT TIME ZONE 'America/Lima')::date
    END;
$$;

-- 3. TRIGGER: valores calculados por el servidor, no editables desde el navegador --
CREATE OR REPLACE FUNCTION public.compute_fee_amounts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_days INT;
    v_interest DECIMAL(10,2);
BEGIN
    -- El período sale de la fecha de vencimiento (fecha real)
    NEW.period_month := date_trunc('month', NEW.due_date)::date;

    SELECT c.days_late, c.interest_amount INTO v_days, v_interest
      FROM public.calc_fee_late(
               NEW.building_id, NEW.fee_amount, NEW.due_date,
               public.fee_reference_date(NEW.status, NEW.payment_date)) c;

    NEW.days_late := v_days;
    NEW.interest_amount := v_interest;
    NEW.total_amount := NEW.fee_amount + v_interest;
    NEW.total_pending := CASE WHEN NEW.status = 'PAGADO' THEN 0 ELSE NEW.fee_amount + v_interest END;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compute_fee_amounts ON public.maintenance_fees;
CREATE TRIGGER trg_compute_fee_amounts
BEFORE INSERT OR UPDATE ON public.maintenance_fees
FOR EACH ROW EXECUTE FUNCTION public.compute_fee_amounts();

-- 4. VISTA CON MORA AL DÍA ------------------------------------------------------
-- Las cuotas pendientes siguen acumulando días cada día; esta vista las calcula
-- en el momento de consultar. Respeta RLS de maintenance_fees (security_invoker).
CREATE OR REPLACE VIEW public.vw_maintenance_fees_calc
WITH (security_invoker = true) AS
SELECT
    f.id, f.building_id, f.unit_id, f.unit_code, f.owner_name,
    f.period, f.period_month, f.due_date, f.fee_amount,
    c.days_late,
    c.interest_amount,
    (f.fee_amount + c.interest_amount) AS total_amount,
    CASE WHEN f.status = 'PAGADO' THEN 0 ELSE (f.fee_amount + c.interest_amount) END AS total_pending,
    f.status, f.payment_date, f.created_at
FROM public.maintenance_fees f
CROSS JOIN LATERAL public.calc_fee_late(
    f.building_id, f.fee_amount, f.due_date,
    public.fee_reference_date(f.status, f.payment_date)) c;

GRANT SELECT ON public.vw_maintenance_fees_calc TO authenticated;

-- 5. REGISTRO DE PAGO (solo administradora, validado en el servidor) --------------
CREATE OR REPLACE FUNCTION public.register_payment(
    p_unit_id UUID,
    p_period_month DATE,
    p_amount DECIMAL(10,2),
    p_payment_date DATE,
    p_method TEXT,
    p_operation_number TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS public.payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_role TEXT;
    v_building UUID;
    v_admin_name TEXT;
    v_period DATE := date_trunc('month', p_period_month)::date;
    v_fee public.maintenance_fees;
    v_pay public.payments;
BEGIN
    SELECT p.role, p.building_id INTO v_role, v_building FROM public.get_auth_user_profile() p;
    IF v_role IS DISTINCT FROM 'administradora' THEN
        RAISE EXCEPTION 'Acceso denegado: solo la administradora puede registrar pagos.';
    END IF;

    SELECT full_name INTO v_admin_name FROM public.user_profiles WHERE id = auth.uid();

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'El monto pagado debe ser mayor a cero.';
    END IF;
    IF p_payment_date IS NULL OR p_payment_date > (now() AT TIME ZONE 'America/Lima')::date THEN
        RAISE EXCEPTION 'La fecha de pago es obligatoria y no puede ser futura.';
    END IF;
    IF p_method NOT IN ('Transferencia bancaria', 'Yape', 'Plin', 'Efectivo', 'Otro') THEN
        RAISE EXCEPTION 'Método de pago inválido.';
    END IF;
    IF p_method IN ('Transferencia bancaria', 'Yape', 'Plin') AND COALESCE(trim(p_operation_number), '') = '' THEN
        RAISE EXCEPTION 'El número de operación es obligatorio para el método seleccionado.';
    END IF;

    SELECT * INTO v_fee
      FROM public.maintenance_fees
     WHERE unit_id = p_unit_id AND period_month = v_period AND building_id = v_building
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No existe una cuota para ese departamento y período.';
    END IF;
    IF v_fee.status = 'PAGADO' THEN
        RAISE EXCEPTION 'La cuota de ese período ya figura como pagada.';
    END IF;

    INSERT INTO public.payments (
        building_id, fee_id, unit_id, unit_code, owner_name, period, period_month,
        amount, payment_date, method, operation_number, status, notes, registered_by
    ) VALUES (
        v_building, v_fee.id, v_fee.unit_id, v_fee.unit_code, v_fee.owner_name, v_fee.period, v_fee.period_month,
        p_amount, p_payment_date, p_method, NULLIF(trim(p_operation_number), ''), 'VERIFICADO',
        p_notes, COALESCE(v_admin_name, 'Administración')
    ) RETURNING * INTO v_pay;

    -- La cuota se cierra solo si el monto cubre la cuota base.
    -- Pagos parciales: se registran pero la cuota sigue pendiente (lógica detallada pendiente).
    IF p_amount >= v_fee.fee_amount THEN
        UPDATE public.maintenance_fees
           SET status = 'PAGADO', payment_date = p_payment_date
         WHERE id = v_fee.id;  -- el trigger recalcula días de atraso con la fecha real del pago
    END IF;

    INSERT INTO public.audit_logs (building_id, action, description, performed_by)
    VALUES (v_building, 'REGISTRO_PAGO',
            format('Registró pago de %s para Dpto %s por S/ %s (%s%s)',
                   v_fee.period, v_fee.unit_code, p_amount, p_method,
                   CASE WHEN COALESCE(trim(p_operation_number), '') <> '' THEN ' Op: ' || trim(p_operation_number) ELSE '' END),
            COALESCE(v_admin_name, 'Administración'));

    RETURN v_pay;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.register_payment(UUID, DATE, DECIMAL, DATE, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_payment(UUID, DATE, DECIMAL, DATE, TEXT, TEXT, TEXT) TO authenticated;

-- 6. COMPROBANTES -------------------------------------------------------------------
-- Sin cambios en Storage: bucket privado 'comprobantes-pagos' y sus políticas
-- existentes (propietario lee solo <su_unit_id>/..., administradora gestiona).
-- La app sube a '<unit_id>/<payment_id>/<archivo>' y guarda esa ruta en
-- payments.proof_file_path (ruta, nunca el archivo). Se visualiza con URL firmada.

-- Refresca la caché de esquema de la API (PostgREST) para que vea las vistas/funciones nuevas
NOTIFY pgrst, 'reload schema';
