/* Propietario My Reservations View */
import { store } from '../../store.js';
import { reservationService } from '../../services/reservationService.js';
import { authService } from '../../services/authService.js';
import { formatDate } from '../../config.js';
import { confirmDialog, alertDialog } from '../../ui/dialog.js';
import { ownerReservationApi } from '../../services/reservationLive.js';
import { isSupabaseConnected } from '../../supabaseClient.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function renderPropietarioMisReservas() {
  const user = await authService.getCurrentUser();
  const live = isSupabaseConnected() && !!authService.getContext();

  let reservations;
  if (live) {
    const failure = (title, text) => {
      const box = document.createElement('div');
      box.className = 'card';
      box.style.maxWidth = '640px';
      box.innerHTML = `<h2 class="card-title" style="margin-bottom:0.5rem;"><i data-lucide="bookmark-check"></i> ${title}</h2><p>${text}</p>`;
      setTimeout(() => { if (window.lucide) window.lucide.createIcons(); }, 0);
      return box;
    };
    if (!user.unitId) return failure('Sin departamento asignado', 'Todavía no tiene un departamento asignado. Comuníquese con la administración.');
    try {
      reservations = await ownerReservationApi.listForUnit(user.unitId);
    } catch (err) {
      return failure('No se pudo cargar', esc(err.message));
    }
  } else {
    reservations = reservationService.getOwnerReservations(user.unit);
  }

  // Fecha de hoy en hora local (no en UTC, que en Perú adelanta el día por la noche)
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const upcoming = reservations.filter(r => r.date >= today && (r.status === 'CONFIRMADA' || r.status === 'PENDIENTE'));
  const history = reservations.filter(r => r.date < today || (r.status !== 'CONFIRMADA' && r.status !== 'PENDIENTE'));

  const container = document.createElement('div');
  container.className = 'fade-in';

  container.innerHTML = `
    <div class="card" style="margin-bottom: 1.5rem;">
      <div class="card-header">
        <h2 class="card-title"><i data-lucide="bookmark-check"></i> Mis Reservas</h2>
        <button class="btn btn-primary btn-sm" id="btn-nueva-reserva">
          <i data-lucide="plus"></i> Nueva Reserva
        </button>
      </div>
      <p>Consulta tus próximas reservas de áreas comunes e historial de uso.</p>
    </div>

    <!-- Upcoming Reservations -->
    <h3 style="font-size: 1.1rem; font-weight: 700; margin-bottom: 1rem; color: var(--primary);">
      Próximas Reservas (${upcoming.length})
    </h3>

    ${upcoming.length === 0 ? `
      <div class="card" style="text-align: center; padding: 2rem; margin-bottom: 1.5rem;">
        <p style="color: var(--text-dim);">No tienes reservas próximas programadas.</p>
      </div>
    ` : `
      <div class="grid-cards" style="margin-bottom: 2rem;">
        ${upcoming.map(res => `
          <div class="card">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem;">
              <span class="badge ${reservationService.statusBadgeClass(res.status)}">${reservationService.statusLabel(res.status)}</span>
              <span style="font-size: 0.8rem; font-weight: 700; color: var(--text-dim);">${esc(res.code)}</span>
            </div>
            <h4 style="font-size: 1.1rem; font-weight: 700; margin-bottom: 0.25rem;">${esc(res.area_name)}</h4>
            <p style="font-size: 0.85rem; margin-bottom: 0.5rem;"><i data-lucide="calendar"></i> ${formatDate(res.date)}</p>
            <p style="font-size: 0.85rem; margin-bottom: 1rem;"><i data-lucide="clock"></i> ${res.start_time} – ${res.end_time}</p>
            
            <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-color); padding-top: 0.75rem;">
              <span style="font-size: 0.75rem; color: var(--text-dim);">${esc(res.motive)}</span>
              <button class="btn btn-danger btn-sm btn-cancel-res" data-res-id="${res.id}">Cancelar</button>
            </div>
          </div>
        `).join('')}
      </div>
    `}

    <!-- History -->
    <h3 style="font-size: 1.1rem; font-weight: 700; margin-bottom: 1rem; color: var(--text-muted);">
      Historial de Reservas
    </h3>

    <div class="table-responsive">
      <table class="data-table table-cards">
        <thead>
          <tr>
            <th>Código</th>
            <th>Área Común</th>
            <th>Fecha</th>
            <th>Horario</th>
            <th>Motivo</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          ${history.length === 0 ? `
            <tr><td colspan="6" style="text-align: center; color: var(--text-dim);">No hay registros en el historial.</td></tr>
          ` : history.map(res => `
            <tr>
              <td><strong>${esc(res.code)}</strong></td>
              <td>${esc(res.area_name)}</td>
              <td>${formatDate(res.date)}</td>
              <td>${res.start_time} – ${res.end_time}</td>
              <td>${esc(res.motive)}${res.status === 'RECHAZADA' && res.rejection_reason ? `<br><small>Motivo del rechazo: ${esc(res.rejection_reason)}</small>` : ''}</td>
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
  `;

  setTimeout(() => {
    container.querySelector('#btn-nueva-reserva')?.addEventListener('click', () => {
      store.setView('propietario-reservas');
    });

    container.querySelectorAll('.btn-cancel-res').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-res-id');
        const ok = await confirmDialog({
          title: 'Cancelar reserva',
          message: '¿Está seguro de que desea cancelar esta reserva?',
          confirmText: 'Sí, cancelar',
          cancelText: 'No, mantenerla',
          danger: true
        });
        if (ok) {
          try {
            if (live) await ownerReservationApi.cancel(id); else reservationService.cancelReservation(id);
          } catch (err) {
            await alertDialog({ tone: 'danger', message: err.message });
          }
          store.setView('propietario-mis-reservas');
        }
      });
    });

    if (window.lucide) window.lucide.createIcons();
  }, 0);

  return container;
}
