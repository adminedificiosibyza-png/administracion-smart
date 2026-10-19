-- ==============================================================================
-- 021 - MANTENIMIENTO Y SERVICIOS + CAJA GENERAL
-- Módulo SOLO para administración. Los residentes no tienen ninguna política de lectura,
-- así que aunque consulten Supabase directamente no ven nada (tablas ni archivos).
--
--  * maintenance_services : catálogo y programación de servicios por edificio
--  * service_providers    : proveedores (lista simple, compartida por todos los edificios)
--  * service_expenses     : gastos/obligaciones (alcance EDIFICIO, COMPARTIDO o GENERAL)
--  * expense_allocations  : parte de cada edificio en cada gasto (compartidos se reparten)
--  * expense_payments     : pagos de cada gasto (parciales; anulables sin borrar)
--  * service_documents    : facturas, recibos, cotizaciones, comprobantes, informes
--  * admin_cash_account   : cuenta única de la administración (saldo inicial global)
--  * other_income         : otros ingresos (por edificio o generales)
--  Todo se escribe mediante funciones que validan permisos y dejan registro en auditoría.
-- Ejecutar completo en el SQL Editor de Supabase.
-- ==============================================================================
BEGIN;

-- 0. Utilidades -------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._lima_today() RETURNS DATE
LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'America/Lima')::date $$;

