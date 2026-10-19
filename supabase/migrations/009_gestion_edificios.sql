-- ==============================================================================
-- MIGRACIÓN 009: GESTIÓN DE EDIFICIOS (FASE 2)
--   * Datos del edificio: razón social, RUC, color, cuota por defecto
--   * Desactivar en vez de borrar (con quién y cuándo) y orden manual
--   * Crear / editar un edificio y su regla de mora en UNA sola operación segura
-- ------------------------------------------------------------------------------
-- Requiere las migraciones 007 y 008. Solo el superadmin puede usar estas funciones.
-- ==============================================================================

BEGIN;

-- 1. Nuevas columnas -----------------------------------------------------------------
ALTER TABLE public.buildings
    ADD COLUMN IF NOT EXISTS legal_name     TEXT,
    ADD COLUMN IF NOT EXISTS tax_id         VARCHAR(20),                       -- RUC (opcional)
    ADD COLUMN IF NOT EXISTS brand_color    VARCHAR(7)    NOT NULL DEFAULT '#4f7609',
    ADD COLUMN IF NOT EXISTS default_fee    DECIMAL(10,2) NOT NULL DEFAULT 150.00,
    ADD COLUMN IF NOT EXISTS is_active      BOOLEAN       NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS sort_order     INT           NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS deactivated_by UUID,
    ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS created_by     UUID;

-- El RUC no se repite entre edificios activos
CREATE UNIQUE INDEX IF NOT EXISTS uq_buildings_tax_id_active
    ON public.buildings (tax_id) WHERE tax_id IS NOT NULL AND is_active;

UPDATE public.buildings
   SET sort_order = 1, default_fee = 150.00
 WHERE code = 'PK10' AND sort_order = 0;

