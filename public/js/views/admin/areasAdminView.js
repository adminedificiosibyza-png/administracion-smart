/* Áreas comunes del edificio activo: crear, editar horarios, activar/desactivar y eliminar */
import { activeBuilding } from '../../services/activeBuilding.js';
import { reservationAdminApi } from '../../services/reservationLive.js';
import { isSupabaseConnected } from '../../supabaseClient.js';
import { openAppModal } from '../../ui/credentials.js';
import { confirmDialog, alertDialog } from '../../ui/dialog.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hhmm = v => String(v || '').slice(0, 5);

// 08:00 -> 8:00 a.m.
function to12h(t) {
  const [h, m] = hhmm(t).split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'p.m.' : 'a.m.'}`;
}

export function renderAdminAreas() {
  const container = document.createElement('div');
  container.className = 'fade-in';

  if (!isSupabaseConnected()) {
    container.innerHTML = '<div class="card" style="max-width:640px;"><p>La gestión de áreas comunes por edificio solo está disponible con Supabase conectado.</p></div>';
    return container;
  }
  const building = activeBuilding.get();
  if (!building) return container;

  let areas = [];

  function render() {
    container.innerHTML = `
      <div class="card" style="margin-bottom: 1.5rem;">
        <div class="card-header">
          <h2 class="card-title"><i data-lucide="umbrella"></i> Áreas Comunes — ${esc(building.name)}</h2>
          <button class="btn btn-primary btn-sm" id="area-new"><i data-lucide="plus"></i> Nueva área</button>
        </div>
        <p>Áreas que los propietarios de <strong>${esc(building.name)}</strong> pueden reservar, cada una con su horario de uso.
          Un edificio sin piscina, por ejemplo, simplemente no tiene esa área.</p>
      </div>
      <div class="building-list">
        ${areas.length ? areas.map(a => `
          <div class="building-row ${a.is_active ? '' : 'inactive'}">
            <div class="building-avatar-lg" style="background: var(--primary);"><i data-lucide="umbrella"></i></div>
            <div class="building-main">
              <strong>${esc(a.name)}</strong>
              <div class="building-tags">${a.is_active ? '<span class="tag tag-primary">Activa</span>' : '<span class="tag tag-muted">Inactiva</span>'}</div>
              ${a.description ? `<span class="cell-note">${esc(a.description)}</span>` : ''}
            </div>
            <div class="building-metrics">
              <div><span>Lunes a viernes</span><strong>${to12h(a.weekday_open)} – ${to12h(a.weekday_close)}</strong></div>
              <div><span>Sábado y domingo</span><strong>${to12h(a.weekend_open)} – ${to12h(a.weekend_close)}</strong></div>
            </div>
            <div class="building-actions">
              <button class="btn-icon" data-act="edit" data-id="${a.id}" title="Editar"><i data-lucide="square-pen"></i></button>
              <button class="btn-icon ${a.is_active ? 'danger' : 'ok'}" data-act="toggle" data-id="${a.id}" title="${a.is_active ? 'Desactivar' : 'Activar'}"><i data-lucide="${a.is_active ? 'ban' : 'rotate-ccw'}"></i></button>
              <button class="btn-icon danger" data-act="delete" data-id="${a.id}" title="Eliminar"><i data-lucide="trash-2"></i></button>
            </div>
          </div>`).join('') : `<div class="card" style="text-align:center; color: var(--text-dim);">Este edificio todavía no tiene áreas comunes. Cree la primera con "Nueva área".</div>`}
      </div>`;

    container.querySelector('#area-new').addEventListener('click', () => openForm(null));
    container.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', () => {
      const area = areas.find(a => a.id === btn.dataset.id);
      if (!area) return;
      if (btn.dataset.act === 'edit') openForm(area);
      if (btn.dataset.act === 'toggle') toggle(area);
      if (btn.dataset.act === 'delete') remove(area);
    }));
    if (window.lucide) window.lucide.createIcons();
  }

  async function reload() {
    try {
      areas = await reservationAdminApi.listAreas(building.id);
      render();
    } catch (err) {
      container.innerHTML = `
        <div class="card" style="text-align:center;">
          <p style="color: var(--status-danger); margin-bottom: 1rem;">${esc(err.message)}</p>
          <button class="btn btn-primary btn-sm" id="areas-retry">Reintentar</button>
        </div>`;
      container.querySelector('#areas-retry').addEventListener('click', () => { start(); });
    }
  }

  async function start() {
    container.innerHTML = '<div class="card" style="text-align:center; color: var(--text-dim);">Cargando áreas...</div>';
    await reload();
  }

  const payloadOf = (a, overrides = {}) => ({
    id: a.id, building_id: building.id, name: a.name, description: a.description || '',
    weekday_open: hhmm(a.weekday_open), weekday_close: hhmm(a.weekday_close),
    weekend_open: hhmm(a.weekend_open), weekend_close: hhmm(a.weekend_close),
    is_active: a.is_active, ...overrides
  });

  async function toggle(area) {
    try {
      if (area.is_active) {
        const ok = await confirmDialog({
          title: `Desactivar ${area.name}`,
          message: 'Los propietarios dejarán de poder solicitar reservas de esta área. Las reservas ya aprobadas se conservan. Puede reactivarla cuando quiera.',
          confirmText: 'Desactivar', danger: true
        });
        if (!ok) return;
      }
      await reservationAdminApi.saveArea(payloadOf(area, { is_active: !area.is_active }));
      reload();
    } catch (err) { alertDialog({ tone: 'danger', message: err.message }); }
  }

  async function remove(area) {
    const ok = await confirmDialog({
      title: `Eliminar ${area.name}`,
      message: 'Solo se puede eliminar un área que nunca tuvo reservas ni bloqueos. Si ya los tuvo, desactívela en su lugar.',
      confirmText: 'Eliminar', danger: true
    });
    if (!ok) return;
    try {
      await reservationAdminApi.deleteArea(area.id);
      reload();
    } catch (err) { alertDialog({ tone: 'danger', message: err.message }); }
  }

  function openForm(area) {
    const editing = !!area;
    const v = area || { name: '', description: '', weekday_open: '08:00', weekday_close: '18:00', weekend_open: '08:00', weekend_close: '20:00', is_active: true };
    const modal = openAppModal(`<i data-lucide="umbrella" style="color: var(--primary);"></i> ${editing ? 'Editar área común' : 'Nueva área común'}`, `
      <form id="area-form" novalidate>
        <div class="form-group"><label class="form-label" for="af-name">Nombre *</label>
          <input type="text" id="af-name" class="form-control" maxlength="100" value="${esc(v.name)}" placeholder="Ej: Terraza, Sala de reuniones" required></div>
        <div class="form-group"><label class="form-label" for="af-desc">Descripción (opcional)</label>
          <input type="text" id="af-desc" class="form-control" value="${esc(v.description)}"></div>
        <h4 class="form-section">Horario de uso</h4>
        <div class="form-grid">
          <div class="form-group"><label class="form-label" for="af-wd-open">Lunes a viernes: desde</label><input type="time" step="1800" id="af-wd-open" class="form-control" value="${hhmm(v.weekday_open)}" required></div>
          <div class="form-group"><label class="form-label" for="af-wd-close">Lunes a viernes: hasta</label><input type="time" step="1800" id="af-wd-close" class="form-control" value="${hhmm(v.weekday_close)}" required></div>
          <div class="form-group"><label class="form-label" for="af-we-open">Sábado y domingo: desde</label><input type="time" step="1800" id="af-we-open" class="form-control" value="${hhmm(v.weekend_open)}" required></div>
          <div class="form-group"><label class="form-label" for="af-we-close">Sábado y domingo: hasta</label><input type="time" step="1800" id="af-we-close" class="form-control" value="${hhmm(v.weekend_close)}" required></div>
        </div>
        <label class="checkbox-group"><input type="checkbox" id="af-active" ${v.is_active ? 'checked' : ''}><span class="checkbox-label">Disponible para reservas</span></label>
        <div id="af-error" class="form-error" hidden></div>
        <div style="display:flex; gap:1rem; justify-content:flex-end; margin-top:1.25rem;">
          <button type="button" class="btn btn-secondary" id="af-cancel">Cancelar</button>
          <button type="submit" class="btn btn-primary" id="af-submit">${editing ? 'Guardar cambios' : 'Crear área'}</button>
        </div>
      </form>`);

    modal.$('af-cancel').onclick = modal.close;
    modal.$('area-form').onsubmit = async (e) => {
      e.preventDefault();
      const errBox = modal.$('af-error');
      errBox.hidden = true;
      const submit = modal.$('af-submit');
      submit.disabled = true;
      try {
        await reservationAdminApi.saveArea({
          id: editing ? area.id : null,
          building_id: building.id,
          name: modal.$('af-name').value,
          description: modal.$('af-desc').value,
          weekday_open: modal.$('af-wd-open').value, weekday_close: modal.$('af-wd-close').value,
          weekend_open: modal.$('af-we-open').value, weekend_close: modal.$('af-we-close').value,
          is_active: modal.$('af-active').checked
        });
        modal.close();
        reload();
      } catch (err) {
        errBox.textContent = err.message; errBox.hidden = false; submit.disabled = false;
      }
    };
  }

  start();
  return container;
}
