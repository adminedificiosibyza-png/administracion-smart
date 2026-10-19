/* Propietario Maintenance Fees & Payments History View */
import { store } from '../../store.js';
import { feeService } from '../../services/feeService.js';
import { authService } from '../../services/authService.js';
import { formatCurrency, formatDate } from '../../config.js';
import { isSupabaseConnected } from '../../supabaseClient.js';
import { openAppModal } from '../../ui/credentials.js';
import { alertDialog } from '../../ui/dialog.js';
import { paymentInfoService, copyText } from '../../services/paymentInfoService.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------- Con Supabase: cuotas y pagos reales del departamento activo ---------------- */

async function renderLiveCuotas(user) {
  const container = document.createElement('div');
  container.className = 'fade-in';

  const message = (icon, title, text, color = '') => {
    container.innerHTML = `
      <div class="card" style="max-width: 640px;">
        <h2 class="card-title" style="margin-bottom: 0.5rem; ${color}"><i data-lucide="${icon}"></i> ${title}</h2>
        <p>${text}</p>
      </div>`;
    setTimeout(() => { if (window.lucide) window.lucide.createIcons(); }, 0);
    return container;
  };

  if (!user.unitId) return message('home', 'Sin departamento asignado', 'Todavía no tiene un departamento asignado. Comuníquese con la administración.');
  if (!user.canViewFees) return message('lock', 'Información no disponible', 'Su cuenta no tiene habilitada la consulta de cuotas y pagos de este departamento. Si necesita verla, comuníquese con la administración.');

  let fees, payments;
  try {
    ({ fees, payments } = await feeService.loadUnitFees(user.unitId));
  } catch (err) {
    return message('alert-triangle', 'No se pudo cargar', esc(err.message), 'color: var(--status-danger);');
  }

  // Datos de pago del edificio (si falla, la pantalla sigue funcionando sin ese bloque)
  let payInfo = null;
  try {
    const active = authService.getActiveAssignment();
    if (active) payInfo = await paymentInfoService.load(active.building_id);
  } catch (err) { console.warn('Datos de pago no disponibles:', err.message); }

  const copyBtn = (value, label) => value
    ? `<button class="btn-copy" data-copy="${esc(value)}" title="Copiar ${esc(label)}"><i data-lucide="copy"></i> Copiar</button>` : '';
  // Fila simple: etiqueta pequeña, valor y botón de copiar a la derecha
  const payRow = (label, value, copiable = true) => value
    ? `<div class="pay-row"><div class="pay-row-main"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>${copiable ? copyBtn(value, label) : ''}</div>` : '';
  const waLink = payInfo ? paymentInfoService.whatsappLink(payInfo.whatsapp, paymentInfoService.receiptMessage(user.buildingName)) : null;
  const payHTML = (payInfo && (payInfo.accounts.length || payInfo.whatsapp)) ? `
    <section class="pay-section">
      <h3 class="pay-heading"><i data-lucide="landmark"></i> ¿Dónde pagar mi cuota?</h3>
      <div class="pay-layout">
        <div class="pay-accounts">
          ${payInfo.accounts.map(a => `
            <article class="pay-card">
              <header class="pay-card-head">
                <span class="pay-card-icon"><i data-lucide="landmark"></i></span>
                <div>
                  <h4>${esc(a.bank)}</h4>
                </div>
              </header>
              ${payRow('Titular de la cuenta', a.account_holder, false)}
              ${payRow('N° de cuenta', a.account_number)}
              ${payRow('CCI (interbancaria)', a.cci)}
            </article>`).join('')}
        </div>
        ${payInfo.whatsapp ? `
        <article class="pay-card pay-wa">
          <header class="pay-card-head">
            <span class="pay-card-icon"><i data-lucide="message-circle"></i></span>
            <div>
              <h4>Envía tu comprobante</h4>
              <p>Indica tu departamento y el mes que estás pagando</p>
            </div>
          </header>
          <div class="pay-wa-number">${esc(payInfo.whatsapp)}</div>
          <div class="pay-wa-actions">
            ${copyBtn(payInfo.whatsapp, 'WhatsApp').replace('btn-copy', 'btn-copy btn-copy-block')}
            ${waLink ? `<a class="btn btn-primary pay-wa-open" href="${waLink}" target="_blank" rel="noopener"><i data-lucide="send"></i> Abrir WhatsApp</a>` : ''}
          </div>
          <p class="pay-wa-hint">La administración puede demorar hasta 24 horas en registrar tu pago; luego figurará en tu historial.</p>
        </article>` : ''}
      </div>
      ${payInfo.note ? `<p class="pay-note"><i data-lucide="info"></i><span>${esc(payInfo.note)}</span></p>` : ''}
    </section>` : '';

  const status = feeService.buildFeeStatus(fees);
  // Saldo adeudado real: descuenta los pagos parciales ya registrados
  const pendingBalance = Math.round(fees.filter(f => f.status === 'PENDIENTE' || f.status === 'POR_VERIFICAR' || f.status === 'MORA_PENDIENTE')
    .reduce((s, f) => s + Math.max(0, (Number(f.total_pending) || 0) - feeService.paidForFee(f.id, payments)), 0) * 100) / 100;
  // Todos los pagos válidos de la cuota, del más antiguo al más reciente (los anulados no llegan al propietario)
  const paymentsFor = fee => payments
    .filter(p => p.fee_id === fee.id && p.status !== 'RECHAZADO')
    .sort((a, b) => String(a.payment_date).localeCompare(String(b.payment_date)));
  const feeBadge = fee => {
    const info = feeService.statusInfo(fee, feeService.paidForFee(fee.id, payments));
    return `<span class="badge ${info.badge}">${info.label}</span>`;
  };

  const header = !status.hasFees
    ? '<span class="badge badge-neutral">SIN CUOTAS</span>'
    : `<span class="badge ${status.isAlDia ? 'badge-success' : 'badge-danger'}">${status.isAlDia ? 'AL DÍA' : 'PENDIENTE'}</span>`;

  container.innerHTML = `
    <div class="card" style="margin-bottom: 1.5rem;">
      <div class="card-header">
        <h2 class="card-title"><i data-lucide="dollar-sign"></i> Cuotas de Mantenimiento y Pagos</h2>
        ${header}
      </div>
      <p>Historial de cuotas del Dpto ${esc(user.unit)} (${esc(user.buildingName)}): vencimientos, intereses aplicados y pagos registrados.
        ${status.pendingCount ? ` Tiene <strong>${status.pendingCount}</strong> cuota(s) pendiente(s) por <strong>${formatCurrency(pendingBalance)}</strong>.` : ''}</p>
    </div>

    ${payHTML}

    <div class="card">
      <h3 class="card-title" style="margin-bottom: 1rem;"><i data-lucide="receipt"></i> Historial por períodos (Dpto ${esc(user.unit)})</h3>
      <div class="table-responsive">
        <table class="data-table cobranza-table table-cards">
          <thead>
            <tr>
              <th>Período</th><th>Vencimiento</th><th>Cuota base</th><th>Días de atraso</th>
              <th>Interés moratorio</th><th>Total a pagar</th><th>Estado</th><th>Pago registrado</th><th style="text-align:right;">Comprobante</th>
            </tr>
          </thead>
          <tbody>
            ${fees.length ? status.allFees.map(fee => {
              const pays = paymentsFor(fee);
              const paidSoFar = pays.reduce((s, p) => s + (Number(p.amount) || 0), 0);
              const partial = fee.status !== 'PAGADO' && paidSoFar > 0;
              return `
              <tr>
                <td><strong>${esc(fee.period)}</strong></td>
                <td>${formatDate(fee.due_date)}</td>
                <td>${formatCurrency(fee.fee_amount)}</td>
                <td>${fee.days_late > 0 ? `<span style="color: var(--status-danger); font-weight: 700;">${fee.days_late} ${fee.days_late === 1 ? 'día' : 'días'}</span>` : '<span style="color: var(--text-dim);">0 días</span>'}</td>
                <td>${fee.interest_amount > 0 ? `<span style="color: var(--status-danger); font-weight: 700;">${formatCurrency(fee.interest_amount)}</span>` : formatCurrency(0)}</td>
                <td><strong>${formatCurrency(fee.total_amount)}</strong>${partial
                  ? `<span class="cell-note">Pagado ${formatCurrency(paidSoFar)} · Saldo ${formatCurrency(Math.max(0, fee.total_amount - paidSoFar))}</span>` : ''}</td>
                <td>${feeBadge(fee)}</td>
                <td>${pays.length
                  ? pays.map(p => `<div>${formatDate(p.payment_date)}<span class="cell-note">${esc(p.method)} · ${formatCurrency(p.amount)}</span></div>`).join('')
                  : (fee.payment_date ? `${formatDate(fee.payment_date)}` : '<span style="color: var(--text-dim);">—</span>')}</td>
                <td style="text-align:right;">${pays.some(p => p.proof_file_path)
                  ? pays.filter(p => p.proof_file_path).map((p, i, arr) =>
                      `<div><button class="btn btn-outline btn-sm btn-proof" data-payment="${esc(p.id)}"><i data-lucide="paperclip"></i> Ver${arr.length > 1 ? ` ${i + 1}` : ''}</button></div>`).join('')
                  : '<span style="color: var(--text-dim);">—</span>'}</td>
              </tr>`;
            }).join('') : `<tr><td colspan="9" style="text-align:center; color: var(--text-dim);">La administración aún no generó cuotas para este departamento.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`;

  // Botones "Copiar": cambian a "Copiado" un momento
  container.querySelectorAll('.btn-copy').forEach(btn => btn.addEventListener('click', async () => {
    const ok = await copyText(btn.dataset.copy);
    const original = btn.innerHTML;
    btn.innerHTML = ok ? '<i data-lucide="check"></i> Copiado' : 'No se pudo copiar';
    btn.classList.toggle('copied', ok);
    if (window.lucide) window.lucide.createIcons();
    setTimeout(() => { btn.innerHTML = original; btn.classList.remove('copied'); if (window.lucide) window.lucide.createIcons(); }, 1500);
  }));

  // Comprobante de solo lectura: ver y descargar (la base de datos solo lo entrega si es de su departamento)
  container.querySelectorAll('.btn-proof').forEach(btn => btn.addEventListener('click', async () => {
    const pay = payments.find(p => String(p.id) === btn.dataset.payment);
    if (!pay) return;
    const modal = openAppModal('<i data-lucide="paperclip" style="color: var(--primary);"></i> Comprobante de pago',
      '<div class="proof-view">Cargando comprobante...</div>');
    try {
      const access = await feeService.getProofAccess(pay);
      document.getElementById('modal-body').innerHTML = `
        <div class="fee-info-box">
          <div><span>Período</span><strong>${esc(pay.period)}</strong></div>
          <div><span>Monto</span><strong>${formatCurrency(pay.amount)}</strong></div>
          <div><span>Fecha de pago</span><strong>${formatDate(pay.payment_date)}</strong></div>
          <div><span>Método</span><strong>${esc(pay.method)}</strong></div>
        </div>
        <div class="proof-view">${access.isImage
          ? `<img src="${access.url}" alt="Comprobante" class="proof-full">`
          : `<iframe src="${access.url}" class="proof-frame" title="Comprobante PDF"></iframe>`}</div>
        <div style="display:flex; justify-content:flex-end; margin-top:1rem;">
          <a class="btn btn-primary btn-sm" href="${access.downloadUrl}" download="${esc(access.name)}" target="_blank" rel="noopener"><i data-lucide="download"></i> Descargar</a>
        </div>`;
      if (window.lucide) window.lucide.createIcons();
    } catch (err) {
      modal.close();
      alertDialog({ tone: 'danger', message: err.message });
    }
  }));

  setTimeout(() => { if (window.lucide) window.lucide.createIcons(); }, 0);
  return container;
}

export async function renderPropietarioCuotasPagos() {
  const user = await authService.getCurrentUser();
  if (isSupabaseConnected() && authService.getContext()) return renderLiveCuotas(user);
  const feeStatus = feeService.getUnitFeeStatus(user.unit);

  const container = document.createElement('div');
  container.className = 'fade-in';

  container.innerHTML = `
    <div class="card" style="margin-bottom: 1.5rem;">
      <div class="card-header">
        <h2 class="card-title"><i data-lucide="dollar-sign"></i> Cuotas de Mantenimiento y Pagos</h2>
        <span class="badge ${feeStatus.isAlDia ? 'badge-success' : 'badge-danger'}">
          ${feeStatus.isAlDia ? 'AL DÍA' : 'PENDIENTE'}
        </span>
      </div>
      <p>Revisa el historial de cuotas mensuales, vencimientos, intereses aplicados y registro de pagos.</p>
    </div>

    <!-- Fees Table -->
    <div class="card">
      <h3 class="card-title" style="margin-bottom: 1rem;">
        <i data-lucide="receipt"></i> Historial por Períodos (Dpto ${user.unit})
      </h3>

      <div class="table-responsive">
        <table class="data-table table-cards">
          <thead>
            <tr>
              <th>Período</th>
              <th>Vencimiento</th>
              <th>Cuota Base</th>
              <th>Días Atraso</th>
              <th>Interés Moratorio</th>
              <th>Total a Pagar</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            ${feeStatus.allFees.map(fee => `
              <tr>
                <td><strong>${fee.period}</strong></td>
                <td>${formatDate(fee.due_date)}</td>
                <td>${formatCurrency(fee.fee_amount)}</td>
                <td>${fee.days_late > 0 ? `<span style="color: var(--status-danger); font-weight: 700;">${fee.days_late} días</span>` : '-'}</td>
                <td>${fee.interest_amount > 0 ? `<span style="color: var(--status-danger); font-weight: 700;">${formatCurrency(fee.interest_amount)}</span>` : 'S/ 0.00'}</td>
                <td><strong>${formatCurrency(fee.total_amount)}</strong></td>
                <td>
                  <span class="badge ${fee.status === 'PAGADO' ? 'badge-success' : (fee.status === 'POR_VERIFICAR' ? 'badge-warning' : 'badge-danger')}">
                    ${fee.status === 'PAGADO' ? 'Pagado' : (fee.status === 'POR_VERIFICAR' ? 'Por Verificar' : 'Vencido')}
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
    if (window.lucide) window.lucide.createIcons();
  }, 0);

  return container;
}
