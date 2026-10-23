-- ============================================================================
-- 023_verificar_permisos_funciones.sql   (SOLO LECTURA: no modifica nada)
-- Muestra quién puede ejecutar hoy las 14 funciones internas.
-- Ejecutarlo ANTES y DESPUÉS de 024_cerrar_funciones_internas.sql.
-- Esperado ANTES: anon_puede = true en varias.  Esperado DESPUÉS: anon_puede = false en todas.
-- ============================================================================
SELECT p.proname AS funcion,
       pg_get_function_identity_arguments(p.oid) AS argumentos,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_puede,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_puede,
       has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role_puede
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'assign_reservation_code', 'auth_is_staff', 'can_manage_expense', 'can_manage_service',
    'compute_fee_amounts', 'enforce_reservation_insert', 'enforce_reservation_required_fields',
    'get_auth_user_profile', 'log_reservation_decision', 'prevent_block_overlap',
    'prevent_double_booking', 'prevent_reservation_tampering', 'prevent_user_profile_escalation',
    'trg_seed_catalog_on_building'
  )
ORDER BY p.proname;
