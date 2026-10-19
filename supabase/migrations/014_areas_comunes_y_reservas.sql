-- ==============================================================================
-- MIGRACIÓN 014: ÁREAS COMUNES POR EDIFICIO Y RESERVAS REALES
-- ------------------------------------------------------------------------------
-- Requiere 001 (flujo de solicitudes) y 007 (acceso multi-edificio).
--
--  1) Cada área común tiene su propio horario: lunes a viernes y sábado/domingo.
--  2) El código de reserva (PK10-00001) lo genera el servidor, por edificio.
--  3) El servidor valida cada solicitud: área y departamento del mismo edificio, fecha no
--     pasada, horario dentro del permitido y sin cruzarse con reservas aprobadas o bloqueos.
--     (Lo mismo que valida la pantalla: aquí no se puede saltar desde el navegador.)
--  4) Aprobar / rechazar / cancelar queda en el registro de auditoría.
--  5) Crear, editar y eliminar áreas comunes (solo la administración).
--  6) PARKE10 pasa a tener su única área real: "Terraza – Zona de Parrillas y Piscina".
-- ==============================================================================

BEGIN;

-- 1. Horarios por área ----------------------------------------------------------------------
ALTER TABLE public.common_areas
    ADD COLUMN IF NOT EXISTS weekday_open  TIME NOT NULL DEFAULT '08:00',
    ADD COLUMN IF NOT EXISTS weekday_close TIME NOT NULL DEFAULT '18:00',
    ADD COLUMN IF NOT EXISTS weekend_open  TIME NOT NULL DEFAULT '08:00',
    ADD COLUMN IF NOT EXISTS weekend_close TIME NOT NULL DEFAULT '20:00',
    ADD COLUMN IF NOT EXISTS sort_order    INT  NOT NULL DEFAULT 0;

-- 2. Código de reserva por edificio ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reservation_counters (
    building_id UUID PRIMARY KEY REFERENCES public.buildings(id) ON DELETE CASCADE,
    last_value  INT NOT NULL DEFAULT 0
);
ALTER TABLE public.reservation_counters ENABLE ROW LEVEL SECURITY;   -- sin políticas: solo lo usan funciones del servidor

CREATE OR REPLACE FUNCTION public.assign_reservation_code()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_seq  INT;
    v_code TEXT;
BEGIN
    IF NEW.code IS NOT NULL AND NEW.code <> '' THEN
        RETURN NEW;
    END IF;
    INSERT INTO public.reservation_counters (building_id, last_value)
    VALUES (NEW.building_id, 1)
    ON CONFLICT (building_id) DO UPDATE SET last_value = public.reservation_counters.last_value + 1
    RETURNING last_value INTO v_seq;

    SELECT code INTO v_code FROM public.buildings WHERE id = NEW.building_id;
    NEW.code := v_code || '-' || lpad(v_seq::text, 5, '0');
    RETURN NEW;
END;
$$;

-- Se ejecuta DESPUÉS de las validaciones (orden alfabético), para no gastar números en solicitudes rechazadas
DROP TRIGGER IF EXISTS trg_z_assign_reservation_code ON public.reservations;
CREATE TRIGGER trg_z_assign_reservation_code
BEFORE INSERT ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.assign_reservation_code();

-- 3. Validación de la solicitud en el servidor --------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_reservation_insert()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_unit_code  TEXT;
    v_owner_name TEXT;
    v_area       public.common_areas;
    v_open       TIME;
    v_close      TIME;
    v_today      DATE := (now() AT TIME ZONE 'America/Lima')::date;
