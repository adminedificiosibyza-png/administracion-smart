/* Reporte financiero mensual del edificio activo (datos reales) con exportación a CSV */
import { feeService } from '../../services/feeService.js';
import { activeBuilding } from '../../services/activeBuilding.js';
import { periodLabel } from '../../mockData.js';
import { formatCurrency, formatDate } from '../../config.js';
import { exportFinancialReportPdf } from '../../services/reportPdf.js';
import { alertDialog } from '../../ui/dialog.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const STATUS_LABEL = { PAGADO: 'Pagado', PENDIENTE: 'Pendiente', POR_VERIFICAR: 'Por verificar', MORA_PENDIENTE: 'Mora pendiente' };

const unitSort = (a, b) => String(a.unit_code).localeCompare(String(b.unit_code), 'es', { numeric: true });

/** Una fila por departamento del mes, con las mismas definiciones del dashboard. */
function buildRows(monthFees, payments) {
  const { verified } = feeService._paymentIndex(payments);
  const lastPay = new Map(); // fee_id -> pago verificado más reciente
  payments.forEach(p => {
    if (!p.fee_id || p.status === 'RECHAZADO') return;
    const cur = lastPay.get(p.fee_id);
    if (!cur || String(p.payment_date) > String(cur.payment_date)) lastPay.set(p.fee_id, p);
  });

  // Pagos válidos de cada cuota, del más antiguo al más reciente (los anulados no entran)
  const paysByFee = new Map();
  payments.filter(p => p.fee_id && p.status !== 'RECHAZADO')
    .sort((a, b) => String(a.payment_date).localeCompare(String(b.payment_date)) || String(a.registered_at).localeCompare(String(b.registered_at)))
    .forEach(p => { if (!paysByFee.has(p.fee_id)) paysByFee.set(p.fee_id, []); paysByFee.get(p.fee_id).push({ amount: r2(p.amount), date: p.payment_date }); });

  return monthFees.slice().sort(unitSort).map(f => {
    const base = Number(f.fee_amount) || 0;
    const paid = verified.get(f.id);
    const totalPaid = paid != null ? paid : (f.status === 'PAGADO' ? base : 0);
    const mora = Number(f.interest_amount) || 0;
    const pending = f.status === 'PAGADO' ? 0 : Math.max(0, (Number(f.total_amount) || base) - (paid || 0));
    const last = lastPay.get(f.id);
    const statusInfo = feeService.statusInfo(f, totalPaid);
    // Cuota pagada sin registro de pago (datos antiguos): se muestra como un pago con la fecha de la cuota
    let pays = paysByFee.get(f.id) || [];
    if (!pays.length && totalPaid > 0 && f.payment_date) pays = [{ amount: r2(totalPaid), date: f.payment_date }];
    return {
      unit: f.unit_code, owner: String(f.owner_name || '').toLocaleUpperCase('es'),
      status: statusInfo.label, badge: statusInfo.badge, statusPdf: statusInfo.pdf,
      fee: r2(base), mora: r2(mora), paid: r2(totalPaid), pending: r2(pending),
      payDate: last ? last.payment_date : (f.payment_date || ''), method: last ? last.method : '',
      pays
    };
  });
}

/** Columnas de pago: siempre Pago 1; Pago 2, 3... solo si algún departamento tiene más de un pago. */
function payColumnLabels(rows) {
  const max = Math.max(1, ...rows.map(r => r.pays.length));
  return Array.from({ length: max }, (_, i) => i + 1);
}

