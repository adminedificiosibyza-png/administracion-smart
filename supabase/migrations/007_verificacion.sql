-- ==============================================================================
-- VERIFICACIÓN DE SEGURIDAD DE LA FASE 1 (no modifica datos: todo termina en ROLLBACK)
-- ------------------------------------------------------------------------------
-- Antes: cree desde la app (Usuarios y Accesos) un propietario de prueba con DOS
-- departamentos y, si quiere probar al inquilino, otra persona con "Puede ver cuotas"
-- desmarcado. Copie sus UUID desde:
--     select id, full_name from public.user_profiles order by created_at desc;
-- Reemplace <UUID_PROPIETARIO>, <UUID_INQUILINO_SIN_CUOTAS> y <UUID_SUPERADMIN>.
-- Ejecute CADA bloque por separado (el editor solo muestra el último resultado).
-- ==============================================================================

-- ---------- A) PROPIETARIO: solo ve lo de SUS departamentos ----------
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '<UUID_PROPIETARIO>', 'role', 'authenticated')::text, true);

select * from public.get_auth_user_profile();                                   -- 1 fila por departamento asignado
select count(*) as cuotas_visibles from public.maintenance_fees;                -- solo las de sus departamentos
select count(*) as cuotas_ajenas                                                  -- DEBE SER 0
  from public.maintenance_fees
 where unit_id not in (select unit_id from public.user_units where user_id = '<UUID_PROPIETARIO>');
select count(*) as perfiles_visibles from public.user_profiles;                 -- DEBE SER 1 (el suyo)
rollback;

-- ---------- B) INQUILINO con "ver cuotas" desmarcado: NO ve cuotas ni pagos ----------
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '<UUID_INQUILINO_SIN_CUOTAS>', 'role', 'authenticated')::text, true);

select count(*) as cuotas_visibles from public.maintenance_fees;                -- DEBE SER 0
select count(*) as pagos_visibles  from public.payments;                        -- DEBE SER 0
select count(*) as reservas_visibles from public.reservations;                  -- solo las de su departamento
rollback;

-- ---------- C) PROPIETARIO no puede aprobar su propia reserva ni cambiar su rol ----------
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '<UUID_PROPIETARIO>', 'role', 'authenticated')::text, true);

-- Debe FALLAR con "Acceso denegado: solo puede modificar sus datos de contacto."
update public.user_profiles set role = 'superadmin' where id = '<UUID_PROPIETARIO>';
rollback;

-- ---------- D) SUPERADMIN: ve todo ----------
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '<UUID_SUPERADMIN>', 'role', 'authenticated')::text, true);

select count(*) as edificios from public.buildings;
select count(*) as cuotas_visibles from public.maintenance_fees;               -- todas
select count(*) as personas from public.user_profiles;                          -- todas
rollback;

-- ---------- E) SIN SESIÓN (anon): no ve nada ----------
begin;
set local role anon;
select count(*) from public.maintenance_fees;     -- debe dar error "permission denied" (correcto)
rollback;