BEGIN
    IF (auth.uid() IS NULL) THEN
        RETURN NEW;   -- SQL editor / service role
    END IF;

    IF (NEW.end_time <= NEW.start_time) THEN
        RAISE EXCEPTION 'La hora de término debe ser posterior a la hora de inicio.';
    END IF;

    SELECT * INTO v_area FROM public.common_areas WHERE id = NEW.area_id;
    IF NOT FOUND OR v_area.building_id <> NEW.building_id THEN
        RAISE EXCEPTION 'El área común no pertenece a este edificio.';
    END IF;
    IF NOT v_area.is_active THEN
        RAISE EXCEPTION 'El área común no está disponible para reservas.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.units WHERE id = NEW.unit_id AND building_id = NEW.building_id) THEN
        RAISE EXCEPTION 'El departamento no pertenece a este edificio.';
    END IF;
    IF NEW.date < v_today THEN
        RAISE EXCEPTION 'No se puede reservar en una fecha pasada.';
    END IF;

    -- Horario del día: sábado y domingo (0 y 6) o lunes a viernes
    IF EXTRACT(DOW FROM NEW.date) IN (0, 6) THEN
        v_open := v_area.weekend_open;  v_close := v_area.weekend_close;
    ELSE
        v_open := v_area.weekday_open;  v_close := v_area.weekday_close;
    END IF;
    IF NEW.start_time < v_open OR NEW.end_time > v_close THEN
        RAISE EXCEPTION 'El horario debe estar entre las % y las % para esa fecha.',
            to_char(v_open, 'HH24:MI'), to_char(v_close, 'HH24:MI');
    END IF;

    -- No se pide un horario que ya está aprobado o bloqueado
    IF EXISTS (SELECT 1 FROM public.reservations r
                WHERE r.area_id = NEW.area_id AND r.date = NEW.date AND r.status = 'CONFIRMADA'
                  AND (NEW.start_time, NEW.end_time) OVERLAPS (r.start_time, r.end_time)) THEN
        RAISE EXCEPTION 'Ese horario ya está reservado. Elija otro.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.reservation_blocks b
                WHERE b.area_id = NEW.area_id AND b.date = NEW.date
                  AND (NEW.start_time, NEW.end_time) OVERLAPS (b.start_time, b.end_time)) THEN
        RAISE EXCEPTION 'Ese horario no está disponible (bloqueado por la administración).';
    END IF;

    -- La marca de tiempo real de la solicitud la define el servidor (define la prioridad)
    NEW.created_at := clock_timestamp();

    IF NOT public.auth_is_admin_of(NEW.building_id) THEN
        IF (NEW.accepted_terms IS NOT TRUE) THEN
            RAISE EXCEPTION 'Debe aceptar las normas de uso del área común.';
        END IF;
        NEW.status := 'PENDIENTE';
        NEW.decided_by := NULL;
        NEW.decided_at := NULL;
        NEW.rejection_reason := NULL;
        SELECT u.code INTO v_unit_code FROM public.units u WHERE u.id = NEW.unit_id;
        SELECT p.full_name INTO v_owner_name FROM public.user_profiles p WHERE p.id = auth.uid();
        NEW.unit_code := v_unit_code;
        NEW.owner_name := v_owner_name;
    END IF;

    RETURN NEW;
END;
$$;

-- 4. Auditoría de decisiones sobre reservas -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_reservation_decision()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_action TEXT;
    v_name   TEXT;
BEGIN
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
    END IF;
    v_action := CASE NEW.status
        WHEN 'CONFIRMADA' THEN 'APROBAR_RESERVA'
        WHEN 'RECHAZADA'  THEN 'RECHAZAR_RESERVA'
        WHEN 'CANCELADA'  THEN 'CANCELAR_RESERVA'
        ELSE NULL END;
    IF v_action IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT full_name INTO v_name FROM public.user_profiles WHERE id = auth.uid();
    INSERT INTO public.audit_logs (building_id, action, description, performed_by)
    VALUES (NEW.building_id, v_action,
            format('%s: reserva %s del Dpto %s (%s, %s a %s)%s',
                   CASE NEW.status WHEN 'CONFIRMADA' THEN 'Aprobada' WHEN 'RECHAZADA' THEN 'Rechazada' ELSE 'Cancelada' END,
                   NEW.code, NEW.unit_code, NEW.date, to_char(NEW.start_time, 'HH24:MI'), to_char(NEW.end_time, 'HH24:MI'),
                   CASE WHEN NEW.rejection_reason IS NOT NULL AND NEW.rejection_reason <> '' THEN '. Motivo: ' || NEW.rejection_reason ELSE '' END),
            COALESCE(v_name, 'Sistema'));
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_reservation_decision ON public.reservations;
CREATE TRIGGER trg_log_reservation_decision
AFTER UPDATE OF status ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.log_reservation_decision();

