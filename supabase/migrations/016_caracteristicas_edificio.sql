-- ==============================================================================
-- 016 - CARACTERÍSTICAS DEL EDIFICIO dentro de Gestión de Edificios
-- save_building ahora también guarda: ascensores, estacionamientos, sótanos,
-- puertas de garaje y horario de vigilancia (las columnas ya existían).
-- Si el formulario no envía un dato, se conserva el valor actual.
-- ==============================================================================
BEGIN;

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
    v_elev    INT     := NULLIF(p_data->>'elevators_count', '')::int;
    v_park    INT     := NULLIF(p_data->>'parking_spots_count', '')::int;
    v_base    INT     := NULLIF(p_data->>'basements_count', '')::int;
    v_doors   INT     := NULLIF(p_data->>'garage_doors_count', '')::int;
    v_guard   TEXT    := NULLIF(trim(COALESCE(p_data->>'surveillance_hours', '')), '');
    v_row     public.buildings;
    v_admin   TEXT;
BEGIN
    IF NOT public.auth_is_superadmin() THEN
        RAISE EXCEPTION 'Acceso denegado: solo el superadmin puede gestionar edificios.';
    END IF;

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
    IF COALESCE(v_elev, 0) < 0 OR COALESCE(v_park, 0) < 0 OR COALESCE(v_base, 0) < 0 OR COALESCE(v_doors, 0) < 0 THEN
        RAISE EXCEPTION 'Las características del edificio no pueden ser negativas.';
    END IF;
    IF v_guard IS NOT NULL AND char_length(v_guard) > 100 THEN
        RAISE EXCEPTION 'El horario de vigilancia es demasiado largo (máximo 100 caracteres).';
    END IF;

    SELECT full_name INTO v_admin FROM public.user_profiles WHERE id = auth.uid();

    BEGIN
        IF v_id IS NULL THEN
            INSERT INTO public.buildings (
                code, name, legal_name, tax_id, address, city, country,
                total_floors, total_units, default_due_day, default_fee, brand_color,
                elevators_count, parking_spots_count, basements_count, garage_doors_count, surveillance_hours,
                sort_order, created_by
            ) VALUES (
                v_code, v_name, v_legal, v_tax, v_address, v_city, v_country,
                v_floors, v_units, v_due, v_fee, v_color,
                COALESCE(v_elev, 0), COALESCE(v_park, 0), COALESCE(v_base, 0), COALESCE(v_doors, 0), v_guard,
                (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM public.buildings), auth.uid()
            ) RETURNING * INTO v_row;

            INSERT INTO public.interest_rules (building_id, type, rate_percent, grace_days, applied_from_day, rounding, is_active)
            VALUES (v_row.id, 'PORCENTAJE_DIARIO', v_rate, v_grace, v_due + 1, 'DOS_DECADAS', TRUE);
        ELSE
            UPDATE public.buildings
               SET name = v_name, legal_name = v_legal, tax_id = v_tax, address = v_address,
                   city = v_city, country = v_country, total_floors = v_floors, total_units = v_units,
                   default_due_day = v_due, default_fee = v_fee, brand_color = v_color,
                   elevators_count = COALESCE(v_elev, elevators_count),
                   parking_spots_count = COALESCE(v_park, parking_spots_count),
                   basements_count = COALESCE(v_base, basements_count),
                   garage_doors_count = COALESCE(v_doors, garage_doors_count),
                   surveillance_hours = CASE WHEN p_data ? 'surveillance_hours' THEN v_guard ELSE surveillance_hours END,
                   updated_at = NOW()
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

REVOKE EXECUTE ON FUNCTION public.save_building(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_building(JSONB) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
