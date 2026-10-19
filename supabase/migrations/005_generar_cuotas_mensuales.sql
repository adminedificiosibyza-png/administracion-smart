-- ==============================================================================
-- MIGRACIÓN 005: GENERACIÓN DE CUOTAS MENSUALES
-- ------------------------------------------------------------------------------
-- Crea las cuotas de un mes para TODOS los departamentos del edificio:
--   * monto  = units.monthly_fee (S/ 150.00)
--   * vence  = día buildings.default_due_day (5) de ese mes
--   * nombre = el del propietario de la última cuota del departamento
-- Es idempotente: si la cuota de un departamento/mes ya existe, no se duplica
-- (usa el índice único uq_fees_unit_period de la migración 002).
-- Requiere la migración 002 (period_month).
-- ==============================================================================

-- Lógica interna (sin chequeo de usuario). No se expone a la API.
CREATE OR REPLACE FUNCTION public.generate_fees_for_period(p_building_id UUID, p_period_month DATE)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_period DATE := date_trunc('month', p_period_month)::date;
    v_due_day INT;
    v_months TEXT[] := ARRAY['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio',
                             'Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    v_label TEXT;
    v_created INT;
BEGIN
    SELECT default_due_day INTO v_due_day FROM public.buildings WHERE id = p_building_id;
    IF v_due_day IS NULL THEN
        RAISE EXCEPTION 'Edificio no encontrado.';
    END IF;

    v_label := v_months[EXTRACT(MONTH FROM v_period)::int] || ' ' || EXTRACT(YEAR FROM v_period)::int;

    INSERT INTO public.maintenance_fees
        (building_id, unit_id, unit_code, owner_name, period, period_month, due_date,
         fee_amount, total_amount, total_pending, status)
    SELECT
        u.building_id, u.id, u.code,
        COALESCE(
            (SELECT f.owner_name FROM public.maintenance_fees f
              WHERE f.unit_id = u.id ORDER BY f.period_month DESC LIMIT 1),
            (SELECT o.full_name FROM public.owners o
              WHERE o.unit_id = u.id ORDER BY o.is_primary_owner DESC LIMIT 1),
            'Propietario por asignar'),
        v_label, v_period, v_period + (v_due_day - 1),
        u.monthly_fee, u.monthly_fee, u.monthly_fee, 'PENDIENTE'
    FROM public.units u
    WHERE u.building_id = p_building_id
    ON CONFLICT (unit_id, period_month) DO NOTHING;

    GET DIAGNOSTICS v_created = ROW_COUNT;
    RETURN v_created;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_fees_for_period(UUID, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_fees_for_period(UUID, DATE) FROM authenticated;

-- Función que usa la app: solo la administradora, solo su edificio
CREATE OR REPLACE FUNCTION public.generate_monthly_fees(p_period_month DATE)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_role TEXT;
    v_building UUID;
    v_admin_name TEXT;
    v_period DATE := date_trunc('month', p_period_month)::date;
    v_today_month DATE := date_trunc('month', (now() AT TIME ZONE 'America/Lima'))::date;
    v_created INT;
BEGIN
    SELECT p.role, p.building_id INTO v_role, v_building FROM public.get_auth_user_profile() p;
    IF v_role IS DISTINCT FROM 'administradora' THEN
        RAISE EXCEPTION 'Acceso denegado: solo la administradora puede generar cuotas.';
    END IF;

    -- Evita errores de tipeo: de un mes atrás hasta 12 meses adelante
    IF p_period_month IS NULL
       OR v_period < (v_today_month - interval '1 month')::date
       OR v_period > (v_today_month + interval '12 months')::date THEN
        RAISE EXCEPTION 'El período debe estar entre el mes anterior y los próximos 12 meses.';
    END IF;

    v_created := public.generate_fees_for_period(v_building, v_period);

    SELECT full_name INTO v_admin_name FROM public.user_profiles WHERE id = auth.uid();
    INSERT INTO public.audit_logs (building_id, action, description, performed_by)
    VALUES (v_building, 'GENERAR_CUOTAS',
            format('Generó las cuotas de %s: %s nuevas', to_char(v_period, 'YYYY-MM'), v_created),
            COALESCE(v_admin_name, 'Administración'));

    RETURN v_created;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_monthly_fees(DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_monthly_fees(DATE) TO authenticated;

-- ------------------------------------------------------------------------------
-- OPCIONAL (NO activado): generar solo, el día 25 de cada mes, las cuotas del mes
-- siguiente. Requiere habilitar la extensión pg_cron en Supabase
-- (Database > Extensions). Descomentar solo si se decide automatizar.
--
-- select cron.schedule(
--   'generar-cuotas-mes-siguiente', '0 13 25 * *',
--   $$ select public.generate_fees_for_period(
--        'b1d00000-0000-0000-0000-000000000001',
--        (date_trunc('month', now() at time zone 'America/Lima') + interval '1 month')::date) $$
-- );
-- ------------------------------------------------------------------------------

NOTIFY pgrst, 'reload schema';
