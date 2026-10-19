/* Administradora Reservations Management & Administrative Time Blocking View */
import { store } from '../../store.js';
import { reservationService } from '../../services/reservationService.js';
import { formatDate } from '../../config.js';
import { alertDialog, promptDialog } from '../../ui/dialog.js';

export function renderAdminReservas() {
  const reservations = store.state.reservations;
  const pending = reservationService.getPendingRequests();
  const blocks = store.state.reservation_blocks;
  const commonAreas = reservationService.getAllCommonAreas();

  const container = document.createElement('div');
  container.className = 'fade-in';

  container.innerHTML = `
    <div class="card" style="margin-bottom: 1.5rem;">
      <div class="card-header">
        <h2 class="card-title"><i data-lucide="calendar"></i> Administrar Reservas y Bloqueos de Horario</h2>
        <button class="btn btn-primary btn-sm" id="btn-open-block-modal">
          <i data-lucide="lock"></i> Bloquear Horario para Mantenimiento
        </button>
      </div>
      <p>Gestión integral de áreas comunes, control de reservas de propietarios y bloqueos administrativos.</p>
    </div>

    <!-- Solicitudes de reserva pendientes -->
    <h3 id="solicitudes-reservas" style="font-size: 1.1rem; font-weight: 700; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;">
      <i data-lucide="inbox"></i> Solicitudes de reservas (${pending.length})
    </h3>

    ${pending.length === 0 ? `
      <div class="card" style="text-align: center; color: var(--text-dim); margin-bottom: 2rem;">
        No hay solicitudes de reserva pendientes.
      </div>
    ` : `
      <div class="card" style="margin-bottom: 2rem;">
        <p style="font-size: 0.8rem; margin-bottom: 0.75rem;">
          Ordenadas por fecha y hora de creación de la solicitud (la más antigua primero). Si dos solicitudes coinciden en fecha y horario, tiene prioridad la que se creó antes.
        </p>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Propietario</th>
                <th>Dpto</th>
                <th>Área solicitada</th>
                <th>Fecha solicitada</th>
                <th>Inicio</th>
                <th>Término</th>
                <th>Solicitud creada</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${pending.map(req => requestRowHTML(req)).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `}

    <!-- Active Administrative Blocks -->
    <h3 style="font-size: 1.1rem; font-weight: 700; margin-bottom: 1rem; color: var(--status-warning);">
      Bloqueos Administrativos Vigentes (${blocks.length})
    </h3>

    <div class="grid-cards" style="margin-bottom: 2rem;">
      ${blocks.length === 0 ? `
        <div class="card" style="grid-column: 1 / -1; text-align: center; color: var(--text-dim);">
          No hay bloqueos administrativos activos.
        </div>
      ` : blocks.map(blk => `
        <div class="card" style="border-left: 4px solid var(--status-warning);">
          <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
            <span class="badge badge-warning">BLOQUEADO</span>
            <span style="font-size: 0.8rem; color: var(--text-dim);">${formatDate(blk.date)}</span>
          </div>
          <h4 style="font-size: 1.05rem; font-weight: 700; margin-bottom: 0.25rem;">${blk.area_name}</h4>
          <p style="font-size: 0.85rem; margin-bottom: 0.5rem;"><i data-lucide="clock"></i> Horario: ${blk.start_time} – ${blk.end_time}</p>
          <p style="font-size: 0.8rem; color: var(--text-muted);"><strong>Motivo:</strong> ${blk.reason}</p>
        </div>
      `).join('')}
    </div>

    <!-- All Reservations Table -->
    <h3 style="font-size: 1.1rem; font-weight: 700; margin-bottom: 1rem;">
      Registro General de Reservas de Propietarios
    </h3>

    <div class="card">
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Área Común</th>
              <th>Dpto</th>
              <th>Propietario</th>
              <th>Fecha</th>
              <th>Horario</th>
              <th>Motivo</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            ${reservations.map(res => `
              <tr>
                <td><strong>${res.code}</strong></td>
                <td>${res.area_name}</td>
                <td><strong style="color: var(--primary);">Dpto ${res.unit_code}</strong></td>
                <td>${res.owner_name}</td>
                <td>${formatDate(res.date)}</td>
                <td>${res.start_time} – ${res.end_time}</td>
                <td>${res.motive}</td>
                <td>
                  <span class="badge ${reservationService.statusBadgeClass(res.status)}">
                    ${reservationService.statusLabel(res.status)}
                  </span>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  setTimeout(() => {
    container.querySelector('#btn-open-block-modal')?.addEventListener('click', () => openBlockModal(commonAreas));

    container.querySelectorAll('.btn-approve-req').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          reservationService.approveRequest(btn.getAttribute('data-req-id'), 'Administradora PARKE10');
        } catch (err) {
          await alertDialog({ tone: 'danger', message: err.message });
        }
        store.setView('admin-reservas');
      });
    });

    container.querySelectorAll('.btn-reject-req').forEach(btn => {
      btn.addEventListener('click', async () => {
        const reason = await promptDialog({
          title: 'Rechazar solicitud',
          message: 'Puede indicar el motivo del rechazo (opcional). Lo verá el propietario.',
          label: 'Motivo',
          confirmText: 'Rechazar'
        });
        if (reason === null) return; // canceló
        try {
          reservationService.rejectRequest(btn.getAttribute('data-req-id'), reason, 'Administradora PARKE10');
        } catch (err) {
          await alertDialog({ tone: 'danger', message: err.message });
        }
        store.setView('admin-reservas');
      });
    });
    if (window.lucide) window.lucide.createIcons();
  }, 0);

  return container;
}

