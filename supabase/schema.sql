-- ==============================================================================
-- SISTEMA DE ADMINISTRACIÓN DE EDIFICIOS - SCHEMA AUDITADO Y COMPLETO (POSTGRESQL)
-- Arquitectura Multi-Edificio e Integración Inequívoca con Supabase Auth
-- ==============================================================================

-- 1. Habilitar extensión UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. TABLA DE EDIFICIOS (BUILDINGS)
CREATE TABLE IF NOT EXISTS buildings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(10) UNIQUE NOT NULL, -- Ej: PK10
    name VARCHAR(150) NOT NULL,       -- Ej: PARKE10
    address TEXT NOT NULL,            -- Ej: Av. Ejército 410, Yanahuara, Arequipa
    city VARCHAR(100) NOT NULL DEFAULT 'Arequipa',
    country VARCHAR(100) NOT NULL DEFAULT 'Perú',
    total_units INT NOT NULL DEFAULT 52,
    total_floors INT NOT NULL DEFAULT 11,
    default_due_day INT NOT NULL DEFAULT 5, -- Día 5 de cada mes
    
    -- Parámetros del edificio (Configurables)
    elevators_count INT DEFAULT 2,
    parking_spots_count INT DEFAULT 52,
    basements_count INT DEFAULT 2,
    garage_doors_count INT DEFAULT 2,
    surveillance_hours VARCHAR(100) DEFAULT '24/7',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. TABLA DE DEPARTAMENTOS (UNITS)
