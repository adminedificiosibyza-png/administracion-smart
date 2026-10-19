-- ==============================================================================
-- 018 - PAGOS PARCIALES ACUMULADOS Y ANULACIÓN DE PAGOS
--  1) register_payment: la cuota se cierra cuando la SUMA de los pagos válidos alcanza la
--     cuota base (antes comparaba cada pago por separado y nunca se cerraba con 2 parciales).
--  2) void_payment: anula un pago (no lo borra): queda con estado RECHAZADO y el motivo en sus
--     notas. Si la cuota estaba pagada y la suma válida baja de la cuota base, vuelve a PENDIENTE.
--  3) Los propietarios dejan de ver los pagos anulados (solo la administración los ve).
-- Los reportes y el dashboard ya ignoran los pagos RECHAZADO.
-- Ejecutar completo en el SQL Editor de Supabase.
-- ==============================================================================
BEGIN;

-- 1. Registro de pago con acumulación ------------------------------------------------------
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
    v_paid DECIMAL(10,2);
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
        p_notes, COALESCE(v_admin_name, 'Administración')
    ) RETURNING * INTO v_pay;

    -- Suma de los pagos válidos de la cuota (incluye el recién registrado)
    SELECT COALESCE(SUM(amount), 0) INTO v_paid
      FROM public.payments
     WHERE fee_id = v_fee.id AND status <> 'RECHAZADO';

    IF v_paid >= v_fee.fee_amount THEN
        UPDATE public.maintenance_fees
           SET status = 'PAGADO', payment_date = p_payment_date
         WHERE id = v_fee.id;
    END IF;

    INSERT INTO public.audit_logs (building_id, action, description, performed_by)
    VALUES (v_building, 'REGISTRO_PAGO',
            format('Registró pago de %s para Dpto %s por S/ %s (%s%s)%s',
                   v_fee.period, v_fee.unit_code, p_amount, p_method,
                   CASE WHEN COALESCE(trim(p_operation_number), '') <> '' THEN ' Op: ' || trim(p_operation_number) ELSE '' END,
                   CASE WHEN v_paid < v_fee.fee_amount THEN format(' - pago parcial, acumulado S/ %s de S/ %s', v_paid, v_fee.fee_amount) ELSE '' END),
            COALESCE(v_admin_name, 'Administración'));

    RETURN v_pay;
END;
$$;

-- 2. Anulación de un pago -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.void_payment(p_payment_id UUID, p_reason TEXT)
RETURNS public.payments
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_pay public.payments;
    v_fee public.maintenance_fees;
    v_admin_name TEXT;
    v_reason TEXT := trim(COALESCE(p_reason, ''));
    v_paid DECIMAL(10,2);
    v_last DATE;
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

    -- Recalcular la cuota con los pagos que siguen siendo válidos
    IF v_pay.fee_id IS NOT NULL THEN
        SELECT * INTO v_fee FROM public.maintenance_fees WHERE id = v_pay.fee_id FOR UPDATE;
        IF FOUND THEN
            SELECT COALESCE(SUM(amount), 0), MAX(payment_date) INTO v_paid, v_last
              FROM public.payments
             WHERE fee_id = v_fee.id AND status <> 'RECHAZADO';

            IF v_fee.status = 'PAGADO' AND v_paid < v_fee.fee_amount THEN
                UPDATE public.maintenance_fees SET status = 'PENDIENTE', payment_date = NULL WHERE id = v_fee.id;
            ELSIF v_fee.status = 'PAGADO' AND v_last IS NOT NULL THEN
                UPDATE public.maintenance_fees SET payment_date = v_last WHERE id = v_fee.id;
            END IF;
        END IF;
    END IF;

    INSERT INTO public.audit_logs (building_id, action, description, performed_by)
    VALUES (v_pay.building_id, 'ANULAR_PAGO',
            format('Anuló el pago de %s del Dpto %s por S/ %s. Motivo: %s',
                   v_pay.period, v_pay.unit_code, v_pay.amount, v_reason),
            COALESCE(v_admin_name, 'Administración'));

    RETURN v_pay;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.void_payment(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_payment(UUID, TEXT) TO authenticated;

-- 3. Los propietarios no ven pagos anulados -------------------------------------------------
DROP POLICY IF EXISTS "Propietario lee solo los pagos de su departamento" ON public.payments;
CREATE POLICY "Propietario lee solo los pagos de su departamento"
ON public.payments FOR SELECT USING (
    public.auth_is_admin_of(building_id)
    OR (status <> 'RECHAZADO' AND unit_id IN (SELECT f FROM public.auth_fee_unit_ids() AS f))
);

COMMIT;

NOTIFY pgrst, 'reload schema';