// Fecha y hora de creación con segundos, para distinguir solicitudes casi simultáneas
function formatDateTime(iso) {
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function requestRowHTML(req) {
  const conflicts = reservationService.getConflictingRequests(req);
  const approvedConflict = reservationService.getApprovedConflict(req);
  const restriction = reservationService.getOwnerRestriction(req.unit_code);
  // Grupo en conflicto (incluida esta solicitud) por orden real de creación
  const group = [req, ...conflicts].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const hasPriority = group[0].id === req.id;

  const alerts = [];
  if (conflicts.length) {
    alerts.push(`<span class="badge badge-warning"><i data-lucide="alert-triangle"></i> Existe otra solicitud para este horario</span>`);
  }
  if (approvedConflict) {
    alerts.push(`<span class="badge badge-danger"><i data-lucide="ban"></i> Se superpone con una reserva aprobada</span>`);
  }
  if (restriction) {
    alerts.push(`<span class="badge badge-danger"><i data-lucide="shield-alert"></i> Propietario con restricción vigente${restriction.reason ? ': ' + restriction.reason : ''}</span>`);
  }

  const rows = `
    <tr>
      <td><strong>${req.owner_name}</strong></td>
      <td><strong style="color: var(--primary);">Dpto ${req.unit_code}</strong></td>
      <td>${req.area_name}</td>
      <td>${formatDate(req.date)}</td>
      <td>${req.start_time}</td>
      <td>${req.end_time}</td>
      <td style="white-space: nowrap;">${formatDateTime(req.created_at)}</td>
      <td><span class="badge ${reservationService.statusBadgeClass(req.status)}">${reservationService.statusLabel(req.status)}</span></td>
      <td style="white-space: nowrap;">
        <button class="btn btn-primary btn-sm btn-approve-req" data-req-id="${req.id}" ${approvedConflict ? 'disabled style="opacity:.5;cursor:not-allowed;"' : ''}>Aprobar</button>
        <button class="btn btn-outline btn-sm btn-reject-req" data-req-id="${req.id}">Rechazar</button>
      </td>
    </tr>`;

  if (!alerts.length) return rows;

  return rows + `
    <tr class="request-detail-row">
      <td colspan="9">
        <div style="display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: ${conflicts.length ? '0.6rem' : '0'};">${alerts.join('')}</div>
        ${conflicts.length ? `
          <div style="font-size: 0.8rem;">
            <strong>Solicitudes para este horario, por orden de creación:</strong>
            <ol class="priority-list">
              ${group.map((g, i) => `
                <li ${g.id === req.id ? 'class="current"' : ''}>
                  ${g.owner_name} (Dpto ${g.unit_code}) · ${g.start_time}–${g.end_time} · creada ${formatDateTime(g.created_at)}
                  ${i === 0 ? '<span class="badge badge-success">Primera solicitud: tiene prioridad</span>' : ''}
                  ${g.id === req.id ? '<em>(esta fila)</em>' : ''}
                </li>`).join('')}
            </ol>
            ${hasPriority ? '' : `<span style="color: var(--text-muted);">Esta solicitud fue creada después de la de ${group[0].owner_name} (Dpto ${group[0].unit_code}).</span>`}
          </div>` : ''}
      </td>
    </tr>`;
}

function openBlockModal(commonAreas) {
  const modalOverlay = document.getElementById('modal-container');
  const modalTitle = document.getElementById('modal-title');
  const modalBody = document.getElementById('modal-body');

  modalTitle.innerHTML = `<i data-lucide="lock" style="color: var(--status-warning);"></i> Bloquear Horario de Área Común`;

  modalBody.innerHTML = `
    <form id="create-block-form">
      <div class="form-group">
        <label class="form-label">Área Común</label>
        <select id="block-area-id" class="form-select" required>
          ${commonAreas.map(a => `<option value="${a.id}">${a.name}</option>`).join('')}
        </select>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem;">
        <div class="form-group">
          <label class="form-label">Fecha del Bloqueo</label>
          <input type="date" id="block-date" class="form-control" value="${new Date().toISOString().split('T')[0]}" required>
        </div>
        <div class="form-group">
          <label class="form-label">Hora Inicio</label>
          <input type="time" id="block-start" class="form-control" value="09:00" required>
        </div>
        <div class="form-group">
          <label class="form-label">Hora Fin</label>
          <input type="time" id="block-end" class="form-control" value="18:00" required>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Motivo del Bloqueo</label>
        <input type="text" id="block-reason" class="form-control" placeholder="Ej: Mantenimiento preventivo o limpieza profunda" required>
      </div>

      <div style="display: flex; gap: 1rem; justify-content: flex-end; margin-top: 1.5rem;">
        <button type="button" class="btn btn-secondary" id="modal-block-cancel">Cancelar</button>
        <button type="submit" class="btn btn-primary"><i data-lucide="lock"></i> Aplicar Bloqueo</button>
      </div>
    </form>
  `;

  modalOverlay.classList.remove('hidden');

  document.getElementById('modal-close-btn').onclick = () => modalOverlay.classList.add('hidden');
  document.getElementById('modal-block-cancel').onclick = () => modalOverlay.classList.add('hidden');

  document.getElementById('create-block-form').onsubmit = (e) => {
    e.preventDefault();
    const areaId = document.getElementById('block-area-id').value;
    const date = document.getElementById('block-date').value;
    const start = document.getElementById('block-start').value;
    const end = document.getElementById('block-end').value;
    const reason = document.getElementById('block-reason').value;

    reservationService.createBlock({
      areaId: areaId,
      date: date,
      startTime: start,
      endTime: end,
      reason: reason,
      createdBy: 'Administradora PARKE10'
    });

    modalOverlay.classList.add('hidden');
    store.setView('admin-reservas');
  };

  if (window.lucide) window.lucide.createIcons();
}
