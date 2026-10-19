-- ==============================================================================
-- MIGRACIÓN 003: PRIVILEGIOS DE TABLA PARA USUARIOS AUTENTICADOS
-- ------------------------------------------------------------------------------
-- Síntoma que corrige: "permission denied for table maintenance_fees" (o cualquier
-- otra tabla) aunque la sesión esté iniciada.
--
-- Causa: las tablas creadas con schema.sql no tienen GRANT para el rol
-- `authenticated`, y este proyecto no los concede por defecto.
--
-- Importante:
--  * GRANT solo abre la puerta a nivel de tabla. QUIÉN puede ver o modificar cada
--    fila lo siguen decidiendo las políticas RLS de rls.sql (todas las tablas tienen
--    RLS activado). No se modifica ninguna política.
--  * NO se concede nada al rol `anon`: sin sesión iniciada no hay acceso a los datos.
-- ==============================================================================

GRANT USAGE ON SCHEMA public TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
    public.buildings,
    public.units,
    public.user_profiles,
    public.owners,
    public.common_areas,
    public.reservations,
    public.reservation_blocks,
    public.maintenance_fees,
    public.payments,
    public.interest_rules,
    public.announcements,
    public.rules,
    public.documents,
    public.audit_logs
TO authenticated;

NOTIFY pgrst, 'reload schema';
