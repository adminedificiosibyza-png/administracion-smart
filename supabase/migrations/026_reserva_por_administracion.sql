-- ==============================================================================
-- 026 - RESERVAS REGISTRADAS POR LA ADMINISTRACIÓN (a nombre de un propietario)
--
--  1) Corrige la migración 020, que no estaba aplicada: el servidor vuelve a exigir teléfono
--     (mínimo 7 dígitos) y actividad / motivo en las solicitudes de los residentes.
--  2) Columnas nuevas en reservations: cuándo hizo el pedido la persona (requested_at), por qué
--     canal llegó, quién la registró y una observación interna.
--  3) Un propietario NO puede escribir esas columnas (no puede adelantar su "hora de pedido").
--  4) Función admin_create_reservation: solo la administración del edificio; valida lo mismo que
--     una reserva normal (horario, fecha, cruces con reservas aprobadas y bloqueos) y deja
--     constancia en el Registro de Auditoría.
--
-- No modifica reservas existentes: quedan con canal PORTAL. Idempotente (se puede ejecutar de nuevo).
-- ==============================================================================
BEGIN;

-- 1. Datos obligatorios en el servidor (contenido de la migración 020) --------------------------
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

REVOKE EXECUTE ON FUNCTION public.enforce_reservation_required_fields() FROM PUBLIC, anon;

-- 2. Columnas nuevas -----------------------------------------------------------------------------
ALTER TABLE public.reservations
    ADD COLUMN IF NOT EXISTS requested_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS request_channel VARCHAR(12) NOT NULL DEFAULT 'PORTAL',
    ADD COLUMN IF NOT EXISTS registered_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS admin_note      TEXT;

ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_channel_check;
ALTER TABLE public.reservations ADD CONSTRAINT reservations_channel_check
    CHECK (request_channel IN ('PORTAL', 'RECEPCION', 'WHATSAPP', 'LLAMADA', 'OTRO'));

-- 3. Solo la administración escribe esas columnas ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_reservation_admin_fields()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    IF auth.uid() IS NULL OR public.auth_is_admin_of(NEW.building_id) THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' THEN
        NEW.requested_at := NULL;
        NEW.request_channel := 'PORTAL';
        NEW.registered_by := NULL;
        NEW.admin_note := NULL;
    ELSE
        NEW.requested_at := OLD.requested_at;
        NEW.request_channel := OLD.request_channel;
        NEW.registered_by := OLD.registered_by;
        NEW.admin_note := OLD.admin_note;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_b_reservation_admin_fields ON public.reservations;
CREATE TRIGGER trg_b_reservation_admin_fields
BEFORE INSERT OR UPDATE ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.protect_reservation_admin_fields();

REVOKE EXECUTE ON FUNCTION public.protect_reservation_admin_fields() FROM PUBLIC, anon;

