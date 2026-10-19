-- ==============================================================================
-- SUPABASE ROW LEVEL SECURITY (RLS) POLICIES & SECURITY TRIGGERS DEFINITIVOS
-- Sistema Multi-Edificio (PARKE10) - Blindaje Total en Base de Datos PostgreSQL
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- HABILITAR RLS EN TODAS LAS TABLAS DEL SISTEMA
-- ------------------------------------------------------------------------------
ALTER TABLE buildings ENABLE ROW LEVEL SECURITY;
ALTER TABLE units ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE common_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE interest_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- ELIMINACIÓN DE POLÍTICAS PREVIAS ÚNICAMENTE DE LAS TABLAS DEL SISTEMA
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    r RECORD;
    target_tables TEXT[] := ARRAY[
        'buildings', 'units', 'user_profiles', 'owners', 'common_areas', 
        'reservations', 'reservation_blocks', 'maintenance_fees', 'payments', 
        'interest_rules', 'announcements', 'rules', 'documents', 'audit_logs'
    ];
BEGIN
    FOR r IN (
        SELECT policyname, tablename 
        FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = ANY(target_tables)
    ) LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', r.policyname, r.tablename);
    END LOOP;
END $$;

-- ------------------------------------------------------------------------------
-- 1. TRIGGER DE PREVENCIÓN DE ESCALADA DE PRIVILEGIOS EN USER_PROFILES
-- Evita que un propietario modifique su propio role, building_id o unit_id
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_user_profile_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER 
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    IF (auth.uid() = OLD.id AND (SELECT role FROM public.get_auth_user_profile()) <> 'administradora') THEN
        IF (NEW.role IS DISTINCT FROM OLD.role) THEN
            RAISE EXCEPTION 'Acceso denegado: No está autorizado a modificar su rol de usuario.';
        END IF;
        IF (NEW.building_id IS DISTINCT FROM OLD.building_id) THEN
            RAISE EXCEPTION 'Acceso denegado: No está autorizado a cambiar de edificio.';
        END IF;
        IF (NEW.unit_id IS DISTINCT FROM OLD.unit_id) THEN
            RAISE EXCEPTION 'Acceso denegado: No está autorizado a modificar su departamento asignado.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_user_profile_escalation ON public.user_profiles;
CREATE TRIGGER trg_prevent_user_profile_escalation
BEFORE UPDATE ON public.user_profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_user_profile_escalation();

