-- ==============================================================================
-- 020 - RESERVAS: DATOS OBLIGATORIOS TAMBIÉN EN EL SERVIDOR
-- Una solicitud de reserva de un residente no puede guardarse sin teléfono de contacto
-- (mínimo 7 dígitos) ni actividad / motivo. La pantalla ya lo exige; esto lo garantiza aunque
-- alguien intente saltarse la pantalla.
-- ==============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_reservation_required_fields()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    IF auth.uid() IS NULL OR public.auth_is_admin_of(NEW.building_id) THEN
        RETURN NEW;   -- SQL editor / administración
    END IF;
    IF char_length(regexp_replace(COALESCE(NEW.phone, ''), '\D', '', 'g')) < 7 THEN
        RAISE EXCEPTION 'Ingrese un teléfono de contacto válido (mínimo 7 dígitos).';
    END IF;
    IF char_length(trim(COALESCE(NEW.motive, ''))) < 3 THEN
        RAISE EXCEPTION 'Indique la actividad o motivo de la reserva.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_a_reservation_required_fields ON public.reservations;
CREATE TRIGGER trg_a_reservation_required_fields
BEFORE INSERT ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.enforce_reservation_required_fields();

COMMIT;

NOTIFY pgrst, 'reload schema';