CREATE TABLE IF NOT EXISTS units (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    building_id UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL, -- Ej: 502, 101, 1102
    floor INT NOT NULL,
    monthly_fee DECIMAL(10,2) NOT NULL DEFAULT 150.00,
    status VARCHAR(50) DEFAULT 'OCUPADO' CHECK (status IN ('OCUPADO', 'DESOCUPADO', 'EN_ALQUILER')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(building_id, code)
);

-- 4. TABLA DE PERFILES DE USUARIO (USER_PROFILES)
-- Enlace directo con Supabase Auth (auth.users)
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    building_id UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
    unit_id UUID REFERENCES units(id) ON DELETE SET NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'propietario' CHECK (role IN ('propietario', 'administradora', 'superadmin')),
    full_name VARCHAR(200) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    phone VARCHAR(30),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. TABLA DE PROPIETARIOS / RESIDENTES (OWNERS)
CREATE TABLE IF NOT EXISTS owners (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_profile_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
    building_id UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    full_name VARCHAR(200) NOT NULL,
    document_type VARCHAR(20) DEFAULT 'DNI',
    document_number VARCHAR(30),
    phone VARCHAR(30) NOT NULL,
    email VARCHAR(150) NOT NULL,
    is_primary_owner BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. TABLA DE ÁREAS COMUNES (COMMON AREAS)
CREATE TABLE IF NOT EXISTS common_areas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    building_id UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL, -- Ej: Piscina, Zona de Parrillas, SUM
    description TEXT,
    capacity INT DEFAULT 15,
    opening_time TIME NOT NULL DEFAULT '09:00',
    closing_time TIME NOT NULL DEFAULT '21:00',
    slot_duration_hours INT NOT NULL DEFAULT 3,
    is_active BOOLEAN DEFAULT TRUE,
    image_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. TABLA DE RESERVAS (RESERVATIONS)
CREATE TABLE IF NOT EXISTS reservations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(20) UNIQUE NOT NULL, -- Ej: PK10-00001
    building_id UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
    area_id UUID NOT NULL REFERENCES common_areas(id) ON DELETE CASCADE,
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    unit_code VARCHAR(20) NOT NULL,
    owner_name VARCHAR(200) NOT NULL,
    phone VARCHAR(30) NOT NULL,
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    motive TEXT,
    accepted_terms BOOLEAN NOT NULL DEFAULT TRUE,
    -- PENDIENTE = solicitud en espera; CONFIRMADA = aprobada por la administradora
    status VARCHAR(30) DEFAULT 'PENDIENTE' CONSTRAINT reservations_status_check CHECK (status IN ('PENDIENTE', 'CONFIRMADA', 'RECHAZADA', 'CANCELADA', 'FINALIZADA', 'BLOQUEADA')),
    decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    decided_at TIMESTAMP WITH TIME ZONE,
    rejection_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() -- asignado por el servidor (trigger), no editable
);

-- 8. TABLA DE BLOQUEOS DE ÁREAS COMUNES (RESERVATION BLOCKS)
CREATE TABLE IF NOT EXISTS reservation_blocks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    building_id UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
    area_id UUID NOT NULL REFERENCES common_areas(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    reason TEXT NOT NULL,
    created_by VARCHAR(150) NOT NULL DEFAULT 'Administración',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 9. TABLA DE CUOTAS DE MANTENIMIENTO (MAINTENANCE FEES)
CREATE TABLE IF NOT EXISTS maintenance_fees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    building_id UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    unit_code VARCHAR(20) NOT NULL,
    owner_name VARCHAR(200) NOT NULL,
    period VARCHAR(50) NOT NULL, -- Ej: Octubre 2026
    due_date DATE NOT NULL,      -- Ej: 2026-10-05
    fee_amount DECIMAL(10,2) NOT NULL DEFAULT 150.00,
    days_late INT DEFAULT 0,
    interest_amount DECIMAL(10,2) DEFAULT 0.00,
    total_amount DECIMAL(10,2) NOT NULL,
    total_pending DECIMAL(10,2) NOT NULL,
    status VARCHAR(30) DEFAULT 'PENDIENTE' CHECK (status IN ('PAGADO', 'POR_VERIFICAR', 'PENDIENTE')),
    payment_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 10. TABLA DE PAGOS (PAYMENTS)
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    building_id UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
    fee_id UUID REFERENCES maintenance_fees(id) ON DELETE SET NULL,
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    unit_code VARCHAR(20) NOT NULL,
    owner_name VARCHAR(200) NOT NULL,
    period VARCHAR(50) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    payment_date DATE NOT NULL,
    method VARCHAR(50) NOT NULL, -- Transferencia bancaria, Yape, Plin, Efectivo, Otro
    operation_number VARCHAR(100),
    status VARCHAR(30) DEFAULT 'VERIFICADO' CHECK (status IN ('VERIFICADO', 'POR_VERIFICAR', 'RECHAZADO')),
    notes TEXT,
    proof_file_path TEXT, -- Supabase Storage Reference Path
    registered_by VARCHAR(150) NOT NULL,
    registered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 11. TABLA DE REGLAS DE INTERÉS MORATORIO (INTEREST RULES)
CREATE TABLE IF NOT EXISTS interest_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    building_id UUID UNIQUE NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
    type VARCHAR(50) DEFAULT 'PORCENTAJE_DIARIO',
    rate_percent DECIMAL(5,2) DEFAULT 0.10,
    fixed_amount DECIMAL(10,2) DEFAULT 0.00,
    grace_days INT DEFAULT 0,
    applied_from_day INT DEFAULT 6,
    rounding VARCHAR(50) DEFAULT 'DOS_DECADAS',
    is_active BOOLEAN DEFAULT TRUE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 12. TABLA DE COMUNICADOS (ANNOUNCEMENTS)
CREATE TABLE IF NOT EXISTS announcements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    building_id UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
    title VARCHAR(250) NOT NULL,
    category VARCHAR(100) DEFAULT 'General',
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    content TEXT NOT NULL,
    is_published BOOLEAN DEFAULT TRUE,
    attachment_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 13. TABLA DE NORMAS Y REGLAMENTOS (RULES)
CREATE TABLE IF NOT EXISTS rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    building_id UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
    category VARCHAR(150) NOT NULL,
    item_order INT DEFAULT 1,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 14. TABLA DE DOCUMENTOS (DOCUMENTS)
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    building_id UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
    unit_id UUID REFERENCES units(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    category VARCHAR(100) DEFAULT 'Administrativo', -- Comprobantes, Reglamento, Acta, etc.
    file_path TEXT NOT NULL, -- Supabase Storage Bucket Path
    file_size_bytes BIGINT,
    uploaded_by VARCHAR(150) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 15. TABLA DE AUDITORÍA (AUDIT LOGS)
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    building_id UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
    action VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    performed_by VARCHAR(150) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ÍNDICES DE RENDIMIENTO AUDITADOS
CREATE INDEX IF NOT EXISTS idx_units_building ON units(building_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_building ON user_profiles(building_id);
CREATE INDEX IF NOT EXISTS idx_owners_unit ON owners(unit_id);
CREATE INDEX IF NOT EXISTS idx_reservations_area_date ON reservations(area_id, date);
CREATE INDEX IF NOT EXISTS idx_fees_unit_period ON maintenance_fees(unit_code, period);
CREATE INDEX IF NOT EXISTS idx_payments_building ON payments(building_id);
CREATE INDEX IF NOT EXISTS idx_audit_building ON audit_logs(building_id, timestamp DESC);

-- FUNCIONES DE SEGURIDAD SERVIDOR (SERVER-SIDE SECURITY HELPERS)
CREATE OR REPLACE FUNCTION public.get_auth_user_profile()
RETURNS TABLE (
    user_id UUID,
    building_id UUID,
    unit_id UUID,
    role VARCHAR
) 
LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT id, building_id, unit_id, role
    FROM public.user_profiles
    WHERE id = auth.uid();
$$;

-- FUNCIÓN PARA CALCULAR INTERÉS MORATORIO EN EL SERVIDOR (NO CONFIAR EN EL FRONTEND)
CREATE OR REPLACE FUNCTION public.calculate_late_interest(
    p_fee_amount DECIMAL(10,2),
    p_due_date DATE,
    p_rate_percent DECIMAL(5,2),
    p_applied_from_day INT
)
RETURNS TABLE (
    days_late INT,
    interest_amount DECIMAL(10,2),
    total_amount DECIMAL(10,2)
)
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    v_days INT;
    v_interest DECIMAL(10,2);
BEGIN
    v_days := GREATEST(0, CURRENT_DATE - p_due_date);
    IF v_days > 0 THEN
        v_interest := ROUND(p_fee_amount * (p_rate_percent / 100.00) * v_days, 2);
    ELSE
        v_interest := 0.00;
    END IF;

    RETURN QUERY SELECT v_days, v_interest, (p_fee_amount + v_interest);
END;
$$;
