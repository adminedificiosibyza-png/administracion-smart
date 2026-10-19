-- ==============================================================================
-- MIGRACIÓN 007: MODELO DE ACCESO (FASE 1)
--   * Una cuenta por PERSONA con varios departamentos, en uno o varios edificios
--   * Superadmin global (ve y administra todos los edificios)
--   * Propietario / inquilino con interruptor "puede ver cuotas y pagos"
-- ------------------------------------------------------------------------------
-- Requisitos: schema.sql, rls.sql, storage.sql y migraciones 001 a 006.
--
-- CÓMO FUNCIONA SIN REESCRIBIR TODAS LAS POLÍTICAS:
--   Las políticas existentes consultan get_auth_user_profile(). Esa función ahora
--   devuelve VARIAS filas por usuario:
--     * una fila por cada departamento activo asignado  (rol 'propietario')
--     * una fila por cada edificio que administra       (rol 'administradora')
--       - el superadmin recibe una fila por TODOS los edificios
--   Así "building_id IN (...)", "unit_id IN (...)" y "role = 'administradora'"
--   siguen funcionando igual, pero con varios departamentos y edificios.
--   Solo se reescriben las políticas/funciones que comparaban con un único valor
--   (subconsulta escalar) o que necesitan el interruptor de cuotas.
--
-- PARA VOLVER ATRÁS (si algo sale mal): la migración corre dentro de una transacción
--   (un error cancela todo). Una vez aplicada, para revertir se vuelven a ejecutar,
--   en este orden: rls.sql, storage.sql, 001, 002, 005. Todos son repetibles.
-- ==============================================================================

BEGIN;

-- 1. PERSONAS: user_profiles pasa a ser una ficha por persona ---------------------
ALTER TABLE public.user_profiles ALTER COLUMN building_id DROP NOT NULL;

ALTER TABLE public.user_profiles
    ADD COLUMN IF NOT EXISTS username      TEXT,                        -- nombre completo normalizado
    ADD COLUMN IF NOT EXISTS contact_email TEXT,                        -- correo real de contacto (opcional)
    ADD COLUMN IF NOT EXISTS is_active     BOOLEAN NOT NULL DEFAULT TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_profiles_username
    ON public.user_profiles (username) WHERE username IS NOT NULL;

-- 2. ASIGNACIONES: persona <-> departamento ------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_units (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    unit_id       UUID NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
    relation      VARCHAR(20) NOT NULL DEFAULT 'PROPIETARIO'
                  CHECK (relation IN ('PROPIETARIO', 'INQUILINO', 'OTRO')),
    can_view_fees BOOLEAN NOT NULL DEFAULT TRUE,
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    valid_from    DATE NOT NULL DEFAULT CURRENT_DATE,
    valid_to      DATE,
    created_by    UUID,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (user_id, unit_id)
);

