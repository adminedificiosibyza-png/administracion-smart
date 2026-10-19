-- ==============================================================================
-- MIGRACIÓN 012: NOMBRES DE PERSONAS SIEMPRE EN MAYÚSCULAS
-- ------------------------------------------------------------------------------
-- Cómo se escriba el nombre no importa: la base de datos lo guarda siempre en
-- mayúsculas y con espacios simples. Esto no afecta el inicio de sesión, porque el
-- usuario se compara sin distinguir mayúsculas, tildes ni espacios.
-- ==============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.normalize_person_name()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    NEW.full_name := upper(regexp_replace(trim(NEW.full_name), '\s+', ' ', 'g'));
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_person_name ON public.user_profiles;
CREATE TRIGGER trg_normalize_person_name
BEFORE INSERT OR UPDATE OF full_name ON public.user_profiles
FOR EACH ROW EXECUTE FUNCTION public.normalize_person_name();

-- Los nombres que ya existen también pasan a mayúsculas
UPDATE public.user_profiles
   SET full_name = upper(regexp_replace(trim(full_name), '\s+', ' ', 'g'))
 WHERE full_name <> upper(regexp_replace(trim(full_name), '\s+', ' ', 'g'));

COMMIT;
