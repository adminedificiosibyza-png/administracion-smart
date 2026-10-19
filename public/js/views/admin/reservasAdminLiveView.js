/* Solicitudes de reserva y bloqueos del edificio activo (datos reales) */
import { store } from '../../store.js';
import { activeBuilding } from '../../services/activeBuilding.js';
import { authService } from '../../services/authService.js';
import { reservationAdminApi } from '../../services/reservationLive.js';
import { openAppModal } from '../../ui/credentials.js';
import { confirmDialog, alertDialog, promptDialog } from '../../ui/dialog.js';
import { formatDate } from '../../config.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const STATUS = { PENDIENTE: 'Pendiente', CONFIRMADA: 'Aprobada', RECHAZADA: 'Rechazada', CANCELADA: 'Cancelada', FINALIZADA: 'Finalizada' };
const STATUS_BADGE = { PENDIENTE: 'badge-warning', CONFIRMADA: 'badge-success', RECHAZADA: 'badge-danger' };

// Fecha y hora de creación con segundos: distingue solicitudes casi simultáneas
function formatDateTime(iso) {
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const overlaps = (a, b) => a.area_id === b.area_id && a.date === b.date &&
  toMin(a.start_time) < toMin(b.end_time) && toMin(a.end_time) > toMin(b.start_time);

export function renderAdminReservasLive() {
  const container = document.createElement('div');
  container.className = 'fade-in';

  const building = activeBuilding.get();
  if (!building) return container;

  let reservations = [];
  let blocks = [];
  let areas = [];

  const today = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  /* ---------------- solicitudes pendientes (por orden de llegada) ---------------- */

  function pendingRowHTML(req, pending) {
    // Misma lógica de prioridad: gana quien envió primero, según la hora real del servidor
    const conflicts = pending.filter(r => r.id !== req.id && overlaps(r, req));
    const approvedConflict = reservations.find(r => r.status === 'CONFIRMADA' && r.id !== req.id && overlaps(r, req));
    const group = [req, ...conflicts].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const first = group[0].id === req.id;

    const alerts = [];
    if (conflicts.length) alerts.push('<span class="badge badge-warning"><i data-lucide="alert-triangle"></i> Existe otra solicitud para este horario</span>');
    if (approvedConflict) alerts.push('<span class="badge badge-danger"><i data-lucide="ban"></i> Se superpone con una reserva aprobada</span>');

    const row = `
      <tr>
        <td><strong>${esc(req.owner_name)}</strong></td>
        <td><strong style="color: var(--primary);">Dpto ${esc(req.unit_code)}</strong></td>
        <td>${esc(req.area_name)}</td>
        <td>${formatDate(req.date)}</td>
        <td>${esc(req.start_time)}</td>
        <td>${esc(req.end_time)}</td>
        <td style="white-space:nowrap;">${formatDateTime(req.created_at)}</td>
        <td><span class="badge badge-warning">Pendiente</span></td>
        <td style="white-space:nowrap;">
          <button class="btn btn-primary btn-sm" data-act="approve" data-id="${req.id}" ${approvedConflict ? 'disabled style="opacity:.5;cursor:not-allowed;"' : ''}>Aprobar</button>
          <button class="btn btn-outline btn-sm" data-act="reject" data-id="${req.id}">Rechazar</button>
        </td>
      </tr>`;
    if (!alerts.length) return row;

    return row + `
      <tr class="request-detail-row"><td colspan="9">
        <div style="display:flex; flex-wrap:wrap; gap:0.4rem; margin-bottom:${conflicts.length ? '0.6rem' : '0'};">${alerts.join('')}</div>
        ${conflicts.length ? `
          <div style="font-size:0.8rem;"><strong>Solicitudes para este horario, por orden de creación:</strong>
            <ol class="priority-list">
              ${group.map((g, i) => `<li ${g.id === req.id ? 'class="current"' : ''}>
                ${esc(g.owner_name)} (Dpto ${esc(g.unit_code)}) · ${esc(g.start_time)}–${esc(g.end_time)} · creada ${formatDateTime(g.created_at)}
                ${i === 0 ? '<span class="badge badge-success">Primera solicitud: tiene prioridad</span>' : ''}
                ${g.id === req.id ? '<em>(esta fila)</em>' : ''}</li>`).join('')}
            </ol>
            ${first ? '' : `<span style="color: var(--text-muted);">Esta solicitud fue creada después de la de ${esc(group[0].owner_name)} (Dpto ${esc(group[0].unit_code)}).</span>`}
          </div>` : ''}
      </td></tr>`;
  }

  function render() {
    const pending = reservations.filter(r => r.status === 'PENDIENTE')
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const upcoming = reservations.filter(r => r.status === 'CONFIRMADA' && r.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time));
    const history = reservations.filter(r => r.status !== 'PENDIENTE' && !(r.status === 'CONFIRMADA' && r.date >= today))
      .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100);
    const activeBlocks = blocks.filter(b => b.date >= today).sort((a, b) => a.date.localeCompare(b.date));

    container.innerHTML = `
      <div class="card" style="margin-bottom: 1.5rem;">
        <div class="card-header">
          <h2 class="card-title"><i data-lucide="calendar"></i> Solicitudes y Bloqueos — ${esc(building.name)}</h2>
          <button class="btn btn-primary btn-sm" id="btn-block"><i data-lucide="lock"></i> Bloquear horario</button>
        </div>
        <p>Revise las solicitudes de los propietarios y bloquee horarios para mantenimiento. Si dos personas piden el mismo horario, tiene prioridad quien envió primero.</p>
      </div>

      <h3 class="section-title"><i data-lucide="inbox"></i> Solicitudes de reservas (${pending.length})</h3>
      ${pending.length ? `
      <div class="card" style="margin-bottom: 2rem;">
        <div class="table-responsive"><table class="data-table">
          <thead><tr><th>Propietario</th><th>Dpto</th><th>Área solicitada</th><th>Fecha solicitada</th><th>Inicio</th><th>Término</th><th>Solicitud creada</th><th>Estado</th><th>Acciones</th></tr></thead>
          <tbody>${pending.map(r => pendingRowHTML(r, pending)).join('')}</tbody>
        </table></div>
      </div>` : '<div class="card" style="text-align:center; color: var(--text-dim); margin-bottom: 2rem;">No hay solicitudes pendientes.</div>'}

      <h3 class="section-title"><i data-lucide="check-circle-2"></i> Próximas reservas aprobadas (${upcoming.length})</h3>
      ${upcoming.length ? `
      <div class="card" style="margin-bottom: 2rem;">
        <div class="table-responsive"><table class="data-table">
          <thead><tr><th>Código</th><th>Área</th><th>Dpto</th><th>Propietario</th><th>Fecha</th><th>Horario</th><th style="text-align:right;">Acciones</th></tr></thead>
          <tbody>${upcoming.map(r => `
            <tr><td><strong>${esc(r.code)}</strong></td><td>${esc(r.area_name)}</td><td>Dpto ${esc(r.unit_code)}</td><td>${esc(r.owner_name)}</td>
              <td>${formatDate(r.date)}</td><td>${esc(r.start_time)} – ${esc(r.end_time)}</td>
              <td style="text-align:right;"><button class="btn btn-outline btn-sm" data-act="cancel" data-id="${r.id}">Cancelar</button></td></tr>`).join('')}
          </tbody>
        </table></div>
      </div>` : '<div class="card" style="text-align:center; color: var(--text-dim); margin-bottom: 2rem;">No hay reservas aprobadas próximas.</div>'}

      <h3 class="section-title"><i data-lucide="lock"></i> Bloqueos vigentes (${activeBlocks.length})</h3>
      <div class="grid-cards" style="margin-bottom: 2rem;">
        ${activeBlocks.length ? activeBlocks.map(b => `
          <div class="card" style="border-left: 4px solid var(--status-warning);">
            <div style="display:flex; justify-content: space-between; margin-bottom: 0.5rem;">
              <span class="badge badge-warning">Bloqueado</span>
              <span style="font-size:0.8rem; color: var(--text-dim);">${formatDate(b.date)}</span>
            </div>
            <h4 style="font-size:1.05rem; font-weight:700;">${esc(b.area_name)}</h4>
            <p style="font-size:0.85rem; margin: 0.25rem 0 0.5rem;">${esc(b.start_time)} – ${esc(b.end_time)}</p>
            <p style="font-size:0.8rem; color: var(--text-muted);"><strong>Motivo:</strong> ${esc(b.reason)}</p>
            <button class="btn btn-outline btn-sm" data-act="unblock" data-id="${b.id}" style="margin-top:0.75rem;">Quitar bloqueo</button>
          </div>`).join('') : '<div class="card" style="grid-column: 1 / -1; text-align:center; color: var(--text-dim);">No hay bloqueos vigentes.</div>'}
      </div>

      <h3 class="section-title"><i data-lucide="history"></i> Historial de reservas</h3>
      <div class="card"><div class="table-responsive"><table class="data-table">
        <thead><tr><th>Código</th><th>Área</th><th>Dpto</th><th>Propietario</th><th>Fecha</th><th>Horario</th><th>Estado</th></tr></thead>
        <tbody>${history.length ? history.map(r => `
          <tr><td><strong>${esc(r.code)}</strong></td><td>${esc(r.area_name)}</td><td>Dpto ${esc(r.unit_code)}</td><td>${esc(r.owner_name)}</td>
            <td>${formatDate(r.date)}</td><td>${esc(r.start_time)} – ${esc(r.end_time)}</td>
            <td><span class="badge ${STATUS_BADGE[r.status] || 'badge-neutral'}">${STATUS[r.status] || r.status}</span>${r.status === 'RECHAZADA' && r.rejection_reason ? `<span class="cell-note">${esc(r.rejection_reason)}</span>` : ''}</td></tr>`).join('')
          : '<tr><td colspan="7" style="text-align:center; color: var(--text-dim);">Sin registros.</td></tr>'}
        </tbody>
      </table></div></div>`;

    container.querySelector('#btn-block').addEventListener('click', openBlockModal);
    container.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', () => handleAction(btn.dataset.act, btn.dataset.id)));
    if (window.lucide) window.lucide.createIcons();
  }

  async function handleAction(act, id) {
    try {
      if (act === 'approve') {
        await reservationAdminApi.approve(id);
      } else if (act === 'reject') {
        const reason = await promptDialog({
          title: 'Rechazar solicitud',
          message: 'Puede indicar el motivo del rechazo (opcional). Lo verá el propietario.',
          label: 'Motivo', confirmText: 'Rechazar'
        });
        if (reason === null) return;
        await reservationAdminApi.reject(id, reason);
      } else if (act === 'cancel') {
        const ok = await confirmDialog({
          title: 'Cancelar reserva aprobada',
          message: 'La reserva se cancelará y el horario quedará libre. El propietario verá el cambio en Mis Reservas.',
          confirmText: 'Sí, cancelar', cancelText: 'No', danger: true
        });
        if (!ok) return;
        await reservationAdminApi.cancel(id);
      } else if (act === 'unblock') {
        const ok = await confirmDialog({ title: 'Quitar bloqueo', message: 'El horario volverá a estar disponible para reservas.', confirmText: 'Quitar bloqueo' });
        if (!ok) return;
        await reservationAdminApi.deleteBlock(id);
      } else return;
      await reload();
      store.setView(store.currentView); // actualiza el contador del menú
    } catch (err) {
      await alertDialog({ tone: 'danger', title: 'No se pudo completar', message: err.message });
      reload();
    }
  }

  function openBlockModal() {
    const active = areas.filter(a => a.is_active);
    if (!active.length) { alertDialog({ tone: 'warning', message: 'Primero cree un área común en "Áreas Comunes".' }); return; }
    const modal = openAppModal('<i data-lucide="lock" style="color: var(--status-warning);"></i> Bloquear horario de un área', `
      <form id="block-form" novalidate>
        <div class="form-group"><label class="form-label" for="bl-area">Área común</label>
          <select id="bl-area" class="form-select">${active.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select></div>
        <div class="form-grid">
          <div class="form-group"><label class="form-label" for="bl-date">Fecha</label><input type="date" id="bl-date" class="form-control" min="${today}" value="${today}" required></div>
          <div class="form-group"><label class="form-label" for="bl-start">Desde</label><input type="time" step="1800" id="bl-start" class="form-control" value="08:00" required></div>
          <div class="form-group"><label class="form-label" for="bl-end">Hasta</label><input type="time" step="1800" id="bl-end" class="form-control" value="18:00" required></div>
        </div>
        <div class="form-group"><label class="form-label" for="bl-reason">Motivo</label>
          <input type="text" id="bl-reason" class="form-control" placeholder="Ej: Mantenimiento preventivo o limpieza profunda" required></div>
        <div id="bl-error" class="form-error" hidden></div>
        <div style="display:flex; gap:1rem; justify-content:flex-end; margin-top:1.25rem;">
          <button type="button" class="btn btn-secondary" id="bl-cancel">Cancelar</button>
          <button type="submit" class="btn btn-primary" id="bl-submit"><i data-lucide="lock"></i> Aplicar bloqueo</button>
        </div>
      </form>`);
    modal.$('bl-cancel').onclick = modal.close;
    modal.$('block-form').onsubmit = async (e) => {
      e.preventDefault();
      const err = modal.$('bl-error');
      err.hidden = true;
      const date = modal.$('bl-date').value, start = modal.$('bl-start').value, end = modal.$('bl-end').value, reason = modal.$('bl-reason').value.trim();
      if (!date || !start || !end || !reason) { err.textContent = 'Complete todos los campos.'; err.hidden = false; return; }
      if (end <= start) { err.textContent = 'La hora final debe ser posterior a la inicial.'; err.hidden = false; return; }
      const submit = modal.$('bl-submit');
      submit.disabled = true;
      try {
        await reservationAdminApi.createBlock({
          buildingId: building.id, areaId: modal.$('bl-area').value, date, startTime: start, endTime: end, reason,
          createdBy: (authService.getContext() || {}).full_name || 'Administración'
        });
        modal.close();
        reload();
      } catch (ex) { err.textContent = ex.message; err.hidden = false; submit.disabled = false; }
    };
  }

  async function reload() {
    try {
      [reservations, blocks, areas] = await Promise.all([
        reservationAdminApi.listReservations(building.id),
        reservationAdminApi.listBlocks(building.id),
        reservationAdminApi.listAreas(building.id)
      ]);
      render();
    } catch (err) {
      container.innerHTML = `
        <div class="card" style="text-align:center;">
          <p style="color: var(--status-danger); margin-bottom: 1rem;">${esc(err.message)}</p>
          <button class="btn btn-primary btn-sm" id="res-retry">Reintentar</button>
        </div>`;
      container.querySelector('#res-retry').addEventListener('click', () => { start(); });
    }
  }

  async function start() {
    container.innerHTML = '<div class="card" style="text-align:center; color: var(--text-dim);">Cargando reservas...</div>';
    await reload();
  }

  start();
  return container;
}
