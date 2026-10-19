-- ==============================================================================
-- 019 - ESTADO "MORA PENDIENTE" Y CIERRE DE CUOTAS CON CUOTA + MORA
--  * Una cuota queda PAGADO solo cuando los pagos válidos cubren la cuota base MÁS la mora.
--  * Si la cuota base ya está cubierta pero falta la mora: estado MORA_PENDIENTE. La mora se
--    congela en la fecha en que se cubrió la cuota base (no sigue creciendo) y se cobra con
--    otro pago normal ("Registrar Pago").
--  * Si falta parte de la cuota base: sigue PENDIENTE (en pantalla se ve como "Pago parcial").
--  * Una sola función (recompute_fee_status) decide el estado; la usan registrar y anular pagos.
-- Ejecutar completo en el SQL Editor de Supabase.
-- ==============================================================================
BEGIN;

-- 1. Nuevo valor permitido para el estado de la cuota ----------------------------------------
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT conname FROM pg_constraint
              WHERE conrelid = 'public.maintenance_fees'::regclass AND contype = 'c'
                AND pg_get_constraintdef(oid) LIKE '%status%' LOOP
        EXECUTE format('ALTER TABLE public.maintenance_fees DROP CONSTRAINT %I', r.conname);
    END LOOP;
END $$;

ALTER TABLE public.maintenance_fees
    ADD CONSTRAINT maintenance_fees_status_check
    CHECK (status IN ('PENDIENTE', 'PAGADO', 'POR_VERIFICAR', 'MORA_PENDIENTE'));

-- 2. La mora de MORA_PENDIENTE queda congelada en su fecha de referencia ------------------------
CREATE OR REPLACE FUNCTION public.fee_reference_date(p_status TEXT, p_payment_date DATE)
RETURNS DATE
LANGUAGE sql STABLE AS $$
    SELECT CASE
        WHEN p_status IN ('PAGADO', 'POR_VERIFICAR', 'MORA_PENDIENTE') AND p_payment_date IS NOT NULL THEN p_payment_date
        ELSE (now() AT TIME ZONE 'America/Lima')::date
    END;
$$;

-- 3. Decide el estado de una cuota a partir de sus pagos válidos ---------------------------------
CREATE OR REPLACE FUNCTION public.recompute_fee_status(p_fee_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_fee public.maintenance_fees;
    r RECORD;
    v_cum DECIMAL(10,2) := 0;
    v_cover DATE;
    v_mora DECIMAL(10,2);
    v_status TEXT;
BEGIN
    SELECT * INTO v_fee FROM public.maintenance_fees WHERE id = p_fee_id FOR UPDATE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF v_fee.status = 'POR_VERIFICAR' THEN RETURN v_fee.status; END IF;  -- estado en desuso: no se toca

    -- Fecha en que los pagos acumulados cubrieron la cuota base
    FOR r IN SELECT amount, payment_date FROM public.payments
              WHERE fee_id = p_fee_id AND status <> 'RECHAZADO'
              ORDER BY payment_date, registered_at LOOP
        v_cum := v_cum + r.amount;
        IF v_cover IS NULL AND v_cum >= v_fee.fee_amount THEN
            v_cover := r.payment_date;
        END IF;
    END LOOP;

    IF v_cover IS NULL THEN
        v_status := 'PENDIENTE';
        UPDATE public.maintenance_fees SET status = v_status, payment_date = NULL WHERE id = p_fee_id;
    ELSE
        SELECT c.interest_amount INTO v_mora
          FROM public.calc_fee_late(v_fee.building_id, v_fee.fee_amount, v_fee.due_date, v_cover) c;
        v_status := CASE WHEN v_cum >= v_fee.fee_amount + COALESCE(v_mora, 0) THEN 'PAGADO' ELSE 'MORA_PENDIENTE' END;
        UPDATE public.maintenance_fees SET status = v_status, payment_date = v_cover WHERE id = p_fee_id;
    END IF;
    RETURN v_status;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recompute_fee_status(UUID) FROM PUBLIC;

-- 4. Registrar pago --------------------------------------------------------------------------------
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
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_building UUID;
    v_admin_name TEXT;
    v_period DATE := date_trunc('month', p_period_month)::date;
    v_fee public.maintenance_fees;
    v_pay public.payments;
    v_status TEXT;
BEGIN
    SELECT building_id INTO v_building FROM public.units WHERE id = p_unit_id;
    IF v_building IS NULL OR NOT public.auth_is_admin_of(v_building) THEN
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
        NULLIF(trim(COALESCE(p_notes, '')), ''), COALESCE(v_admin_name, 'Administración')
    ) RETURNING * INTO v_pay;

    v_status := public.recompute_fee_status(v_fee.id);

    INSERT INTO public.audit_logs (building_id, action, description, performed_by)
    VALUES (v_building, 'REGISTRO_PAGO',
            format('Registró pago de %s para Dpto %s por S/ %s (%s%s) - cuota: %s',
                   v_fee.period, v_fee.unit_code, p_amount, p_method,
                   CASE WHEN COALESCE(trim(p_operation_number), '') <> '' THEN ' Op: ' || trim(p_operation_number) ELSE '' END,
                   CASE v_status WHEN 'PAGADO' THEN 'pagada'
                                 WHEN 'MORA_PENDIENTE' THEN 'cuota cubierta, mora pendiente'
                                 ELSE 'pago parcial, sigue pendiente' END),
            COALESCE(v_admin_name, 'Administración'));

    RETURN v_pay;
