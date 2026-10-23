-- ============================================================================
-- 025_restaurar_ayudantes_rls.sql
-- Corrige 024: las funciones que las políticas RLS ejecutan con el rol de la persona con
-- sesión (authenticated) recibían ese permiso a través de PUBLIC. Al quitar PUBLIC lo perdieron.
-- Se devuelve el permiso SOLO a authenticated y SOLO en esas 4 funciones.
-- anon (visitante sin sesión) sigue sin poder ejecutarlas. Los triggers siguen cerrados.
-- Idempotente; no modifica datos.
-- ============================================================================
GRANT EXECUTE ON FUNCTION public.auth_is_staff()                TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_expense(UUID)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_service(UUID)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_auth_user_profile()        TO authenticated;
