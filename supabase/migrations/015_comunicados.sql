-- ==============================================================================
-- 015 - COMUNICADOS POR EDIFICIO
--  * Categoría de texto libre.
--  * Adjuntos en un bucket PRIVADO ("comunicados"): solo se abren con enlace temporal
--    y únicamente por usuarios con sesión que pertenecen a ese edificio.
--  * Crear / editar / eliminar mediante funciones que además dejan registro en auditoría.
-- Ejecutar completo en el SQL Editor de Supabase.
-- ==============================================================================
BEGIN;

-- 1. Bucket privado ------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('comunicados', 'comunicados', FALSE, 10485760,
        ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
   SET public = FALSE, file_size_limit = 10485760,
       allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS "Residentes leen adjuntos de comunicados de su edificio" ON storage.objects;
DROP POLICY IF EXISTS "Administracion gestiona adjuntos de comunicados" ON storage.objects;

-- La primera carpeta del archivo es el id del edificio: comunicados/<building_id>/<anuncio>/<archivo>
CREATE POLICY "Residentes leen adjuntos de comunicados de su edificio"
ON storage.objects FOR SELECT USING (
    bucket_id = 'comunicados'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] IN (
        SELECT g.building_id::text FROM public.get_auth_user_profile() g)
);

CREATE POLICY "Administracion gestiona adjuntos de comunicados"
ON storage.objects FOR ALL USING (
    bucket_id = 'comunicados'
    AND public.auth_is_admin_of(((storage.foldername(name))[1])::uuid)
) WITH CHECK (
    bucket_id = 'comunicados'
    AND public.auth_is_admin_of(((storage.foldername(name))[1])::uuid)
);

-- 2. Tabla: lectura para residentes, escritura solo por las funciones ---------------------
ALTER TABLE public.announcements ALTER COLUMN category DROP DEFAULT;
ALTER TABLE public.announcements ALTER COLUMN category TYPE VARCHAR(100);

DROP POLICY IF EXISTS "Administradora gestiona comunicados de su edificio" ON public.announcements;

-- 3. Guardar (crear o editar) ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_announcement(
    p_id UUID,
    p_building_id UUID,
    p_title TEXT,
    p_category TEXT,
    p_date DATE,
    p_content TEXT,
    p_is_published BOOLEAN,
    p_attachment_path TEXT DEFAULT NULL,
    p_keep_attachment BOOLEAN DEFAULT TRUE
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_id UUID;
    v_admin TEXT;
    v_title TEXT := trim(COALESCE(p_title, ''));
    v_cat TEXT := trim(COALESCE(p_category, ''));
    v_content TEXT := trim(COALESCE(p_content, ''));
BEGIN
    IF NOT public.auth_is_admin_of(p_building_id) THEN
        RAISE EXCEPTION 'No tiene permiso para administrar este edificio.';
    END IF;
    IF v_title = '' OR char_length(v_title) > 250 THEN
        RAISE EXCEPTION 'El título es obligatorio (máximo 250 caracteres).';
    END IF;
    IF char_length(v_cat) > 100 THEN
        RAISE EXCEPTION 'La categoría es demasiado larga (máximo 100 caracteres).';
    END IF;
    IF v_content = '' OR char_length(v_content) > 10000 THEN
        RAISE EXCEPTION 'El contenido es obligatorio (máximo 10000 caracteres).';
    END IF;
    IF p_attachment_path IS NOT NULL
       AND (storage.foldername(p_attachment_path))[1] <> p_building_id::text THEN
        RAISE EXCEPTION 'El adjunto no corresponde a este edificio.';
    END IF;

    SELECT full_name INTO v_admin FROM public.user_profiles WHERE id = auth.uid();

    IF p_id IS NULL THEN
        INSERT INTO public.announcements (building_id, title, category, date, content, is_published, attachment_url)
        VALUES (p_building_id, v_title, COALESCE(NULLIF(v_cat, ''), 'General'),
                COALESCE(p_date, CURRENT_DATE), v_content, COALESCE(p_is_published, TRUE), p_attachment_path)
        RETURNING id INTO v_id;

        INSERT INTO public.audit_logs (building_id, action, description, performed_by)
        VALUES (p_building_id, 'CREAR_COMUNICADO',
                format('%s comunicado: "%s"', CASE WHEN COALESCE(p_is_published, TRUE) THEN 'Publicó' ELSE 'Guardó como borrador el' END, v_title),
                COALESCE(v_admin, 'Administración'));
    ELSE
        UPDATE public.announcements
           SET title = v_title,
               category = COALESCE(NULLIF(v_cat, ''), 'General'),
               date = COALESCE(p_date, date),
               content = v_content,
               is_published = COALESCE(p_is_published, is_published),
               attachment_url = CASE WHEN p_attachment_path IS NOT NULL THEN p_attachment_path
                                     WHEN p_keep_attachment THEN attachment_url
                                     ELSE NULL END
         WHERE id = p_id AND building_id = p_building_id
         RETURNING id INTO v_id;
        IF v_id IS NULL THEN
            RAISE EXCEPTION 'El comunicado no existe en este edificio.';
        END IF;

        INSERT INTO public.audit_logs (building_id, action, description, performed_by)
        VALUES (p_building_id, 'EDITAR_COMUNICADO',
                format('Editó el comunicado: "%s" (%s)', v_title,
                       CASE WHEN COALESCE(p_is_published, TRUE) THEN 'publicado' ELSE 'borrador' END),
                COALESCE(v_admin, 'Administración'));
    END IF;

    RETURN v_id;
END;
$$;

-- 4. Eliminar -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_announcement(p_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_row public.announcements%ROWTYPE;
    v_admin TEXT;
BEGIN
    SELECT * INTO v_row FROM public.announcements WHERE id = p_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'El comunicado no existe.';
    END IF;
    IF NOT public.auth_is_admin_of(v_row.building_id) THEN
        RAISE EXCEPTION 'No tiene permiso para administrar este edificio.';
    END IF;

    DELETE FROM public.announcements WHERE id = p_id;

    SELECT full_name INTO v_admin FROM public.user_profiles WHERE id = auth.uid();
    INSERT INTO public.audit_logs (building_id, action, description, performed_by)
    VALUES (v_row.building_id, 'ELIMINAR_COMUNICADO',
            format('Eliminó el comunicado: "%s"', v_row.title), COALESCE(v_admin, 'Administración'));

    RETURN v_row.attachment_url;  -- la app borra el archivo adjunto con esta ruta
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_announcement(UUID, UUID, TEXT, TEXT, DATE, TEXT, BOOLEAN, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_announcement(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_announcement(UUID, UUID, TEXT, TEXT, DATE, TEXT, BOOLEAN, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_announcement(UUID) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
