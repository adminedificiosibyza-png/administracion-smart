-- ==============================================================================
-- MIGRACIÓN 004: CUOTA DE MANTENIMIENTO MENSUAL = S/ 150.00
-- ------------------------------------------------------------------------------
-- La cuota real de PARKE10 es S/ 150.00 por departamento y mes (antes 250.00).
-- Corrige los valores por defecto y los datos ya cargados.
-- ==============================================================================

ALTER TABLE public.units            ALTER COLUMN monthly_fee SET DEFAULT 150.00;
ALTER TABLE public.maintenance_fees ALTER COLUMN fee_amount  SET DEFAULT 150.00;

UPDATE public.units
   SET monthly_fee = 150.00
 WHERE building_id = 'b1d00000-0000-0000-0000-000000000001';

-- Solo cuotas sin pago registrado (no se reescribe lo ya pagado).
-- El trigger trg_compute_fee_amounts recalcula interés, total y pendiente.
UPDATE public.maintenance_fees
   SET fee_amount = 150.00
 WHERE building_id = 'b1d00000-0000-0000-0000-000000000001'
   AND status <> 'PAGADO';

NOTIFY pgrst, 'reload schema';
