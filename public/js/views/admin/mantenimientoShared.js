/* Piezas comunes de Mantenimiento y Servicios y de la Caja general: filtros, tabla de gastos y CSV */
import { EXPENSE_STATUS, MONTH_NAMES, periodText, downloadCsv } from '../../services/maintenanceService.js';
import { esc, monthYearHTML, readMonthYear } from '../../ui/mantenimientoModals.js';
import { formatCurrency, formatDate } from '../../config.js';

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/** Fila de un edificio (vista de asignaciones): muestra SU parte; "total" es el gasto completo. */
export function fromBuildingRow(r) {
  return { id: r.id, scope: r.scope, concept: r.concept, category: r.category || '', provider_id: r.provider_id, provider: r.provider_name || '',
    service: r.service_name || '', period: r.period_month, opDate: r.last_payment || '', due: r.due_date, obs: r.observations,
    amount: Number(r.share_amount), total: Number(r.amount), paid: Number(r.share_paid), balance: Number(r.share_balance),
    status: r.calc_status, buildings: [], buildingIds: [r.building_id], payments: r.payments_count, raw: r };
}
/** Fila general: importe completo; indica a qué edificios corresponde. */
export function fromAllRow(r, buildingsById) {
  const names = (r.allocations || []).map(a => (buildingsById.get(a.building_id) || {}).name || 'Edificio');
  return { id: r.id, scope: r.scope, concept: r.concept, category: r.category || '', provider_id: r.provider_id, provider: r.provider_name || '',
    service: r.service_name || '', period: r.period_month, opDate: r.last_payment || '', due: r.due_date, obs: r.observations,
    amount: Number(r.amount), total: Number(r.amount), paid: Number(r.paid_total), balance: Number(r.balance_total),
    status: r.calc_status, buildings: names, buildingIds: (r.allocations || []).map(a => a.building_id), payments: r.payments_count, raw: r };
}

/** allPeriods = true: abre mostrando todos los períodos (se puede filtrar por mes y/o año). */
export const newFilters = (allPeriods = false) => {
  const now = new Date();
  return { month: allPeriods ? '' : String(now.getMonth() + 1).padStart(2, '0'), year: allPeriods ? '' : String(now.getFullYear()), category: '', provider: '', status: '', q: '', building: '' };
};

/**
 * parts: 'all' (todos los filtros), 'top' (solo edificio y mes: filtros generales de una pantalla)
 * o 'gastos' (solo categoría, proveedor, estado y búsqueda: filtros de la lista de gastos).
 */