-- 2. Validación del RUC peruano (11 dígitos con dígito verificador) ------------------
CREATE OR REPLACE FUNCTION public.is_valid_ruc(p_ruc TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    w INT[] := ARRAY[5,4,3,2,7,6,5,4,3,2];
    s INT := 0;
    r INT;
BEGIN
    IF p_ruc !~ '^[0-9]{11}$' THEN RETURN FALSE; END IF;
    FOR i IN 1..10 LOOP
        s := s + substr(p_ruc, i, 1)::int * w[i];
    END LOOP;
    r := 11 - (s % 11);
    IF r = 10 THEN r := 0; ELSIF r = 11 THEN r := 1; END IF;
    RETURN r = substr(p_ruc, 11, 1)::int;
END;
$$;

-- 3. Crear o editar un edificio (+ su regla de mora) en una sola transacción -------------
CREATE OR REPLACE FUNCTION public.save_building(p_data JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_id      UUID    := NULLIF(p_data->>'id', '')::uuid;
    v_code    TEXT    := upper(trim(COALESCE(p_data->>'code', '')));
    v_name    TEXT    := trim(COALESCE(p_data->>'name', ''));
    v_legal   TEXT    := NULLIF(trim(COALESCE(p_data->>'legal_name', '')), '');
    v_tax     TEXT    := NULLIF(regexp_replace(COALESCE(p_data->>'tax_id', ''), '\s', '', 'g'), '');
    v_address TEXT    := trim(COALESCE(p_data->>'address', ''));
    v_city    TEXT    := COALESCE(NULLIF(trim(COALESCE(p_data->>'city', '')), ''), 'Arequipa');
    v_country TEXT    := COALESCE(NULLIF(trim(COALESCE(p_data->>'country', '')), ''), 'Perú');
    v_floors  INT     := COALESCE((p_data->>'total_floors')::int, 0);
    v_units   INT     := COALESCE((p_data->>'total_units')::int, 0);
    v_due     INT     := COALESCE((p_data->>'default_due_day')::int, 5);
    v_fee     NUMERIC := COALESCE((p_data->>'default_fee')::numeric, 0);
    v_color   TEXT    := COALESCE(NULLIF(trim(COALESCE(p_data->>'brand_color', '')), ''), '#4f7609');
    v_rate    NUMERIC := COALESCE((p_data->>'rate_percent')::numeric, 0.10);
    v_grace   INT     := COALESCE((p_data->>'grace_days')::int, 0);
    v_row     public.buildings;
    v_admin   TEXT;
BEGIN
    IF NOT public.auth_is_superadmin() THEN
        RAISE EXCEPTION 'Acceso denegado: solo el superadmin puede gestionar edificios.';
    END IF;

    -- Validaciones (el servidor no confía en el formulario)
    IF v_name = '' THEN RAISE EXCEPTION 'El nombre del edificio es obligatorio.'; END IF;
    IF v_id IS NULL AND v_code !~ '^[A-Z0-9]{2,10}$' THEN
        RAISE EXCEPTION 'El código debe tener de 2 a 10 letras o números (sin espacios).';
    END IF;
    IF v_address = '' THEN RAISE EXCEPTION 'La dirección es obligatoria.'; END IF;
    IF v_tax IS NOT NULL AND NOT public.is_valid_ruc(v_tax) THEN
        RAISE EXCEPTION 'El RUC no es válido (11 dígitos con dígito verificador).';
    END IF;
    IF v_floors < 1 THEN RAISE EXCEPTION 'El número de pisos debe ser al menos 1.'; END IF;
    IF v_units < 0 THEN RAISE EXCEPTION 'El número de departamentos no puede ser negativo.'; END IF;
    IF v_due < 1 OR v_due > 28 THEN RAISE EXCEPTION 'El día de vencimiento debe estar entre 1 y 28.'; END IF;
    IF v_fee <= 0 THEN RAISE EXCEPTION 'La cuota mensual debe ser mayor a cero.'; END IF;
    IF v_color !~ '^#[0-9a-fA-F]{6}$' THEN RAISE EXCEPTION 'El color no es válido.'; END IF;
    IF v_rate < 0 OR v_rate > 100 THEN RAISE EXCEPTION 'La tasa de mora debe estar entre 0 y 100.'; END IF;
    IF v_grace < 0 THEN RAISE EXCEPTION 'Los días de gracia no pueden ser negativos.'; END IF;

    SELECT full_name INTO v_admin FROM public.user_profiles WHERE id = auth.uid();

    BEGIN
        IF v_id IS NULL THEN
            INSERT INTO public.buildings (
                code, name, legal_name, tax_id, address, city, country,
                total_floors, total_units, default_due_day, default_fee, brand_color,
                sort_order, created_by
            ) VALUES (
                v_code, v_name, v_legal, v_tax, v_address, v_city, v_country,
                v_floors, v_units, v_due, v_fee, v_color,
                (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM public.buildings), auth.uid()
            ) RETURNING * INTO v_row;

            INSERT INTO public.interest_rules (building_id, type, rate_percent, grace_days, applied_from_day, rounding, is_active)
            VALUES (v_row.id, 'PORCENTAJE_DIARIO', v_rate, v_grace, v_due + 1, 'DOS_DECADAS', TRUE);
        ELSE
            -- El código no se modifica después de crear el edificio
            UPDATE public.buildings
               SET name = v_name, legal_name = v_legal, tax_id = v_tax, address = v_address,
                   city = v_city, country = v_country, total_floors = v_floors, total_units = v_units,
                   default_due_day = v_due, default_fee = v_fee, brand_color = v_color, updated_at = NOW()
             WHERE id = v_id
         RETURNING * INTO v_row;
            IF NOT FOUND THEN RAISE EXCEPTION 'El edificio no existe.'; END IF;

            UPDATE public.interest_rules
               SET rate_percent = v_rate, grace_days = v_grace, applied_from_day = v_due + 1, updated_at = NOW()
             WHERE building_id = v_id;
            IF NOT FOUND THEN
                INSERT INTO public.interest_rules (building_id, type, rate_percent, grace_days, applied_from_day, rounding, is_active)
                VALUES (v_id, 'PORCENTAJE_DIARIO', v_rate, v_grace, v_due + 1, 'DOS_DECADAS', TRUE);
            END IF;
        END IF;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'Ya existe un edificio con ese código o con ese RUC.';
    END;

    INSERT INTO public.audit_logs (building_id, action, description, performed_by)
    VALUES (v_row.id, CASE WHEN v_id IS NULL THEN 'CREAR_EDIFICIO' ELSE 'EDITAR_EDIFICIO' END,
            format('%s el edificio %s (%s)', CASE WHEN v_id IS NULL THEN 'Creó' ELSE 'Editó' END, v_row.name, v_row.code),
            COALESCE(v_admin, 'Administración'));

    RETURN to_jsonb(v_row);
END;
$$;

-- 4. Qué se vería afectado al desactivar un edificio ----------------------------------------
CREATE OR REPLACE FUNCTION public.building_impact(p_building_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    IF NOT public.auth_is_superadmin() THEN
        RAISE EXCEPTION 'Acceso denegado.';
    END IF;
    RETURN jsonb_build_object(
        'units', (SELECT count(*) FROM public.units WHERE building_id = p_building_id),
        'people', (SELECT count(DISTINCT uu.user_id) FROM public.user_units uu
                    JOIN public.units u ON u.id = uu.unit_id
                   WHERE u.building_id = p_building_id AND uu.active),
        'pending_fees', (SELECT count(*) FROM public.maintenance_fees
                          WHERE building_id = p_building_id AND status <> 'PAGADO')
    );
END;
$$;

-- 5. Desactivar / reactivar (nunca se borra) ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_building_active(p_building_id UUID, p_active BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_admin TEXT;
    v_name  TEXT;
BEGIN
    IF NOT public.auth_is_superadmin() THEN
        RAISE EXCEPTION 'Acceso denegado: solo el superadmin puede gestionar edificios.';
    END IF;

    UPDATE public.buildings
       SET is_active = p_active,
           deactivated_by = CASE WHEN p_active THEN NULL ELSE auth.uid() END,
           deactivated_at = CASE WHEN p_active THEN NULL ELSE NOW() END,
           updated_at = NOW()
     WHERE id = p_building_id
 RETURNING name INTO v_name;
    IF NOT FOUND THEN RAISE EXCEPTION 'El edificio no existe.'; END IF;

    SELECT full_name INTO v_admin FROM public.user_profiles WHERE id = auth.uid();
    INSERT INTO public.audit_logs (building_id, action, description, performed_by)
    VALUES (p_building_id, CASE WHEN p_active THEN 'REACTIVAR_EDIFICIO' ELSE 'DESACTIVAR_EDIFICIO' END,
            format('%s el edificio %s', CASE WHEN p_active THEN 'Reactivó' ELSE 'Desactivó' END, v_name),
            COALESCE(v_admin, 'Administración'));
END;
$$;

-- 6. Orden manual (una sola operación) -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reorder_buildings(p_ids UUID[])
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    IF NOT public.auth_is_superadmin() THEN
        RAISE EXCEPTION 'Acceso denegado: solo el superadmin puede ordenar edificios.';
    END IF;
    UPDATE public.buildings b
       SET sort_order = t.idx
      FROM unnest(p_ids) WITH ORDINALITY AS t(id, idx)
     WHERE b.id = t.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_building(JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.building_impact(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_building_active(UUID, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reorder_buildings(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_building(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.building_impact(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_building_active(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_buildings(UUID[]) TO authenticated;

-- 7. Un edificio desactivado deja de verse para propietarios e inquilinos ----------------------------
--    (el superadmin sigue viéndolo para poder reactivarlo)
CREATE OR REPLACE FUNCTION public.get_auth_user_profile()
RETURNS TABLE (
    user_id UUID,
    building_id UUID,
    unit_id UUID,
    role VARCHAR
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT p.id, b.id, NULL::uuid, 'administradora'::varchar
      FROM public.user_profiles p
      CROSS JOIN public.buildings b
     WHERE p.id = auth.uid() AND p.is_active AND p.role = 'superadmin'
    UNION ALL
    SELECT p.id, p.building_id, NULL::uuid, 'administradora'::varchar
      FROM public.user_profiles p
      JOIN public.buildings b ON b.id = p.building_id AND b.is_active
     WHERE p.id = auth.uid() AND p.is_active AND p.role = 'administradora'
    UNION ALL
    SELECT p.id, u.building_id, uu.unit_id, 'propietario'::varchar
      FROM public.user_profiles p
      JOIN public.user_units uu ON uu.user_id = p.id AND uu.active
      JOIN public.units u ON u.id = uu.unit_id
      JOIN public.buildings b ON b.id = u.building_id AND b.is_active
     WHERE p.id = auth.uid() AND p.is_active;
$$;

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
                       'is_active', b.is_active, 'brand_color', b.brand_color)
                   ORDER BY b.sort_order, b.name)
              FROM public.buildings b
             WHERE p.role = 'superadmin' OR (p.role = 'administradora' AND b.id = p.building_id)), '[]'::jsonb)
    )
    FROM public.user_profiles p
    WHERE p.id = auth.uid() AND p.is_active;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
