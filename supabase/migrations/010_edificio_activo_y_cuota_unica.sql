-- ==============================================================================
-- MIGRACIÓN 010: ENTRAR POR EDIFICIO + UN SOLO LUGAR PARA LA CUOTA
-- ------------------------------------------------------------------------------
-- Requiere 005, 007 y 009.
--
-- 1) La cuota mensual sale SOLO de buildings.default_fee (se edita en Gestión de
--    Edificios). Antes, "Generar cuotas" usaba units.monthly_fee, un valor
--    guardado en cada departamento que la pantalla no mostraba ni permitía editar.
--    Un cambio de cuota afecta a las cuotas que se generen DESPUÉS; las ya
--    generadas conservan el monto con el que se crearon.
-- 2) get_my_context devuelve más datos de cada edificio (para la barra lateral).
-- 3) get_building_summaries: resumen por edificio para la página de inicio.
-- ==============================================================================

BEGIN;

-- 1. Generación de cuotas: monto = cuota del edificio ------------------------------------
CREATE OR REPLACE FUNCTION public.generate_fees_for_period(p_building_id UUID, p_period_month DATE)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_period DATE := date_trunc('month', p_period_month)::date;
    v_due_day INT;
    v_fee DECIMAL(10,2);
    v_months TEXT[] := ARRAY['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio',
                             'Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    v_label TEXT;
    v_created INT;
BEGIN
    SELECT default_due_day, default_fee INTO v_due_day, v_fee
      FROM public.buildings WHERE id = p_building_id;
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
        v_fee, v_fee, v_fee, 'PENDIENTE'
    FROM public.units u
    WHERE u.building_id = p_building_id
    ON CONFLICT (unit_id, period_month) DO NOTHING;

    GET DIAGNOSTICS v_created = ROW_COUNT;
    RETURN v_created;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_fees_for_period(UUID, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_fees_for_period(UUID, DATE) FROM authenticated;

-- Sincroniza la cuota de los edificios existentes con lo que hoy cobran sus departamentos
UPDATE public.buildings b
   SET default_fee = sub.fee
  FROM (SELECT building_id, MAX(monthly_fee) AS fee FROM public.units GROUP BY building_id) sub
 WHERE b.id = sub.building_id AND b.code = 'PK10';

-- 2. Contexto de sesión con más datos del edificio -----------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_context()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT jsonb_build_object(
        'user_id',       p.id,
        'full_name',     p.full_name,
        'username',      p.username,
        'role',          p.role,
        'is_superadmin', (p.role = 'superadmin'),
        'assignments', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'assignment_id',  uu.id,
                       'unit_id',        u.id,
                       'unit_code',      u.code,
                       'floor',          u.floor,
                       'building_id',    b.id,
                       'building_name',  b.name,
                       'building_code',  b.code,
                       'brand_color',    b.brand_color,
                       'relation',       uu.relation,
                       'can_view_fees',  uu.can_view_fees)
                   ORDER BY b.sort_order, b.name, u.code)
              FROM public.user_units uu
              JOIN public.units u ON u.id = uu.unit_id
              JOIN public.buildings b ON b.id = u.building_id AND b.is_active
             WHERE uu.user_id = p.id AND uu.active), '[]'::jsonb),
        'buildings', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'id', b.id, 'name', b.name, 'code', b.code,
                       'is_active', b.is_active, 'brand_color', b.brand_color,
                       'total_units', b.total_units, 'total_floors', b.total_floors,
                       'city', b.city, 'address', b.address)
                   ORDER BY b.sort_order, b.name)
              FROM public.buildings b
             WHERE p.role = 'superadmin' OR (p.role = 'administradora' AND b.id = p.building_id)), '[]'::jsonb)
    )
    FROM public.user_profiles p
    WHERE p.id = auth.uid() AND p.is_active;
$$;

-- 3. Resumen por edificio para la página de inicio del superadmin ---------------------------
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
                              WHERE f.building_id = b.id AND f.status = 'PENDIENTE'),
            'overdue_fees', (SELECT count(*) FROM public.maintenance_fees f
                              WHERE f.building_id = b.id AND f.status = 'PENDIENTE' AND f.due_date < v_today)
        ))
        FROM public.buildings b WHERE b.is_active), '[]'::jsonb);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_building_summaries() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_building_summaries() TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
