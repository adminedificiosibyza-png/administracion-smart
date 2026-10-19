-- ==============================================================================
-- MIGRACIÓN 011: DEPARTAMENTOS Y PERSONAS CONECTADOS (FASE 3)
-- ------------------------------------------------------------------------------
-- Requiere 005, 007, 009 y 010.
--
-- Fuente única de verdad: la ASIGNACIÓN persona <-> departamento (user_units).
--   * El "titular" de un departamento es la persona activa con relación PROPIETARIO
--     (si hay varias, la que se asignó primero).
--   * La cobranza muestra el titular actual en las cuotas NO pagadas; las pagadas
--     conservan el nombre con el que se pagaron (historial).
--   * Al generar cuotas nuevas se usa el titular actual.
-- También agrega las funciones para crear, editar y eliminar departamentos.
-- ==============================================================================

BEGIN;

-- 1. Titular de un departamento ---------------------------------------------------------
-- Solo responde a quien tiene acceso a ese departamento o lo administra.
CREATE OR REPLACE FUNCTION public.unit_titular_name(p_unit_id UUID)
RETURNS VARCHAR(200)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT p.full_name::varchar(200)
      FROM public.user_units uu
      JOIN public.user_profiles p ON p.id = uu.user_id
     WHERE uu.unit_id = p_unit_id
       AND uu.relation = 'PROPIETARIO' AND uu.active AND p.is_active
       AND (public.auth_has_unit(p_unit_id)
            OR public.auth_is_admin_of((SELECT u.building_id FROM public.units u WHERE u.id = p_unit_id)))
     ORDER BY uu.created_at, uu.id
     LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.unit_titular_name(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unit_titular_name(UUID) TO authenticated;

-- 2. La cobranza muestra al titular actual en las cuotas pendientes --------------------------
CREATE OR REPLACE VIEW public.vw_maintenance_fees_calc
WITH (security_invoker = true) AS
SELECT
    f.id, f.building_id, f.unit_id, f.unit_code,
    (CASE WHEN f.status = 'PAGADO' THEN f.owner_name
          ELSE COALESCE(public.unit_titular_name(f.unit_id), f.owner_name) END)::varchar(200) AS owner_name,
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

-- 3. Cuotas nuevas: nombre del titular actual ------------------------------------------------
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
            public.unit_titular_name(u.id),
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

-- 4. Estructura del edificio: los totales salen de los departamentos reales ----------------------
CREATE OR REPLACE FUNCTION public.sync_building_structure(p_building_id UUID)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
    UPDATE public.buildings b
       SET total_units  = (SELECT count(*) FROM public.units u WHERE u.building_id = b.id),
           total_floors = GREATEST(b.total_floors, COALESCE((SELECT max(u.floor) FROM public.units u WHERE u.building_id = b.id), 1)),
           updated_at   = NOW()
     WHERE b.id = p_building_id;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_building_structure(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_building_structure(UUID) FROM authenticated;

-- 5. Crear / editar un departamento ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_unit(p_data JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_id       UUID := NULLIF(p_data->>'id', '')::uuid;
    v_building UUID := NULLIF(p_data->>'building_id', '')::uuid;
    v_code     TEXT := upper(trim(COALESCE(p_data->>'code', '')));
    v_floor    INT  := COALESCE((p_data->>'floor')::int, -1);
    v_status   TEXT := COALESCE(NULLIF(p_data->>'status', ''), 'OCUPADO');
    v_old      public.units;
    v_row      public.units;
    v_fee      DECIMAL(10,2);
    v_admin    TEXT;
BEGIN
    IF v_id IS NOT NULL THEN
        SELECT * INTO v_old FROM public.units WHERE id = v_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'El departamento no existe.'; END IF;
        v_building := v_old.building_id;
    END IF;

    IF v_building IS NULL OR NOT public.auth_is_admin_of(v_building) THEN
        RAISE EXCEPTION 'Acceso denegado: solo la administración puede gestionar departamentos.';
    END IF;
    IF v_code !~ '^[A-Z0-9-]{1,10}$' THEN
        RAISE EXCEPTION 'El número del departamento debe tener de 1 a 10 letras, números o guiones.';
    END IF;
    IF v_floor < 0 OR v_floor > 100 THEN RAISE EXCEPTION 'El piso no es válido.'; END IF;
    IF v_status NOT IN ('OCUPADO', 'DESOCUPADO', 'EN_ALQUILER') THEN
        RAISE EXCEPTION 'El estado de ocupación no es válido.';
    END IF;

    -- El número no se cambia si el departamento ya tiene historial (cuotas, pagos o reservas)
    IF v_id IS NOT NULL AND v_code <> v_old.code THEN
        IF EXISTS (SELECT 1 FROM public.maintenance_fees WHERE unit_id = v_id)
           OR EXISTS (SELECT 1 FROM public.payments WHERE unit_id = v_id)
           OR EXISTS (SELECT 1 FROM public.reservations WHERE unit_id = v_id) THEN
            RAISE EXCEPTION 'No se puede cambiar el número: el departamento ya tiene cuotas, pagos o reservas.';
        END IF;
    END IF;

    SELECT default_fee INTO v_fee FROM public.buildings WHERE id = v_building;

    BEGIN
        IF v_id IS NULL THEN
            INSERT INTO public.units (building_id, code, floor, monthly_fee, status)
            VALUES (v_building, v_code, v_floor, v_fee, v_status)
            RETURNING * INTO v_row;
        ELSE
            UPDATE public.units
               SET code = v_code, floor = v_floor, status = v_status, updated_at = NOW()
             WHERE id = v_id
         RETURNING * INTO v_row;
        END IF;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'Ya existe el departamento % en este edificio.', v_code;
    END;

    PERFORM public.sync_building_structure(v_building);

    SELECT full_name INTO v_admin FROM public.user_profiles WHERE id = auth.uid();
    INSERT INTO public.audit_logs (building_id, action, description, performed_by)
    VALUES (v_building, CASE WHEN v_id IS NULL THEN 'CREAR_DEPARTAMENTO' ELSE 'EDITAR_DEPARTAMENTO' END,
            format('%s el departamento %s (piso %s)', CASE WHEN v_id IS NULL THEN 'Creó' ELSE 'Editó' END, v_row.code, v_row.floor),
            COALESCE(v_admin, 'Administración'));

    RETURN to_jsonb(v_row);
END;
$$;

-- 6. Crear varios departamentos por piso -----------------------------------------------------------
-- p_floors = [{"floor":1,"count":4},{"floor":2,"count":5}, ...]  ->  101..104, 201..205, ...
CREATE OR REPLACE FUNCTION public.create_units_bulk(p_building_id UUID, p_floors JSONB)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_item    JSONB;
    v_floor   INT;
    v_count   INT;
    v_fee     DECIMAL(10,2);
    v_created INT := 0;
    v_total   INT := 0;
    v_rows    INT;
    v_admin   TEXT;
BEGIN
    IF p_building_id IS NULL OR NOT public.auth_is_admin_of(p_building_id) THEN
        RAISE EXCEPTION 'Acceso denegado: solo la administración puede gestionar departamentos.';
    END IF;
    IF jsonb_typeof(p_floors) <> 'array' OR jsonb_array_length(p_floors) = 0 THEN
        RAISE EXCEPTION 'Indique al menos un piso con su cantidad de departamentos.';
    END IF;

    SELECT default_fee INTO v_fee FROM public.buildings WHERE id = p_building_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_floors) LOOP
        v_floor := (v_item->>'floor')::int;
        v_count := (v_item->>'count')::int;
        IF v_floor IS NULL OR v_floor < 1 OR v_floor > 100 THEN RAISE EXCEPTION 'Piso inválido: %.', v_item->>'floor'; END IF;
        IF v_count IS NULL OR v_count < 1 OR v_count > 30 THEN RAISE EXCEPTION 'Cantidad inválida en el piso %: debe ser de 1 a 30.', v_floor; END IF;
        v_total := v_total + v_count;
        IF v_total > 500 THEN RAISE EXCEPTION 'Demasiados departamentos en una sola operación (máximo 500).'; END IF;

        INSERT INTO public.units (building_id, code, floor, monthly_fee, status)
        SELECT p_building_id, v_floor::text || lpad(n::text, 2, '0'), v_floor, v_fee, 'OCUPADO'
          FROM generate_series(1, v_count) AS n
        ON CONFLICT (building_id, code) DO NOTHING;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_created := v_created + v_rows;
    END LOOP;

    PERFORM public.sync_building_structure(p_building_id);

    SELECT full_name INTO v_admin FROM public.user_profiles WHERE id = auth.uid();
    INSERT INTO public.audit_logs (building_id, action, description, performed_by)
    VALUES (p_building_id, 'CREAR_DEPARTAMENTOS',
            format('Creó %s departamentos por piso', v_created), COALESCE(v_admin, 'Administración'));

    RETURN v_created;
END;
$$;

-- 7. Eliminar un departamento (solo si no tiene historial ni personas) --------------------------------
CREATE OR REPLACE FUNCTION public.delete_unit(p_unit_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_unit  public.units;
    v_admin TEXT;
BEGIN
    SELECT * INTO v_unit FROM public.units WHERE id = p_unit_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'El departamento no existe.'; END IF;
    IF NOT public.auth_is_admin_of(v_unit.building_id) THEN
        RAISE EXCEPTION 'Acceso denegado: solo la administración puede gestionar departamentos.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.user_units WHERE unit_id = p_unit_id AND active) THEN
        RAISE EXCEPTION 'El departamento tiene personas asignadas. Quite primero sus asignaciones.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.maintenance_fees WHERE unit_id = p_unit_id)
       OR EXISTS (SELECT 1 FROM public.payments WHERE unit_id = p_unit_id)
       OR EXISTS (SELECT 1 FROM public.reservations WHERE unit_id = p_unit_id) THEN
        RAISE EXCEPTION 'El departamento tiene cuotas, pagos o reservas registradas y no se puede eliminar. Márquelo como desocupado en su lugar.';
    END IF;

    DELETE FROM public.units WHERE id = p_unit_id;   -- las asignaciones inactivas se borran en cascada
    PERFORM public.sync_building_structure(v_unit.building_id);

    SELECT full_name INTO v_admin FROM public.user_profiles WHERE id = auth.uid();
    INSERT INTO public.audit_logs (building_id, action, description, performed_by)
    VALUES (v_unit.building_id, 'ELIMINAR_DEPARTAMENTO',
            format('Eliminó el departamento %s', v_unit.code), COALESCE(v_admin, 'Administración'));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_unit(JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_units_bulk(UUID, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_unit(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_unit(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_units_bulk(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_unit(UUID) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
