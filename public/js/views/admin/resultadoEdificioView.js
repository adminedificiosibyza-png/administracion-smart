/* Resultado del edificio: cuánto entra (cuotas y otros ingresos) y cuánto sale (gastos pagados) en un mes */
import { activeBuilding } from '../../services/activeBuilding.js';
import { authService } from '../../services/authService.js';
import { isSupabaseConnected } from '../../supabaseClient.js';
import { maintenanceService, monthRange, periodText } from '../../services/maintenanceService.js';
import { openIncomeForm, openPaymentsModal, monthYearHTML, readMonthYear, esc } from '../../ui/mantenimientoModals.js';
import { alertDialog, confirmDialog } from '../../ui/dialog.js';
import { formatCurrency, formatDate } from '../../config.js';
import { createLedger } from './libroMovimientos.js';
import { exportBuildingResultPdf, exportBuildingLedgerPdf } from '../../services/resultPdf.js';

export function renderAdminResultado() {
  const container = document.createElement('div');
  container.className = 'fade-in';
  if (!isSupabaseConnected() || !authService.getContext()) {
    container.innerHTML = '<div class="card" style="max-width:640px;"><p>Este módulo solo está disponible con Supabase conectado.</p></div>';
    return container;
  }
  const building = activeBuilding.get();
  if (!building) return container;

  const now = new Date();
  let period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  let cash = null, incomes = [], ledger = null;

  async function openExpense(id) {
    try {
      const rows = await maintenanceService.loadBuildingExpenses(building.id);
      const r = rows.find(x => String(x.id) === String(id));
      if (!r) return alertDialog({ tone: 'warning', message: 'No se encontró el gasto.' });
      openPaymentsModal({ expense: r, readOnly: true });
    } catch (err) { alertDialog({ tone: 'danger', message: err.message }); }
  }

  async function draw() {
    container.innerHTML = '<div class="card" style="text-align:center; color: var(--text-dim);">Calculando...</div>';
    const y = Number(period.slice(0, 4)), m = Number(period.slice(5, 7));
    const { from, to } = monthRange(y, m);
    try { [cash, incomes] = await Promise.all([maintenanceService.cashSummary(from, to, building.id), maintenanceService.loadOtherIncome(building.id)]); }
    catch (err) {
      container.innerHTML = `<div class="card"><p class="form-error">${esc(err.message)}</p><button class="btn btn-primary btn-sm" id="rs-retry">Reintentar</button></div>`;
      container.querySelector('#rs-retry').onclick = draw;
      return;
    }
    container.innerHTML = `
      <div class="card" style="margin-bottom:1rem;">
        <div class="card-header">
          <h2 class="card-title"><i data-lucide="scale"></i> Resultado del Edificio — ${esc(building.name)}</h2>
          <div style="display:flex; gap:.5rem; flex-wrap:wrap;">
            <button class="btn btn-outline btn-sm" id="rs-income"><i data-lucide="plus"></i> Otro ingreso</button>
            <button class="btn btn-primary btn-sm" id="rs-pdf"><i data-lucide="file-text"></i> Exportar PDF</button>
          </div>
        </div>
        <p>Lo que entró y salió del edificio en el mes, por fecha de operación.</p>
        <div class="form-group" style="margin:1rem 0 0; max-width:300px;"><label class="form-label">Mes</label>${monthYearHTML('rs-period', period)}</div>
        <div class="metrics-strip" style="margin-top:1rem;">
          <div class="stat-item"><span class="stat-label">Cuotas cobradas</span><span class="stat-value" style="color: var(--primary);">${formatCurrency(cash.fees_collected)}</span></div>
          <div class="stat-item"><span class="stat-label">Otros ingresos</span><span class="stat-value">${formatCurrency(cash.other_income)}</span></div>
          <div class="stat-item"><span class="stat-label">Gastos pagados</span><span class="stat-value">${formatCurrency(cash.expenses_paid)}</span></div>
          <div class="stat-item"><span class="stat-label">Resultado del mes</span><span class="stat-value ${cash.period_result < 0 ? 'highlight-danger' : ''}" style="${cash.period_result >= 0 ? 'color: var(--primary);' : ''}">${formatCurrency(cash.period_result)}</span></div>
        </div>
        <div class="metrics-strip" style="margin-top:.75rem;">
          <div class="stat-item"><span class="stat-label">Obligaciones pendientes (a hoy)</span><span class="stat-value">${formatCurrency(cash.pending_obligations)}</span></div>
          <div class="stat-item"><span class="stat-label" style="color: var(--status-danger);">De ellas vencidas</span><span class="stat-value highlight-danger">${formatCurrency(cash.overdue_obligations)}</span></div>
        </div>
        <p class="cell-note" style="margin-top:.75rem;">Cuotas y gastos se cuentan por la <strong>fecha de operación</strong> (cuando se pagaron). Las cuotas pendientes no cuentan como dinero recibido ni los gastos pendientes como pagados. En gastos compartidos solo se descuenta la parte de este edificio. El saldo del banco está en "Caja General".</p>
      </div>
      <div class="card" style="margin-bottom:1rem;"><h3 class="card-title" style="font-size:1rem; margin-bottom:.75rem;"><i data-lucide="book-open"></i> Libro de movimientos — ${esc(periodText(period))}</h3><div id="rs-ledger"></div></div>
      <div class="card"><h3 class="card-title" style="font-size:1rem; margin-bottom:.75rem;">Otros ingresos de este edificio</h3>
        <div class="table-responsive"><table class="data-table report-table"><thead><tr><th>Fecha</th><th>Concepto</th><th>Importe</th><th style="text-align:right;">Acciones</th></tr></thead><tbody>
          ${incomes.length ? incomes.map(i => `<tr style="${i.status === 'ANULADO' ? 'opacity:.6;' : ''}"><td>${formatDate(i.income_date)}</td><td style="white-space:normal;">${esc(i.concept)}${i.status === 'ANULADO' ? ' <span class="badge badge-danger">Anulado</span>' : ''}</td>
            <td><strong>${formatCurrency(i.amount)}</strong></td><td style="text-align:right; white-space:nowrap;">${i.status === 'VALIDO' ? `<button class="btn btn-outline btn-sm" data-inc-edit="${i.id}"><i data-lucide="pencil"></i></button> <button class="btn btn-outline btn-sm" data-inc-void="${i.id}" style="color: var(--status-danger);"><i data-lucide="ban"></i></button>` : ''}</td></tr>`).join('')
            : '<tr><td colspan="4" style="text-align:center; color: var(--text-dim);">Sin otros ingresos registrados.</td></tr>'}</tbody></table></div></div>`;

    ledger = createLedger({
      showBuildingCol: false, onViewExpense: openExpense,
      // Sale lo que se ve en el libro (Todos = Estado de ingresos y egresos, Ingresos o Egresos, + filtros) y respeta el mes elegido arriba
      onExportPdf: ({ tab, rows, filtersText }) => exportBuildingLedgerPdf({ buildingName: building.name, periodText: periodText(period), tab, filtersText, rows, summary: cash })
    });
    container.querySelector('#rs-ledger').appendChild(ledger.el);
    ledger.load({ from, to, buildingId: building.id, summary: cash, showBalance: false });

    ['#rs-period-m', '#rs-period-y'].forEach(sel => container.querySelector(sel).onchange = () => { period = readMonthYear(container, 'rs-period') || period; draw(); });
    container.querySelector('#rs-income').onclick = () => openIncomeForm({ buildings: activeBuilding.list().filter(b => b.id === building.id), defaultBuildingId: building.id, allowGeneral: false, onSaved: draw });
    container.querySelectorAll('[data-inc-edit]').forEach(b => b.onclick = () => openIncomeForm({ income: incomes.find(i => i.id === b.dataset.incEdit), buildings: activeBuilding.list(), allowGeneral: false, onSaved: draw }));
    container.querySelectorAll('[data-inc-void]').forEach(b => b.onclick = async () => {
      if (!(await confirmDialog({ title: 'Anular ingreso', message: '¿Anular este ingreso? Queda marcado como anulado y no cuenta en los totales.', confirmText: 'Anular', danger: true }))) return;
      try { await maintenanceService.voidOtherIncome(b.dataset.incVoid); draw(); } catch (err) { alertDialog({ tone: 'danger', message: err.message }); }
    });
    container.querySelector('#rs-pdf').onclick = async (e) => {
      const btn = e.currentTarget; btn.disabled = true;
      try {
        // Se vuelve a pedir el libro para exportar siempre lo último guardado
        const fresh = createLedger({ showBuildingCol: false });
        await fresh.load({ from, to, buildingId: building.id, summary: cash, showBalance: false });
        if (fresh.lastError()) throw new Error(fresh.lastError());
        await exportBuildingResultPdf({ buildingName: building.name, periodText: periodText(period), rows: fresh.fullList(), summary: cash });
      } catch (err) { alertDialog({ tone: 'danger', title: 'No se pudo generar el PDF', message: err.message }); }
      finally { btn.disabled = false; }
    };
    if (window.lucide) window.lucide.createIcons();
  }

  draw();
  return container;
}
