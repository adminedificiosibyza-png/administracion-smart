-- ==============================================================================
-- 022 - LIBRO DE MOVIMIENTOS + AJUSTE DEL RESUMEN DE CAJA
--  * El resultado de un EDIFICIO ya no se corta por la fecha del saldo inicial de la cuenta
--    (esa fecha solo afecta al saldo del banco, es decir, a la vista general).
--  * get_cash_summary informa lo cobrado/gastado ANTES de la fecha del saldo inicial
--    ("before_opening") para que no parezca que desapareció.
--  * get_cash_ledger: lista cronológica de todo lo que entra y sale (una línea por cuota
--    pagada, otros ingresos y pagos de gastos), con anulados marcados.
-- Ejecutar completo en el SQL Editor de Supabase.
-- ==============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.get_cash_summary(p_from DATE, p_to DATE, p_building UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_acc public.admin_cash_account;
    v_eff DATE := p_from;
    v_fees NUMERIC; v_other NUMERIC; v_spent NUMERIC;
    v_opening NUMERIC; v_pending NUMERIC := 0; v_overdue NUMERIC := 0;
    v_rows JSONB := '[]'::jsonb; b RECORD; bf NUMERIC; bo NUMERIC; bs NUMERIC;
    v_gen_in NUMERIC; v_gen_out NUMERIC;
    v_before JSONB := NULL; xf NUMERIC; xo NUMERIC; xs NUMERIC;
BEGIN
    IF p_building IS NULL THEN
        IF NOT public.auth_is_superadmin() THEN RAISE EXCEPTION 'Solo el superadmin ve la caja general.'; END IF;
    ELSIF NOT public.auth_is_admin_of(p_building) THEN
        RAISE EXCEPTION 'No tiene permiso para este edificio.';
    END IF;
    IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'Período no válido.'; END IF;

    SELECT * INTO v_acc FROM public.admin_cash_account WHERE id = 1;
    -- La fecha del saldo inicial solo recorta la vista GENERAL (saldo del banco)
    IF FOUND AND p_building IS NULL THEN v_eff := GREATEST(p_from, v_acc.opening_date); END IF;

    IF v_eff > p_to THEN
        v_fees := 0; v_other := 0; v_spent := 0;
    ELSE
        SELECT fees, other, spent INTO v_fees, v_other, v_spent FROM public._cash_flows(v_eff, p_to, p_building);
    END IF;

    IF p_building IS NULL AND v_acc.id IS NOT NULL THEN
        IF v_acc.opening_date >= p_from THEN
            v_opening := v_acc.opening_balance;
        ELSE
            SELECT v_acc.opening_balance + fees + other - spent INTO v_opening
              FROM public._cash_flows(v_acc.opening_date, p_from - 1, NULL);
        END IF;
        IF v_acc.opening_date > p_from THEN
            SELECT fees, other, spent INTO xf, xo, xs FROM public._cash_flows(p_from, LEAST(p_to, v_acc.opening_date - 1), NULL);
            v_before := jsonb_build_object('fees', xf, 'other', xo, 'spent', xs, 'until', LEAST(p_to, v_acc.opening_date - 1));
        END IF;
    END IF;

    IF p_building IS NULL THEN
        SELECT COALESCE(SUM(balance_total), 0), COALESCE(SUM(balance_total) FILTER (WHERE calc_status = 'VENCIDO'), 0)
          INTO v_pending, v_overdue FROM public.vw_service_expenses_calc WHERE calc_status IN ('PENDIENTE', 'VENCIDO');
    ELSE
        SELECT COALESCE(SUM(share_balance), 0), COALESCE(SUM(share_balance) FILTER (WHERE calc_status = 'VENCIDO'), 0)
          INTO v_pending, v_overdue FROM public.vw_expense_allocations_calc
         WHERE building_id = p_building AND calc_status IN ('PENDIENTE', 'VENCIDO');
    END IF;

    IF p_building IS NULL THEN
        FOR b IN SELECT id, name FROM public.buildings WHERE is_active ORDER BY sort_order, name LOOP
            IF v_eff > p_to THEN bf := 0; bo := 0; bs := 0;
            ELSE SELECT fees, other, spent INTO bf, bo, bs FROM public._cash_flows(v_eff, p_to, b.id); END IF;
            v_rows := v_rows || jsonb_build_object('building_id', b.id, 'name', b.name, 'fees', bf, 'other', bo, 'spent', bs,
                                                   'result', bf + bo - bs);
        END LOOP;
        IF v_eff > p_to THEN v_gen_in := 0; v_gen_out := 0;
        ELSE
            SELECT COALESCE(SUM(amount), 0) INTO v_gen_in FROM public.other_income
             WHERE building_id IS NULL AND status = 'VALIDO' AND income_date BETWEEN v_eff AND p_to;
            SELECT COALESCE(SUM(ep.amount), 0) INTO v_gen_out FROM public.expense_payments ep
              JOIN public.service_expenses e ON e.id = ep.expense_id
             WHERE e.scope = 'GENERAL' AND ep.status = 'VALIDO' AND e.status = 'ACTIVO' AND ep.payment_date BETWEEN v_eff AND p_to;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'from', p_from, 'to', p_to, 'effective_from', v_eff,
        'account_configured', v_acc.id IS NOT NULL,
        'account_name', v_acc.name, 'opening_date', v_acc.opening_date,
        'opening_balance', v_opening,
        'fees_collected', v_fees, 'other_income', v_other, 'expenses_paid', v_spent,
        'period_result', v_fees + v_other - v_spent,
        'closing_balance', CASE WHEN v_opening IS NULL THEN NULL ELSE v_opening + v_fees + v_other - v_spent END,
        'pending_obligations', v_pending, 'overdue_obligations', v_overdue,
        'before_opening', v_before,
        'by_building', v_rows,
        'general_income', v_gen_in, 'general_expenses', v_gen_out);