export function filtersHTML(f, { rows, providers, buildings = null, parts = 'all' }) {
  const cats = [...new Set(rows.map(r => r.category).filter(Boolean))].sort();
  const provs = providers.filter(p => rows.some(r => r.provider_id === p.id));
  const top = parts !== 'gastos', low = parts !== 'top';
  return `
    <div class="form-grid" style="margin-top:1rem; align-items:end;">
      ${top && buildings ? `<div class="form-group"><label class="form-label" for="f-building">Edificio</label>
        <select id="f-building" class="form-select"><option value="">Todos</option>${buildings.map(b => `<option value="${b.id}" ${b.id === f.building ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></div>` : ''}
      ${top ? `<div class="form-group" style="grid-column: span 2;"><label class="form-label">Mes de la operación</label>${monthYearHTML('f-period', '', true, { m: f.month, y: f.year })}</div>` : ''}
      ${low ? `<div class="form-group"><label class="form-label" for="f-cat">Categoría</label>
        <select id="f-cat" class="form-select"><option value="">Todas</option>${cats.map(c => `<option ${c === f.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label" for="f-prov">Proveedor</label>
        <select id="f-prov" class="form-select"><option value="">Todos</option>${provs.map(p => `<option value="${p.id}" ${p.id === f.provider ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label" for="f-status">Estado</label>
        <select id="f-status" class="form-select"><option value="">Todos</option>${['PENDIENTE', 'VENCIDO', 'PAGADO', 'ANULADO'].map(s => `<option value="${s}" ${s === f.status ? 'selected' : ''}>${EXPENSE_STATUS[s].label}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label" for="f-q">Buscar</label>
        <input id="f-q" class="form-control" placeholder="Servicio, proveedor o concepto" value="${esc(f.q)}" autocomplete="off"></div>` : ''}
    </div>`;
}

/** Conecta los filtros que existan dentro de root; onChange(typing) avisa cuando cambia alguno. */
export function bindFilters(root, f, onChange) {
  const val = (sel) => { const el = root.querySelector(sel); return el ? el.value : null; };
  const sync = () => {
    if (root.querySelector('#f-period-m')) { f.month = val('#f-period-m'); f.year = val('#f-period-y'); }
    if (root.querySelector('#f-cat')) { f.category = val('#f-cat'); f.provider = val('#f-prov'); f.status = val('#f-status'); }
    if (root.querySelector('#f-building')) f.building = val('#f-building');
  };
  ['#f-period-m', '#f-period-y', '#f-cat', '#f-prov', '#f-status', '#f-building'].forEach(sel =>
    root.querySelector(sel)?.addEventListener('change', () => { sync(); onChange(false); }));
  root.querySelector('#f-q')?.addEventListener('input', (e) => { f.q = e.target.value; onChange(true); });
}

export function applyFilters(rows, f, { ignoreStatus = false } = {}) {
  const q = norm(f.q);
  return rows.filter(r => {
    if (f.building && !r.buildingIds.includes(f.building)) return false;
    // El mes del filtro es el de la FECHA DE OPERACIÓN (cuando se pagó); un gasto sin pagos se ubica por su período
    const per = String(r.opDate || r.period || '');
    if (f.year && per.slice(0, 4) !== f.year) return false;
    if (f.month && per.slice(5, 7) !== f.month) return false;
    if (f.category && r.category !== f.category) return false;
    if (f.provider && r.provider_id !== f.provider) return false;
    if (!ignoreStatus && f.status && r.status !== f.status) return false;
    if (q && ![r.service, r.provider, r.concept, r.category].some(v => norm(v).includes(q))) return false;
    return true;
  });
}

/** Texto del período filtrado: 'Octubre 2026', 'Octubre (todos los años)', 'Año 2026' o 'Todos los períodos'. */
export function filterPeriodLabel(f) {
  if (f.month && f.year) return periodText(`${f.year}-${f.month}-01`);
  if (f.month) return `${MONTH_NAMES[Number(f.month) - 1]} (todos los años)`;
  if (f.year) return `Año ${f.year}`;
  return 'Todos los períodos';
}

export function statusBadge(r) {
  const s = EXPENSE_STATUS[r.status] || EXPENSE_STATUS.PENDIENTE;
  const partial = r.status !== 'PAGADO' && r.status !== 'ANULADO' && r.paid > 0;
  return `<span class="badge ${partial ? 'badge-orange' : s.badge}">${partial ? 'Pago parcial' : s.label}</span>`;
}

const scopeNote = (r) => r.scope === 'COMPARTIDO'
  ? `<span class="badge badge-info" style="margin-left:.4rem;">Compartido</span>${r.amount !== r.total ? `<span class="cell-note">Su parte: ${formatCurrency(r.amount)} de ${formatCurrency(r.total)}</span>` : ''}`
  : (r.scope === 'GENERAL' ? '<span class="badge badge-neutral" style="margin-left:.4rem;">General</span>' : '');

export function tableHTML(rows, { showBuildings = false, readOnly = false } = {}) {
  const LIMIT = 300;
  return `
    <div class="table-responsive"><table class="data-table report-table">
      <thead><tr><th>Período</th><th>Fecha de operación</th><th>Concepto</th>${showBuildings ? '<th>Edificio</th>' : ''}<th>Proveedor</th><th>Vencimiento</th>
        <th>Importe</th><th>Pagado</th><th>Saldo</th><th>Estado</th><th style="text-align:right;">Acciones</th></tr></thead>
      <tbody>${rows.length ? rows.slice(0, LIMIT).map(r => `<tr style="${r.status === 'ANULADO' ? 'opacity:.6;' : ''}">
        <td>${esc(periodText(r.period))}</td>
        <td>${r.opDate ? formatDate(r.opDate) : '<span style="color: var(--text-dim);">—</span>'}</td>
        <td style="white-space:normal; min-width:200px;"><strong>${esc(r.concept)}</strong>${scopeNote(r)}
          ${(r.service || r.category) ? `<span class="cell-note">${esc([r.service, r.category].filter(Boolean).join(' · '))}</span>` : ''}</td>
        ${showBuildings ? `<td style="white-space:normal;">${r.buildings.length ? esc(r.buildings.join(', ')) : '<span style="color: var(--text-dim);">General</span>'}</td>` : ''}
        <td>${esc(r.provider || '—')}</td><td>${r.due ? formatDate(r.due) : '—'}</td>
        <td><strong>${formatCurrency(r.amount)}</strong></td><td>${r.paid > 0 ? formatCurrency(r.paid) : '—'}</td>
        <td><strong style="${r.balance > 0 && r.status !== 'ANULADO' ? 'color: var(--status-danger);' : 'color: var(--text-dim);'}">${formatCurrency(r.status === 'ANULADO' ? 0 : r.balance)}</strong></td>
        <td>${statusBadge(r)}</td>
        <td style="text-align:right; white-space:nowrap;">
          <button class="btn btn-outline btn-sm" data-x-pay="${r.id}" title="Pagos y documentos"><i data-lucide="receipt"></i> Pagos${r.payments ? ` (${r.payments})` : ''}</button>
          ${(!readOnly && r.status !== 'ANULADO') ? `<button class="btn btn-outline btn-sm" data-x-edit="${r.id}" title="Editar"><i data-lucide="pencil"></i></button>
          <button class="btn btn-outline btn-sm" data-x-void="${r.id}" title="Anular gasto" style="color: var(--status-danger);"><i data-lucide="ban"></i></button>` : ''}
        </td></tr>`).join('')
        : `<tr><td colspan="${showBuildings ? 11 : 10}" style="text-align:center; color: var(--text-dim);">No hay gastos con esos filtros.</td></tr>`}</tbody></table></div>
    ${rows.length > LIMIT ? `<p class="cell-note" style="margin-top:.5rem;">Se muestran los primeros ${LIMIT} de ${rows.length}. Use los filtros o exporte el CSV para ver todos.</p>` : ''}`;
}

export function bindTableActions(root, rows, { onPay, onEdit, onVoid }) {
  const find = id => rows.find(r => String(r.id) === id);
  root.querySelectorAll('[data-x-pay]').forEach(b => b.onclick = () => onPay(find(b.dataset.xPay)));
  root.querySelectorAll('[data-x-edit]').forEach(b => b.onclick = () => onEdit && onEdit(find(b.dataset.xEdit)));
  root.querySelectorAll('[data-x-void]').forEach(b => b.onclick = () => onVoid && onVoid(find(b.dataset.xVoid)));
}

export function exportExpensesCsv(filename, rows, { showBuildings = false } = {}) {
  downloadCsv(filename, [
    ['Período', 'Fecha de operación', 'Concepto', 'Tipo', ...(showBuildings ? ['Edificio'] : []), 'Servicio', 'Categoría', 'Proveedor', 'Vencimiento',
      'Importe', 'Pagado', 'Saldo', 'Estado', 'Observaciones'],
    ...rows.map(r => [periodText(r.period), r.opDate || '', r.concept, r.scope === 'EDIFICIO' ? 'De un edificio' : r.scope === 'COMPARTIDO' ? 'Compartido' : 'General',
      ...(showBuildings ? [r.buildings.join(' / ') || 'General'] : []), r.service, r.category, r.provider,
      r.due || '', r.amount.toFixed(2), r.paid.toFixed(2), (r.status === 'ANULADO' ? 0 : r.balance).toFixed(2),
      (EXPENSE_STATUS[r.status] || {}).label || r.status, String(r.obs || '').replace(/\s+/g, ' ')])
  ]);
}

export { r2 };
