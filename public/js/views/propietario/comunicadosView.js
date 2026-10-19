/* Propietario Announcements View */
import { announcementService } from '../../services/announcementService.js';
import { authService } from '../../services/authService.js';
import { isSupabaseConnected } from '../../supabaseClient.js';
import { formatDate } from '../../config.js';
import { alertDialog } from '../../ui/dialog.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function renderList(container, announcements, buildingName, isLive) {
  container.innerHTML = `
    <div class="card" style="margin-bottom: 1.5rem;">
      <div class="card-header">
        <h2 class="card-title"><i data-lucide="megaphone"></i> Comunicados de la Administración</h2>
        <span class="badge badge-building">${esc(buildingName || 'PARKE10')}</span>
      </div>
      <p>Avisos, boletines informativos y citaciones oficiales para los residentes.</p>
    </div>

    <div style="display: flex; flex-direction: column; gap: 1rem;">
      ${announcements.length === 0 ? `
        <div class="card" style="text-align: center; padding: 2rem;">
          <p style="color: var(--text-dim);">No hay comunicados publicados recientemente.</p>
        </div>
      ` : announcements.map(ann => `
        <div class="card" style="border-left: 4px solid var(--primary);">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem; flex-wrap: wrap; gap: 0.5rem;">
            <span class="badge badge-building">${esc(ann.category)}</span>
            <span style="font-size: 0.8rem; color: var(--text-dim);"><i data-lucide="calendar" style="width: 14px; height: 14px;"></i> ${formatDate(ann.date)}</span>
          </div>
          <h3 style="font-size: 1.15rem; font-weight: 700; margin-bottom: 0.75rem; color: var(--text-main);">${esc(ann.title)}</h3>
          <p style="font-size: 0.95rem; line-height: 1.6; color: var(--text-muted); margin-bottom: 1rem; white-space: pre-line;">${esc(ann.content)}</p>
          ${ann.attachment_url && isLive ? `
            <div style="padding-top: 0.75rem; border-top: 1px solid var(--border-color);">
              <button class="btn btn-outline btn-sm" data-attach="${esc(ann.id)}">
                <i data-lucide="paperclip"></i> Ver adjunto (${esc(announcementService.attachmentName(ann.attachment_url))})
              </button>
            </div>` : ''}
        </div>
      `).join('')}
    </div>
  `;

  container.querySelectorAll('[data-attach]').forEach(btn => btn.addEventListener('click', async () => {
    const ann = announcements.find(a => a.id === btn.dataset.attach);
    if (!ann) return;
    // La pestaña se abre antes de la consulta para que el navegador no la bloquee
    const win = window.open('', '_blank');
    try {
      const url = await announcementService.getAttachmentUrl(ann.attachment_url);
      if (win) win.location.href = url; else window.location.href = url;
    } catch (err) {
      if (win) win.close();
      alertDialog({ tone: 'danger', message: err.message });
    }
  }));

  if (window.lucide) window.lucide.createIcons();
}

export function renderPropietarioComunicados() {
  const container = document.createElement('div');
  container.className = 'fade-in';

  if (isSupabaseConnected() && authService.getContext()) {
    const active = authService.getActiveAssignment();
    if (!active) {
      container.innerHTML = '<div class="card"><p>Todavía no tiene un departamento asignado.</p></div>';
      return container;
    }
    container.innerHTML = '<div class="card" style="text-align:center; color: var(--text-dim);">Cargando comunicados...</div>';
    announcementService.loadForBuilding(active.building_id)
      .then(list => renderList(container, list.filter(a => a.is_published), active.building_name, true))
      .catch(err => { container.innerHTML = `<div class="card"><p style="color: var(--status-danger);">${esc(err.message)}</p></div>`; });
    return container;
  }

  renderList(container, announcementService.getPublishedAnnouncements(), '', false);
  return container;
}