function toCsv(buildingName, month, rows, summary) {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [
    [q('Reporte financiero'), q(buildingName), q(periodLabel(month))].join(','),
    '',
    ['Departamento', 'Titular', 'Estado', 'Cuota', 'Mora', 'Total pagado', 'Saldo pendiente',
      ...payColumnLabels(rows).flatMap(n => [`Pago ${n} (monto)`, `Pago ${n} (fecha)`])].map(q).join(','),
    ...rows.map(r => [q(r.unit), q(r.owner), q(r.status), r.fee.toFixed(2), r.mora.toFixed(2), r.paid.toFixed(2),
      r.pending.toFixed(2),
      ...payColumnLabels(rows).flatMap(n => r.pays[n - 1] ? [r.pays[n - 1].amount.toFixed(2), q(r.pays[n - 1].date)] : ['', '""'])].join(',')),
    '',
    [q('Cuota esperada'), '', '', summary.expected.toFixed(2)].join(','),
    [q('Cuota cobrada'), '', '', summary.collected.toFixed(2)].join(','),
    [q('Mora cobrada'), '', '', summary.moraCollected.toFixed(2)].join(','),
    [q('Mora por cobrar'), '', '', summary.moraInBalance.toFixed(2)].join(','),
    [q('Saldo pendiente'), '', '', summary.balance.toFixed(2)].join(','),
    [q('% de cobranza'), '', '', summary.percentage.toFixed(2)].join(',')
  ];
  return '﻿' + lines.join('\r\n'); // BOM para que Excel respete las tildes
}

