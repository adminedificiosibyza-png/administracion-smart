-- ============================================================================
-- 024_cerrar_funciones_internas.sql
-- Quita a PUBLIC y a anon (visitantes sin sesión) el permiso de ejecutar 14 funciones
-- internas (triggers y ayudantes de las reglas de seguridad).
--
-- NO se toca a "authenticated" ni a "service_role": las políticas RLS y las vistas
-- ejecutan algunas de estas funciones con el rol de la persona con sesión, así que
-- siguen funcionando igual. Los triggers no necesitan permiso de ejecución al dispararse.
--
-- Es idempotente (se puede ejecutar más de una vez) y no modifica datos ni tablas.
-- DESHACER (si algo fallara), ejecutar al final de este archivo el bloque "ROLLBACK".
-- ============================================================================
DO $$
DECLARE
  f RECORD;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS firma
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
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f.firma);
    RAISE NOTICE 'Cerrada: %', f.firma;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- ROLLBACK (solo si hiciera falta volver atrás; NO ejecutar normalmente):
-- DO $$ DECLARE f RECORD; BEGIN
--   FOR f IN SELECT p.oid::regprocedure AS firma FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--     WHERE n.nspname = 'public' AND p.proname IN (
--       'assign_reservation_code','auth_is_staff','can_manage_expense','can_manage_service',
--       'compute_fee_amounts','enforce_reservation_insert','enforce_reservation_required_fields',
--       'get_auth_user_profile','log_reservation_decision','prevent_block_overlap',
--       'prevent_double_booking','prevent_reservation_tampering','prevent_user_profile_escalation',
--       'trg_seed_catalog_on_building')
--   LOOP EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC, anon', f.firma); END LOOP;
-- END $$;
-- ----------------------------------------------------------------------------