CREATE INDEX IF NOT EXISTS idx_user_units_user ON public.user_units(user_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_user_units_unit ON public.user_units(unit_id) WHERE active;

ALTER TABLE public.user_units ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_units TO authenticated;

-- 3. FUNCIÓN BASE: qué ve cada usuario (multi-fila) ----------------------------------
CREATE OR REPLACE FUNCTION public.get_auth_user_profile()
RETURNS TABLE (
    user_id UUID,
    building_id UUID,
    unit_id UUID,
    role VARCHAR
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
    -- Superadmin: administra TODOS los edificios
    SELECT p.id, b.id, NULL::uuid, 'administradora'::varchar
      FROM public.user_profiles p
      CROSS JOIN public.buildings b
     WHERE p.id = auth.uid() AND p.is_active AND p.role = 'superadmin'
    UNION ALL
    -- Administradora de un solo edificio (modelo anterior)
    SELECT p.id, p.building_id, NULL::uuid, 'administradora'::varchar
      FROM public.user_profiles p
     WHERE p.id = auth.uid() AND p.is_active AND p.role = 'administradora'
       AND p.building_id IS NOT NULL
    UNION ALL
    -- Propietarios / inquilinos: una fila por departamento activo
    SELECT p.id, u.building_id, uu.unit_id, 'propietario'::varchar
      FROM public.user_profiles p
      JOIN public.user_units uu ON uu.user_id = p.id AND uu.active
      JOIN public.units u ON u.id = uu.unit_id
     WHERE p.id = auth.uid() AND p.is_active;
$$;

-- 4. FUNCIONES AUXILIARES ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auth_is_superadmin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.user_profiles p
         WHERE p.id = auth.uid() AND p.is_active AND p.role = 'superadmin');
$$;

CREATE OR REPLACE FUNCTION public.auth_is_admin_of(p_building_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.get_auth_user_profile() g
         WHERE g.role = 'administradora' AND g.building_id = p_building_id);
$$;

CREATE OR REPLACE FUNCTION public.auth_has_unit(p_unit_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.get_auth_user_profile() g
         WHERE g.role = 'propietario' AND g.unit_id = p_unit_id);
$$;

-- Departamentos cuyas cuotas y pagos puede ver (respeta el interruptor)
CREATE OR REPLACE FUNCTION public.auth_fee_unit_ids()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT uu.unit_id
      FROM public.user_units uu
      JOIN public.user_profiles p ON p.id = uu.user_id
     WHERE uu.user_id = auth.uid() AND uu.active AND uu.can_view_fees AND p.is_active;
$$;

REVOKE EXECUTE ON FUNCTION public.auth_is_superadmin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.auth_is_admin_of(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.auth_has_unit(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.auth_fee_unit_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_is_superadmin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_is_admin_of(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_has_unit(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_fee_unit_ids() TO authenticated;

-- 5. DATOS: tu cuenta pasa a superadmin y se migran las asignaciones antiguas ----------
INSERT INTO public.user_profiles (id, building_id, role, full_name, email)
VALUES ('6684ae7c-5e06-4f53-adce-064252ffc32a', NULL, 'superadmin',
        'Administración de Edificios', 'admin.edificios.ibyza@gmail.com')
ON CONFLICT (id) DO UPDATE
   SET role = 'superadmin', building_id = NULL, is_active = TRUE;

INSERT INTO public.user_units (user_id, unit_id, relation)
SELECT p.id, p.unit_id, 'PROPIETARIO'
  FROM public.user_profiles p
 WHERE p.role = 'propietario' AND p.unit_id IS NOT NULL
ON CONFLICT (user_id, unit_id) DO NOTHING;

-- 6. POLÍTICAS QUE USABAN UN SOLO VALOR (subconsulta escalar) --------------------------
-- user_profiles: la persona ve y edita (solo contacto) lo suyo; el superadmin gestiona todo
DROP POLICY IF EXISTS "Usuario lee su propio perfil o administradora del edificio" ON public.user_profiles;
DROP POLICY IF EXISTS "Usuario actualiza unicamente sus datos de contacto" ON public.user_profiles;
DROP POLICY IF EXISTS "Administradora gestiona perfiles de su edificio" ON public.user_profiles;
DROP POLICY IF EXISTS "Persona lee su propio perfil o superadmin" ON public.user_profiles;
DROP POLICY IF EXISTS "Persona actualiza su contacto" ON public.user_profiles;
DROP POLICY IF EXISTS "Superadmin gestiona perfiles" ON public.user_profiles;

CREATE POLICY "Persona lee su propio perfil o superadmin"
ON public.user_profiles FOR SELECT USING (id = auth.uid() OR public.auth_is_superadmin());

CREATE POLICY "Persona actualiza su contacto"
ON public.user_profiles FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());
-- (el trigger prevent_user_profile_escalation impide que cambie rol, usuario o estado)

CREATE POLICY "Superadmin gestiona perfiles"
ON public.user_profiles FOR ALL USING (public.auth_is_superadmin()) WITH CHECK (public.auth_is_superadmin());

-- edificios: el superadmin puede crear y editar edificios
DROP POLICY IF EXISTS "Superadmin gestiona edificios" ON public.buildings;
CREATE POLICY "Superadmin gestiona edificios"
ON public.buildings FOR ALL USING (public.auth_is_superadmin()) WITH CHECK (public.auth_is_superadmin());

-- asignaciones persona <-> departamento
DROP POLICY IF EXISTS "Persona lee sus asignaciones" ON public.user_units;
DROP POLICY IF EXISTS "Superadmin gestiona asignaciones" ON public.user_units;
CREATE POLICY "Persona lee sus asignaciones"
ON public.user_units FOR SELECT USING (
    user_id = auth.uid()
    OR public.auth_is_superadmin()
    OR EXISTS (SELECT 1 FROM public.units u WHERE u.id = unit_id AND public.auth_is_admin_of(u.building_id))
);
CREATE POLICY "Superadmin gestiona asignaciones"
ON public.user_units FOR ALL USING (public.auth_is_superadmin()) WITH CHECK (public.auth_is_superadmin());

-- áreas comunes y comunicados (antes comparaban el rol con un único valor)
DROP POLICY IF EXISTS "Usuarios leen areas comunes activas de su edificio" ON public.common_areas;
CREATE POLICY "Usuarios leen areas comunes activas de su edificio"
ON public.common_areas FOR SELECT USING (
    building_id IN (SELECT building_id FROM public.get_auth_user_profile())
    AND (is_active = true OR public.auth_is_admin_of(building_id))
);

DROP POLICY IF EXISTS "Usuarios leen comunicados publicados de su edificio" ON public.announcements;
CREATE POLICY "Usuarios leen comunicados publicados de su edificio"
ON public.announcements FOR SELECT USING (
    building_id IN (SELECT building_id FROM public.get_auth_user_profile())
    AND (is_published = true OR public.auth_is_admin_of(building_id))
);

-- cuotas y pagos: respetan el interruptor "puede ver cuotas y pagos"
DROP POLICY IF EXISTS "Propietario lee solo las cuotas de su departamento" ON public.maintenance_fees;
CREATE POLICY "Propietario lee solo las cuotas de su departamento"
ON public.maintenance_fees FOR SELECT USING (
    unit_id IN (SELECT f FROM public.auth_fee_unit_ids() AS f)
    OR public.auth_is_admin_of(building_id)
);

DROP POLICY IF EXISTS "Propietario lee solo los pagos de su departamento" ON public.payments;
CREATE POLICY "Propietario lee solo los pagos de su departamento"
ON public.payments FOR SELECT USING (
    unit_id IN (SELECT f FROM public.auth_fee_unit_ids() AS f)
    OR public.auth_is_admin_of(building_id)
);

-- 7. STORAGE (comprobantes y documentos) --------------------------------------------------
DROP POLICY IF EXISTS "Propietario lee sus comprobantes" ON storage.objects;
DROP POLICY IF EXISTS "Administradora gestiona comprobantes de pago" ON storage.objects;
DROP POLICY IF EXISTS "Propietario lee sus documentos privados" ON storage.objects;
DROP POLICY IF EXISTS "Administradora gestiona documentos privados" ON storage.objects;
DROP POLICY IF EXISTS "Administradora gestiona documentos publicos" ON storage.objects;

CREATE POLICY "Propietario lee sus comprobantes"
ON storage.objects FOR SELECT USING (
    bucket_id = 'comprobantes-pagos'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] IN (SELECT f::text FROM public.auth_fee_unit_ids() AS f)
);

CREATE POLICY "Administradora gestiona comprobantes de pago"
ON storage.objects FOR ALL USING (
    bucket_id = 'comprobantes-pagos'
    AND EXISTS (SELECT 1 FROM public.units u
                 WHERE u.id::text = (storage.foldername(name))[1]
                   AND public.auth_is_admin_of(u.building_id))
) WITH CHECK (
    bucket_id = 'comprobantes-pagos'
    AND EXISTS (SELECT 1 FROM public.units u
                 WHERE u.id::text = (storage.foldername(name))[1]
                   AND public.auth_is_admin_of(u.building_id))
);

CREATE POLICY "Propietario lee sus documentos privados"
ON storage.objects FOR SELECT USING (
    bucket_id = 'documentos-privados'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] IN (
        SELECT g.unit_id::text FROM public.get_auth_user_profile() g WHERE g.unit_id IS NOT NULL)
);

CREATE POLICY "Administradora gestiona documentos privados"
ON storage.objects FOR ALL USING (
    bucket_id = 'documentos-privados'
    AND EXISTS (SELECT 1 FROM public.units u
                 WHERE u.id::text = (storage.foldername(name))[1]
                   AND public.auth_is_admin_of(u.building_id))
) WITH CHECK (
    bucket_id = 'documentos-privados'
    AND EXISTS (SELECT 1 FROM public.units u
                 WHERE u.id::text = (storage.foldername(name))[1]
                   AND public.auth_is_admin_of(u.building_id))
);

CREATE POLICY "Administradora gestiona documentos publicos"
ON storage.objects FOR ALL USING (
    bucket_id = 'documentos-publicos'
    AND (storage.foldername(name))[1] IN (
        SELECT g.building_id::text FROM public.get_auth_user_profile() g WHERE g.role = 'administradora')
) WITH CHECK (
    bucket_id = 'documentos-publicos'
    AND (storage.foldername(name))[1] IN (
        SELECT g.building_id::text FROM public.get_auth_user_profile() g WHERE g.role = 'administradora')
);

-- 8. TRIGGERS Y FUNCIONES QUE ASUMÍAN UN SOLO EDIFICIO O DEPARTAMENTO ------------------
-- 8.1 Nadie (salvo el superadmin) puede cambiar rol, usuario, estado o edificio de un perfil
CREATE OR REPLACE FUNCTION public.prevent_user_profile_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    IF (auth.uid() IS NULL) THEN
        RETURN NEW;  -- SQL editor / service role
    END IF;
    IF NOT public.auth_is_superadmin() THEN
        IF (NEW.id IS DISTINCT FROM OLD.id
            OR NEW.role IS DISTINCT FROM OLD.role
            OR NEW.building_id IS DISTINCT FROM OLD.building_id
            OR NEW.unit_id IS DISTINCT FROM OLD.unit_id
            OR NEW.username IS DISTINCT FROM OLD.username
            OR NEW.email IS DISTINCT FROM OLD.email
            OR NEW.is_active IS DISTINCT FROM OLD.is_active) THEN
            RAISE EXCEPTION 'Acceso denegado: solo puede modificar sus datos de contacto.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- 8.2 Reservas: la solicitud nace pendiente y con datos del servidor (de 001, multi-edificio)
CREATE OR REPLACE FUNCTION public.enforce_reservation_insert()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
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

-- 8.3 Reservas: quién puede cambiar qué estado (de 001, multi-edificio)
CREATE OR REPLACE FUNCTION public.prevent_reservation_tampering()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    IF (auth.uid() IS NULL) THEN
        RETURN NEW;
    END IF;

    NEW.created_at := OLD.created_at;

    IF NOT public.auth_is_admin_of(OLD.building_id) THEN
        IF NOT public.auth_has_unit(OLD.unit_id) THEN
            RAISE EXCEPTION 'Acceso denegado: No está autorizado a modificar reservas de otro departamento.';
        END IF;

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

-- 8.4 Registro de pago (de 002): el edificio sale del departamento, no del perfil
CREATE OR REPLACE FUNCTION public.register_payment(
    p_unit_id UUID,
    p_period_month DATE,
    p_amount DECIMAL(10,2),
    p_payment_date DATE,
    p_method TEXT,
    p_operation_number TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS public.payments
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_building UUID;
    v_admin_name TEXT;
    v_period DATE := date_trunc('month', p_period_month)::date;
    v_fee public.maintenance_fees;
    v_pay public.payments;
BEGIN
    SELECT building_id INTO v_building FROM public.units WHERE id = p_unit_id;
    IF v_building IS NULL OR NOT public.auth_is_admin_of(v_building) THEN
        RAISE EXCEPTION 'Acceso denegado: solo la administradora puede registrar pagos.';
    END IF;

    SELECT full_name INTO v_admin_name FROM public.user_profiles WHERE id = auth.uid();

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'El monto pagado debe ser mayor a cero.';
    END IF;
    IF p_payment_date IS NULL OR p_payment_date > (now() AT TIME ZONE 'America/Lima')::date THEN
        RAISE EXCEPTION 'La fecha de pago es obligatoria y no puede ser futura.';
    END IF;
    IF p_method NOT IN ('Transferencia bancaria', 'Yape', 'Plin', 'Efectivo', 'Otro') THEN
        RAISE EXCEPTION 'Método de pago inválido.';
    END IF;
    IF p_method IN ('Transferencia bancaria', 'Yape', 'Plin') AND COALESCE(trim(p_operation_number), '') = '' THEN
        RAISE EXCEPTION 'El número de operación es obligatorio para el método seleccionado.';
    END IF;

    SELECT * INTO v_fee
      FROM public.maintenance_fees
     WHERE unit_id = p_unit_id AND period_month = v_period AND building_id = v_building
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No existe una cuota para ese departamento y período.';
    END IF;
    IF v_fee.status = 'PAGADO' THEN
        RAISE EXCEPTION 'La cuota de ese período ya figura como pagada.';
    END IF;

    INSERT INTO public.payments (
        building_id, fee_id, unit_id, unit_code, owner_name, period, period_month,
        amount, payment_date, method, operation_number, status, notes, registered_by
    ) VALUES (
        v_building, v_fee.id, v_fee.unit_id, v_fee.unit_code, v_fee.owner_name, v_fee.period, v_fee.period_month,
        p_amount, p_payment_date, p_method, NULLIF(trim(p_operation_number), ''), 'VERIFICADO',
        p_notes, COALESCE(v_admin_name, 'Administración')
    ) RETURNING * INTO v_pay;

    IF p_amount >= v_fee.fee_amount THEN
        UPDATE public.maintenance_fees
           SET status = 'PAGADO', payment_date = p_payment_date
         WHERE id = v_fee.id;
    END IF;

    INSERT INTO public.audit_logs (building_id, action, description, performed_by)
    VALUES (v_building, 'REGISTRO_PAGO',
            format('Registró pago de %s para Dpto %s por S/ %s (%s%s)',
                   v_fee.period, v_fee.unit_code, p_amount, p_method,
                   CASE WHEN COALESCE(trim(p_operation_number), '') <> '' THEN ' Op: ' || trim(p_operation_number) ELSE '' END),
            COALESCE(v_admin_name, 'Administración'));

    RETURN v_pay;
END;
$$;

-- 8.5 Generar cuotas del mes (de 005): ahora se indica el edificio
DROP FUNCTION IF EXISTS public.generate_monthly_fees(DATE);

CREATE OR REPLACE FUNCTION public.generate_monthly_fees(p_building_id UUID, p_period_month DATE)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_admin_name TEXT;
    v_period DATE := date_trunc('month', p_period_month)::date;
    v_today_month DATE := date_trunc('month', (now() AT TIME ZONE 'America/Lima'))::date;
    v_created INT;
BEGIN
    IF p_building_id IS NULL OR NOT public.auth_is_admin_of(p_building_id) THEN
        RAISE EXCEPTION 'Acceso denegado: solo la administradora puede generar cuotas.';
    END IF;

    IF p_period_month IS NULL
       OR v_period < (v_today_month - interval '1 month')::date
       OR v_period > (v_today_month + interval '12 months')::date THEN
        RAISE EXCEPTION 'El período debe estar entre el mes anterior y los próximos 12 meses.';
    END IF;

    v_created := public.generate_fees_for_period(p_building_id, v_period);

    SELECT full_name INTO v_admin_name FROM public.user_profiles WHERE id = auth.uid();
    INSERT INTO public.audit_logs (building_id, action, description, performed_by)
    VALUES (p_building_id, 'GENERAR_CUOTAS',
            format('Generó las cuotas de %s: %s nuevas', to_char(v_period, 'YYYY-MM'), v_created),
            COALESCE(v_admin_name, 'Administración'));

    RETURN v_created;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_monthly_fees(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_monthly_fees(UUID, DATE) TO authenticated;

-- 9. CONTEXTO DE LA SESIÓN: lo que la app necesita saber al iniciar sesión -----------------
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
                   ORDER BY b.name, u.code)
              FROM public.user_units uu
              JOIN public.units u ON u.id = uu.unit_id
              JOIN public.buildings b ON b.id = u.building_id
             WHERE uu.user_id = p.id AND uu.active), '[]'::jsonb),
        'buildings', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'code', b.code) ORDER BY b.name)
              FROM public.buildings b
             WHERE p.role = 'superadmin' OR (p.role = 'administradora' AND b.id = p.building_id)), '[]'::jsonb)
    )
    FROM public.user_profiles p
    WHERE p.id = auth.uid() AND p.is_active;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_context() TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
