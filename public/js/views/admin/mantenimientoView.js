/* Mantenimiento y Servicios del edificio activo (solo administración) */
import { activeBuilding } from '../../services/activeBuilding.js';
import { authService } from '../../services/authService.js';
import { isSupabaseConnected } from '../../supabaseClient.js';
import { maintenanceService, FREQUENCIES, SERVICE_STATUS, EXPENSE_STATUS, MONTH_NAMES, monthRange, periodText } from '../../services/maintenanceService.js';
import { exportExpensesPdf } from '../../services/expensesPdf.js';
import { openExpenseForm, openServiceForm, openProvidersModal, openPaymentsModal, openIncomeForm, monthYearHTML, readMonthYear, esc } from '../../ui/mantenimientoModals.js';
import { alertDialog, confirmDialog, promptDialog } from '../../ui/dialog.js';
import { formatCurrency, formatDate } from '../../config.js';
import { createLedger } from './libroMovimientos.js';
import { fromBuildingRow, newFilters, filtersHTML, bindFilters, applyFilters, tableHTML, bindTableActions, exportExpensesCsv, r2, filterPeriodLabel } from './mantenimientoShared.js';

const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });

export function renderAdminMantenimiento() {
  const container = document.createElement('div');
  container.className = 'fade-in';
  if (!isSupabaseConnected() || !authService.getContext()) {
    container.innerHTML = '<div class="card" style="max-width:640px;"><p>Este módulo solo está disponible con Supabase conectado.</p></div>';
    return container;
  }
  const building = activeBuilding.get();
  if (!building) return container;

  let tab = 'resumen';
  let providers = [], services = [], expenses = [];
  const filters = newFilters(true);   // abre mostrando todos los períodos
  let svcFilter = 'TODOS';
  let cash = null, incomes = [], cashPeriod = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`;
  const buildingsForForm = () => activeBuilding.list();

  async function loadAll() {
    container.innerHTML = '<div class="card" style="text-align:center; color: var(--text-dim);">Cargando mantenimiento y servicios...</div>';
    try {
      const [p, s, e] = await Promise.all([maintenanceService.loadProviders(), maintenanceService.loadServices(building.id), maintenanceService.loadBuildingExpenses(building.id)]);
      providers = p; services = s; expenses = e.map(fromBuildingRow);
      render();
    } catch (err) {
      container.innerHTML = `<div class="card" style="text-align:center;"><p style="color: var(--status-danger); margin-bottom:1rem;">${esc(err.message)}</p><button class="btn btn-primary btn-sm" id="mt-retry">Reintentar</button></div>`;
      container.querySelector('#mt-retry').onclick = loadAll;
    }
  }
  async function reloadExpenses() { expenses = (await maintenanceService.loadBuildingExpenses(building.id)).map(fromBuildingRow); }
  const refreshExpense = async (id) => { await reloadExpenses(); render(); const r = expenses.find(x => String(x.id) === String(id)); return r ? { ...r.raw } : null; };

  function render() {
    container.innerHTML = `
      <div class="card" style="margin-bottom:1.5rem;">
        <div class="card-header">
          <h2 class="card-title"><i data-lucide="wrench"></i> Mantenimiento y Servicios — ${esc(building.name)}</h2>
          <div style="display:flex; gap:.5rem; flex-wrap:wrap;">
            <button class="btn btn-outline btn-sm" id="mt-providers"><i data-lucide="truck"></i> Proveedores</button>
            <button class="btn btn-primary btn-sm" id="mt-new-expense"><i data-lucide="plus-circle"></i> Nuevo gasto</button>
          </div>
        </div>
        <p>Servicios del edificio, gastos y pagos. Solo lo ve la administración.</p>
        <div class="tabs" style="display:flex; gap:.4rem; flex-wrap:wrap; margin-top:1rem;">
          ${[['resumen', 'Resumen'], ['servicios', 'Servicios'], ['gastos', 'Gastos']].map(([k, l]) =>
            `<button class="btn btn-sm ${tab === k ? 'btn-primary' : 'btn-outline'}" data-tab="${k}">${l}</button>`).join('')}
        </div>
      </div>
      <div id="mt-body"></div>`;
    container.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });
    container.querySelector('#mt-providers').onclick = () => openProvidersModal({ providers, onChange: (l) => { providers = l; render(); } });
    container.querySelector('#mt-new-expense').onclick = () => openExpenseForm({
      buildings: buildingsForForm(), defaultBuildingId: building.id, allowGeneral: false, providers, onSaved: async () => { await reloadExpenses(); render(); } });
    ({ resumen: drawResumen, servicios: drawServicios, gastos: drawGastos })[tab]();
    if (window.lucide) window.lucide.createIcons();
  }

  const expenseHandlers = () => ({
    onPay: (r) => openPaymentsModal({ expense: r.raw, onChange: () => refreshExpense(r.id) }),
    onEdit: (r) => openExpenseForm({ expense: r.raw, buildings: buildingsForForm(), defaultBuildingId: building.id, allowGeneral: false, providers,
      onSaved: async () => { await reloadExpenses(); render(); } }),
    onVoid: async (r) => {
      const reason = await promptDialog({ title: 'Anular gasto', message: `Se anulará "${r.concept}". Escriba el motivo (obligatorio). No se borra: queda marcado como anulado.`, label: 'Motivo', confirmText: 'Continuar' });
      if (reason === null) return;
      if (reason.trim().length < 3) return alertDialog({ tone: 'warning', message: 'Escriba un motivo de al menos 3 letras.' });
      if (!(await confirmDialog({ title: 'Confirmar anulación', message: '¿Anular este gasto?', confirmText: 'Anular gasto', danger: true }))) return;
      try { await maintenanceService.voidExpense(r.id, reason.trim()); await reloadExpenses(); render(); }
      catch (err) { alertDialog({ tone: 'danger', message: err.message }); }
    }
  });

  /* ---- Resumen ---- */
  function drawResumen() {
    const body = container.querySelector('#mt-body');
    const draw = () => {
      const base = applyFilters(expenses, filters, { ignoreStatus: true }).filter(r => r.status !== 'ANULADO');
      const sum = (arr, k) => r2(arr.reduce((s, r) => s + r[k], 0));
      const paid = sum(base, 'paid');
      const pending = sum(base.filter(r => r.status === 'PENDIENTE'), 'balance');
      const overdue = sum(base.filter(r => r.status === 'VENCIDO'), 'balance');
      const today = todayStr();
      const nextMaint = services.filter(s => s.status === 'ACTIVO' && s.next_maintenance_date && s.next_maintenance_date >= today)
        .sort((a, b) => a.next_maintenance_date.localeCompare(b.next_maintenance_date)).slice(0, 5);
      const nextDue = [
        ...expenses.filter(r => ['PENDIENTE'].includes(r.status) && r.due && r.due >= today).map(r => ({ date: r.due, text: r.concept, amount: r.balance, kind: 'Gasto' })),
        ...services.filter(s => s.status === 'ACTIVO' && s.next_due_date && s.next_due_date >= today).map(s => ({ date: s.next_due_date, text: s.name, amount: s.estimated_amount, kind: 'Servicio (estimado)' }))
      ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
      body.querySelector('#mt-cards').innerHTML = `
        <div class="metrics-strip">
          <div class="stat-item"><span class="stat-label" style="color: var(--primary);">Gastos pagados</span><span class="stat-value" style="color: var(--primary);">${formatCurrency(paid)}</span></div>
          <div class="stat-item"><span class="stat-label">Gastos pendientes</span><span class="stat-value">${formatCurrency(pending)}</span></div>
          <div class="stat-item"><span class="stat-label" style="color: var(--status-danger);">Gastos vencidos</span><span class="stat-value highlight-danger">${formatCurrency(overdue)}</span></div>
        </div>
        <div class="form-grid" style="margin-top:1rem; gap:1rem;">
          <div class="card" style="margin:0;"><h3 class="card-title" style="font-size:1rem; margin-bottom:.6rem;"><i data-lucide="calendar-clock"></i> Próximos mantenimientos</h3>
            ${nextMaint.length ? nextMaint.map(s => `<div class="pay-row"><div class="pay-row-main"><strong style="font-family:inherit;">${esc(s.name)}</strong><span>${FREQUENCIES[s.frequency]}</span></div><strong>${formatDate(s.next_maintenance_date)}</strong></div>`).join('')
              : '<p class="cell-note">No hay mantenimientos programados. Cargue la fecha en cada servicio activo.</p>'}</div>
          <div class="card" style="margin:0;"><h3 class="card-title" style="font-size:1rem; margin-bottom:.6rem;"><i data-lucide="calendar-check"></i> Próximos vencimientos de pago</h3>
            ${nextDue.length ? nextDue.map(d => `<div class="pay-row"><div class="pay-row-main"><strong style="font-family:inherit;">${esc(d.text)}</strong><span>${d.kind}${d.amount != null ? ' · ' + formatCurrency(d.amount) : ''}</span></div><strong>${formatDate(d.date)}</strong></div>`).join('')
              : '<p class="cell-note">No hay vencimientos próximos.</p>'}</div>
        </div>
        <p class="cell-note" style="margin-top:.75rem;">Los importes se ubican por la fecha de operación del pago (${filterPeriodLabel(filters).toLowerCase()}); un gasto sin pagos se ubica por su período. En gastos compartidos se cuenta solo la parte de este edificio.</p>`;
      if (window.lucide) window.lucide.createIcons();
    };
    body.innerHTML = `<div class="card">${filtersHTML(filters, { rows: expenses, providers })}<div id="mt-cards" style="margin-top:1rem;"></div></div>`;
    bindFilters(body, filters, () => draw());
    draw();
  }

  /* ---- Servicios ---- */
  function drawServicios() {
    const body = container.querySelector('#mt-body');
    const list = services.filter(s => svcFilter === 'TODOS' || s.status === svcFilter);
    const provName = id => (providers.find(p => p.id === id) || {}).name || '—';
    body.innerHTML = `<div class="card">
      <div style="display:flex; justify-content:space-between; gap:.75rem; flex-wrap:wrap; align-items:end; margin-bottom:1rem;">
        <div class="form-group" style="margin:0;"><label class="form-label" for="svc-filter">Mostrar</label>
          <select id="svc-filter" class="form-select">${[['TODOS', 'Todos'], ['ACTIVO', 'Activos'], ['INACTIVO', 'Inactivos'], ['FINALIZADO', 'Finalizados']].map(([k, l]) => `<option value="${k}" ${k === svcFilter ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <button class="btn btn-primary btn-sm" id="svc-new"><i data-lucide="plus"></i> Nuevo servicio</button></div>
      <p class="cell-note" style="margin-bottom:.75rem;">Los servicios del catálogo vienen precargados pero inactivos: actívelos solo si el edificio los tiene contratados.</p>
      <div class="table-responsive"><table class="data-table report-table"><thead><tr><th>Servicio</th><th>Proveedor</th><th>Frecuencia</th><th>Estimado</th><th>Próx. mantenimiento</th><th>Próx. vencimiento</th><th>Estado</th><th style="text-align:right;">Acciones</th></tr></thead><tbody>
        ${list.length ? list.map(s => `<tr style="${s.status === 'ACTIVO' ? '' : 'opacity:.7;'}">
          <td style="white-space:normal; min-width:220px;"><strong>${esc(s.name)}</strong>${s.category ? `<span class="cell-note">${esc(s.category)}</span>` : ''}${s.description ? `<span class="cell-note">${esc(s.description)}</span>` : ''}</td>
          <td>${esc(provName(s.provider_id))}</td><td>${FREQUENCIES[s.frequency]}</td><td>${s.estimated_amount != null ? formatCurrency(s.estimated_amount) : '—'}</td>
          <td>${s.next_maintenance_date ? formatDate(s.next_maintenance_date) : '—'}</td><td>${s.next_due_date ? formatDate(s.next_due_date) : '—'}</td>
          <td><span class="badge ${s.status === 'ACTIVO' ? 'badge-success' : s.status === 'FINALIZADO' ? 'badge-neutral' : 'badge-warning'}">${SERVICE_STATUS[s.status]}</span></td>
          <td style="text-align:right; white-space:nowrap;">
            ${s.status !== 'FINALIZADO' ? `<button class="btn btn-outline btn-sm" data-toggle="${s.id}">${s.status === 'ACTIVO' ? 'Desactivar' : 'Activar'}</button>` : ''}
            <button class="btn btn-outline btn-sm" data-edit="${s.id}"><i data-lucide="pencil"></i></button></td></tr>`).join('')
          : '<tr><td colspan="8" style="text-align:center; color: var(--text-dim);">No hay servicios con ese filtro.</td></tr>'}</tbody></table></div></div>`;
    body.querySelector('#svc-filter').onchange = (e) => { svcFilter = e.target.value; drawServicios(); if (window.lucide) window.lucide.createIcons(); };
    body.querySelector('#svc-new').onclick = () => openServiceForm({ buildingId: building.id, providers, onSaved: async () => { services = await maintenanceService.loadServices(building.id); render(); } });
    body.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openServiceForm({ service: services.find(s => s.id === b.dataset.edit), buildingId: building.id, providers,
      onSaved: async () => { services = await maintenanceService.loadServices(building.id); render(); } }));
    body.querySelectorAll('[data-toggle]').forEach(b => b.onclick = async () => {
      const s = services.find(x => x.id === b.dataset.toggle);
      try { await maintenanceService.saveService({ ...s, status: s.status === 'ACTIVO' ? 'INACTIVO' : 'ACTIVO' }); services = await maintenanceService.loadServices(building.id); render(); }
      catch (err) { alertDialog({ tone: 'danger', message: err.message }); }
    });
  }

  /* ---- Gastos ---- */
  async function exportGastosPdf(rows, btn) {
    const filterParts = [];
    if (filters.category) filterParts.push(`Categoría: ${filters.category}`);
    if (filters.provider) filterParts.push(`Proveedor: ${(providers.find(p => p.id === filters.provider) || {}).name || ''}`);
    if (filters.status) filterParts.push(`Estado: ${(EXPENSE_STATUS[filters.status] || {}).label || filters.status}`);
    if (filters.q.trim()) filterParts.push(`Búsqueda: "${filters.q.trim()}"`);
    const pdfRows = rows.map(r => ({
      period: periodText(r.period), opDate: r.opDate, concept: r.concept, category: r.category, provider: r.provider, due: r.due,
      note: [r.service && r.service !== r.concept ? r.service : '',
             r.scope === 'COMPARTIDO' ? `Compartido: su parte de ${formatCurrency(r.amount)} de ${formatCurrency(r.total)}` : ''].filter(Boolean).join('\n'),
      amount: r.amount, paid: r.paid, balance: r.balance, voided: r.status === 'ANULADO',
      status: (r.status !== 'PAGADO' && r.status !== 'ANULADO' && r.paid > 0) ? 'Pago parcial' : (EXPENSE_STATUS[r.status] || {}).label || r.status
    }));
    btn.disabled = true;
    try {
      await exportExpensesPdf({ buildingName: building.name, periodText: filterPeriodLabel(filters), filtersText: filterParts.join(' · '), rows: pdfRows });
    } catch (err) {
      alertDialog({ tone: 'danger', title: 'No se pudo generar el PDF', message: err.message });
    } finally {
      btn.disabled = false;
    }
  }

  function drawGastos() {
    const body = container.querySelector('#mt-body');
    const draw = () => {
      const rows = applyFilters(expenses, filters);
      body.querySelector('#mt-table').innerHTML = tableHTML(rows);
      body.querySelector('#mt-count').textContent = `${rows.length} gasto(s)`;
      bindTableActions(body, rows, expenseHandlers());
      body.querySelector('#mt-csv').onclick = () => exportExpensesCsv(`Gastos_${building.name.replace(/[^A-Za-z0-9]+/g, '_')}.csv`, rows);
      body.querySelector('#mt-pdf').onclick = (e) => exportGastosPdf(rows, e.currentTarget);
      if (window.lucide) window.lucide.createIcons();
    };
    body.innerHTML = `<div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:.5rem; flex-wrap:wrap;"><span id="mt-count" class="badge badge-neutral"></span>
        <div style="display:flex; gap:.5rem; flex-wrap:wrap;">
          <button class="btn btn-outline btn-sm" id="mt-csv"><i data-lucide="file-spreadsheet"></i> Exportar CSV</button>
          <button class="btn btn-sm btn-pdf" id="mt-pdf"><i data-lucide="file-text"></i> Exportar PDF</button></div></div>
      ${filtersHTML(filters, { rows: expenses, providers })}<div id="mt-table" style="margin-top:1rem;"></div></div>`;
    bindFilters(body, filters, (typing) => {
      draw();
    });
    draw();
  }

  loadAll();
  return container;
}