-- 4. Registrar una reserva a nombre de un propietario ----------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_create_reservation(p JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_area    public.common_areas;
    v_unit    public.units;
    v_user    UUID        := NULLIF(p->>'user_id', '')::uuid;
    v_name    TEXT;
    v_phone   TEXT        := trim(COALESCE(p->>'phone', ''));
    v_motive  TEXT        := trim(COALESCE(p->>'motive', ''));
    v_channel TEXT        := COALESCE(NULLIF(p->>'channel', ''), 'RECEPCION');
    v_status  TEXT        := COALESCE(NULLIF(p->>'status', ''), 'CONFIRMADA');
    v_req     TIMESTAMPTZ := COALESCE(NULLIF(p->>'requested_at', '')::timestamptz, now());
    v_note    TEXT        := NULLIF(trim(COALESCE(p->>'admin_note', '')), '');
    v_date    DATE        := NULLIF(p->>'date', '')::date;
    v_start   TIME        := NULLIF(p->>'start_time', '')::time;
    v_end     TIME        := NULLIF(p->>'end_time', '')::time;
    v_row     public.reservations;
    v_admin   TEXT;
BEGIN
    SELECT * INTO v_area FROM public.common_areas WHERE id = NULLIF(p->>'area_id', '')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'El área común no existe.'; END IF;
    IF NOT public.auth_is_admin_of(v_area.building_id) THEN
        RAISE EXCEPTION 'Acceso denegado: no administra este edificio.';
    END IF;

    SELECT * INTO v_unit FROM public.units
     WHERE id = NULLIF(p->>'unit_id', '')::uuid AND building_id = v_area.building_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'El departamento no pertenece a este edificio.'; END IF;

    IF v_user IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.user_units uu
          JOIN public.user_profiles up ON up.id = uu.user_id
         WHERE uu.user_id = v_user AND uu.unit_id = v_unit.id AND uu.active AND up.is_active) THEN
        RAISE EXCEPTION 'La persona elegida no tiene este departamento asignado.';
    END IF;
    SELECT full_name INTO v_name FROM public.user_profiles WHERE id = v_user;

    IF v_date IS NULL OR v_start IS NULL OR v_end IS NULL THEN
        RAISE EXCEPTION 'Indique la fecha y el horario de la reserva.';
    END IF;
    IF char_length(regexp_replace(v_phone, '\D', '', 'g')) < 7 THEN
        RAISE EXCEPTION 'Ingrese un teléfono de contacto válido (mínimo 7 dígitos).';
    END IF;
    IF char_length(v_motive) < 3 THEN RAISE EXCEPTION 'Indique la actividad o motivo de la reserva.'; END IF;
    IF v_channel NOT IN ('RECEPCION', 'WHATSAPP', 'LLAMADA', 'OTRO') THEN RAISE EXCEPTION 'Canal de pedido no válido.'; END IF;
    IF v_status NOT IN ('CONFIRMADA', 'PENDIENTE') THEN RAISE EXCEPTION 'Estado inicial no válido.'; END IF;
    IF COALESCE((p->>'accepted_terms')::boolean, FALSE) IS NOT TRUE THEN
        RAISE EXCEPTION 'Debe confirmar que la persona aceptó las normas de uso del área común.';
    END IF;
    IF v_req > now() + interval '2 minutes' THEN
        RAISE EXCEPTION 'La fecha y hora del pedido no puede ser futura.';
    END IF;

    -- Las demás reglas (fecha no pasada, horario del área, cruces con reservas aprobadas y bloqueos)
    -- las aplican los triggers de la tabla, igual que en una reserva hecha desde el portal.
    INSERT INTO public.reservations (
        building_id, area_id, unit_id, unit_code, owner_name, phone, date, start_time, end_time,
        motive, accepted_terms, status, decided_by, decided_at,
        requested_at, request_channel, registered_by, admin_note)
    VALUES (
        v_area.building_id, v_area.id, v_unit.id, v_unit.code, v_name, v_phone, v_date, v_start, v_end,
        v_motive, TRUE, v_status,
        CASE WHEN v_status = 'CONFIRMADA' THEN auth.uid() END,
        CASE WHEN v_status = 'CONFIRMADA' THEN clock_timestamp() END,
        v_req, v_channel, auth.uid(), v_note)
    RETURNING * INTO v_row;

    SELECT full_name INTO v_admin FROM public.user_profiles WHERE id = auth.uid();
    INSERT INTO public.audit_logs (building_id, action, description, performed_by)
    VALUES (v_row.building_id, 'CREAR_RESERVA_ADMIN',
            format('Reserva %s registrada por la administración a nombre de %s (Dpto %s, %s, %s a %s). Canal: %s. Pedido recibido el %s. Estado: %s%s',
                   v_row.code, v_name, v_row.unit_code, v_row.date,
                   to_char(v_row.start_time, 'HH24:MI'), to_char(v_row.end_time, 'HH24:MI'),
                   v_channel, to_char(v_req AT TIME ZONE 'America/Lima', 'DD/MM/YYYY HH24:MI'),
                   CASE v_status WHEN 'CONFIRMADA' THEN 'aprobada' ELSE 'pendiente' END,
                   CASE WHEN v_note IS NOT NULL THEN '. Obs.: ' || v_note ELSE '' END),
            COALESCE(v_admin, 'Administración'));

    RETURN jsonb_build_object('id', v_row.id, 'code', v_row.code, 'status', v_row.status);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_create_reservation(JSONB) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_create_reservation(JSONB) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------------------------
-- ROLLBACK (solo si hiciera falta volver atrás; NO ejecutar normalmente):
-- DROP FUNCTION IF EXISTS public.admin_create_reservation(JSONB);
-- DROP TRIGGER IF EXISTS trg_b_reservation_admin_fields ON public.reservations;
-- DROP FUNCTION IF EXISTS public.protect_reservation_admin_fields();
-- ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_channel_check;
-- ALTER TABLE public.reservations DROP COLUMN IF EXISTS requested_at, DROP COLUMN IF EXISTS request_channel,
--     DROP COLUMN IF EXISTS registered_by, DROP COLUMN IF EXISTS admin_note;
-- (La corrección de la 020 conviene dejarla.)
-- ------------------------------------------------------------------------------