-- 5. Crear / editar / eliminar áreas comunes ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_common_area(p_data JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_id       UUID := NULLIF(p_data->>'id', '')::uuid;
    v_building UUID := NULLIF(p_data->>'building_id', '')::uuid;
    v_name     TEXT := trim(COALESCE(p_data->>'name', ''));
    v_desc     TEXT := NULLIF(trim(COALESCE(p_data->>'description', '')), '');
    v_wd_open  TIME := COALESCE(NULLIF(p_data->>'weekday_open', '')::time, '08:00');
    v_wd_close TIME := COALESCE(NULLIF(p_data->>'weekday_close', '')::time, '18:00');
    v_we_open  TIME := COALESCE(NULLIF(p_data->>'weekend_open', '')::time, '08:00');
    v_we_close TIME := COALESCE(NULLIF(p_data->>'weekend_close', '')::time, '20:00');
    v_active   BOOLEAN := COALESCE((p_data->>'is_active')::boolean, TRUE);
    v_row      public.common_areas;
    v_admin    TEXT;
BEGIN
    IF v_id IS NOT NULL THEN
        SELECT building_id INTO v_building FROM public.common_areas WHERE id = v_id;
        IF v_building IS NULL THEN RAISE EXCEPTION 'El área común no existe.'; END IF;
    END IF;
    IF v_building IS NULL OR NOT public.auth_is_admin_of(v_building) THEN
        RAISE EXCEPTION 'Acceso denegado: solo la administración puede gestionar áreas comunes.';
    END IF;
    IF v_name = '' OR char_length(v_name) > 100 THEN
        RAISE EXCEPTION 'El nombre del área es obligatorio (hasta 100 caracteres).';
    END IF;
    IF v_wd_open >= v_wd_close THEN RAISE EXCEPTION 'En lunes a viernes, la hora de apertura debe ser anterior al cierre.'; END IF;
    IF v_we_open >= v_we_close THEN RAISE EXCEPTION 'En sábado y domingo, la hora de apertura debe ser anterior al cierre.'; END IF;

    IF v_id IS NULL THEN
        INSERT INTO public.common_areas (building_id, name, description, weekday_open, weekday_close,
                                         weekend_open, weekend_close, is_active, sort_order)
        VALUES (v_building, v_name, v_desc, v_wd_open, v_wd_close, v_we_open, v_we_close, v_active,
                (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM public.common_areas WHERE building_id = v_building))
        RETURNING * INTO v_row;
    ELSE
        UPDATE public.common_areas
           SET name = v_name, description = v_desc,
               weekday_open = v_wd_open, weekday_close = v_wd_close,
               weekend_open = v_we_open, weekend_close = v_we_close, is_active = v_active
         WHERE id = v_id
     RETURNING * INTO v_row;
    END IF;

    SELECT full_name INTO v_admin FROM public.user_profiles WHERE id = auth.uid();
    INSERT INTO public.audit_logs (building_id, action, description, performed_by)
    VALUES (v_building, CASE WHEN v_id IS NULL THEN 'CREAR_AREA' ELSE 'EDITAR_AREA' END,
            format('%s el área común %s', CASE WHEN v_id IS NULL THEN 'Creó' ELSE 'Editó' END, v_row.name),
            COALESCE(v_admin, 'Administración'));

    RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_common_area(p_area_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_area  public.common_areas;
    v_admin TEXT;
BEGIN
    SELECT * INTO v_area FROM public.common_areas WHERE id = p_area_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'El área común no existe.'; END IF;
    IF NOT public.auth_is_admin_of(v_area.building_id) THEN
        RAISE EXCEPTION 'Acceso denegado: solo la administración puede gestionar áreas comunes.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.reservations WHERE area_id = p_area_id)
       OR EXISTS (SELECT 1 FROM public.reservation_blocks WHERE area_id = p_area_id) THEN
        RAISE EXCEPTION 'El área tiene reservas o bloqueos registrados y no se puede eliminar. Desactívela en su lugar.';
    END IF;

    DELETE FROM public.common_areas WHERE id = p_area_id;

    SELECT full_name INTO v_admin FROM public.user_profiles WHERE id = auth.uid();
    INSERT INTO public.audit_logs (building_id, action, description, performed_by)
    VALUES (v_area.building_id, 'ELIMINAR_AREA', format('Eliminó el área común %s', v_area.name), COALESCE(v_admin, 'Administración'));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_common_area(JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_common_area(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_common_area(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_common_area(UUID) TO authenticated;

-- 6. PARKE10: su única área común real (reemplaza las de ejemplo del arranque, si no tienen reservas) --------
DELETE FROM public.common_areas a
 USING public.buildings b
 WHERE a.building_id = b.id AND b.code = 'PK10'
   AND a.name IN ('Piscina', 'Zona de Parrillas')
   AND NOT EXISTS (SELECT 1 FROM public.reservations r WHERE r.area_id = a.id)
   AND NOT EXISTS (SELECT 1 FROM public.reservation_blocks bl WHERE bl.area_id = a.id);

INSERT INTO public.common_areas (building_id, name, description, weekday_open, weekday_close,
                                 weekend_open, weekend_close, is_active, sort_order)
SELECT b.id, 'Terraza – Zona de Parrillas y Piscina',
       'Zona común recreativa ubicada en la terraza: zona de parrillas y piscina.',
       '08:00', '18:00', '08:00', '20:00', TRUE, 1
  FROM public.buildings b
 WHERE b.code = 'PK10'
   AND NOT EXISTS (SELECT 1 FROM public.common_areas a WHERE a.building_id = b.id AND a.name LIKE 'Terraza%');

COMMIT;

NOTIFY pgrst, 'reload schema';