-- ------------------------------------------------------------------------------
-- 2. FUNCIÓN Y VISTA SEGURA DE DISPONIBILIDAD DE HORARIOS
-- Permite consultar si un horario está libre u ocupado sin exponer datos de vecinos
-- Protegido con search_path seguro (pg_catalog, public, pg_temp) y revocacion pública
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_reservation_availability()
RETURNS TABLE (
    building_id UUID,
    area_id UUID,
    date DATE,
    start_time TIME,
    end_time TIME,
    status TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER 
SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT 
        r.building_id,
        r.area_id,
        r.date,
        r.start_time,
        r.end_time,
        'RESERVADO'::text AS status
    FROM public.reservations r
    WHERE r.status = 'CONFIRMADA'
      AND r.building_id IN (SELECT p.building_id FROM public.get_auth_user_profile() p)

    UNION ALL

    SELECT 
        b.building_id,
        b.area_id,
        b.date,
        b.start_time,
        b.end_time,
        'BLOQUEADO'::text AS status
    FROM public.reservation_blocks b
    WHERE b.building_id IN (SELECT p.building_id FROM public.get_auth_user_profile() p);
$$;

REVOKE EXECUTE ON FUNCTION public.get_reservation_availability() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reservation_availability() TO authenticated;

CREATE OR REPLACE VIEW public.vw_reservation_availability AS
SELECT * FROM public.get_reservation_availability();

GRANT SELECT ON public.vw_reservation_availability TO authenticated;

-- ------------------------------------------------------------------------------
-- 3. TRIGGER DE INMUTABILIDAD AL CANCELAR RESERVAS
-- Garantiza que el propietario solo pueda cambiar status a CANCELADA sin alterar fecha/hora/dpto
-- ------------------------------------------------------------------------------
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

-- Solicitud nueva: siempre PENDIENTE, con propietario/dpto y hora de creación del servidor
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
    IF (auth.uid() IS NULL) THEN
        RETURN NEW;
    END IF;

    IF (NEW.end_time <= NEW.start_time) THEN
        RAISE EXCEPTION 'La hora de término debe ser posterior a la hora de inicio.';
    END IF;

    NEW.created_at := clock_timestamp();

    SELECT role INTO v_role FROM public.get_auth_user_profile();

    IF (v_role IS DISTINCT FROM 'administradora') THEN
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

DROP TRIGGER IF EXISTS trg_enforce_reservation_insert ON public.reservations;
CREATE TRIGGER trg_enforce_reservation_insert
BEFORE INSERT ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.enforce_reservation_insert();

DROP TRIGGER IF EXISTS trg_prevent_reservation_tampering ON public.reservations;
CREATE TRIGGER trg_prevent_reservation_tampering
BEFORE UPDATE ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.prevent_reservation_tampering();

-- ------------------------------------------------------------------------------
-- 4. TRIGGER DE PREVENCIÓN DE DOBLE RESERVA EN CONCURRENCIA (POSTGRESQL ADVISORY LOCK)
-- Previene reservas solapadas mediante cerrojo exclusivo de transacción por área y fecha
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_double_booking()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER 
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_overlap_count INT;
BEGIN
    IF (NEW.status = 'CONFIRMADA') THEN
        -- Cerrojo de transacción por área y fecha para garantizar seguridad ante concurrencia
        PERFORM pg_advisory_xact_lock(hashtext(NEW.area_id::text || '_' || NEW.date::text));

        -- 1. Validar solapamiento con reservas confirmadas existentes
        SELECT COUNT(*) INTO v_overlap_count
        FROM public.reservations r
        WHERE r.area_id = NEW.area_id
          AND r.date = NEW.date
          AND r.status = 'CONFIRMADA'
          AND r.id <> NEW.id
          AND (NEW.start_time, NEW.end_time) OVERLAPS (r.start_time, r.end_time);

        IF (v_overlap_count > 0) THEN
            RAISE EXCEPTION 'El horario seleccionado (% - %) ya se encuentra reservado.', NEW.start_time, NEW.end_time;
        END IF;

        -- 2. Validar solapamiento con bloqueos administrativos
        SELECT COUNT(*) INTO v_overlap_count
        FROM public.reservation_blocks b
        WHERE b.area_id = NEW.area_id
          AND b.date = NEW.date
          AND (NEW.start_time, NEW.end_time) OVERLAPS (b.start_time, b.end_time);

        IF (v_overlap_count > 0) THEN
            RAISE EXCEPTION 'El horario seleccionado (% - %) se encuentra bloqueado por administración.', NEW.start_time, NEW.end_time;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_double_booking ON public.reservations;
CREATE TRIGGER trg_prevent_double_booking
BEFORE INSERT OR UPDATE ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.prevent_double_booking();

-- ------------------------------------------------------------------------------
-- 5. TRIGGER DE PREVENCIÓN DE SOLAPAMIENTO DE BLOQUEOS ADMINISTRATIVOS
-- Evita que la administradora cree un bloqueo sobre un horario con reserva confirmada existente
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_block_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER 
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_overlap_count INT;
BEGIN
    -- Cerrojo de transacción por área y fecha
    PERFORM pg_advisory_xact_lock(hashtext(NEW.area_id::text || '_' || NEW.date::text));

    -- 1. Validar si existe reserva confirmada previa en ese horario
    SELECT COUNT(*) INTO v_overlap_count
    FROM public.reservations r
    WHERE r.area_id = NEW.area_id
      AND r.date = NEW.date
      AND r.status = 'CONFIRMADA'
      AND (NEW.start_time, NEW.end_time) OVERLAPS (r.start_time, r.end_time);

    IF (v_overlap_count > 0) THEN
        RAISE EXCEPTION 'No se puede crear el bloqueo en el horario (% - %) porque ya existe una reserva confirmada.', NEW.start_time, NEW.end_time;
    END IF;

    -- 2. Validar solapamiento con otros bloqueos de horario de la administradora
    SELECT COUNT(*) INTO v_overlap_count
    FROM public.reservation_blocks b
    WHERE b.area_id = NEW.area_id
      AND b.date = NEW.date
      AND b.id <> NEW.id
      AND (NEW.start_time, NEW.end_time) OVERLAPS (b.start_time, b.end_time);

    IF (v_overlap_count > 0) THEN
        RAISE EXCEPTION 'Ya existe un bloqueo de horario solapado para la misma área y fecha (% - %).', NEW.start_time, NEW.end_time;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_block_overlap ON public.reservation_blocks;
CREATE TRIGGER trg_prevent_block_overlap
BEFORE INSERT OR UPDATE ON public.reservation_blocks
FOR EACH ROW EXECUTE FUNCTION public.prevent_block_overlap();

-- ==============================================================================
-- 1. TABLA: BUILDINGS (EDIFICIOS)
-- ==============================================================================
CREATE POLICY "Lectura de edificio asignado"
ON buildings FOR SELECT USING (
    id IN (SELECT building_id FROM public.get_auth_user_profile())
);

CREATE POLICY "Administradora gestiona su edificio"
ON buildings FOR ALL USING (
    id IN (SELECT building_id FROM public.get_auth_user_profile() WHERE role = 'administradora')
) WITH CHECK (
    id IN (SELECT building_id FROM public.get_auth_user_profile() WHERE role = 'administradora')
);

-- ==============================================================================
-- 2. TABLA: UNITS (DEPARTAMENTOS)
-- ==============================================================================
CREATE POLICY "Lectura de departamentos del edificio asignado"
ON units FOR SELECT USING (
    building_id IN (SELECT building_id FROM public.get_auth_user_profile())
);

CREATE POLICY "Administradora gestiona departamentos de su edificio"
ON units FOR ALL USING (
    building_id IN (SELECT building_id FROM public.get_auth_user_profile() WHERE role = 'administradora')
) WITH CHECK (
    building_id IN (SELECT building_id FROM public.get_auth_user_profile() WHERE role = 'administradora')
);

-- ==============================================================================
-- 3. TABLA: USER_PROFILES (PERFILES DE USUARIO)
-- ==============================================================================
CREATE POLICY "Usuario lee su propio perfil o administradora del edificio"
ON user_profiles FOR SELECT USING (
    id = auth.uid() 
    OR building_id IN (SELECT building_id FROM public.get_auth_user_profile() WHERE role = 'administradora')
);

CREATE POLICY "Usuario actualiza unicamente sus datos de contacto"
ON user_profiles FOR UPDATE USING (
    id = auth.uid()
) WITH CHECK (
    id = auth.uid() 
    AND role = (SELECT role FROM public.get_auth_user_profile())
    AND building_id IN (SELECT building_id FROM public.get_auth_user_profile())
    AND (unit_id IS NOT DISTINCT FROM (SELECT unit_id FROM public.get_auth_user_profile()))
);

CREATE POLICY "Administradora gestiona perfiles de su edificio"
ON user_profiles FOR ALL USING (
    building_id IN (SELECT building_id FROM public.get_auth_user_profile() WHERE role = 'administradora')
) WITH CHECK (
    building_id IN (SELECT building_id FROM public.get_auth_user_profile() WHERE role = 'administradora')
);

-- ==============================================================================
-- 4. TABLA: OWNERS (PROPIETARIOS / RESIDENTES)
-- ==============================================================================
CREATE POLICY "Propietario lee solo sus datos personales"
ON owners FOR SELECT USING (
    user_profile_id = auth.uid()
    OR building_id IN (SELECT building_id FROM public.get_auth_user_profile() WHERE role = 'administradora')
);

CREATE POLICY "Administradora gestiona padron de propietarios"
ON owners FOR ALL USING (
    building_id IN (SELECT building_id FROM public.get_auth_user_profile() WHERE role = 'administradora')
) WITH CHECK (
    building_id IN (SELECT building_id FROM public.get_auth_user_profile() WHERE role = 'administradora')
);

-- ==============================================================================
-- 5. TABLA: COMMON_AREAS (ÁREAS COMUNES)
-- ==============================================================================
CREATE POLICY "Usuarios leen areas comunes activas de su edificio"
ON common_areas FOR SELECT USING (
    building_id IN (SELECT building_id FROM public.get_auth_user_profile())
    AND (is_active = true OR (SELECT role FROM public.get_auth_user_profile()) = 'administradora')
);

CREATE POLICY "Administradora gestiona areas comunes de su edificio"
ON common_areas FOR ALL USING (
    building_id IN (SELECT building_id FROM public.get_auth_user_profile() WHERE role = 'administradora')
) WITH CHECK (
    building_id IN (SELECT building_id FROM public.get_auth_user_profile() WHERE role = 'administradora')
);

-- ==============================================================================
-- 6. TABLA: RESERVATIONS (RESERVAS)
-- ==============================================================================
CREATE POLICY "Propietario lee solo sus propias reservas"
ON reservations FOR SELECT USING (
    unit_id IN (SELECT unit_id FROM public.get_auth_user_profile() WHERE unit_id IS NOT NULL)
    OR building_id IN (SELECT building_id FROM public.get_auth_user_profile() WHERE role = 'administradora')
);

CREATE POLICY "Propietario inserta reservas solo para su dpto y area de su edificio"
ON reservations FOR INSERT WITH CHECK (
    building_id IN (SELECT building_id FROM public.get_auth_user_profile())
    AND unit_id IN (SELECT unit_id FROM public.get_auth_user_profile() WHERE unit_id IS NOT NULL)
    AND status = 'PENDIENTE'
    AND area_id IN (
        SELECT id FROM public.common_areas 
        WHERE building_id IN (SELECT building_id FROM public.get_auth_user_profile())
          AND is_active = true
    )
);

CREATE POLICY "Propietario cancela su propia reserva"
ON reservations FOR UPDATE USING (
    unit_id IN (SELECT unit_id FROM public.get_auth_user_profile() WHERE unit_id IS NOT NULL)
    AND status IN ('PENDIENTE', 'CONFIRMADA')
) WITH CHECK (
    unit_id IN (SELECT unit_id FROM public.get_auth_user_profile() WHERE unit_id IS NOT NULL)
    AND status = 'CANCELADA'
);

CREATE POLICY "Administradora gestiona todas las reservas de su edificio"
ON reservations FOR ALL USING (
    building_id IN (SELECT building_id FROM public.get_auth_user_profile() WHERE role = 'administradora')
) WITH CHECK (
    building_id IN (SELECT building_id FROM public.get_auth_user_profile() WHERE role = 'administradora')
);

-- ==============================================================================
-- 7. TABLA: RESERVATION_BLOCKS (BLOQUEOS DE MANTENIMIENTO)
-- ==============================================================================
CREATE POLICY "Usuarios leen bloqueos de horario de su edificio"
ON reservation_blocks FOR SELECT USING (
    building_id IN (SELECT building_id FROM public.get_auth_user_profile())
);

CREATE POLICY "Administradora gestiona bloqueos de horario de su edificio"
ON reservation_blocks FOR ALL USING (
    building_id IN (SELECT building_id FROM public.get_auth_user_profile() WHERE role = 'administradora')
) WITH CHECK (
    building_id IN (SELECT building_id FROM public.get_auth_user_profile() WHERE role = 'administradora')
);

-- ==============================================================================
-- 8. TABLA: MAINTENANCE_FEES (CUOTAS DE MANTENIMIENTO)
-- ==============================================================================
CREATE POLICY "Propietario lee solo las cuotas de su departamento"
ON maintenance_fees FOR SELECT USING (
    unit_id IN (SELECT unit_id FROM public.get_auth_user_profile() WHERE unit_id IS NOT NULL)
    OR building_id IN (SELECT building_id FROM public.get_auth_user_profile() WHERE role = 'administradora')
);

CREATE POLICY "Administradora gestiona cuotas de mantenimiento de su edificio"
ON maintenance_fees FOR ALL USING (
    building_id IN (SELECT building_id FROM public.get_auth_user_profile() WHERE role = 'administradora')
) WITH CHECK (
    building_id IN (SELECT building_id FROM public.get_auth_user_profile() WHERE role = 'administradora')
);

-- ==============================================================================
-- 9. TABLA: PAYMENTS (PAGOS)
-- ==============================================================================
CREATE POLICY "Propietario lee solo los pagos de su departamento"
ON payments FOR SELECT USING (
    unit_id IN (SELECT unit_id FROM public.get_auth_user_profile() WHERE unit_id IS NOT NULL)
    OR building_id IN (SELECT building_id FROM public.get_auth_user_profile() WHERE role = 'administradora')
);

CREATE POLICY "Administradora gestiona y registra pagos de su edificio"
ON payments FOR ALL USING (
    building_id IN (SELECT building_id FROM public.get_auth_user_profile() WHERE role = 'administradora')
) WITH CHECK (
    building_id IN (SELECT building_id FROM public.get_auth_user_profile() WHERE role = 'administradora')
);

-- ==============================================================================
-- 10. TABLA: INTEREST_RULES (REGLAS DE INTERÉS MORATORIO)
-- ==============================================================================
CREATE POLICY "Usuarios leen reglas de interes de su edificio"
ON interest_rules FOR SELECT USING (
    building_id IN (SELECT building_id FROM public.get_auth_user_profile())
);

CREATE POLICY "Administradora gestiona reglas de interes de su edificio"
ON interest_rules FOR ALL USING (
    building_id IN (SELECT building_id FROM public.get_auth_user_profile() WHERE role = 'administradora')
) WITH CHECK (
    building_id IN (SELECT building_id FROM public.get_auth_user_profile() WHERE role = 'administradora')
);

-- ==============================================================================
-- 11. TABLA: ANNOUNCEMENTS (COMUNICADOS)
-- ==============================================================================
CREATE POLICY "Usuarios leen comunicados publicados de su edificio"
ON announcements FOR SELECT USING (
    building_id IN (SELECT building_id FROM public.get_auth_user_profile())
    AND (is_published = true OR (SELECT role FROM public.get_auth_user_profile()) = 'administradora')
);

CREATE POLICY "Administradora gestiona comunicados de su edificio"
ON announcements FOR ALL USING (
    building_id IN (SELECT building_id FROM public.get_auth_user_profile() WHERE role = 'administradora')
) WITH CHECK (
    building_id IN (SELECT building_id FROM public.get_auth_user_profile() WHERE role = 'administradora')
);

-- ==============================================================================
-- 12. TABLA: RULES (NORMAS DE CONVIVENCIA)
-- ==============================================================================
CREATE POLICY "Usuarios leen normas de convivencia de su edificio"
ON rules FOR SELECT USING (
    building_id IN (SELECT building_id FROM public.get_auth_user_profile())
);

CREATE POLICY "Administradora gestiona normas de convivencia de su edificio"
ON rules FOR ALL USING (
    building_id IN (SELECT building_id FROM public.get_auth_user_profile() WHERE role = 'administradora')
) WITH CHECK (
    building_id IN (SELECT building_id FROM public.get_auth_user_profile() WHERE role = 'administradora')
);

-- ==============================================================================
-- 13. TABLA: DOCUMENTS (DOCUMENTOS)
-- ==============================================================================
CREATE POLICY "Propietario lee solo sus documentos de departamento o los generales del edificio"
ON documents FOR SELECT USING (
    (unit_id IN (SELECT unit_id FROM public.get_auth_user_profile() WHERE unit_id IS NOT NULL) AND building_id IN (SELECT building_id FROM public.get_auth_user_profile()))
    OR (unit_id IS NULL AND building_id IN (SELECT building_id FROM public.get_auth_user_profile()))
    OR building_id IN (SELECT building_id FROM public.get_auth_user_profile() WHERE role = 'administradora')
);

CREATE POLICY "Administradora gestiona documentos de su edificio"
ON documents FOR ALL USING (
    building_id IN (SELECT building_id FROM public.get_auth_user_profile() WHERE role = 'administradora')
) WITH CHECK (
    building_id IN (SELECT building_id FROM public.get_auth_user_profile() WHERE role = 'administradora')
);

-- ==============================================================================
-- 14. TABLA: AUDIT_LOGS (REGISTRO DE AUDITORÍA)
-- ==============================================================================
CREATE POLICY "Administradora lee registro de auditoria de su edificio"
ON audit_logs FOR SELECT USING (
    building_id IN (SELECT building_id FROM public.get_auth_user_profile() WHERE role = 'administradora')
);
