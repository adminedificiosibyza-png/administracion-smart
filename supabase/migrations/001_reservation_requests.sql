-- ==============================================================================
-- MIGRACIÓN 001: SOLICITUDES DE RESERVA CON APROBACIÓN DE LA ADMINISTRADORA
-- ------------------------------------------------------------------------------
-- Aplicar UNA vez sobre una base ya creada con schema.sql + rls.sql.
-- (schema.sql y rls.sql ya incluyen estos cambios para instalaciones nuevas.)
--
-- Modelo de estados (columna reservations.status):
--   PENDIENTE  -> solicitud enviada por el propietario, NO ocupa el horario.
--   CONFIRMADA -> aprobada por la administradora (se muestra como "Aprobada").
--   RECHAZADA  -> rechazada por la administradora.
--   CANCELADA  -> cancelada (propietario o administración).
-- Se reutiliza CONFIRMADA como "Aprobada" para no romper la vista de
-- disponibilidad ni el trigger anti-doble-reserva, que ya solo consideran
-- reservas CONFIRMADAS.
--
-- Sanciones: NO se crea ninguna estructura todavía (pendiente de definir).
-- ==============================================================================

-- 1. Nuevos estados y columnas de decisión ------------------------------------
ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_status_check;
ALTER TABLE public.reservations ADD CONSTRAINT reservations_status_check
    CHECK (status IN ('PENDIENTE', 'CONFIRMADA', 'RECHAZADA', 'CANCELADA', 'FINALIZADA', 'BLOQUEADA'));
ALTER TABLE public.reservations ALTER COLUMN status SET DEFAULT 'PENDIENTE';

ALTER TABLE public.reservations
    ADD COLUMN IF NOT EXISTS decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS decided_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_reservations_status_created
    ON public.reservations(status, created_at);

-- 2. INSERT: la solicitud siempre nace PENDIENTE y con datos/hora del servidor --
CREATE OR REPLACE FUNCTION public.enforce_reservation_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_role TEXT;
    v_unit_code TEXT;
    v_owner_name TEXT;
BEGIN
    -- Sin sesión de usuario (SQL editor / service role): no se restringe
    IF (auth.uid() IS NULL) THEN
        RETURN NEW;
    END IF;

    IF (NEW.end_time <= NEW.start_time) THEN
        RAISE EXCEPTION 'La hora de término debe ser posterior a la hora de inicio.';
    END IF;

    -- Marca de tiempo real de creación: la define el servidor, no el cliente.
    -- clock_timestamp() (y no NOW()) para ordenar bien solicitudes casi simultáneas.
    NEW.created_at := clock_timestamp();

    SELECT role INTO v_role FROM public.get_auth_user_profile();

    IF (v_role IS DISTINCT FROM 'administradora') THEN
        IF (NEW.accepted_terms IS NOT TRUE) THEN
            RAISE EXCEPTION 'Debe aceptar las normas de uso del área común.';
        END IF;

        -- El propietario no puede crearla ya aprobada ni decidida
        NEW.status := 'PENDIENTE';
        NEW.decided_by := NULL;
        NEW.decided_at := NULL;
        NEW.rejection_reason := NULL;

        -- Departamento y propietario salen del servidor, no del formulario
        SELECT u.code INTO v_unit_code FROM public.units u WHERE u.id = NEW.unit_id;
        SELECT p.full_name INTO v_owner_name FROM public.user_profiles p WHERE p.id = auth.uid();
        NEW.unit_code := v_unit_code;
        NEW.owner_name := v_owner_name;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_reservation_insert ON public.reservations;
CREATE TRIGGER trg_enforce_reservation_insert
BEFORE INSERT ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.enforce_reservation_insert();

