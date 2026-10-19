-- ==============================================================================
-- MIGRACIÓN 013: NORMAS DE CONVIVENCIA PROPIAS DE CADA EDIFICIO
-- ------------------------------------------------------------------------------
-- Requiere 007 (funciones de acceso). Reutiliza la tabla rules (categoría + norma) y
-- sus políticas existentes: cada persona lee las normas de su edificio y la
-- administración las gestiona.
--
-- Se agrega el orden de las categorías y el texto de introducción por edificio.
-- save_building_rules reemplaza TODAS las normas del edificio en una sola operación:
-- o se guarda todo o no se guarda nada.
-- ==============================================================================

BEGIN;

ALTER TABLE public.rules     ADD COLUMN IF NOT EXISTS category_order INT NOT NULL DEFAULT 0;
ALTER TABLE public.buildings ADD COLUMN IF NOT EXISTS rules_intro TEXT;

CREATE INDEX IF NOT EXISTS idx_rules_building_order
    ON public.rules (building_id, category_order, item_order);

-- p_rules = [{"category": "Mascotas", "items": ["Norma 1", "Norma 2"]}, ...]
CREATE OR REPLACE FUNCTION public.save_building_rules(p_building_id UUID, p_intro TEXT, p_rules JSONB)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_cat    JSONB;
    v_item   JSONB;
    v_name   TEXT;
    v_text   TEXT;
    v_ci     INT := 0;
    v_ii     INT;
    v_total  INT := 0;
    v_admin  TEXT;
BEGIN
    IF p_building_id IS NULL OR NOT public.auth_is_admin_of(p_building_id) THEN
        RAISE EXCEPTION 'Acceso denegado: solo la administración puede editar las normas.';
    END IF;
    IF jsonb_typeof(p_rules) <> 'array' THEN
        RAISE EXCEPTION 'El formato de las normas no es válido.';
    END IF;
    IF jsonb_array_length(p_rules) > 50 THEN
        RAISE EXCEPTION 'Demasiadas categorías (máximo 50).';
    END IF;
    IF char_length(COALESCE(p_intro, '')) > 4000 THEN
        RAISE EXCEPTION 'La introducción es demasiado larga (máximo 4000 caracteres).';
    END IF;

    DELETE FROM public.rules WHERE building_id = p_building_id;

    FOR v_cat IN SELECT * FROM jsonb_array_elements(p_rules) LOOP
        v_name := trim(COALESCE(v_cat->>'category', ''));
        IF v_name = '' OR char_length(v_name) > 150 THEN
            RAISE EXCEPTION 'Cada categoría necesita un nombre de hasta 150 caracteres.';
        END IF;
        IF jsonb_typeof(v_cat->'items') <> 'array' OR jsonb_array_length(v_cat->'items') > 100 THEN
            RAISE EXCEPTION 'La categoría "%" tiene un formato no válido o demasiadas normas (máximo 100).', v_name;
        END IF;

        v_ci := v_ci + 1;
        v_ii := 0;
        FOR v_item IN SELECT * FROM jsonb_array_elements(v_cat->'items') LOOP
            v_text := trim(COALESCE(v_item #>> '{}', ''));
            IF v_text = '' THEN CONTINUE; END IF;            -- las normas vacías se ignoran
            IF char_length(v_text) > 3000 THEN
                RAISE EXCEPTION 'Una norma de "%" es demasiado larga (máximo 3000 caracteres).', v_name;
            END IF;
            v_ii := v_ii + 1;
            v_total := v_total + 1;
            INSERT INTO public.rules (building_id, category, category_order, item_order, content)
            VALUES (p_building_id, v_name, v_ci, v_ii, v_text);
        END LOOP;
    END LOOP;

    UPDATE public.buildings
       SET rules_intro = NULLIF(trim(COALESCE(p_intro, '')), ''), updated_at = NOW()
     WHERE id = p_building_id;

    SELECT full_name INTO v_admin FROM public.user_profiles WHERE id = auth.uid();
    INSERT INTO public.audit_logs (building_id, action, description, performed_by)
    VALUES (p_building_id, 'EDITAR_NORMAS',
            format('Actualizó las normas de convivencia (%s normas en %s categorías)', v_total, v_ci),
            COALESCE(v_admin, 'Administración'));

    RETURN v_total;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_building_rules(UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_building_rules(UUID, TEXT, JSONB) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
