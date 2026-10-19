/* Propietario Dashboard View */
import { store } from '../../store.js';
import { authService } from '../../services/authService.js';
import { feeService } from '../../services/feeService.js';
import { formatCurrency, formatDate } from '../../config.js';
import { isSupabaseConnected } from '../../supabaseClient.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------- Con Supabase: cuotas reales del departamento activo ---------------- */

/** Un renglón por cada mes que se debe, del más antiguo al más reciente, con su total. */
function pendingTableHTML(status, payments = []) {
  const pending = status.allFees
    .filter(f => f.status === 'PENDIENTE' || f.status === 'POR_VERIFICAR' || f.status === 'MORA_PENDIENTE')
    .sort((a, b) => a.period_month.localeCompare(b.period_month));
  // Lo que falta por pagar de cada mes: total del mes menos los pagos parciales ya registrados
  const balance = f => Math.max(0, Math.round(((Number(f.total_pending) || 0) - feeService.paidForFee(f.id, payments)) * 100) / 100);
  const grandTotal = Math.round(pending.reduce((s, f) => s + balance(f), 0) * 100) / 100;
  return `
    <div class="table-responsive" style="margin-top: 1rem;">
      <table class="data-table table-cards">
        <thead><tr><th>Mes</th><th>Cuota</th><th>Vencimiento</th><th>Días de atraso</th><th>Interés moratorio</th><th>Total del mes</th></tr></thead>
        <tbody>
          ${pending.map(f => `
            <tr>
              <td><strong>${esc(f.period)}</strong> <span class="badge ${feeService.statusInfo(f, feeService.paidForFee(f.id, payments)).badge}">${feeService.statusInfo(f, feeService.paidForFee(f.id, payments)).label}</span></td>
              <td>${formatCurrency(f.fee_amount)}</td>
              <td>${formatDate(f.due_date)}</td>
              <td class="${f.days_late > 0 ? 'highlight-danger' : ''}">${f.days_late} ${f.days_late === 1 ? 'día' : 'días'}</td>
              <td class="${f.interest_amount > 0 ? 'highlight-danger' : ''}">${formatCurrency(f.interest_amount)}</td>
              <td><strong class="highlight-danger">${formatCurrency(balance(f))}</strong>${balance(f) < (Number(f.total_pending) || 0) ? `<div class="cell-note">Ya pagó ${formatCurrency(feeService.paidForFee(f.id, payments))}</div>` : ''}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr><td colspan="5" style="text-align:right;"><strong>Total adeudado</strong></td>
              <td><strong class="highlight-danger" style="font-size:1.15rem;">${formatCurrency(grandTotal)}</strong></td></tr>
        </tfoot>
      </table>
    </div>
    <div style="margin-top: 0.75rem; text-align: right;">
      <button class="btn btn-outline btn-sm" id="banner-go-fees"><i data-lucide="receipt"></i> Ver historial de cuotas y pagos</button>
    </div>`;
}

function liveBannerHTML(status, payments = []) {
  if (!status.hasFees) {
    return `
      <div class="fee-status-banner">
        <span class="fee-state-label">Estado de mi cuota actual</span>
        <div class="fee-state-value" style="color: var(--text-muted);">Sin cuotas todavía</div>
        <p style="margin-top: 0.35rem;">La administración aún no generó cuotas para este departamento.</p>
      </div>`;
  }

  if (status.isAlDia) {
    const last = status.allFees[0];
    return `
      <div class="fee-status-banner status-al-dia">
        <div class="fee-status-header">
          <div>
            <span class="fee-state-label">Estado de mi cuota actual</span>
            <div class="fee-state-value ok">Al día</div>
            <p style="margin-top: 0.35rem;">No registra cuotas pendientes de pago. Gracias por mantener sus pagos al día.</p>
          </div>
          <span class="badge badge-success"><i data-lucide="check"></i> ${formatCurrency(0)} pendiente</span>
        </div>
        <div class="fee-debt-breakdown">
          <div class="stat-item"><span class="stat-label">Último período</span><span class="stat-value">${esc(last.period)}</span></div>
          <div class="stat-item"><span class="stat-label">Monto cuota</span><span class="stat-value">${formatCurrency(last.fee_amount)}</span></div>
          <div class="stat-item"><span class="stat-label">Estado</span><span class="stat-value" style="color: var(--primary);">Pagado</span></div>
        </div>
      </div>`;
  }

  const p = status.activePending;
  const verifying = p.status === 'POR_VERIFICAR';
  return `
    <div class="fee-status-banner status-pendiente">
      <div class="fee-status-header">
        <div>
          <span class="fee-state-label">Estado de mi cuota actual</span>
          <div class="fee-state-value ${verifying ? '' : 'late'}" ${verifying ? 'style="color: var(--status-warning);"' : ''}>${verifying ? 'Pago por verificar' : 'Pendiente'}</div>
          <p style="margin-top: 0.35rem;">${status.pendingCount > 1
            ? `Tiene ${status.pendingCount} cuotas pendientes. Revise abajo el saldo de cada mes.`
            : (verifying ? 'Su pago está siendo verificado por la administración.' : 'Tiene una cuota pendiente de pago.')}</p>
        </div>
        <span class="badge ${verifying ? 'badge-warning' : 'badge-danger'}">${verifying ? 'Por verificar' : (p.days_late > 0 ? 'Vencida' : 'Por vencer')}</span>
      </div>
      ${pendingTableHTML(status, payments)}
    </div>`;
}

async function renderLiveDashboard(user) {
  const container = document.createElement('div');
  container.className = 'fade-in';

  let bannerHTML;
  if (!user.unitId) {
    bannerHTML = `<div class="card" style="margin-bottom: 1.5rem;"><p>Todavía no tiene un departamento asignado. Comuníquese con la administración.</p></div>`;
  } else if (!user.canViewFees) {
    bannerHTML = `
      <div class="card" style="margin-bottom: 1.5rem;">
        <h3 class="card-title" style="margin-bottom: 0.4rem;"><i data-lucide="lock"></i> Información de cuotas no disponible</h3>
        <p>Su cuenta no tiene habilitada la consulta de cuotas y pagos de este departamento. Si necesita verla, comuníquese con la administración.</p>
      </div>`;
  } else {
    try {
      const { fees, payments } = await feeService.loadUnitFees(user.unitId);
      bannerHTML = liveBannerHTML(feeService.buildFeeStatus(fees), payments);
    } catch (err) {
      bannerHTML = `<div class="card" style="margin-bottom: 1.5rem;"><p style="color: var(--status-danger);">${esc(err.message)}</p></div>`;
    }
  }

  container.innerHTML = `
    <div class="portal-hero">
      <div class="portal-hero-title">
        <h2>Bienvenido al Portal de Propietarios</h2>
        <p>Edificio <strong>${esc(user.buildingName)}</strong> • Residente: <strong>${esc(user.name)}</strong></p>
      </div>
      ${user.unit ? `<div class="unit-pill"><i data-lucide="home"></i> Dpto ${esc(user.unit)}</div>` : ''}
    </div>

    ${bannerHTML}
  `;

  container.querySelector('#banner-go-fees')?.addEventListener('click', () => store.setView('propietario-cuotas'));
  setTimeout(() => { if (window.lucide) window.lucide.createIcons(); }, 0);
  return container;
}

export async function renderPropietarioDashboard() {
  const user = await authService.getCurrentUser();
  if (isSupabaseConnected() && authService.getContext()) return renderLiveDashboard(user);
  const feeStatus = feeService.getUnitFeeStatus(user.unit);

  const container = document.createElement('div');
  container.className = 'fade-in';

  // Fee Status Banner HTML logic
  let statusBannerHTML = '';
  const currentFee = feeStatus.activePending || feeStatus.allFees[0] || null;
  if (feeStatus.isAlDia) {
    statusBannerHTML = `
      <div class="fee-status-banner status-al-dia">
        <div class="fee-status-header">
          <div>
            <span class="fee-state-label">Estado de mi cuota actual</span>
            <div class="fee-state-value ok">Al día</div>
            <p style="margin-top: 0.35rem;">No registras cuotas pendientes de pago. Gracias por mantener tus pagos al día.</p>
          </div>
          <span class="badge badge-success"><i data-lucide="check"></i> ${formatCurrency(0)} pendiente</span>
        </div>
        ${currentFee ? `
        <div class="fee-debt-breakdown">
          <div class="stat-item"><span class="stat-label">Mes / Período</span><span class="stat-value">${currentFee.period}</span></div>
          <div class="stat-item"><span class="stat-label">Monto Cuota</span><span class="stat-value">${formatCurrency(currentFee.fee_amount)}</span></div>
          <div class="stat-item"><span class="stat-label">Estado</span><span class="stat-value" style="color: var(--primary);">Pagado</span></div>
        </div>` : ''}
      </div>
    `;
  } else {
    const pending = feeStatus.activePending;
    statusBannerHTML = `
      <div class="fee-status-banner status-pendiente">
        <div class="fee-status-header">
          <div>
            <span class="fee-state-label">Estado de mi cuota actual</span>
            <div class="fee-state-value late">Pendiente</div>
            <p style="margin-top: 0.35rem;">Tienes una cuota pendiente de pago.</p>
          </div>
          <span class="badge badge-danger">${pending.days_late > 0 ? 'Vencida' : 'Por vencer'}</span>
        </div>

        <div class="fee-debt-breakdown">
          <div class="stat-item">
            <span class="stat-label">Mes / Período</span>
            <span class="stat-value">${pending.period}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Monto Cuota</span>
            <span class="stat-value">${formatCurrency(pending.fee_amount)}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Fecha Vencimiento</span>
            <span class="stat-value">${formatDate(pending.due_date)}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Días de atraso</span>
            <span class="stat-value highlight-danger">${pending.days_late} días</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Interés Moratorio</span>
            <span class="stat-value highlight-danger">${formatCurrency(pending.interest_amount)}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Total Pendiente</span>
            <span class="stat-value highlight-danger" style="font-size: 1.3rem;">
              ${formatCurrency(pending.total_pending)}
            </span>
          </div>
        </div>
      </div>
    `;
  }
  container.innerHTML = `
    <!-- Hero Banner -->
    <div class="portal-hero">
      <div class="portal-hero-title">
        <h2>Bienvenido al Portal de Propietarios</h2>
        <p>Edificio <strong>PARKE10</strong> • Residente: <strong>${user.name}</strong></p>
      </div>
      <div class="unit-pill">
        <i data-lucide="home"></i> Dpto ${user.unit}
      </div>
    </div>

    <!-- Fee Status Banner -->
    ${statusBannerHTML}
  `;

  setTimeout(() => { if (window.lucide) window.lucide.createIcons(); }, 0);

  return container;
}