-- 3. UPDATE: quién puede cambiar qué estado ------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_reservation_tampering()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_role TEXT;
BEGIN
    IF (auth.uid() IS NULL) THEN
        RETURN NEW;
    END IF;

    -- La fecha/hora de creación nunca se modifica, ni siquiera por la administradora
    NEW.created_at := OLD.created_at;

    SELECT role INTO v_role FROM public.get_auth_user_profile();

    IF (v_role IS DISTINCT FROM 'administradora') THEN
        IF (OLD.unit_id NOT IN (SELECT unit_id FROM public.get_auth_user_profile() WHERE unit_id IS NOT NULL)) THEN
            RAISE EXCEPTION 'Acceso denegado: No está autorizado a modificar reservas de otro departamento.';
        END IF;

        -- El propietario solo puede cancelar (nunca aprobar ni rechazar)
        IF (OLD.status NOT IN ('PENDIENTE', 'CONFIRMADA') OR NEW.status <> 'CANCELADA') THEN
            RAISE EXCEPTION 'Transición de estado inválida para la reserva.';
        END IF;

        IF (NEW.building_id IS DISTINCT FROM OLD.building_id OR
            NEW.unit_id IS DISTINCT FROM OLD.unit_id OR
            NEW.unit_code IS DISTINCT FROM OLD.unit_code OR
            NEW.owner_name IS DISTINCT FROM OLD.owner_name OR
            NEW.area_id IS DISTINCT FROM OLD.area_id OR
            NEW.date IS DISTINCT FROM OLD.date OR
            NEW.start_time IS DISTINCT FROM OLD.start_time OR
            NEW.end_time IS DISTINCT FROM OLD.end_time OR
            NEW.code IS DISTINCT FROM OLD.code OR
            NEW.decided_by IS DISTINCT FROM OLD.decided_by OR
            NEW.decided_at IS DISTINCT FROM OLD.decided_at OR
            NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason) THEN
            RAISE EXCEPTION 'Acceso denegado: No está permitido alterar la solicitud durante la cancelación.';
        END IF;
    ELSE
        -- Administradora: solo PENDIENTE -> CONFIRMADA | RECHAZADA (o cancelar)
        IF (NEW.status IS DISTINCT FROM OLD.status) THEN
            IF (OLD.status = 'PENDIENTE' AND NEW.status IN ('CONFIRMADA', 'RECHAZADA')) THEN
                NEW.decided_by := auth.uid();
                NEW.decided_at := clock_timestamp();
            ELSIF (NEW.status = 'CANCELADA' AND OLD.status IN ('PENDIENTE', 'CONFIRMADA')) THEN
                NULL;
            ELSE
                RAISE EXCEPTION 'Transición de estado inválida: % -> %.', OLD.status, NEW.status;
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- (el trigger trg_prevent_reservation_tampering ya existe y usa esta función)

-- 4. Políticas RLS -------------------------------------------------------------
DROP POLICY IF EXISTS "Propietario inserta reservas solo para su dpto y area de su edificio" ON public.reservations;
CREATE POLICY "Propietario inserta reservas solo para su dpto y area de su edificio"
ON public.reservations FOR INSERT WITH CHECK (
    building_id IN (SELECT building_id FROM public.get_auth_user_profile())
    AND unit_id IN (SELECT unit_id FROM public.get_auth_user_profile() WHERE unit_id IS NOT NULL)
    AND status = 'PENDIENTE'
    AND area_id IN (
        SELECT id FROM public.common_areas
        WHERE building_id IN (SELECT building_id FROM public.get_auth_user_profile())
          AND is_active = true
    )
);

DROP POLICY IF EXISTS "Propietario cancela su propia reserva" ON public.reservations;
CREATE POLICY "Propietario cancela su propia reserva"
ON public.reservations FOR UPDATE USING (
    unit_id IN (SELECT unit_id FROM public.get_auth_user_profile() WHERE unit_id IS NOT NULL)
    AND status IN ('PENDIENTE', 'CONFIRMADA')
) WITH CHECK (
    unit_id IN (SELECT unit_id FROM public.get_auth_user_profile() WHERE unit_id IS NOT NULL)
    AND status = 'CANCELADA'
);

-- 5. Anti-solapamiento
-- trg_prevent_double_booking (ya existente) se ejecuta al pasar una fila a
-- CONFIRMADA y toma un advisory lock por área+fecha, por lo que dos aprobaciones
-- simultáneas de horarios que se cruzan no pueden confirmarse a la vez.
-- Las solicitudes PENDIENTE no se validan contra otras pendientes: pueden coincidir.
-- La vista vw_reservation_availability sigue mostrando solo CONFIRMADAS.

-- Refresca la caché de esquema de la API (PostgREST) para que vea las vistas/funciones nuevas
NOTIFY pgrst, 'reload schema';
