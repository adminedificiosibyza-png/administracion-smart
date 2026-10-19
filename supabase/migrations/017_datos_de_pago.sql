-- ==============================================================================
-- 017 - DATOS DE PAGO POR EDIFICIO
-- Cuentas donde los residentes depositan sus cuotas (una o varias por edificio),
-- número de WhatsApp para enviar la captura del pago y una nota opcional.
--  * Lectura: administración del edificio y residentes con departamento en él.
--  * Escritura: solo mediante save_payment_info (administración del edificio).
-- Ejecutar completo en el SQL Editor de Supabase.
-- ==============================================================================
BEGIN;

ALTER TABLE public.buildings
    ADD COLUMN IF NOT EXISTS payment_whatsapp TEXT,
    ADD COLUMN IF NOT EXISTS payment_note     TEXT;

CREATE TABLE IF NOT EXISTS public.building_bank_accounts (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    building_id    UUID NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
    sort_order     INT  NOT NULL DEFAULT 0,
    bank           VARCHAR(100) NOT NULL,        -- banco o billetera (BCP, Interbank, Yape...)
    account_holder VARCHAR(200),                 -- nombre de la cuenta
    account_number VARCHAR(60),
    cci            VARCHAR(60),                  -- cuenta interbancaria
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_building ON public.building_bank_accounts(building_id, sort_order);

ALTER TABLE public.building_bank_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Residentes y administracion leen cuentas de pago" ON public.building_bank_accounts;
CREATE POLICY "Residentes y administracion leen cuentas de pago"
ON public.building_bank_accounts FOR SELECT USING (
    public.auth_is_admin_of(building_id)
    OR building_id IN (SELECT building_id FROM public.get_auth_user_profile())
);

GRANT SELECT ON public.building_bank_accounts TO authenticated;
GRANT ALL ON public.building_bank_accounts TO service_role;

-- Guardar todo en una sola operación: reemplaza las cuentas del edificio ------------------
CREATE OR REPLACE FUNCTION public.save_payment_info(
    p_building_id UUID,
    p_whatsapp TEXT,
    p_note TEXT,
    p_accounts JSONB
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_acc JSONB;
    v_n INT := 0;
    v_admin TEXT;
    v_wa TEXT := NULLIF(regexp_replace(COALESCE(p_whatsapp, ''), '[^0-9+]', '', 'g'), '');
    v_bank TEXT;
BEGIN
    IF NOT public.auth_is_admin_of(p_building_id) THEN
        RAISE EXCEPTION 'No tiene permiso para administrar este edificio.';
    END IF;
    IF p_accounts IS NULL OR jsonb_typeof(p_accounts) <> 'array' THEN
        RAISE EXCEPTION 'El formato de las cuentas no es válido.';
    END IF;
    IF jsonb_array_length(p_accounts) > 20 THEN
        RAISE EXCEPTION 'Demasiadas cuentas (máximo 20).';
    END IF;
    IF v_wa IS NOT NULL AND (char_length(v_wa) < 7 OR char_length(v_wa) > 16) THEN
        RAISE EXCEPTION 'El número de WhatsApp no es válido.';
    END IF;
    IF char_length(COALESCE(p_note, '')) > 1000 THEN
        RAISE EXCEPTION 'La nota es demasiado larga (máximo 1000 caracteres).';
    END IF;

    DELETE FROM public.building_bank_accounts WHERE building_id = p_building_id;

    FOR v_acc IN SELECT * FROM jsonb_array_elements(p_accounts) LOOP
        v_bank := trim(COALESCE(v_acc->>'bank', ''));
        IF v_bank = '' OR char_length(v_bank) > 100 THEN
            RAISE EXCEPTION 'Cada cuenta necesita el nombre del banco o billetera (máximo 100 caracteres).';
        END IF;
        IF char_length(COALESCE(v_acc->>'account_holder', '')) > 200
           OR char_length(COALESCE(v_acc->>'account_number', '')) > 60
           OR char_length(COALESCE(v_acc->>'cci', '')) > 60 THEN
            RAISE EXCEPTION 'Alguno de los datos de la cuenta "%" es demasiado largo.', v_bank;
        END IF;
        v_n := v_n + 1;
        INSERT INTO public.building_bank_accounts (building_id, sort_order, bank, account_holder, account_number, cci)
        VALUES (p_building_id, v_n, v_bank,
                NULLIF(trim(COALESCE(v_acc->>'account_holder', '')), ''),
                NULLIF(trim(COALESCE(v_acc->>'account_number', '')), ''),
                NULLIF(trim(COALESCE(v_acc->>'cci', '')), ''));
    END LOOP;

    UPDATE public.buildings
       SET payment_whatsapp = v_wa,
           payment_note = NULLIF(trim(COALESCE(p_note, '')), ''),
           updated_at = NOW()
     WHERE id = p_building_id;

    SELECT full_name INTO v_admin FROM public.user_profiles WHERE id = auth.uid();
    INSERT INTO public.audit_logs (building_id, action, description, performed_by)
    VALUES (p_building_id, 'EDITAR_DATOS_PAGO',
            format('Actualizó los datos de pago (%s cuenta(s))', v_n),
            COALESCE(v_admin, 'Administración'));

    RETURN v_n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_payment_info(UUID, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_payment_info(UUID, TEXT, TEXT, JSONB) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
