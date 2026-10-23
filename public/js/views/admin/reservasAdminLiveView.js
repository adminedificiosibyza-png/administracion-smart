/* Solicitudes de reserva y bloqueos del edificio activo (datos reales) */
import { store } from '../../store.js';
import { activeBuilding } from '../../services/activeBuilding.js';
import { authService } from '../../services/authService.js';
import { reservationAdminApi } from '../../services/reservationLive.js';
import { openAppModal } from '../../ui/credentials.js';
import { confirmDialog, alertDialog, promptDialog } from '../../ui/dialog.js';
import { formatDate } from '../../config.js';
import { exportReservationFormPdf } from '../../services/reservationFormPdf.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const STATUS = { PENDIENTE: 'Pendiente', CONFIRMADA: 'Aprobada', RECHAZADA: 'Rechazada', CANCELADA: 'Cancelada', FINALIZADA: 'Finalizada' };
const STATUS_BADGE = { PENDIENTE: 'badge-warning', CONFIRMADA: 'badge-success', RECHAZADA: 'badge-danger' };
const CHANNELS = { RECEPCION: 'Recepción (formato)', WHATSAPP: 'WhatsApp', LLAMADA: 'Llamada', OTRO: 'Otro' };

// Momento en que la persona hizo el pedido: el que registró la administración o, si no hay, el de creación en el portal
const askedAt = r => r.requested_at || r.created_at;
const channelTag = r => (r.request_channel && r.request_channel !== 'PORTAL')
  ? `<span class="badge badge-neutral" title="Registrada por la administración">${esc(CHANNELS[r.request_channel] || r.request_channel)}</span>` : '';