END;
$$;

-- 5. Anular pago (recalcula con la misma función) ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.void_payment(p_payment_id UUID, p_reason TEXT)
RETURNS public.payments
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_pay public.payments;
    v_admin_name TEXT;
    v_reason TEXT := trim(COALESCE(p_reason, ''));
BEGIN
    SELECT * INTO v_pay FROM public.payments WHERE id = p_payment_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'El pago no existe.';
    END IF;
    IF NOT public.auth_is_admin_of(v_pay.building_id) THEN
        RAISE EXCEPTION 'Acceso denegado: solo la administradora puede anular pagos.';
    END IF;
    IF v_pay.status = 'RECHAZADO' THEN
        RAISE EXCEPTION 'Ese pago ya está anulado.';
    END IF;
    IF char_length(v_reason) < 3 OR char_length(v_reason) > 500 THEN
        RAISE EXCEPTION 'Indique el motivo de la anulación (entre 3 y 500 caracteres).';
    END IF;

    SELECT full_name INTO v_admin_name FROM public.user_profiles WHERE id = auth.uid();

    UPDATE public.payments
       SET status = 'RECHAZADO',
           notes = trim(COALESCE(notes, '') || E'\n[ANULADO por ' || COALESCE(v_admin_name, 'Administración')
                        || ' el ' || to_char(now() AT TIME ZONE 'America/Lima', 'DD/MM/YYYY HH24:MI')
                        || '] ' || v_reason)
     WHERE id = p_payment_id
     RETURNING * INTO v_pay;

    IF v_pay.fee_id IS NOT NULL THEN
        PERFORM public.recompute_fee_status(v_pay.fee_id);
    END IF;

    INSERT INTO public.audit_logs (building_id, action, description, performed_by)
    VALUES (v_pay.building_id, 'ANULAR_PAGO',
            format('Anuló el pago de %s del Dpto %s por S/ %s. Motivo: %s',
                   v_pay.period, v_pay.unit_code, v_pay.amount, v_reason),
            COALESCE(v_admin_name, 'Administración'));

    RETURN v_pay;
END;
$$;

-- 6. Resumen del inicio del superadmin: MORA_PENDIENTE también cuenta como cuota por cobrar ---------
CREATE OR REPLACE FUNCTION public.get_building_summaries()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_today DATE := (now() AT TIME ZONE 'America/Lima')::date;
BEGIN
    IF NOT public.auth_is_superadmin() THEN
        RAISE EXCEPTION 'Acceso denegado.';
    END IF;

    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'building_id',  b.id,
            'units',        (SELECT count(*) FROM public.units u WHERE u.building_id = b.id),
            'people',       (SELECT count(DISTINCT uu.user_id) FROM public.user_units uu
                              JOIN public.units u ON u.id = uu.unit_id
                             WHERE u.building_id = b.id AND uu.active),
            'pending_fees', (SELECT count(*) FROM public.maintenance_fees f
                              WHERE f.building_id = b.id AND f.status IN ('PENDIENTE', 'MORA_PENDIENTE')),
            'overdue_fees', (SELECT count(*) FROM public.maintenance_fees f
                              WHERE f.building_id = b.id AND f.status IN ('PENDIENTE', 'MORA_PENDIENTE') AND f.due_date < v_today)
        ))
        FROM public.buildings b WHERE b.is_active), '[]'::jsonb);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_building_summaries() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_building_summaries() TO authenticated;

-- 7. Reevaluar las cuotas que ya tienen pagos (por ejemplo, las pagadas solo con la cuota base) ----------
DO $$
DECLARE f RECORD;
BEGIN
    FOR f IN SELECT DISTINCT fee_id FROM public.payments WHERE fee_id IS NOT NULL AND status <> 'RECHAZADO' LOOP
        PERFORM public.recompute_fee_status(f.fee_id);
    END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