END;
$$;

-- Libro de movimientos: una línea por cada cuota pagada, otro ingreso y pago de gasto --------------------
CREATE OR REPLACE FUNCTION public.get_cash_ledger(p_from DATE, p_to DATE, p_building UUID DEFAULT NULL, p_limit INT DEFAULT 2000)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_rows JSONB;
BEGIN
    IF p_building IS NULL THEN
        IF NOT public.auth_is_superadmin() THEN RAISE EXCEPTION 'Solo el superadmin ve el libro general.'; END IF;
    ELSIF NOT public.auth_is_admin_of(p_building) THEN
        RAISE EXCEPTION 'No tiene permiso para este edificio.';
    END IF;
    IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'Período no válido.'; END IF;

    SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.op_date, m.created_at), '[]'::jsonb) INTO v_rows FROM (
        SELECT * FROM (
            -- Cuotas de mantenimiento cobradas
            SELECT 'CUOTA'::text AS kind, py.id::text AS id, py.payment_date AS op_date, py.registered_at AS created_at,
                   'Cuota de mantenimiento'::text AS category,
                   ('Cuota ' || COALESCE(py.period, '') || ' — Dpto ' || py.unit_code || ' · ' || upper(py.owner_name))::text AS concept,
                   py.building_id, b.name AS building_name,
                   py.amount::numeric AS amount,
                   CASE WHEN py.status = 'RECHAZADO' THEN 'ANULADO' ELSE 'VALIDO' END AS status,
                   NULL::text AS expense_id, py.proof_file_path AS proof_path, py.method AS method
              FROM public.payments py JOIN public.buildings b ON b.id = py.building_id
             WHERE py.payment_date BETWEEN p_from AND p_to AND (p_building IS NULL OR py.building_id = p_building)
            UNION ALL
            -- Otros ingresos
            SELECT 'INGRESO', oi.id::text, oi.income_date, oi.created_at, 'Otro ingreso', oi.concept::text,
                   oi.building_id, COALESCE(b.name, 'General'), oi.amount::numeric,
                   CASE WHEN oi.status = 'ANULADO' THEN 'ANULADO' ELSE 'VALIDO' END,
                   NULL::text, NULL::text, NULL::text
              FROM public.other_income oi LEFT JOIN public.buildings b ON b.id = oi.building_id
             WHERE oi.income_date BETWEEN p_from AND p_to AND (p_building IS NULL OR oi.building_id = p_building)
            UNION ALL
            -- Pagos de gastos (egresos); con filtro de edificio, solo su parte
            SELECT 'GASTO', ep.id::text, ep.payment_date, ep.registered_at,
                   COALESCE(e.category, 'Gasto'),
                   (e.concept || COALESCE(' · ' || pr.name, ''))::text,
                   CASE WHEN p_building IS NULL THEN NULL ELSE p_building END,
                   CASE WHEN p_building IS NULL THEN
                        COALESCE((SELECT string_agg(bb.name, ' / ' ORDER BY bb.name) FROM public.expense_allocations a
                                    JOIN public.buildings bb ON bb.id = a.building_id WHERE a.expense_id = e.id), 'General')
                        ELSE (SELECT bb.name FROM public.buildings bb WHERE bb.id = p_building) END,
                   -(CASE WHEN p_building IS NULL THEN ep.amount
                          ELSE ep.amount * (SELECT a.amount FROM public.expense_allocations a WHERE a.expense_id = e.id AND a.building_id = p_building) / e.amount END)::numeric,
                   CASE WHEN ep.status = 'ANULADO' OR e.status = 'ANULADO' THEN 'ANULADO' ELSE 'VALIDO' END,
                   e.id::text, NULL::text, ep.method
              FROM public.expense_payments ep
              JOIN public.service_expenses e ON e.id = ep.expense_id
              LEFT JOIN public.service_providers pr ON pr.id = e.provider_id
             WHERE ep.payment_date BETWEEN p_from AND p_to
               AND (p_building IS NULL OR EXISTS (SELECT 1 FROM public.expense_allocations a WHERE a.expense_id = e.id AND a.building_id = p_building))
        ) u
        ORDER BY u.op_date DESC, u.created_at DESC
        LIMIT GREATEST(LEAST(COALESCE(p_limit, 2000), 5000), 1)
    ) m;
    RETURN v_rows;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_cash_summary(DATE, DATE, UUID), public.get_cash_ledger(DATE, DATE, UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cash_summary(DATE, DATE, UUID), public.get_cash_ledger(DATE, DATE, UUID, INT) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
