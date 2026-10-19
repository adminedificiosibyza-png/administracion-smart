-- ==============================================================================
-- EDIFICIOSPRO
-- SUPABASE STORAGE - BUCKETS Y POLÍTICAS DE SEGURIDAD
--
-- REGLA:
-- Los propietarios SOLO pueden visualizar/descargar los archivos
-- que les corresponden.
--
-- La administradora es la única que puede subir, modificar y eliminar
-- archivos desde la aplicación.
-- ==============================================================================


-- ==============================================================================
-- 1. CREAR BUCKETS
-- ==============================================================================

INSERT INTO storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
)
VALUES
(
    'comprobantes-pagos',
    'comprobantes-pagos',
    FALSE,
    10485760, -- 10 MB
    ARRAY[
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/pdf'
    ]
),
(
    'documentos-privados',
    'documentos-privados',
    FALSE,
    20971520, -- 20 MB
    ARRAY[
        'image/jpeg',
        'image/png',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
),
(
    'documentos-publicos',
    'documentos-publicos',
    TRUE,
    20971520, -- 20 MB
    ARRAY[
        'application/pdf',
        'image/jpeg',
        'image/png'
    ]
)
ON CONFLICT (id) DO NOTHING;


-- ==============================================================================
-- 2. ELIMINAR POLÍTICAS ANTERIORES
-- ==============================================================================

DROP POLICY IF EXISTS "Acceso privado a comprobantes de pago"
ON storage.objects;

DROP POLICY IF EXISTS "Permitir subir comprobante de pago"
ON storage.objects;

DROP POLICY IF EXISTS "Administradora gestiona comprobantes de pago"
ON storage.objects;

DROP POLICY IF EXISTS "Propietario lee sus comprobantes"
ON storage.objects;

DROP POLICY IF EXISTS "Administradora gestiona documentos privados"
ON storage.objects;

DROP POLICY IF EXISTS "Propietario lee sus documentos privados"
ON storage.objects;

DROP POLICY IF EXISTS "Lectura libre de documentos publicos del edificio"
ON storage.objects;

DROP POLICY IF EXISTS "Administradora gestiona documentos publicos"
ON storage.objects;


-- ==============================================================================
-- 3. COMPROBANTES DE PAGO
--
-- Estructura:
--
-- comprobantes-pagos/<unit_id>/archivo.pdf
--
-- EJEMPLO:
-- comprobantes-pagos/UUID_DEL_DEPARTAMENTO/comprobante-2026-10.pdf
--
-- Propietarios:
--   SOLO lectura de los comprobantes de su departamento.
--
-- Administradora:
--   Puede leer, subir, modificar y eliminar comprobantes
--   de departamentos pertenecientes a su edificio.
-- ==============================================================================


-- ------------------------------------------------------------------------------
-- 3.1 PROPIETARIO: SOLO LECTURA DE SUS COMPROBANTES
-- ------------------------------------------------------------------------------

CREATE POLICY "Propietario lee sus comprobantes"
ON storage.objects
FOR SELECT
USING (
    bucket_id = 'comprobantes-pagos'
    AND auth.uid() IS NOT NULL
    AND (
        storage.foldername(name))[1]
        =
        (
            SELECT unit_id::text
            FROM public.get_auth_user_profile()
        )
);


-- ------------------------------------------------------------------------------
-- 3.2 ADMINISTRADORA: GESTIÓN COMPLETA DE COMPROBANTES
-- ------------------------------------------------------------------------------

CREATE POLICY "Administradora gestiona comprobantes de pago"
ON storage.objects
FOR ALL
USING (
    bucket_id = 'comprobantes-pagos'
    AND (
        SELECT role
        FROM public.get_auth_user_profile()
    ) = 'administradora'
    AND EXISTS (
        SELECT 1
        FROM public.units u
        WHERE u.id::text = (storage.foldername(name))[1]
        AND u.building_id IN (
            SELECT building_id
            FROM public.get_auth_user_profile()
        )
    )
)
WITH CHECK (
    bucket_id = 'comprobantes-pagos'
    AND (
        SELECT role
        FROM public.get_auth_user_profile()
    ) = 'administradora'
    AND EXISTS (
        SELECT 1
        FROM public.units u
        WHERE u.id::text = (storage.foldername(name))[1]
        AND u.building_id IN (
            SELECT building_id
            FROM public.get_auth_user_profile()
        )
    )
);


-- ==============================================================================
-- 4. DOCUMENTOS PRIVADOS
--
-- Estructura:
--
-- documentos-privados/<unit_id>/archivo.pdf
--
-- Propietarios:
--   SOLO lectura de documentos correspondientes a su departamento.
--
-- Administradora:
--   Gestión completa de documentos privados de su edificio.
-- ==============================================================================


-- ------------------------------------------------------------------------------
-- 4.1 PROPIETARIO: SOLO LECTURA DE SUS DOCUMENTOS
-- ------------------------------------------------------------------------------

CREATE POLICY "Propietario lee sus documentos privados"
ON storage.objects
FOR SELECT
USING (
    bucket_id = 'documentos-privados'
    AND auth.uid() IS NOT NULL
    AND (
        storage.foldername(name))[1]
        =
        (
            SELECT unit_id::text
            FROM public.get_auth_user_profile()
        )
);


-- ------------------------------------------------------------------------------
-- 4.2 ADMINISTRADORA: GESTIÓN COMPLETA DE DOCUMENTOS PRIVADOS
-- ------------------------------------------------------------------------------

CREATE POLICY "Administradora gestiona documentos privados"
ON storage.objects
FOR ALL
USING (
    bucket_id = 'documentos-privados'
    AND (
        SELECT role
        FROM public.get_auth_user_profile()
    ) = 'administradora'
    AND EXISTS (
        SELECT 1
        FROM public.units u
        WHERE u.id::text = (storage.foldername(name))[1]
        AND u.building_id IN (
            SELECT building_id
            FROM public.get_auth_user_profile()
        )
    )
)
WITH CHECK (
    bucket_id = 'documentos-privados'
    AND (
        SELECT role
        FROM public.get_auth_user_profile()
    ) = 'administradora'
    AND EXISTS (
        SELECT 1
        FROM public.units u
        WHERE u.id::text = (storage.foldername(name))[1]
        AND u.building_id IN (
            SELECT building_id
            FROM public.get_auth_user_profile()
        )
    )
);


-- ==============================================================================
-- 5. DOCUMENTOS PÚBLICOS
--
-- Estructura:
--
-- documentos-publicos/<building_id>/archivo.pdf
--
-- Estos documentos son públicos porque el bucket está configurado como
-- public = TRUE.
--
-- EJEMPLO:
-- documentos-publicos/UUID_DEL_EDIFICIO/reglamento.pdf
--
-- Cualquier persona que tenga acceso al recurso público puede visualizarlo.
-- La administradora es la única que puede gestionarlo desde el sistema.
-- ==============================================================================


-- ------------------------------------------------------------------------------
-- 5.1 LECTURA PÚBLICA
-- ------------------------------------------------------------------------------

CREATE POLICY "Lectura libre de documentos publicos del edificio"
ON storage.objects
FOR SELECT
USING (
    bucket_id = 'documentos-publicos'
);


-- ------------------------------------------------------------------------------
-- 5.2 ADMINISTRADORA: GESTIÓN COMPLETA DE DOCUMENTOS PÚBLICOS
-- ------------------------------------------------------------------------------

CREATE POLICY "Administradora gestiona documentos publicos"
ON storage.objects
FOR ALL
USING (
    bucket_id = 'documentos-publicos'
    AND (
        SELECT role
        FROM public.get_auth_user_profile()
    ) = 'administradora'
    AND (
        storage.foldername(name))[1]
        IN (
            SELECT building_id::text
            FROM public.get_auth_user_profile()
        )
)
WITH CHECK (
    bucket_id = 'documentos-publicos'
    AND (
        SELECT role
        FROM public.get_auth_user_profile()
    ) = 'administradora'
    AND (
        storage.foldername(name))[1]
        IN (
            SELECT building_id::text
            FROM public.get_auth_user_profile()
        )
);


-- ==============================================================================
-- FIN DEL SCRIPT
-- ==============================================================================
