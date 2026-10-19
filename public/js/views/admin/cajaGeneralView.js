/* Caja general de la administración: una sola cuenta para todos los edificios (solo superadmin) */
import { activeBuilding } from '../../services/activeBuilding.js';
import { authService } from '../../services/authService.js';
import { isSupabaseConnected } from '../../supabaseClient.js';
import { maintenanceService, monthRange, periodText } from '../../services/maintenanceService.js';
import { openExpenseForm, openProvidersModal, openPaymentsModal, openIncomeForm, esc } from '../../ui/mantenimientoModals.js';
import { openAppModal } from '../../ui/credentials.js';
import { alertDialog, confirmDialog, promptDialog } from '../../ui/dialog.js';
import { formatCurrency, formatDate } from '../../config.js';
import { createLedger } from './libroMovimientos.js';
import { exportCashGeneralPdf } from '../../services/resultPdf.js';
import { fromAllRow, newFilters, filtersHTML, bindFilters, applyFilters, tableHTML, bindTableActions, exportExpensesCsv, filterPeriodLabel } from './mantenimientoShared.js';

const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });

export function renderAdminCajaGeneral() {
  const container = document.createElement('div');
  container.className = 'fade-in';
  if (!isSupabaseConnected() || !authService.getContext()) {
    container.innerHTML = '<div class="card" style="max-width:640px;"><p>La caja general solo está disponible con Supabase conectado.</p></div>';
    return container;
  }
  if (!authService.isSuperadmin()) {
    container.innerHTML = '<div class="card" style="max-width:640px;"><p>La caja general solo la ve el superadministrador.</p></div>';
    return container;
  }

  const buildings = activeBuilding.list();
  const byId = new Map(buildings.map(b => [b.id, b]));
  let providers = [], expenses = [], incomes = [], account = null, cash = null;
  const f = newFilters();
  let ledgerKey = '', ledgerTick = 0;
  const ledger = createLedger({ showBuildingCol: true, onViewExpense: (id) => { const r = expenses.find(x => String(x.id) === String(id)); if (r) openPaymentsModal({ readOnly: true, expense: { ...r.raw, expense_id: r.id } }); else alertDialog({ tone: 'warning', message: 'No se encontró el gasto.' }); } });

  function range() {
    if (f.month) return monthRange(Number(f.year) || new Date().getFullYear(), Number(f.month));
    if (f.year) return { from: `${f.year}-01-01`, to: `${f.year}-12-31` };
    return { from: (account && account.opening_date) || '2000-01-01', to: todayStr() };
  }
  const periodLabel = () => (f.month && !f.year) ? `${filterPeriodLabel(f).replace(' (todos los años)', '')} de ${new Date().getFullYear()}`
    : (f.month || f.year ? filterPeriodLabel(f) : 'Todo el tiempo');

  async function loadAll() {
    container.innerHTML = '<div class="card" style="text-align:center; color: var(--text-dim);">Cargando caja general...</div>';
    try {
      const [p, e, a, inc] = await Promise.all([maintenanceService.loadProviders(), maintenanceService.loadAllExpenses(), maintenanceService.loadCashAccount(), maintenanceService.loadOtherIncome()]);
      providers = p; expenses = e.map(r => fromAllRow(r, byId)); account = a; incomes = inc;
      await draw();
    } catch (err) {
      container.innerHTML = `<div class="card" style="text-align:center;"><p style="color: var(--status-danger); margin-bottom:1rem;">${esc(err.message)}</p><button class="btn btn-primary btn-sm" id="cg-retry">Reintentar</button></div>`;
      container.querySelector('#cg-retry').onclick = loadAll;
    }
  }
  async function reloadData() {
    const [e, a, inc] = await Promise.all([maintenanceService.loadAllExpenses(), maintenanceService.loadCashAccount(), maintenanceService.loadOtherIncome()]);
    expenses = e.map(r => fromAllRow(r, byId)); account = a; incomes = inc;
  }
  const refresh = async () => { await reloadData(); ledgerTick++; await draw(); };

  async function draw(onlyBody = false) {
    const { from, to } = range();
    try { cash = await maintenanceService.cashSummary(from, to, f.building || null); }
    catch (err) { cash = null; var summaryError = err.message; }

    const money = (n) => formatCurrency(n);
    const summary = !cash ? `<p class="form-error">${esc(summaryError)}</p>` : (f.building ? `
      <div class="metrics-strip">
        <div class="stat-item"><span class="stat-label">Cuotas cobradas</span><span class="stat-value" style="color: var(--primary);">${money(cash.fees_collected)}</span></div>
        <div class="stat-item"><span class="stat-label">Otros ingresos</span><span class="stat-value">${money(cash.other_income)}</span></div>
        <div class="stat-item"><span class="stat-label">Gastos pagados (su parte)</span><span class="stat-value">${money(cash.expenses_paid)}</span></div>
        <div class="stat-item"><span class="stat-label">Resultado del edificio</span><span class="stat-value ${cash.period_result < 0 ? 'highlight-danger' : ''}" style="${cash.period_result >= 0 ? 'color: var(--primary);' : ''}">${money(cash.period_result)}</span></div>
      </div>` : `
      ${!cash.account_configured ? `<div class="form-warning" style="margin-bottom:1rem;"><strong>Falta configurar la cuenta.</strong> Indique el saldo inicial de la cuenta de la administración para calcular el saldo estimado del banco.
        <button class="btn btn-primary btn-sm" id="cg-config" style="margin-left:.5rem;">Configurar cuenta</button></div>` : ''}
      <div class="metrics-strip">
        <div class="stat-item"><span class="stat-label">Saldo al inicio</span><span class="stat-value">${cash.opening_balance != null ? money(cash.opening_balance) : '—'}</span></div>
        <div class="stat-item"><span class="stat-label" style="color: var(--primary);">+ Cuotas cobradas</span><span class="stat-value" style="color: var(--primary);">${money(cash.fees_collected)}</span></div>
        <div class="stat-item"><span class="stat-label" style="color: var(--primary);">+ Otros ingresos</span><span class="stat-value" style="color: var(--primary);">${money(cash.other_income)}</span></div>
        <div class="stat-item"><span class="stat-label" style="color: var(--status-danger);">− Gastos pagados</span><span class="stat-value highlight-danger">${money(cash.expenses_paid)}</span></div>
        <div class="stat-item"><span class="stat-label">Saldo estimado al cierre</span><span class="stat-value" style="font-size:1.3rem;">${cash.closing_balance != null ? money(cash.closing_balance) : '—'}</span></div>
      </div>`);
    const pendings = cash ? `
      <div class="metrics-strip" style="margin-top:.75rem;">
        <div class="stat-item"><span class="stat-label">Obligaciones pendientes (a hoy)</span><span class="stat-value">${money(cash.pending_obligations)}</span></div>
        <div class="stat-item"><span class="stat-label" style="color: var(--status-danger);">De ellas vencidas</span><span class="stat-value highlight-danger">${money(cash.overdue_obligations)}</span></div>
      </div>` : '';
    const breakdown = (cash && !f.building && cash.by_building) ? `
      <div class="table-responsive" style="margin-top:1rem;"><table class="data-table report-table"><thead><tr><th>Edificio</th><th>Cuotas cobradas</th><th>Otros ingresos</th><th>Gastos pagados</th><th>Resultado</th></tr></thead><tbody>
        ${cash.by_building.map(b => `<tr><td><strong>${esc(b.name)}</strong></td><td>${money(b.fees)}</td><td>${money(b.other)}</td><td>${money(b.spent)}</td><td><strong style="${b.result < 0 ? 'color: var(--status-danger);' : 'color: var(--primary);'}">${money(b.result)}</strong></td></tr>`).join('')}
        <tr><td><strong>General</strong></td><td>—</td><td>${money(cash.general_income)}</td><td>${money(cash.general_expenses)}</td>
          <td><strong style="${cash.general_income - cash.general_expenses < 0 ? 'color: var(--status-danger);' : ''}">${money(cash.general_income - cash.general_expenses)}</strong></td></tr>
      </tbody></table></div>` : '';

    const rows = applyFilters(expenses, f);
    const inRange = incomes.filter(i => (!f.building || i.building_id === f.building)
      && (!f.year || i.income_date.slice(0, 4) === f.year) && (!f.month || i.income_date.slice(5, 7) === f.month));

    if (!onlyBody) {
      container.innerHTML = `
        <div class="card" style="margin-bottom:1.5rem;">
          <div class="card-header">
            <h2 class="card-title"><i data-lucide="landmark"></i> Caja general${account ? ` — ${esc(account.name)}` : ''}</h2>
            <div style="display:flex; gap:.5rem; flex-wrap:wrap;">
              <button class="btn btn-outline btn-sm" id="cg-account"><i data-lucide="settings"></i> Cuenta y saldo inicial</button>
              <button class="btn btn-outline btn-sm" id="cg-providers"><i data-lucide="truck"></i> Proveedores</button>
              <button class="btn btn-outline btn-sm" id="cg-income"><i data-lucide="plus"></i> Otro ingreso</button>
              <button class="btn btn-primary btn-sm" id="cg-expense"><i data-lucide="plus-circle"></i> Nuevo gasto</button>
              <button class="btn btn-sm btn-pdf" id="cg-pdf"><i data-lucide="file-text"></i> Exportar PDF</button>
            </div>
          </div>
          <p>Una sola cuenta para todos los edificios. Elija un edificio para ver solo su parte. Las cuotas y los gastos se cuentan por la fecha en que se pagaron.</p>
          ${filtersHTML(f, { rows: expenses, providers, buildings, parts: 'top' })}
        </div>
        <div id="cg-body"></div>`;
      bindFilters(container, f, () => draw(true));
      container.querySelector('#cg-account').onclick = openAccountForm;
      container.querySelector('#cg-pdf').onclick = async (e) => {
        const btn = e.currentTarget; btn.disabled = true;
        try {
          const { from, to } = range();
          const buildingId = f.building || null;
          if (!f.year && !f.month && !account) throw new Error('Configure primero la cuenta y el saldo inicial, o elija un mes.');
          const summary = await maintenanceService.cashSummary(from, to, buildingId);
          const fresh = createLedger({ showBuildingCol: true });
          await fresh.load({ from, to, buildingId, summary, showBalance: !buildingId });
          if (fresh.lastError()) throw new Error(fresh.lastError());
          await exportCashGeneralPdf({ periodText: periodLabel(), rows: fresh.fullList(), summary, buildingName: buildingId ? (byId.get(buildingId) || {}).name : null });
        } catch (err) { alertDialog({ tone: 'danger', title: 'No se pudo generar el PDF', message: err.message }); }
        finally { btn.disabled = false; }
      };
      container.querySelector('#cg-providers').onclick = () => openProvidersModal({ providers, onChange: (l) => { providers = l; draw(); } });
      container.querySelector('#cg-income').onclick = () => openIncomeForm({ buildings, defaultBuildingId: f.building, allowGeneral: true, onSaved: refresh });
      container.querySelector('#cg-expense').onclick = () => openExpenseForm({ buildings, defaultBuildingId: f.building || (buildings[0] && buildings[0].id), allowGeneral: true, providers, onSaved: refresh });
    }
    const body = container.querySelector('#cg-body');
    body.innerHTML = `
      <div class="card" style="margin-bottom:1.5rem;"><h3 class="card-title" style="font-size:1rem; margin-bottom:.75rem;">Resumen — ${esc(periodLabel())}${f.building ? ` · ${esc((byId.get(f.building) || {}).name || '')}` : ' · todos los edificios'}</h3>${summary}${pendings}${breakdown}
        ${cash && cash.before_opening && (cash.before_opening.fees || cash.before_opening.other || cash.before_opening.spent) ? `<p class="cell-note" style="margin-top:.5rem;">Antes del ${formatDate(cash.opening_date)} hubo cuotas cobradas por ${money(cash.before_opening.fees)}, otros ingresos por ${money(cash.before_opening.other)} y gastos pagados por ${money(cash.before_opening.spent)}: ya están incluidos en el saldo inicial y por eso no se suman al saldo de la cuenta.</p>` : ''}
        ${cash && cash.account_configured && !f.building && cash.effective_from > cash.from ? `<p class="cell-note" style="margin-top:.5rem;">La cuenta empieza el ${formatDate(cash.opening_date)}; lo anterior ya está incluido en el saldo inicial.</p>` : ''}</div>
      <div class="card" style="margin-bottom:1.5rem;"><h3 class="card-title" style="font-size:1rem; margin-bottom:.75rem;"><i data-lucide="book-open"></i> Libro de movimientos — ${esc(periodLabel())}</h3><div id="cg-ledger"></div></div>
      <div class="card" style="margin-bottom:1.5rem;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:.5rem; flex-wrap:wrap; margin-bottom:.75rem;">
          <h3 class="card-title" style="font-size:1rem;">Gastos <span id="cg-exp-count" class="badge badge-neutral" style="margin-left:.4rem;">0</span></h3>
          <button class="btn btn-outline btn-sm" id="cg-csv"><i data-lucide="file-spreadsheet"></i> Exportar CSV</button></div>
        ${filtersHTML(f, { rows: expenses, providers, parts: 'gastos' })}<div id="cg-exp-table" style="margin-top:1rem;"></div></div>
      <div class="card"><h3 class="card-title" style="font-size:1rem; margin-bottom:.75rem;">Otros ingresos del período</h3>
        <div class="table-responsive"><table class="data-table report-table"><thead><tr><th>Fecha</th><th>Edificio</th><th>Concepto</th><th>Importe</th><th style="text-align:right;">Acciones</th></tr></thead><tbody>
          ${inRange.length ? inRange.map(i => `<tr style="${i.status === 'ANULADO' ? 'opacity:.6;' : ''}"><td>${formatDate(i.income_date)}</td><td>${i.building_id ? esc((byId.get(i.building_id) || {}).name || '') : 'General'}</td>
            <td style="white-space:normal;">${esc(i.concept)}${i.status === 'ANULADO' ? ' <span class="badge badge-danger">Anulado</span>' : ''}</td><td><strong>${money(i.amount)}</strong></td>
            <td style="text-align:right; white-space:nowrap;">${i.status === 'VALIDO' ? `<button class="btn btn-outline btn-sm" data-inc-edit="${i.id}"><i data-lucide="pencil"></i></button> <button class="btn btn-outline btn-sm" data-inc-void="${i.id}" style="color: var(--status-danger);"><i data-lucide="ban"></i></button>` : ''}</td></tr>`).join('')
            : '<tr><td colspan="5" style="text-align:center; color: var(--text-dim);">Sin otros ingresos en este período.</td></tr>'}</tbody></table></div></div>`;

    body.querySelector('#cg-config')?.addEventListener('click', openAccountForm);
    // El libro solo se vuelve a pedir si cambió el período, el edificio o los datos
    body.querySelector('#cg-ledger').appendChild(ledger.el);
    const lk = `${from}|${to}|${f.building}|${ledgerTick}|${cash ? cash.closing_balance : ''}`;
    if (lk !== ledgerKey) { ledgerKey = lk; ledger.load({ from, to, buildingId: f.building || null, summary: cash, showBalance: !f.building }); }
    // Categoría, proveedor, estado y búsqueda solo afectan a la lista de gastos: se actualiza sola
    const fillExpenses = () => {
      const r = applyFilters(expenses, f);
      body.querySelector('#cg-exp-table').innerHTML = tableHTML(r, { showBuildings: true, readOnly: true });
      body.querySelector('#cg-exp-count').textContent = r.length;
      body.querySelector('#cg-csv').onclick = () => exportExpensesCsv(`Gastos_${f.year || 'todos'}${f.month ? '-' + f.month : ''}.csv`, r, { showBuildings: true });
      bindTableActions(body, r, {
        onPay: (x) => openPaymentsModal({ readOnly: true, expense: { ...x.raw, expense_id: x.id }, onChange: async () => { await reloadData(); draw(true); const y = expenses.find(e => e.id === x.id); return y ? y.raw : null; } })
      });
      if (window.lucide) window.lucide.createIcons();
    };
    bindFilters(body, f, () => fillExpenses());
    fillExpenses();    body.querySelectorAll('[data-inc-edit]').forEach(b => b.onclick = () => openIncomeForm({ income: incomes.find(i => i.id === b.dataset.incEdit), buildings, allowGeneral: true, onSaved: refresh }));
    body.querySelectorAll('[data-inc-void]').forEach(b => b.onclick = async () => {
      if (!(await confirmDialog({ title: 'Anular ingreso', message: '¿Anular este ingreso? Queda marcado como anulado y no cuenta en los totales.', confirmText: 'Anular', danger: true }))) return;
      try { await maintenanceService.voidOtherIncome(b.dataset.incVoid); await refresh(); } catch (err) { alertDialog({ tone: 'danger', message: err.message }); }
    });
    if (window.lucide) window.lucide.createIcons();
  }

  function openAccountForm() {
    const a = account || { name: 'Cuenta de la administración', opening_balance: '', opening_date: todayStr() };
    const modal = openAppModal('<i data-lucide="settings" style="color: var(--primary);"></i> Cuenta de la administración', `
      <p style="margin-bottom:1rem; font-size:.9rem;">Es la cuenta bancaria única de la que salen los pagos y a la que llegan las cuotas de todos los edificios. El saldo inicial es el dinero que había en ella en la fecha indicada; a partir de ahí el sistema suma y resta los movimientos.</p>
      <form id="acc-form" novalidate>
        <div class="form-group"><label class="form-label" for="acc-name">Nombre de la cuenta</label><input id="acc-name" class="form-control" maxlength="150" value="${esc(a.name)}"></div>
        <div class="form-grid">
          <div class="form-group"><label class="form-label" for="acc-open">Saldo inicial (S/) *</label><input id="acc-open" type="number" step="0.01" class="form-control" value="${a.opening_balance}"></div>
          <div class="form-group"><label class="form-label" for="acc-date">Saldo a la fecha *</label><input id="acc-date" type="date" class="form-control" value="${esc(a.opening_date)}"></div>
        </div>
        <div id="acc-error" class="form-error" hidden></div>
        <div style="display:flex; gap:1rem; justify-content:flex-end; margin-top:1rem;">
          <button type="button" class="btn btn-secondary" id="acc-cancel">Cancelar</button>
          <button type="submit" class="btn btn-primary" id="acc-save"><i data-lucide="save"></i> Guardar</button></div>
      </form>`);
    modal.$('acc-cancel').onclick = modal.close;
    modal.$('acc-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const showErr = (m) => { const b = modal.$('acc-error'); b.textContent = m; b.hidden = !m; };
      const opening = parseFloat(modal.$('acc-open').value);
      if (Number.isNaN(opening)) return showErr('Ingrese el saldo inicial (puede ser 0).');
      if (!modal.$('acc-date').value) return showErr('Indique la fecha del saldo.');
      const btn = modal.$('acc-save'); btn.disabled = true;
      try { await maintenanceService.setCashAccount(modal.$('acc-name').value, opening, modal.$('acc-date').value); modal.close(); await refresh(); }
      catch (err) { showErr(err.message); btn.disabled = false; }
    });
  }

  loadAll();
  return container;
}
