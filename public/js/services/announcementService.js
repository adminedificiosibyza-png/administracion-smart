/* Announcements / Comunicados Service */
import { store } from '../store.js';
import { supabase } from '../supabaseClient.js';

const BUCKET = 'comunicados';
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

const safeName = (name) => String(name || 'archivo').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80);

export const announcementService = {
  getPublishedAnnouncements() {
    return store.state.announcements.filter(a => a.is_published);
  },

  getAllAnnouncements() {
    return store.state.announcements;
  },

  // ---------- Supabase (datos reales) ----------

  /** Comunicados del edificio. Los residentes solo reciben los publicados (lo garantiza la base). */
  async loadForBuilding(buildingId) {
    const { data, error } = await supabase.from('announcements')
      .select('id, building_id, title, category, date, content, is_published, attachment_url, created_at')
      .eq('building_id', buildingId)
      .order('date', { ascending: false }).order('created_at', { ascending: false })
      .range(0, 499);
    if (error) throw new Error(`No se pudieron cargar los comunicados: ${error.message}`);
    return data || [];
  },

  validateFile(file) {
    if (!file) return null;
    if (!ALLOWED_TYPES.includes(file.type)) return 'El adjunto debe ser PDF, JPG, PNG o WEBP.';
    if (file.size > MAX_FILE_BYTES) return 'El adjunto no puede pesar más de 10 MB.';
    return null;
  },

  /** Crea o edita. `removeAttachment` quita el adjunto actual; `file` lo reemplaza. */
  async save({ id, buildingId, title, category, date, content, isPublished, file, currentAttachment, removeAttachment }) {
    const fileError = this.validateFile(file);
    if (fileError) throw new Error(fileError);

    let newPath = null;
    if (file) {
      newPath = `${buildingId}/${crypto.randomUUID()}/${safeName(file.name)}`;
      const up = await supabase.storage.from(BUCKET).upload(newPath, file, { contentType: file.type, upsert: false });
      if (up.error) throw new Error(`No se pudo subir el adjunto: ${up.error.message}`);
    }

    const { data, error } = await supabase.rpc('save_announcement', {
      p_id: id || null,
      p_building_id: buildingId,
      p_title: title,
      p_category: category,
      p_date: date,
      p_content: content,
      p_is_published: !!isPublished,
      p_attachment_path: newPath,
      p_keep_attachment: !removeAttachment
    });
    if (error) {
      if (newPath) await supabase.storage.from(BUCKET).remove([newPath]); // sin archivos huérfanos
      throw new Error(error.message);
    }
    // Se reemplazó o quitó el adjunto anterior: borrarlo del almacenamiento
    if (currentAttachment && (newPath || removeAttachment)) {
      await supabase.storage.from(BUCKET).remove([currentAttachment]);
    }
    return data;
  },

  async setPublished(announcement, isPublished) {
    return this.save({
      id: announcement.id, buildingId: announcement.building_id, title: announcement.title,
      category: announcement.category, date: announcement.date, content: announcement.content,
      isPublished, currentAttachment: null, removeAttachment: false
    });
  },

  async remove(announcement) {
    const { data, error } = await supabase.rpc('delete_announcement', { p_id: announcement.id });
    if (error) throw new Error(error.message);
    const path = data || announcement.attachment_url;
    if (path) await supabase.storage.from(BUCKET).remove([path]);
  },

  /** Enlace temporal (5 min) al adjunto: solo funciona con sesión iniciada. */
  async getAttachmentUrl(path) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
    if (error) throw new Error(`No se pudo abrir el adjunto: ${error.message}`);
    return data.signedUrl;
  },

  attachmentName(path) {
    return path ? decodeURIComponent(String(path).split('/').pop()) : '';
  },

  // ---------- Demostración (modo local) ----------

  createAnnouncement({ title, category, date, content, isPublished, attachmentUrl }) {
    const newAnnouncement = {
      id: `ann-${Date.now()}`,
      building_id: store.state.building.id,
      title: title,
      category: category || 'General',
      date: date || new Date().toISOString().split('T')[0],
      content: content,
      is_published: isPublished !== false,
      attachment_url: attachmentUrl || null,
      created_at: new Date().toISOString()
    };

    store.state.announcements.unshift(newAnnouncement);

    store.state.audit_logs.unshift({
      id: `aud-${Date.now()}`,
      building_id: store.state.building.id,
      action: 'PUBLICACION_COMUNICADO',
      description: `Publicó comunicado: "${title}"`,
      performed_by: 'Administración',
      timestamp: new Date().toISOString()
    });

    store.saveState();
    return newAnnouncement;
  }
};
