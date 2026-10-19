/* Administración de comunicados del edificio activo */
import { announcementService } from '../../services/announcementService.js';
import { activeBuilding } from '../../services/activeBuilding.js';
import { authService } from '../../services/authService.js';
import { isSupabaseConnected } from '../../supabaseClient.js';
import { formatDate } from '../../config.js';
import { openAppModal } from '../../ui/credentials.js';
import { confirmDialog, alertDialog } from '../../ui/dialog.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toISOString().split('T')[0];
const live = () => isSupabaseConnected() && !!authService.getContext();

export function renderAdminComunicados() {
  const container = document.createElement('div');
  container.className = 'fade-in';
  const building = live() ? activeBuilding.get() : null;
  if (live() && !building) return container;

  let items = [];

  async function load() {
    container.innerHTML = '<div class="card"><p>Cargando comunicados...</p></div>';
    try {
      items = live() ? await announcementService.loadForBuilding(building.id) : announcementService.getAllAnnouncements();
      render();
    } catch (err) {
      container.innerHTML = `<div class="card"><p class="form-error">${esc(err.message)}</p></div>`;
    }
  }

  function render() {
    container.innerHTML = `
      <div class="card" style="margin-bottom: 1.5rem;">
        <div class="card-header">
          <h2 class="card-title"><i data-lucide="megaphone"></i> Comunicados${building ? ` — ${esc(building.name)}` : ''}</h2>
          <button class="btn btn-primary btn-sm" id="btn-new-ann"><i data-lucide="plus-circle"></i> Crear comunicado</button>
        </div>
        <p>Avisos, mantenimientos, convocatorias y boletines. Solo los ven los residentes de este edificio, y únicamente los que estén <strong>publicados</strong>.</p>
      </div>

      <div style="display: flex; flex-direction: column; gap: 1rem;">
        ${items.length === 0 ? '<div class="card" style="text-align:center; color: var(--text-dim);">Aún no hay comunicados. Cree el primero con el botón de arriba.</div>' : items.map(ann => `
          <div class="card" style="border-left: 4px solid ${ann.is_published ? 'var(--primary)' : 'var(--border-highlight)'};">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:0.5rem; flex-wrap:wrap; gap:0.5rem;">
              <div>
                <span class="badge badge-building">${esc(ann.category)}</span>
                <span class="badge ${ann.is_published ? 'badge-success' : 'badge-neutral'}" style="margin-left:0.5rem;">${ann.is_published ? 'PUBLICADO' : 'BORRADOR'}</span>
              </div>
              <span style="font-size:0.8rem; color: var(--text-dim);"><i data-lucide="calendar"></i> ${formatDate(ann.date)}</span>
            </div>
            <h3 style="font-size:1.15rem; font-weight:700; margin-bottom:0.5rem;">${esc(ann.title)}</h3>
            <p style="font-size:0.95rem; line-height:1.6; color: var(--text-muted); white-space:pre-line;">${esc(ann.content)}</p>
            ${ann.attachment_url && live() ? `<p style="margin-top:0.5rem; font-size:0.85rem;"><i data-lucide="paperclip" style="width:14px;height:14px;"></i> ${esc(announcementService.attachmentName(ann.attachment_url))}</p>` : ''}
            ${live() ? `
            <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-top:1rem; padding-top:0.75rem; border-top:1px solid var(--border-color);">
              <button class="btn btn-outline btn-sm" data-act="edit" data-id="${ann.id}"><i data-lucide="pencil"></i> Editar</button>
              <button class="btn btn-outline btn-sm" data-act="toggle" data-id="${ann.id}"><i data-lucide="${ann.is_published ? 'eye-off' : 'eye'}"></i> ${ann.is_published ? 'Pasar a borrador' : 'Publicar'}</button>
              <button class="btn btn-outline btn-sm" data-act="delete" data-id="${ann.id}" style="color: var(--status-danger);"><i data-lucide="trash-2"></i> Eliminar</button>
            </div>` : ''}
          </div>`).join('')}
      </div>`;

    container.querySelector('#btn-new-ann').addEventListener('click', () => openForm(null));
    container.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', () => {
      const ann = items.find(a => a.id === btn.dataset.id);
      if (ann) handleAction(btn.dataset.act, ann);
    }));
    if (window.lucide) window.lucide.createIcons();
  }

  async function handleAction(act, ann) {
    if (act === 'edit') return openForm(ann);
    try {
      if (act === 'toggle') {
        await announcementService.setPublished(ann, !ann.is_published);
      } else if (act === 'delete') {
        const ok = await confirmDialog({
          title: 'Eliminar comunicado',
          message: `Se eliminará "${ann.title}"${ann.attachment_url ? ' y su adjunto' : ''}. Esta acción no se puede deshacer.`,
          confirmText: 'Eliminar', danger: true
        });
        if (!ok) return;
        await announcementService.remove(ann);
      }
      await load();
    } catch (err) {
      alertDialog({ tone: 'danger', message: err.message });
    }
  }

  function openForm(ann) {
    const editing = !!ann;
    const modal = openAppModal(
      `<i data-lucide="megaphone" style="color: var(--primary);"></i> ${editing ? 'Editar comunicado' : 'Nuevo comunicado'}`, `
      <form id="ann-form" novalidate>
        <div class="form-group">
          <label class="form-label" for="ann-title">Título</label>
          <input type="text" id="ann-title" class="form-control" maxlength="250" value="${esc(ann ? ann.title : '')}" placeholder="Ej: Mantenimiento del ascensor" required>
        </div>
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:1rem;">
          <div class="form-group">
            <label class="form-label" for="ann-category">Categoría</label>
            <input type="text" id="ann-category" class="form-control" maxlength="100" value="${esc(ann ? ann.category : '')}" placeholder="Ej: Mantenimiento, Asamblea...">
          </div>
          <div class="form-group">
            <label class="form-label" for="ann-date">Fecha</label>
            <input type="date" id="ann-date" class="form-control" value="${ann ? esc(ann.date) : today()}" required>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="ann-content">Mensaje</label>
          <textarea id="ann-content" class="form-control" rows="6" maxlength="10000" placeholder="Escriba el comunicado para los residentes..." required>${esc(ann ? ann.content : '')}</textarea>
        </div>
        ${live() ? `
        <div class="form-group">
          <label class="form-label" for="ann-file">Adjunto (opcional: PDF o imagen, máx. 10 MB)</label>
          ${ann && ann.attachment_url ? `<p id="ann-current" style="font-size:0.85rem; margin-bottom:0.4rem;"><i data-lucide="paperclip" style="width:14px;height:14px;"></i> ${esc(announcementService.attachmentName(ann.attachment_url))}
            <label style="margin-left:0.75rem;"><input type="checkbox" id="ann-remove"> Quitar adjunto</label></p>` : ''}
          <input type="file" id="ann-file" class="form-control" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp">
        </div>` : ''}
        <label style="display:flex; gap:0.5rem; align-items:center; margin: 0.5rem 0;">
          <input type="checkbox" id="ann-published" ${!ann || ann.is_published ? 'checked' : ''}> Publicar ahora (visible para los residentes)
        </label>
        <div id="ann-error" class="form-error" role="alert" hidden></div>
        <div style="display:flex; gap:1rem; justify-content:flex-end; margin-top:1.25rem;">
          <button type="button" class="btn btn-secondary" id="ann-cancel">Cancelar</button>
          <button type="submit" class="btn btn-primary" id="ann-submit"><i data-lucide="save"></i> ${editing ? 'Guardar cambios' : 'Guardar'}</button>
        </div>
      </form>`);

    const errBox = modal.$('ann-error');
    const showError = msg => { errBox.textContent = msg || ''; errBox.hidden = !msg; };
    modal.$('ann-cancel').onclick = modal.close;

    modal.$('ann-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      showError('');
      const title = modal.$('ann-title').value.trim();
      const content = modal.$('ann-content').value.trim();
      const date = modal.$('ann-date').value;
      if (!title) return showError('Escriba el título.');
      if (!content) return showError('Escriba el mensaje.');
      if (!date) return showError('Indique la fecha.');
      const category = modal.$('ann-category').value.trim();
      const isPublished = modal.$('ann-published').checked;
      const submit = modal.$('ann-submit');
      submit.disabled = true;

      try {
        if (live()) {
          const file = modal.$('ann-file').files[0] || null;
          await announcementService.save({
            id: ann ? ann.id : null, buildingId: building.id, title, category, date, content, isPublished,
            file, currentAttachment: ann ? ann.attachment_url : null,
            removeAttachment: !!(modal.$('ann-remove') && modal.$('ann-remove').checked)
          });
        } else {
          announcementService.createAnnouncement({ title, category, date, content, isPublished });
        }
        modal.close();
        await load();
      } catch (err) {
        showError(err.message);
        submit.disabled = false;
      }
    });
  }

  load();
  return container;
}