CREATE OR REPLACE FUNCTION public._audit(p_building UUID, p_action TEXT, p_desc TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_admin TEXT;
BEGIN
    IF p_building IS NULL THEN RETURN; END IF;   -- audit_logs exige edificio
    SELECT full_name INTO v_admin FROM public.user_profiles WHERE id = auth.uid();
    INSERT INTO public.audit_logs (building_id, action, description, performed_by)
    VALUES (p_building, p_action, p_desc, COALESCE(v_admin, 'Administración'));
END;
$$;
REVOKE EXECUTE ON FUNCTION public._audit(UUID, TEXT, TEXT) FROM PUBLIC;

-- 1. Tablas ------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.service_providers (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       VARCHAR(150) NOT NULL,
    phone      VARCHAR(40),
    notes      TEXT,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_providers_name ON public.service_providers (lower(name));

CREATE TABLE IF NOT EXISTS public.maintenance_services (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    building_id           UUID NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
    name                  VARCHAR(200) NOT NULL,
    category              VARCHAR(100),
    description           TEXT,
    provider_id           UUID REFERENCES public.service_providers(id) ON DELETE SET NULL,
    frequency             VARCHAR(20) NOT NULL DEFAULT 'EVENTUAL'
                          CHECK (frequency IN ('MENSUAL','BIMESTRAL','TRIMESTRAL','SEMESTRAL','ANUAL','EVENTUAL')),
    estimated_amount      NUMERIC(12,2) CHECK (estimated_amount IS NULL OR estimated_amount >= 0),
    next_maintenance_date DATE,
    next_due_date         DATE,
    status                VARCHAR(12) NOT NULL DEFAULT 'INACTIVO' CHECK (status IN ('ACTIVO','INACTIVO','FINALIZADO')),
    is_catalog            BOOLEAN NOT NULL DEFAULT FALSE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_maintenance_services_name ON public.maintenance_services (building_id, lower(name));

CREATE TABLE IF NOT EXISTS public.service_expenses (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope        VARCHAR(12) NOT NULL CHECK (scope IN ('EDIFICIO','COMPARTIDO','GENERAL')),
    service_id   UUID REFERENCES public.maintenance_services(id) ON DELETE SET NULL,
    provider_id  UUID REFERENCES public.service_providers(id) ON DELETE SET NULL,
    category     VARCHAR(100),
    concept      VARCHAR(250) NOT NULL,
    period_month DATE NOT NULL,
    amount       NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    due_date     DATE,
    observations TEXT,
    status       VARCHAR(10) NOT NULL DEFAULT 'ACTIVO' CHECK (status IN ('ACTIVO','ANULADO')),
    created_by   VARCHAR(150),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_service_expenses_period ON public.service_expenses (period_month);

CREATE TABLE IF NOT EXISTS public.expense_allocations (
    expense_id  UUID NOT NULL REFERENCES public.service_expenses(id) ON DELETE CASCADE,
    building_id UUID NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
    amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    PRIMARY KEY (expense_id, building_id)
);
CREATE INDEX IF NOT EXISTS idx_expense_alloc_building ON public.expense_allocations (building_id);

CREATE TABLE IF NOT EXISTS public.expense_payments (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_id       UUID NOT NULL REFERENCES public.service_expenses(id) ON DELETE CASCADE,
    amount           NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    payment_date     DATE NOT NULL,
    method           VARCHAR(50) NOT NULL,
    operation_number VARCHAR(100),
    notes            TEXT,
    status           VARCHAR(10) NOT NULL DEFAULT 'VALIDO' CHECK (status IN ('VALIDO','ANULADO')),
    void_reason      TEXT,
    registered_by    VARCHAR(150),
    registered_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_expense_payments_expense ON public.expense_payments (expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_payments_date ON public.expense_payments (payment_date);

CREATE TABLE IF NOT EXISTS public.service_documents (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_id  UUID REFERENCES public.service_expenses(id) ON DELETE CASCADE,
    service_id  UUID REFERENCES public.maintenance_services(id) ON DELETE CASCADE,
    payment_id  UUID REFERENCES public.expense_payments(id) ON DELETE SET NULL,
    doc_type    VARCHAR(20) NOT NULL CHECK (doc_type IN ('FACTURA','RECIBO','COTIZACION','COMPROBANTE','INFORME','OTRO')),
    file_path   TEXT NOT NULL,
    file_name   VARCHAR(250) NOT NULL,
    uploaded_by VARCHAR(150),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (expense_id IS NOT NULL OR service_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.admin_cash_account (
    id              INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    name            VARCHAR(150) NOT NULL DEFAULT 'Cuenta de la administración',
    opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
    opening_date    DATE NOT NULL DEFAULT CURRENT_DATE,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.other_income (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    building_id UUID REFERENCES public.buildings(id) ON DELETE CASCADE,   -- NULL = ingreso general
    income_date DATE NOT NULL,
    concept     VARCHAR(250) NOT NULL,
    amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    notes       TEXT,
    status      VARCHAR(10) NOT NULL DEFAULT 'VALIDO' CHECK (status IN ('VALIDO','ANULADO')),
    created_by  VARCHAR(150),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Permisos de lectura (RLS). No existe ninguna política para residentes ------------------------
CREATE OR REPLACE FUNCTION public.auth_is_staff() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT public.auth_is_superadmin()
        OR EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = auth.uid() AND p.is_active AND p.role = 'administradora')
$$;

CREATE OR REPLACE FUNCTION public.can_manage_expense(p_expense UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT public.auth_is_superadmin()
        OR EXISTS (SELECT 1 FROM public.expense_allocations a
                    WHERE a.expense_id = p_expense AND public.auth_is_admin_of(a.building_id))
$$;

CREATE OR REPLACE FUNCTION public.can_manage_service(p_service UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM public.maintenance_services s
                    WHERE s.id = p_service AND public.auth_is_admin_of(s.building_id))
$$;

ALTER TABLE public.service_providers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_expenses    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_payments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_documents   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_cash_account  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.other_income        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mant_providers_select" ON public.service_providers;
CREATE POLICY "mant_providers_select" ON public.service_providers FOR SELECT USING (public.auth_is_staff());
DROP POLICY IF EXISTS "mant_services_select" ON public.maintenance_services;
CREATE POLICY "mant_services_select" ON public.maintenance_services FOR SELECT USING (public.auth_is_admin_of(building_id));
DROP POLICY IF EXISTS "mant_expenses_select" ON public.service_expenses;
CREATE POLICY "mant_expenses_select" ON public.service_expenses FOR SELECT USING (public.can_manage_expense(id));
DROP POLICY IF EXISTS "mant_alloc_select" ON public.expense_allocations;
CREATE POLICY "mant_alloc_select" ON public.expense_allocations FOR SELECT USING (public.auth_is_admin_of(building_id));
DROP POLICY IF EXISTS "mant_payments_select" ON public.expense_payments;
CREATE POLICY "mant_payments_select" ON public.expense_payments FOR SELECT USING (public.can_manage_expense(expense_id));
DROP POLICY IF EXISTS "mant_documents_select" ON public.service_documents;
CREATE POLICY "mant_documents_select" ON public.service_documents FOR SELECT USING (
    (expense_id IS NOT NULL AND public.can_manage_expense(expense_id))
    OR (service_id IS NOT NULL AND public.can_manage_service(service_id)));
DROP POLICY IF EXISTS "mant_cash_select" ON public.admin_cash_account;
CREATE POLICY "mant_cash_select" ON public.admin_cash_account FOR SELECT USING (public.auth_is_superadmin());
DROP POLICY IF EXISTS "mant_income_select" ON public.other_income;
CREATE POLICY "mant_income_select" ON public.other_income FOR SELECT USING (
    CASE WHEN building_id IS NULL THEN public.auth_is_superadmin() ELSE public.auth_is_admin_of(building_id) END);

GRANT SELECT ON public.service_providers, public.maintenance_services, public.service_expenses,
    public.expense_allocations, public.expense_payments, public.service_documents,
    public.admin_cash_account, public.other_income TO authenticated;
GRANT ALL ON public.service_providers, public.maintenance_services, public.service_expenses,
    public.expense_allocations, public.expense_payments, public.service_documents,
    public.admin_cash_account, public.other_income TO service_role;

-- 3. Vistas con saldos y estado calculados (respetan RLS de las tablas) ----------------------------
CREATE OR REPLACE VIEW public.vw_service_expenses_calc WITH (security_invoker = true) AS
SELECT e.id, e.scope, e.service_id, s.name AS service_name,
       COALESCE(e.category, s.category) AS category,
       e.provider_id, pr.name AS provider_name,
       e.concept, e.period_month, e.amount, e.due_date, e.observations, e.created_by, e.created_at,
       COALESCE(p.paid, 0)::numeric(12,2) AS paid_total,
       GREATEST(e.amount - COALESCE(p.paid, 0), 0)::numeric(12,2) AS balance_total,
       CASE WHEN e.status = 'ANULADO' THEN 'ANULADO'
            WHEN COALESCE(p.paid, 0) >= e.amount THEN 'PAGADO'
            WHEN e.due_date IS NOT NULL AND e.due_date < public._lima_today() THEN 'VENCIDO'
            ELSE 'PENDIENTE' END AS calc_status,
       COALESCE(p.n, 0)::int AS payments_count,
       p.last_payment
  FROM public.service_expenses e
  LEFT JOIN public.maintenance_services s ON s.id = e.service_id
  LEFT JOIN public.service_providers pr ON pr.id = e.provider_id
  LEFT JOIN LATERAL (SELECT SUM(x.amount) AS paid, COUNT(*) AS n, MAX(x.payment_date) AS last_payment
                       FROM public.expense_payments x
                      WHERE x.expense_id = e.id AND x.status = 'VALIDO') p ON TRUE;

CREATE OR REPLACE VIEW public.vw_expense_allocations_calc WITH (security_invoker = true) AS
SELECT a.building_id, a.amount AS share_amount,
       ROUND(a.amount * c.paid_total / c.amount, 2) AS share_paid,
       ROUND(a.amount * c.balance_total / c.amount, 2) AS share_balance,
       c.*
  FROM public.expense_allocations a
  JOIN public.vw_service_expenses_calc c ON c.id = a.expense_id;

GRANT SELECT ON public.vw_service_expenses_calc, public.vw_expense_allocations_calc TO authenticated;
GRANT SELECT ON public.vw_service_expenses_calc, public.vw_expense_allocations_calc TO service_role;

-- 4. Catálogo de servicios (sin duplicar; quedan INACTIVOS hasta que se activen) ---------------------
CREATE OR REPLACE FUNCTION public.seed_maintenance_catalog(p_building UUID) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_n INT := 0; v_rows INT; r RECORD;
BEGIN
    FOR r IN SELECT * FROM (VALUES
        ('Personal de limpieza de áreas comunes', 'Personal'),
        ('Servicio de recepción', 'Personal'),
        ('Mantenimiento de ascensores', 'Mantenimiento'),
        ('Mantenimiento de la puerta de garaje', 'Mantenimiento'),
        ('Consumo de agua', 'Servicios básicos'),
        ('Consumo de electricidad', 'Servicios básicos'),
        ('Mantenimiento de cámaras de seguridad', 'Seguridad'),
        ('Servicio de internet para cámaras de seguridad', 'Seguridad'),
        ('Productos químicos para piscina', 'Piscina'),
        ('Artículos de limpieza', 'Insumos'),
        ('Mantenimiento de piscina', 'Piscina'),
        ('Limpieza y desinfección de cisterna', 'Agua y sanidad'),
        ('Mantenimiento del sistema de presión constante y bombas de agua', 'Agua y sanidad'),
        ('Mantenimiento del sistema contra incendios', 'Seguridad'),
        ('Mantenimiento del cuarto de lodos', 'Agua y sanidad')
    ) AS t(name, category) LOOP
        INSERT INTO public.maintenance_services (building_id, name, category, status, is_catalog)
        VALUES (p_building, r.name, r.category, 'INACTIVO', TRUE)
        ON CONFLICT (building_id, lower(name)) DO NOTHING;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_n := v_n + v_rows;
    END LOOP;
    RETURN v_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.seed_maintenance_catalog(UUID) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.trg_seed_catalog_on_building() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    PERFORM public.seed_maintenance_catalog(NEW.id);
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_seed_catalog_on_building ON public.buildings;
CREATE TRIGGER trg_seed_catalog_on_building AFTER INSERT ON public.buildings
FOR EACH ROW EXECUTE FUNCTION public.trg_seed_catalog_on_building();

DO $$ DECLARE b RECORD;
BEGIN FOR b IN SELECT id FROM public.buildings LOOP PERFORM public.seed_maintenance_catalog(b.id); END LOOP; END $$;

-- 5. Proveedores ----------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_provider(p JSONB) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_id UUID := NULLIF(p->>'id', '')::uuid;
    v_name TEXT := trim(COALESCE(p->>'name', ''));
BEGIN
    IF NOT public.auth_is_staff() THEN RAISE EXCEPTION 'Acceso denegado.'; END IF;
    IF v_name = '' OR char_length(v_name) > 150 THEN RAISE EXCEPTION 'El nombre del proveedor es obligatorio (máximo 150 caracteres).'; END IF;
    BEGIN
        IF v_id IS NULL THEN
            INSERT INTO public.service_providers (name, phone, notes)
            VALUES (v_name, NULLIF(trim(COALESCE(p->>'phone','')), ''), NULLIF(trim(COALESCE(p->>'notes','')), ''))
            RETURNING id INTO v_id;
        ELSE
            UPDATE public.service_providers
               SET name = v_name, phone = NULLIF(trim(COALESCE(p->>'phone','')), ''),
                   notes = NULLIF(trim(COALESCE(p->>'notes','')), ''),
                   is_active = COALESCE((p->>'is_active')::boolean, is_active)
             WHERE id = v_id;
            IF NOT FOUND THEN RAISE EXCEPTION 'El proveedor no existe.'; END IF;
        END IF;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'Ya existe un proveedor con ese nombre.';
    END;
    RETURN v_id;
END;
$$;

-- 6. Servicios (crear, editar, activar/desactivar) ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_maintenance_service(p JSONB) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_id UUID := NULLIF(p->>'id', '')::uuid;
    v_building UUID := NULLIF(p->>'building_id', '')::uuid;
    v_name TEXT := trim(COALESCE(p->>'name', ''));
    v_freq TEXT := COALESCE(NULLIF(p->>'frequency', ''), 'EVENTUAL');
    v_status TEXT := COALESCE(NULLIF(p->>'status', ''), 'INACTIVO');
BEGIN
    IF v_id IS NOT NULL THEN
        SELECT building_id INTO v_building FROM public.maintenance_services WHERE id = v_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'El servicio no existe.'; END IF;
    END IF;
    IF v_building IS NULL OR NOT public.auth_is_admin_of(v_building) THEN
        RAISE EXCEPTION 'No tiene permiso para administrar este edificio.';
    END IF;
    IF v_name = '' OR char_length(v_name) > 200 THEN RAISE EXCEPTION 'El nombre del servicio es obligatorio (máximo 200 caracteres).'; END IF;
    IF v_freq NOT IN ('MENSUAL','BIMESTRAL','TRIMESTRAL','SEMESTRAL','ANUAL','EVENTUAL') THEN RAISE EXCEPTION 'Frecuencia no válida.'; END IF;
    IF v_status NOT IN ('ACTIVO','INACTIVO','FINALIZADO') THEN RAISE EXCEPTION 'Estado no válido.'; END IF;
    IF NULLIF(p->>'estimated_amount', '') IS NOT NULL AND (p->>'estimated_amount')::numeric < 0 THEN
        RAISE EXCEPTION 'El importe estimado no puede ser negativo.';
    END IF;

    BEGIN
        IF v_id IS NULL THEN
            INSERT INTO public.maintenance_services
                (building_id, name, category, description, provider_id, frequency, estimated_amount,
                 next_maintenance_date, next_due_date, status)
            VALUES (v_building, v_name, NULLIF(trim(COALESCE(p->>'category','')), ''),
                    NULLIF(trim(COALESCE(p->>'description','')), ''), NULLIF(p->>'provider_id', '')::uuid, v_freq,
                    NULLIF(p->>'estimated_amount', '')::numeric, NULLIF(p->>'next_maintenance_date', '')::date,
                    NULLIF(p->>'next_due_date', '')::date, v_status)
            RETURNING id INTO v_id;
            PERFORM public._audit(v_building, 'CREAR_SERVICIO', format('Agregó el servicio "%s"', v_name));
        ELSE
            UPDATE public.maintenance_services
               SET name = v_name, category = NULLIF(trim(COALESCE(p->>'category','')), ''),
                   description = NULLIF(trim(COALESCE(p->>'description','')), ''),
                   provider_id = NULLIF(p->>'provider_id', '')::uuid, frequency = v_freq,
                   estimated_amount = NULLIF(p->>'estimated_amount', '')::numeric,
                   next_maintenance_date = NULLIF(p->>'next_maintenance_date', '')::date,
                   next_due_date = NULLIF(p->>'next_due_date', '')::date,
                   status = v_status, updated_at = NOW()
             WHERE id = v_id;
            PERFORM public._audit(v_building, 'EDITAR_SERVICIO', format('Editó el servicio "%s" (%s)', v_name, v_status));
        END IF;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'Ya existe un servicio con ese nombre en este edificio.';
    END;
    RETURN v_id;
END;
$$;

-- 7. Gastos ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_expense(p JSONB) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_id UUID := NULLIF(p->>'id', '')::uuid;
    v_scope TEXT := COALESCE(p->>'scope', 'EDIFICIO');
    v_building UUID := NULLIF(p->>'building_id', '')::uuid;
    v_service UUID := NULLIF(p->>'service_id', '')::uuid;
    v_concept TEXT := trim(COALESCE(p->>'concept', ''));
    v_amount NUMERIC(12,2) := NULLIF(p->>'amount', '')::numeric;
    v_period DATE := date_trunc('month', NULLIF(p->>'period_month', '')::date)::date;
    v_category TEXT := NULLIF(trim(COALESCE(p->>'category','')), '');
    v_allocs JSONB := COALESCE(p->'allocations', '[]'::jsonb);
    v_item JSONB; v_b UUID; v_a NUMERIC; v_sum NUMERIC := 0; v_n INT := 0;
    v_paid NUMERIC := 0; v_old public.service_expenses; v_admin TEXT;
    v_svc_building UUID; v_seen UUID[] := ARRAY[]::uuid[];
BEGIN
    IF v_scope NOT IN ('EDIFICIO','COMPARTIDO','GENERAL') THEN RAISE EXCEPTION 'Alcance no válido.'; END IF;
    IF v_concept = '' OR char_length(v_concept) > 250 THEN RAISE EXCEPTION 'El concepto es obligatorio (máximo 250 caracteres).'; END IF;
    IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'El importe debe ser mayor a cero.'; END IF;
    IF v_period IS NULL THEN RAISE EXCEPTION 'Indique el período al que corresponde el gasto.'; END IF;

    IF v_id IS NOT NULL THEN
        SELECT * INTO v_old FROM public.service_expenses WHERE id = v_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'El gasto no existe.'; END IF;
        IF NOT public.can_manage_expense(v_id) THEN RAISE EXCEPTION 'No tiene permiso para editar este gasto.'; END IF;
        IF v_old.status = 'ANULADO' THEN RAISE EXCEPTION 'Un gasto anulado no se puede editar.'; END IF;
        v_scope := v_old.scope;   -- el alcance no cambia al editar
        SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM public.expense_payments WHERE expense_id = v_id AND status = 'VALIDO';
        IF v_amount < v_paid THEN
            RAISE EXCEPTION 'El importe no puede ser menor a lo ya pagado (S/ %). Anule primero algún pago.', v_paid;
        END IF;
    END IF;

    -- Reparto entre edificios según el alcance
    IF v_scope = 'EDIFICIO' THEN
        IF v_building IS NULL AND v_id IS NOT NULL THEN
            SELECT building_id INTO v_building FROM public.expense_allocations WHERE expense_id = v_id LIMIT 1;
        END IF;
        IF v_building IS NULL OR NOT public.auth_is_admin_of(v_building) THEN
            RAISE EXCEPTION 'No tiene permiso para administrar este edificio.';
        END IF;
        v_allocs := jsonb_build_array(jsonb_build_object('building_id', v_building, 'amount', v_amount));
    ELSIF v_scope = 'COMPARTIDO' THEN
        IF jsonb_array_length(v_allocs) < 2 THEN RAISE EXCEPTION 'Un gasto compartido necesita al menos dos edificios.'; END IF;
    ELSE
        IF NOT public.auth_is_superadmin() THEN RAISE EXCEPTION 'Solo el superadmin registra gastos generales.'; END IF;
        v_allocs := '[]'::jsonb;
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(v_allocs) LOOP
        v_b := (v_item->>'building_id')::uuid;
        v_a := (v_item->>'amount')::numeric;
        IF v_a IS NULL OR v_a <= 0 THEN RAISE EXCEPTION 'Cada edificio del reparto necesita un importe mayor a cero.'; END IF;
        IF v_b = ANY (v_seen) THEN RAISE EXCEPTION 'Un edificio aparece repetido en el reparto.'; END IF;
        IF NOT public.auth_is_admin_of(v_b) THEN RAISE EXCEPTION 'No tiene permiso para administrar uno de los edificios del reparto.'; END IF;
        v_seen := v_seen || v_b; v_sum := v_sum + v_a; v_n := v_n + 1;
    END LOOP;
    IF v_scope <> 'GENERAL' AND ABS(v_sum - v_amount) > 0.01 THEN
        RAISE EXCEPTION 'El reparto (S/ %) no coincide con el importe total (S/ %).', v_sum, v_amount;
    END IF;

    IF v_service IS NOT NULL THEN
        SELECT building_id INTO v_svc_building FROM public.maintenance_services WHERE id = v_service;
        IF v_scope <> 'EDIFICIO' OR v_svc_building IS DISTINCT FROM v_building THEN
            RAISE EXCEPTION 'El servicio elegido no corresponde a este gasto.';
        END IF;
    END IF;

    SELECT full_name INTO v_admin FROM public.user_profiles WHERE id = auth.uid();

    IF v_id IS NULL THEN
        INSERT INTO public.service_expenses (scope, service_id, provider_id, category, concept, period_month, amount, due_date, observations, created_by)
        VALUES (v_scope, v_service, NULLIF(p->>'provider_id', '')::uuid, v_category, v_concept, v_period, v_amount,
                NULLIF(p->>'due_date', '')::date, NULLIF(trim(COALESCE(p->>'observations','')), ''), COALESCE(v_admin, 'Administración'))
        RETURNING id INTO v_id;
    ELSE
        UPDATE public.service_expenses
           SET service_id = v_service, provider_id = NULLIF(p->>'provider_id', '')::uuid, category = v_category,
               concept = v_concept, period_month = v_period, amount = v_amount,
               due_date = NULLIF(p->>'due_date', '')::date,
               observations = NULLIF(trim(COALESCE(p->>'observations','')), ''), updated_at = NOW()
         WHERE id = v_id;
        DELETE FROM public.expense_allocations WHERE expense_id = v_id;
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(v_allocs) LOOP
        INSERT INTO public.expense_allocations (expense_id, building_id, amount)
        VALUES (v_id, (v_item->>'building_id')::uuid, (v_item->>'amount')::numeric);
        PERFORM public._audit((v_item->>'building_id')::uuid, 'GASTO_MANTENIMIENTO',
            format('%s el gasto "%s" por S/ %s (parte del edificio: S/ %s)',
                   CASE WHEN p->>'id' IS NULL OR p->>'id' = '' THEN 'Registró' ELSE 'Editó' END,
                   v_concept, v_amount, (v_item->>'amount')::numeric));
    END LOOP;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_expense(p_expense UUID, p_reason TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_e public.service_expenses; v_reason TEXT := trim(COALESCE(p_reason, '')); a RECORD;
BEGIN
    SELECT * INTO v_e FROM public.service_expenses WHERE id = p_expense FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'El gasto no existe.'; END IF;
    IF NOT public.can_manage_expense(p_expense) THEN RAISE EXCEPTION 'No tiene permiso para anular este gasto.'; END IF;
    IF v_e.status = 'ANULADO' THEN RAISE EXCEPTION 'Ese gasto ya está anulado.'; END IF;
    IF char_length(v_reason) < 3 THEN RAISE EXCEPTION 'Indique el motivo de la anulación.'; END IF;
    IF EXISTS (SELECT 1 FROM public.expense_payments WHERE expense_id = p_expense AND status = 'VALIDO') THEN
        RAISE EXCEPTION 'El gasto tiene pagos registrados. Anule primero esos pagos.';
    END IF;
    UPDATE public.service_expenses
       SET status = 'ANULADO', observations = trim(COALESCE(observations, '') || E'\n[ANULADO] ' || v_reason), updated_at = NOW()
     WHERE id = p_expense;
    FOR a IN SELECT building_id FROM public.expense_allocations WHERE expense_id = p_expense LOOP
        PERFORM public._audit(a.building_id, 'ANULAR_GASTO', format('Anuló el gasto "%s". Motivo: %s', v_e.concept, v_reason));
    END LOOP;
END;
$$;

-- 8. Pagos de gastos ----------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_expense_payment(
    p_expense UUID, p_amount NUMERIC, p_date DATE, p_method TEXT,
    p_operation TEXT DEFAULT NULL, p_notes TEXT DEFAULT NULL
) RETURNS public.expense_payments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_e public.service_expenses; v_paid NUMERIC; v_pay public.expense_payments; v_admin TEXT; a RECORD;
BEGIN
    SELECT * INTO v_e FROM public.service_expenses WHERE id = p_expense FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'El gasto no existe.'; END IF;
    IF NOT public.can_manage_expense(p_expense) THEN RAISE EXCEPTION 'No tiene permiso para registrar pagos en este gasto.'; END IF;
    IF v_e.status = 'ANULADO' THEN RAISE EXCEPTION 'No se puede pagar un gasto anulado.'; END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'El monto pagado debe ser mayor a cero.'; END IF;
    IF p_date IS NULL OR p_date > public._lima_today() THEN RAISE EXCEPTION 'La fecha de pago es obligatoria y no puede ser futura.'; END IF;
    IF char_length(trim(COALESCE(p_method, ''))) = 0 OR char_length(p_method) > 50 THEN RAISE EXCEPTION 'Indique el método de pago.'; END IF;
    SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM public.expense_payments WHERE expense_id = p_expense AND status = 'VALIDO';
    IF v_paid + p_amount > v_e.amount + 0.001 THEN
        RAISE EXCEPTION 'El pago excede el saldo pendiente (S/ %).', GREATEST(v_e.amount - v_paid, 0);
    END IF;
    SELECT full_name INTO v_admin FROM public.user_profiles WHERE id = auth.uid();
    INSERT INTO public.expense_payments (expense_id, amount, payment_date, method, operation_number, notes, registered_by)
    VALUES (p_expense, p_amount, p_date, trim(p_method), NULLIF(trim(COALESCE(p_operation, '')), ''),
            NULLIF(trim(COALESCE(p_notes, '')), ''), COALESCE(v_admin, 'Administración'))
    RETURNING * INTO v_pay;
    FOR a IN SELECT building_id FROM public.expense_allocations WHERE expense_id = p_expense LOOP
        PERFORM public._audit(a.building_id, 'PAGO_GASTO',
            format('Registró pago de S/ %s del gasto "%s" (%s)', p_amount, v_e.concept, trim(p_method)));
    END LOOP;
    RETURN v_pay;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_expense_payment(p_payment UUID, p_reason TEXT)
RETURNS public.expense_payments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_pay public.expense_payments; v_e public.service_expenses; v_reason TEXT := trim(COALESCE(p_reason, '')); a RECORD;
BEGIN
    SELECT * INTO v_pay FROM public.expense_payments WHERE id = p_payment FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'El pago no existe.'; END IF;
    IF NOT public.can_manage_expense(v_pay.expense_id) THEN RAISE EXCEPTION 'No tiene permiso para anular este pago.'; END IF;
    IF v_pay.status = 'ANULADO' THEN RAISE EXCEPTION 'Ese pago ya está anulado.'; END IF;
    IF char_length(v_reason) < 3 OR char_length(v_reason) > 500 THEN RAISE EXCEPTION 'Indique el motivo de la anulación (entre 3 y 500 caracteres).'; END IF;
    UPDATE public.expense_payments SET status = 'ANULADO', void_reason = v_reason WHERE id = p_payment RETURNING * INTO v_pay;
    SELECT * INTO v_e FROM public.service_expenses WHERE id = v_pay.expense_id;
    FOR a IN SELECT building_id FROM public.expense_allocations WHERE expense_id = v_pay.expense_id LOOP
        PERFORM public._audit(a.building_id, 'ANULAR_PAGO_GASTO',
            format('Anuló el pago de S/ %s del gasto "%s". Motivo: %s', v_pay.amount, v_e.concept, v_reason));
    END LOOP;
    RETURN v_pay;
END;
$$;

-- 9. Documentos --------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_service_document(
    p_expense UUID, p_service UUID, p_payment UUID, p_type TEXT, p_path TEXT, p_name TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_id UUID; v_admin TEXT;
BEGIN
    IF p_expense IS NULL AND p_service IS NULL THEN RAISE EXCEPTION 'El documento debe pertenecer a un gasto o a un servicio.'; END IF;
    IF p_expense IS NOT NULL AND NOT public.can_manage_expense(p_expense) THEN RAISE EXCEPTION 'No tiene permiso.'; END IF;
    IF p_expense IS NULL AND NOT public.can_manage_service(p_service) THEN RAISE EXCEPTION 'No tiene permiso.'; END IF;
    IF p_type NOT IN ('FACTURA','RECIBO','COTIZACION','COMPROBANTE','INFORME','OTRO') THEN RAISE EXCEPTION 'Tipo de documento no válido.'; END IF;
    IF split_part(p_path, '/', 2) <> COALESCE(p_expense, p_service)::text THEN RAISE EXCEPTION 'La ruta del archivo no corresponde.'; END IF;
    SELECT full_name INTO v_admin FROM public.user_profiles WHERE id = auth.uid();
    INSERT INTO public.service_documents (expense_id, service_id, payment_id, doc_type, file_path, file_name, uploaded_by)
    VALUES (p_expense, CASE WHEN p_expense IS NULL THEN p_service END, p_payment, p_type, p_path, left(p_name, 250), COALESCE(v_admin, 'Administración'))
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_service_document(p_id UUID) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE d public.service_documents;
BEGIN
    SELECT * INTO d FROM public.service_documents WHERE id = p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'El documento no existe.'; END IF;
    IF (d.expense_id IS NOT NULL AND NOT public.can_manage_expense(d.expense_id))
       OR (d.expense_id IS NULL AND NOT public.can_manage_service(d.service_id)) THEN
        RAISE EXCEPTION 'No tiene permiso.';
    END IF;
    DELETE FROM public.service_documents WHERE id = p_id;
    RETURN d.file_path;   -- la app borra el archivo con esta ruta
END;
$$;

-- Almacenamiento privado: carpeta  expense/<id>/archivo  o  service/<id>/archivo
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('mantenimiento', 'mantenimiento', FALSE, 15728640,
        ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = FALSE, file_size_limit = 15728640,
    allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS "Administracion gestiona documentos de mantenimiento" ON storage.objects;
CREATE POLICY "Administracion gestiona documentos de mantenimiento"
ON storage.objects FOR ALL USING (
    bucket_id = 'mantenimiento' AND auth.uid() IS NOT NULL
    AND CASE WHEN (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$' THEN
        CASE (storage.foldername(name))[1]
            WHEN 'expense' THEN public.can_manage_expense(((storage.foldername(name))[2])::uuid)
            WHEN 'service' THEN public.can_manage_service(((storage.foldername(name))[2])::uuid)
            ELSE FALSE END
        ELSE FALSE END
) WITH CHECK (
    bucket_id = 'mantenimiento' AND auth.uid() IS NOT NULL
    AND CASE WHEN (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$' THEN
        CASE (storage.foldername(name))[1]
            WHEN 'expense' THEN public.can_manage_expense(((storage.foldername(name))[2])::uuid)
            WHEN 'service' THEN public.can_manage_service(((storage.foldername(name))[2])::uuid)
            ELSE FALSE END
        ELSE FALSE END
);
-- 10. Caja general y otros ingresos -----------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_cash_account(p_name TEXT, p_opening NUMERIC, p_date DATE) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    IF NOT public.auth_is_superadmin() THEN RAISE EXCEPTION 'Solo el superadmin gestiona la caja general.'; END IF;
    IF p_opening IS NULL OR p_date IS NULL THEN RAISE EXCEPTION 'Indique el saldo inicial y su fecha.'; END IF;
    INSERT INTO public.admin_cash_account (id, name, opening_balance, opening_date)
    VALUES (1, COALESCE(NULLIF(trim(p_name), ''), 'Cuenta de la administración'), p_opening, p_date)
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, opening_balance = EXCLUDED.opening_balance,
        opening_date = EXCLUDED.opening_date, updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.save_other_income(p JSONB) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_id UUID := NULLIF(p->>'id', '')::uuid;
    v_building UUID := NULLIF(p->>'building_id', '')::uuid;
    v_amount NUMERIC := NULLIF(p->>'amount', '')::numeric;
    v_concept TEXT := trim(COALESCE(p->>'concept', ''));
    v_date DATE := NULLIF(p->>'income_date', '')::date;
    v_admin TEXT;
BEGIN
    IF v_building IS NULL THEN
        IF NOT public.auth_is_superadmin() THEN RAISE EXCEPTION 'Solo el superadmin registra ingresos generales.'; END IF;
    ELSIF NOT public.auth_is_admin_of(v_building) THEN
        RAISE EXCEPTION 'No tiene permiso para administrar este edificio.';
    END IF;
    IF v_concept = '' OR char_length(v_concept) > 250 THEN RAISE EXCEPTION 'El concepto es obligatorio (máximo 250 caracteres).'; END IF;
    IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'El importe debe ser mayor a cero.'; END IF;
    IF v_date IS NULL OR v_date > public._lima_today() THEN RAISE EXCEPTION 'La fecha es obligatoria y no puede ser futura.'; END IF;
    SELECT full_name INTO v_admin FROM public.user_profiles WHERE id = auth.uid();
    IF v_id IS NULL THEN
        INSERT INTO public.other_income (building_id, income_date, concept, amount, notes, created_by)
        VALUES (v_building, v_date, v_concept, v_amount, NULLIF(trim(COALESCE(p->>'notes','')), ''), COALESCE(v_admin, 'Administración'))
        RETURNING id INTO v_id;
    ELSE
        UPDATE public.other_income SET income_date = v_date, concept = v_concept, amount = v_amount,
               notes = NULLIF(trim(COALESCE(p->>'notes','')), '')
         WHERE id = v_id AND building_id IS NOT DISTINCT FROM v_building AND status = 'VALIDO';
        IF NOT FOUND THEN RAISE EXCEPTION 'El ingreso no existe o está anulado.'; END IF;
    END IF;
    PERFORM public._audit(v_building, 'OTRO_INGRESO', format('Registró el ingreso "%s" por S/ %s', v_concept, v_amount));
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_other_income(p_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE r public.other_income;
BEGIN
    SELECT * INTO r FROM public.other_income WHERE id = p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'El ingreso no existe.'; END IF;
    IF (r.building_id IS NULL AND NOT public.auth_is_superadmin())
       OR (r.building_id IS NOT NULL AND NOT public.auth_is_admin_of(r.building_id)) THEN
        RAISE EXCEPTION 'No tiene permiso.';
    END IF;
    UPDATE public.other_income SET status = 'ANULADO' WHERE id = p_id;
    PERFORM public._audit(r.building_id, 'ANULAR_INGRESO', format('Anuló el ingreso "%s" por S/ %s', r.concept, r.amount));
END;
$$;

-- Movimientos del período (cuotas cobradas por FECHA DE PAGO, ingresos y gastos pagados)
CREATE OR REPLACE FUNCTION public._cash_flows(p_from DATE, p_to DATE, p_building UUID)
RETURNS TABLE (fees NUMERIC, other NUMERIC, spent NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT
      COALESCE((SELECT SUM(py.amount) FROM public.payments py
                 WHERE py.status <> 'RECHAZADO' AND py.payment_date BETWEEN p_from AND p_to
                   AND (p_building IS NULL OR py.building_id = p_building)), 0),
      COALESCE((SELECT SUM(oi.amount) FROM public.other_income oi
                 WHERE oi.status = 'VALIDO' AND oi.income_date BETWEEN p_from AND p_to
                   AND (p_building IS NULL OR oi.building_id = p_building)), 0),
      CASE WHEN p_building IS NULL THEN
        COALESCE((SELECT SUM(ep.amount) FROM public.expense_payments ep
                    JOIN public.service_expenses e ON e.id = ep.expense_id
                   WHERE ep.status = 'VALIDO' AND e.status = 'ACTIVO' AND ep.payment_date BETWEEN p_from AND p_to), 0)
      ELSE
        COALESCE((SELECT SUM(ep.amount * a.amount / e.amount) FROM public.expense_payments ep
                    JOIN public.service_expenses e ON e.id = ep.expense_id
                    JOIN public.expense_allocations a ON a.expense_id = e.id AND a.building_id = p_building
                   WHERE ep.status = 'VALIDO' AND e.status = 'ACTIVO' AND ep.payment_date BETWEEN p_from AND p_to), 0)
      END
$$;
REVOKE EXECUTE ON FUNCTION public._cash_flows(DATE, DATE, UUID) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.get_cash_summary(p_from DATE, p_to DATE, p_building UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_acc public.admin_cash_account;
    v_eff DATE := p_from;
    v_fees NUMERIC; v_other NUMERIC; v_spent NUMERIC;
    v_opening NUMERIC; v_pending NUMERIC := 0; v_overdue NUMERIC := 0;
    v_rows JSONB := '[]'::jsonb; b RECORD; bf NUMERIC; bo NUMERIC; bs NUMERIC;
    v_gen_in NUMERIC; v_gen_out NUMERIC; pf RECORD;
BEGIN
    IF p_building IS NULL THEN
        IF NOT public.auth_is_superadmin() THEN RAISE EXCEPTION 'Solo el superadmin ve la caja general.'; END IF;
    ELSIF NOT public.auth_is_admin_of(p_building) THEN
        RAISE EXCEPTION 'No tiene permiso para este edificio.';
    END IF;
    IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'Período no válido.'; END IF;

    SELECT * INTO v_acc FROM public.admin_cash_account WHERE id = 1;
    IF FOUND THEN v_eff := GREATEST(p_from, v_acc.opening_date); END IF;

    IF v_eff > p_to THEN
        v_fees := 0; v_other := 0; v_spent := 0;
    ELSE
        SELECT fees, other, spent INTO v_fees, v_other, v_spent FROM public._cash_flows(v_eff, p_to, p_building);
    END IF;

    IF p_building IS NULL AND v_acc.id IS NOT NULL THEN
        IF v_acc.opening_date >= p_from THEN
            v_opening := v_acc.opening_balance;
        ELSE
            SELECT v_acc.opening_balance + fees + other - spent INTO v_opening
              FROM public._cash_flows(v_acc.opening_date, p_from - 1, NULL);
        END IF;
    END IF;

    -- Obligaciones pendientes a hoy (parte del edificio, o total si no hay filtro)
    IF p_building IS NULL THEN
        SELECT COALESCE(SUM(balance_total), 0), COALESCE(SUM(balance_total) FILTER (WHERE calc_status = 'VENCIDO'), 0)
          INTO v_pending, v_overdue FROM public.vw_service_expenses_calc WHERE calc_status IN ('PENDIENTE', 'VENCIDO');
    ELSE
        SELECT COALESCE(SUM(share_balance), 0), COALESCE(SUM(share_balance) FILTER (WHERE calc_status = 'VENCIDO'), 0)
          INTO v_pending, v_overdue FROM public.vw_expense_allocations_calc
         WHERE building_id = p_building AND calc_status IN ('PENDIENTE', 'VENCIDO');
    END IF;

    IF p_building IS NULL THEN
        FOR b IN SELECT id, name FROM public.buildings WHERE is_active ORDER BY sort_order, name LOOP
            IF v_eff > p_to THEN bf := 0; bo := 0; bs := 0;
            ELSE SELECT fees, other, spent INTO bf, bo, bs FROM public._cash_flows(v_eff, p_to, b.id); END IF;
            v_rows := v_rows || jsonb_build_object('building_id', b.id, 'name', b.name, 'fees', bf, 'other', bo, 'spent', bs,
                                                   'result', bf + bo - bs);
        END LOOP;
        IF v_eff > p_to THEN v_gen_in := 0; v_gen_out := 0;
        ELSE
            SELECT COALESCE(SUM(amount), 0) INTO v_gen_in FROM public.other_income
             WHERE building_id IS NULL AND status = 'VALIDO' AND income_date BETWEEN v_eff AND p_to;
            SELECT COALESCE(SUM(ep.amount), 0) INTO v_gen_out FROM public.expense_payments ep
              JOIN public.service_expenses e ON e.id = ep.expense_id
             WHERE e.scope = 'GENERAL' AND ep.status = 'VALIDO' AND e.status = 'ACTIVO' AND ep.payment_date BETWEEN v_eff AND p_to;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'from', p_from, 'to', p_to, 'effective_from', v_eff,
        'account_configured', v_acc.id IS NOT NULL,
        'account_name', v_acc.name, 'opening_date', v_acc.opening_date,
        'opening_balance', v_opening,
        'fees_collected', v_fees, 'other_income', v_other, 'expenses_paid', v_spent,
        'period_result', v_fees + v_other - v_spent,
        'closing_balance', CASE WHEN v_opening IS NULL THEN NULL ELSE v_opening + v_fees + v_other - v_spent END,
        'pending_obligations', v_pending, 'overdue_obligations', v_overdue,
        'by_building', v_rows,
        'general_income', v_gen_in, 'general_expenses', v_gen_out);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_provider(JSONB), public.save_maintenance_service(JSONB), public.save_expense(JSONB),
    public.void_expense(UUID, TEXT), public.register_expense_payment(UUID, NUMERIC, DATE, TEXT, TEXT, TEXT),
    public.void_expense_payment(UUID, TEXT), public.add_service_document(UUID, UUID, UUID, TEXT, TEXT, TEXT),
    public.delete_service_document(UUID), public.set_cash_account(TEXT, NUMERIC, DATE), public.save_other_income(JSONB),
    public.void_other_income(UUID), public.get_cash_summary(DATE, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_provider(JSONB), public.save_maintenance_service(JSONB), public.save_expense(JSONB),
    public.void_expense(UUID, TEXT), public.register_expense_payment(UUID, NUMERIC, DATE, TEXT, TEXT, TEXT),
    public.void_expense_payment(UUID, TEXT), public.add_service_document(UUID, UUID, UUID, TEXT, TEXT, TEXT),
    public.delete_service_document(UUID), public.set_cash_account(TEXT, NUMERIC, DATE), public.save_other_income(JSONB),
    public.void_other_income(UUID), public.get_cash_summary(DATE, DATE, UUID) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