const nowLocalInput = () => {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

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
    const group = [req, ...conflicts].sort((a, b) => new Date(askedAt(a)) - new Date(askedAt(b)));
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
        <td style="white-space:nowrap;">${formatDateTime(askedAt(req))}${req.request_channel && req.request_channel !== 'PORTAL' ? `<div class="cell-note">${channelTag(req)} registrada ${formatDateTime(req.created_at)}</div>` : ''}</td>
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
          <div style="font-size:0.8rem;"><strong>Solicitudes para este horario, por orden de pedido:</strong>
            <ol class="priority-list">
              ${group.map((g, i) => `<li ${g.id === req.id ? 'class="current"' : ''}>
                ${esc(g.owner_name)} (Dpto ${esc(g.unit_code)}) · ${esc(g.start_time)}–${esc(g.end_time)} · pedido ${formatDateTime(askedAt(g))}
                ${i === 0 ? '<span class="badge badge-success">Primera solicitud: tiene prioridad</span>' : ''}
                ${g.id === req.id ? '<em>(esta fila)</em>' : ''}</li>`).join('')}
            </ol>
            ${first ? '' : `<span style="color: var(--text-muted);">Esta solicitud se pidió después de la de ${esc(group[0].owner_name)} (Dpto ${esc(group[0].unit_code)}).</span>`}
          </div>` : ''}
      </td></tr>`;
  }

  function render() {
    const pending = reservations.filter(r => r.status === 'PENDIENTE')
      .sort((a, b) => new Date(askedAt(a)) - new Date(askedAt(b)));
    const upcoming = reservations.filter(r => r.status === 'CONFIRMADA' && r.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time));
    const history = reservations.filter(r => r.status !== 'PENDIENTE' && !(r.status === 'CONFIRMADA' && r.date >= today))
      .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100);
    const activeBlocks = blocks.filter(b => b.date >= today).sort((a, b) => a.date.localeCompare(b.date));

    container.innerHTML = `
      <div class="card" style="margin-bottom: 1.5rem;">
        <div class="card-header">
          <h2 class="card-title"><i data-lucide="calendar"></i> Solicitudes y Bloqueos — ${esc(building.name)}</h2>
          <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
            <button class="btn btn-primary btn-sm" id="btn-reserve"><i data-lucide="calendar-plus"></i> Reservar a nombre de un propietario</button>
            <button class="btn btn-outline btn-sm" id="btn-form-pdf"><i data-lucide="file-text"></i> Formato para recepción (PDF)</button>
            <button class="btn btn-outline btn-sm" id="btn-block"><i data-lucide="lock"></i> Bloquear horario</button>
          </div>
        </div>
        <p>Revise las solicitudes de los propietarios y bloquee horarios para mantenimiento. Si dos personas piden el mismo horario, tiene prioridad quien pidió primero. Para quien no use el portal, registre su reserva con el botón <strong>Reservar a nombre de un propietario</strong>.</p>
      </div>

      <h3 class="section-title"><i data-lucide="inbox"></i> Solicitudes de reservas (${pending.length})</h3>
      ${pending.length ? `
      <div class="card" style="margin-bottom: 2rem;">
        <div class="table-responsive"><table class="data-table">
          <thead><tr><th>Propietario</th><th>Dpto</th><th>Área solicitada</th><th>Fecha solicitada</th><th>Inicio</th><th>Término</th><th>Pedido recibido</th><th>Estado</th><th>Acciones</th></tr></thead>
          <tbody>${pending.map(r => pendingRowHTML(r, pending)).join('')}</tbody>
        </table></div>
      </div>` : '<div class="card" style="text-align:center; color: var(--text-dim); margin-bottom: 2rem;">No hay solicitudes pendientes.</div>'}

      <h3 class="section-title"><i data-lucide="check-circle-2"></i> Próximas reservas aprobadas (${upcoming.length})</h3>
      ${upcoming.length ? `
      <div class="card" style="margin-bottom: 2rem;">
        <div class="table-responsive"><table class="data-table">
          <thead><tr><th>Código</th><th>Área</th><th>Dpto</th><th>Propietario</th><th>Fecha</th><th>Horario</th><th style="text-align:right;">Acciones</th></tr></thead>
          <tbody>${upcoming.map(r => `
            <tr><td><strong>${esc(r.code)}</strong></td><td>${esc(r.area_name)}</td><td>Dpto ${esc(r.unit_code)}</td><td>${esc(r.owner_name)} ${channelTag(r)}</td>
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
          <tr><td><strong>${esc(r.code)}</strong></td><td>${esc(r.area_name)}</td><td>Dpto ${esc(r.unit_code)}</td><td>${esc(r.owner_name)} ${channelTag(r)}</td>
            <td>${formatDate(r.date)}</td><td>${esc(r.start_time)} – ${esc(r.end_time)}</td>
            <td><span class="badge ${STATUS_BADGE[r.status] || 'badge-neutral'}">${STATUS[r.status] || r.status}</span>${r.status === 'RECHAZADA' && r.rejection_reason ? `<span class="cell-note">${esc(r.rejection_reason)}</span>` : ''}</td></tr>`).join('')
          : '<tr><td colspan="7" style="text-align:center; color: var(--text-dim);">Sin registros.</td></tr>'}
        </tbody>
      </table></div></div>`;

    container.querySelector('#btn-block').addEventListener('click', openBlockModal);
    container.querySelector('#btn-reserve').addEventListener('click', openReserveModal);
    container.querySelector('#btn-form-pdf').addEventListener('click', downloadFormPdf);
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

  /* ---------------- formato en blanco para recepción ---------------- */

  async function downloadFormPdf(e) {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await exportReservationFormPdf({ building: { name: building.name } });
    } catch (err) {
      alertDialog({ tone: 'danger', title: 'No se pudo generar el formato', message: err.message });
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------------- reservar a nombre de un propietario ---------------- */

  async function openReserveModal() {
    const activeAreas = areas.filter(a => a.is_active);
    if (!activeAreas.length) { alertDialog({ tone: 'warning', message: 'Primero cree un área común en "Áreas Comunes".' }); return; }
    let units;
    try {
      units = (await reservationAdminApi.listUnitsWithPeople(building.id)).filter(u => u.people.length);
    } catch (err) { alertDialog({ tone: 'danger', title: 'No se pudo abrir el formulario', message: err.message }); return; }
    if (!units.length) { alertDialog({ tone: 'warning', message: 'Ningún departamento de este edificio tiene personas asignadas todavía. Asígnelas en "Usuarios y Accesos".' }); return; }

    const modal = openAppModal('<i data-lucide="calendar-plus" style="color: var(--primary);"></i> Reservar a nombre de un propietario', `
      <form id="rv-form" novalidate>
        <div class="form-grid">
          <div class="form-group"><label class="form-label" for="rv-unit">Departamento</label>
            <select id="rv-unit" class="form-select">${units.map(u => `<option value="${u.id}">Dpto ${esc(u.code)}</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label" for="rv-user">A nombre de</label>
            <select id="rv-user" class="form-select"></select></div>
        </div>
        <div class="form-group"><label class="form-label" for="rv-phone">Teléfono de contacto</label>
          <input type="tel" id="rv-phone" class="form-control" placeholder="Ej: 987 654 321" required></div>
        <div class="form-group"><label class="form-label" for="rv-area">Área común</label>
          <select id="rv-area" class="form-select">${activeAreas.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select></div>
        <div class="form-grid">
          <div class="form-group"><label class="form-label" for="rv-date">Fecha</label><input type="date" id="rv-date" class="form-control" min="${today}" value="${today}" required></div>
          <div class="form-group"><label class="form-label" for="rv-start">Desde</label><input type="time" step="1800" id="rv-start" class="form-control" required></div>
          <div class="form-group"><label class="form-label" for="rv-end">Hasta</label><input type="time" step="1800" id="rv-end" class="form-control" required></div>
        </div>
        <div id="rv-hint" class="cell-note" style="margin: -0.25rem 0 0.75rem;"></div>
        <div class="form-group"><label class="form-label" for="rv-motive">Actividad / motivo</label>
          <input type="text" id="rv-motive" class="form-control" placeholder="Ej: Cumpleaños familiar" required></div>
        <div class="form-grid">
          <div class="form-group"><label class="form-label" for="rv-channel">Cómo llegó el pedido</label>
            <select id="rv-channel" class="form-select">${Object.entries(CHANNELS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label" for="rv-requested">Pedido recibido el</label>
            <input type="datetime-local" id="rv-requested" class="form-control" value="${nowLocalInput()}" max="${nowLocalInput()}" required></div>
        </div>
        <div class="form-group"><label class="form-label" for="rv-status">Estado inicial</label>
          <select id="rv-status" class="form-select">
            <option value="CONFIRMADA">Aprobada (recomendado)</option>
            <option value="PENDIENTE">Pendiente (decidir después)</option>
          </select></div>
        <div class="form-group"><label class="form-label" for="rv-note">Observación interna (opcional)</label>
          <input type="text" id="rv-note" class="form-control" placeholder="Ej: Formato N.° 12 dejado en recepción"></div>
        <label style="display:flex; gap:0.5rem; align-items:flex-start; margin-bottom:1rem;">
          <input type="checkbox" id="rv-terms" style="margin-top:0.2rem;">
          <span>La persona aceptó las normas de uso del área común (formato firmado o confirmación recibida).</span>
        </label>
        <div id="rv-error" class="form-error" hidden></div>
        <div style="display:flex; gap:1rem; justify-content:flex-end; margin-top:1.25rem;">
          <button type="button" class="btn btn-secondary" id="rv-cancel">Cancelar</button>
          <button type="submit" class="btn btn-primary" id="rv-submit"><i data-lucide="calendar-check"></i> Registrar reserva</button>
        </div>
      </form>`);

    const fillPeople = () => {
      const unit = units.find(u => u.id === modal.$('rv-unit').value);
      modal.$('rv-user').innerHTML = unit.people.map(p => `<option value="${p.user_id}">${esc(p.full_name)} (${p.relation === 'PROPIETARIO' ? 'Propietario' : p.relation === 'INQUILINO' ? 'Inquilino' : 'Otro'})</option>`).join('');
      fillPhone();
    };
    const fillPhone = () => {
      const unit = units.find(u => u.id === modal.$('rv-unit').value);
      const person = unit.people.find(p => p.user_id === modal.$('rv-user').value);
      modal.$('rv-phone').value = (person && person.phone) || '';
    };

    // Horario del área ese día, horarios ocupados y solicitudes pendientes que se cruzan
    const updateHint = () => {
      const areaId = modal.$('rv-area').value, date = modal.$('rv-date').value;
      const start = modal.$('rv-start').value, end = modal.$('rv-end').value;
      const area = areas.find(a => a.id === areaId);
      const parts = [];
      if (area && date) {
        const dow = new Date(`${date}T12:00:00`).getDay();
        const weekend = dow === 0 || dow === 6;
        parts.push(`Horario del área ese día: ${esc(String(weekend ? area.weekend_open : area.weekday_open).slice(0, 5))} – ${esc(String(weekend ? area.weekend_close : area.weekday_close).slice(0, 5))}.`);
      }
      const same = r => r.area_id === areaId && r.date === date;
      const taken = [
        ...reservations.filter(r => r.status === 'CONFIRMADA' && same(r)).map(r => `${esc(r.start_time)}–${esc(r.end_time)} reservado (Dpto ${esc(r.unit_code)})`),
        ...blocks.filter(same).map(b => `${esc(b.start_time)}–${esc(b.end_time)} bloqueado`)
      ];
      if (taken.length) parts.push(`<strong>Ocupado ese día:</strong> ${taken.join(' · ')}.`);
      if (start && end && end > start) {
        const pend = reservations.filter(r => r.status === 'PENDIENTE' && same(r) && toMin(r.start_time) < toMin(end) && toMin(r.end_time) > toMin(start));
        if (pend.length) {
          parts.push(`<span style="color: var(--status-warning);"><strong>Atención:</strong> hay ${pend.length} solicitud(es) pendiente(s) para este horario: ${pend.map(r => `${esc(r.owner_name)} (Dpto ${esc(r.unit_code)}, pedido ${formatDateTime(askedAt(r))})`).join('; ')}. Si registra esta reserva como aprobada, esas no podrán aprobarse.</span>`);
        }
      }
      modal.$('rv-hint').innerHTML = parts.join('<br>');
    };

    fillPeople();
    updateHint();
    modal.$('rv-unit').onchange = fillPeople;
    modal.$('rv-user').onchange = fillPhone;
    ['rv-area', 'rv-date', 'rv-start', 'rv-end'].forEach(id => { modal.$(id).onchange = updateHint; });
    modal.$('rv-cancel').onclick = modal.close;

    modal.$('rv-form').onsubmit = async (e) => {
      e.preventDefault();
      const err = modal.$('rv-error');
      err.hidden = true;
      const fail = (msg) => { err.textContent = msg; err.hidden = false; };
      const v = id => modal.$(id).value.trim();
      const date = v('rv-date'), start = v('rv-start'), end = v('rv-end');
      if (!v('rv-phone') || !date || !start || !end || !v('rv-motive') || !v('rv-requested')) return fail('Complete todos los campos obligatorios.');
      if (v('rv-phone').replace(/\D/g, '').length < 7) return fail('Ingrese un teléfono de contacto válido (mínimo 7 dígitos).');
      if (end <= start) return fail('La hora final debe ser posterior a la inicial.');
      if (new Date(v('rv-requested')) > new Date()) return fail('La fecha y hora del pedido no puede ser futura.');
      if (!modal.$('rv-terms').checked) return fail('Confirme que la persona aceptó las normas de uso del área común.');

      const submit = modal.$('rv-submit');
      submit.disabled = true;
      try {
        const res = await reservationAdminApi.createForOwner({
          area_id: v('rv-area'), unit_id: v('rv-unit'), user_id: v('rv-user'), phone: v('rv-phone'),
          date, start_time: start, end_time: end, motive: v('rv-motive'),
          channel: v('rv-channel'), requested_at: new Date(v('rv-requested')).toISOString(),
          status: v('rv-status'), admin_note: v('rv-note'), accepted_terms: true
        });
        modal.close();
        await alertDialog({ tone: 'success', title: 'Reserva registrada', message: `Se registró la reserva ${res.code} (${res.status === 'CONFIRMADA' ? 'aprobada' : 'pendiente'}). El propietario la verá en Mis Reservas.` });
        await reload();
        store.setView(store.currentView); // actualiza el contador del menú
      } catch (ex) { fail(ex.message); submit.disabled = false; }
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
