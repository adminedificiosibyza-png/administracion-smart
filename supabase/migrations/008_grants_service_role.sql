-- ==============================================================================
-- MIGRACIÓN 008: PRIVILEGIOS PARA EL ROL service_role (funciones de servidor)
-- ------------------------------------------------------------------------------
-- Síntoma: la función admin-users responde "Acceso denegado: solo el superadmin..."
-- aunque la persona SÍ sea superadmin, porque la consulta de su perfil falla con
-- "permission denied for table user_profiles".
--
-- Causa: igual que con `authenticated` (migración 003), este proyecto no concede
-- privilegios de tabla por defecto, y `service_role` tampoco los tiene.
--
-- Qué hace: concede privilegios al rol de servidor. `service_role` solo lo usan las
-- funciones de servidor (Edge Functions); la clave NUNCA está en el navegador. Los
-- usuarios anónimos siguen sin ningún acceso.
-- ==============================================================================

GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Para las tablas y funciones que se creen en el futuro
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;

NOTIFY pgrst, 'reload schema';