function download(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function renderAdminReportesLive() {
  const container = document.createElement('div');
  container.className = 'fade-in';
  const building = activeBuilding.get();
  if (!building) return container;

  container.innerHTML = '<div class="card" style="text-align:center; color: var(--text-dim);">Cargando reporte...</div>';

  feeService.loadCobranza().then(raw => {
    const fees = raw.fees.filter(f => f.building_id === building.id);
    const feeIds = new Set(fees.map(f => f.id));
    const payments = raw.payments.filter(p => p.building_id === building.id || feeIds.has(p.fee_id));

    const months = [...new Set(fees.map(f => f.period_month))].sort().reverse();
    if (!months.length) {
      container.innerHTML = `<div class="card" style="text-align:center; color: var(--text-dim);">
        Este edificio aún no tiene cuotas generadas. Genere un mes desde "Listado de Cobranza" para ver su reporte.</div>`;
      return;
    }
    let month = feeService.getDefaultPeriod(fees);
    if (!months.includes(month)) month = months[0];
    let current = null;

    function draw() {
      const monthFees = fees.filter(f => f.period_month === month);
      const monthPayments = payments.filter(p => monthFees.some(f => f.id === p.fee_id));
      const summary = feeService.computeCollectionSummary(monthFees, payments);
      const rows = buildRows(monthFees, monthPayments);
      current = { rows, summary };

      container.querySelector('#rep-summary').innerHTML = `
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap:1rem;">
          <div class="stat-item"><span class="stat-label">Cuota esperada</span><span class="stat-value">${formatCurrency(summary.expected)}</span></div>
          <div class="stat-item"><span class="stat-label" style="color: var(--primary);">Cuota cobrada</span><span class="stat-value" style="color: var(--primary);">${formatCurrency(summary.collected)}</span></div>
          <div class="stat-item"><span class="stat-label">Mora cobrada</span><span class="stat-value">${formatCurrency(summary.moraCollected)}</span></div>
          <div class="stat-item"><span class="stat-label">Mora por cobrar</span><span class="stat-value">${formatCurrency(summary.moraInBalance)}</span></div>
          <div class="stat-item"><span class="stat-label" style="color: var(--status-danger);">Saldo pendiente</span><span class="stat-value" style="color: var(--status-danger);">${formatCurrency(summary.balance)}</span></div>
          <div class="stat-item"><span class="stat-label">% de cobranza</span><span class="stat-value">${summary.percentage.toFixed(2)} %</span></div>
        </div>`;

      // Columnas "Pago 1, Pago 2..." solo si algún departamento del mes tiene más de un pago
      const payCols = payColumnLabels(rows);
      container.querySelector('#rep-head').innerHTML = `<tr><th>Dpto.</th><th>Titular</th><th>Estado</th><th>Cuota</th><th>Mora</th><th>Total pagado</th><th>Saldo pendiente</th>${payCols.map(n => `<th>Pago ${n}</th>`).join('')}</tr>`;
      container.querySelector('#rep-body').innerHTML = rows.map(r => `
        <tr>
          <td><strong>${esc(r.unit)}</strong></td>
          <td>${esc(r.owner)}</td>
          <td><span class="badge ${r.badge}">${esc(r.status)}</span></td>
          <td>${formatCurrency(r.fee)}</td>
          <td>${formatCurrency(r.mora)}</td>
          <td>${formatCurrency(r.paid)}</td>
          <td>${formatCurrency(r.pending)}</td>
          ${payCols.map(n => `<td>${r.pays[n - 1]
            ? `${formatCurrency(r.pays[n - 1].amount)}<span class="cell-note">${formatDate(r.pays[n - 1].date)}</span>`
            : '<span style="color: var(--text-dim);">—</span>'}</td>`).join('')}
        </tr>`).join('');
      container.querySelector('#rep-title').textContent = `Resumen de ${periodLabel(month)}`;
    }

    container.innerHTML = `
      <div class="card" style="margin-bottom: 1.5rem;">
        <div class="card-header">
          <h2 class="card-title"><i data-lucide="file-text"></i> Reporte de Cuotas — ${esc(building.name)}</h2>
          <div style="display:flex; gap:0.5rem; flex-wrap:wrap; align-items:flex-end;">
            <label class="dash-select"><span>Período</span>
              <select id="rep-month" class="form-select">
                ${months.map(m => `<option value="${m}" ${m === month ? 'selected' : ''}>${esc(periodLabel(m))}</option>`).join('')}
              </select></label>
            <button class="btn btn-primary btn-sm" id="rep-csv"><i data-lucide="file-spreadsheet"></i> Exportar CSV</button>
            <button class="btn btn-primary btn-sm" id="rep-pdf"><i data-lucide="file-text"></i> Exportar PDF</button>
          </div>
        </div>
        <p>Cuota, mora, pagos y saldo de cada departamento en el mes elegido. Los totales usan las mismas definiciones del dashboard.</p>
      </div>

      <div class="card" style="margin-bottom: 1.5rem; border-left: 5px solid var(--primary);">
        <h3 class="card-title" id="rep-title" style="margin-bottom: 1rem;"></h3>
        <div id="rep-summary"></div>
      </div>

      <div class="card">
        <div class="table-responsive">
          <table class="data-table report-table">
            <thead id="rep-head"></thead>
            <tbody id="rep-body"></tbody>
          </table>
        </div>
      </div>`;

    container.querySelector('#rep-month').addEventListener('change', e => { month = e.target.value; draw(); });
    container.querySelector('#rep-csv').addEventListener('click', () => {
      download(`Reporte_${building.name.replace(/[^A-Za-z0-9]+/g, '_')}_${month.slice(0, 7)}.csv`,
        toCsv(building.name, month, current.rows, current.summary));
    });
    // Coherencia entre el resumen y el detalle antes de generar el documento
    function checkConsistency({ rows, summary }) {
      const sum = (arr, k) => r2(arr.reduce((s, r) => s + r[k], 0));
      const problems = [];
      if (Math.abs(sum(rows, 'fee') - summary.expected) > 0.01) problems.push('la cuota esperada no coincide con la suma del detalle');
      if (Math.abs(sum(rows, 'paid') - r2(summary.collected + summary.moraCollected)) > 0.01) problems.push('lo cobrado no coincide con la suma de pagos del detalle');
      const open = rows.filter(r => r.status !== 'Pagado' && r.status !== 'Por verificar');
      if (Math.abs(sum(open, 'pending') - summary.balance) > 0.01) problems.push('el saldo pendiente no coincide con el detalle');
      return problems;
    }

    container.querySelector('#rep-pdf').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (!current || !current.rows.length) {
        alertDialog({ tone: 'warning', message: 'No hay datos para exportar en el período seleccionado.' });
        return;
      }
      const problems = checkConsistency(current);
      if (problems.length) {
        alertDialog({ tone: 'danger', title: 'No se generó el PDF', message: `Los datos del reporte no son coherentes: ${problems.join('; ')}.` });
        return;
      }
      btn.disabled = true;
      try {
        await exportFinancialReportPdf({
          buildingName: building.name, periodText: periodLabel(month), rows: current.rows, summary: current.summary
        });
      } catch (err) {
        alertDialog({ tone: 'danger', message: err.message || 'No se pudo generar el PDF.' });
      } finally {
        btn.disabled = false;
      }
    });

    draw();
    if (window.lucide) window.lucide.createIcons();
  }).catch(err => {
    container.innerHTML = `<div class="card"><p style="color: var(--status-danger);">${esc(err.message)}</p></div>`;
  });

  return container;
}
