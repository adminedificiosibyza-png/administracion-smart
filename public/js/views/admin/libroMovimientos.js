/* Libro de movimientos: una línea por cada cuota cobrada, otro ingreso y pago de gasto (solo lectura) */
import { maintenanceService, downloadCsv } from '../../services/maintenanceService.js';
import { openDocumentViewer, esc } from '../../ui/mantenimientoModals.js';
import { alertDialog } from '../../ui/dialog.js';
import { formatCurrency, formatDate } from '../../config.js';

const PAGE = 50;
const fmtDateTime = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/**
 * Crea el libro. buildingId = null: general (todos los edificios); con valor: solo ese edificio.
 * showBalance: columna de saldo acumulado (solo en la vista general sin filtro de edificio).
 * onViewExpense(expenseId): abre el detalle (de solo lectura) de un gasto.
 * onExportPdf({ tab, rows, filtersText }): si se da, aparece el botón "Exportar PDF" con lo que se está viendo
 *   (pestaña Todos / Ingresos / Egresos, categoría y búsqueda), en orden cronológico.
 */
export function createLedger({ showBuildingCol = true, onViewExpense, onExportPdf = null }) {
  const el = document.createElement('div');
  const st = { rows: [], tab: 'TODOS', q: '', category: '', shown: PAGE, summary: null, buildingId: null, showBalance: false, from: '', to: '', error: '' };

  function buildList() {
    // Saldo inicial / al inicio del período como primera línea (solo vista general)
    const list = st.rows.map(r => ({ ...r }));
    let startIdx = -1;
    if (st.showBalance && st.summary && st.summary.account_configured && st.summary.opening_balance != null) {
      list.push({ kind: 'SALDO', id: 'opening', op_date: st.summary.effective_from, created_at: st.summary.effective_from + 'T00:00:00',
        category: 'Saldo inicial', concept: st.summary.opening_date >= st.summary.from ? 'Saldo inicial de la cuenta' : 'Saldo al inicio del período',
        building_name: '', amount: Number(st.summary.opening_balance), status: 'VALIDO' });
    }
    // Orden cronológico para numerar y acumular el saldo (el saldo inicial va primero en su fecha)
    list.sort((a, b) => String(a.op_date).localeCompare(String(b.op_date)) || (a.kind === 'SALDO' ? -1 : b.kind === 'SALDO' ? 1 : 0) || String(a.created_at).localeCompare(String(b.created_at)));
    let balance = 0, n = 0;
    const eff = st.summary ? st.summary.effective_from : '';
    list.forEach(r => {
      r.n = ++n;
      r.before = st.showBalance && eff && r.kind !== 'SALDO' && String(r.op_date) < eff;   // anterior al saldo inicial
      if (st.showBalance && r.status === 'VALIDO' && !r.before) { balance += Number(r.amount); r.balance = balance; }
    });
    startIdx = 0;
    return list.reverse();   // se muestra lo más reciente primero
  }

  function filtered(all) {
    const q = norm(st.q);
    return all.filter(r => {
      if (st.tab === 'INGRESOS' && !(r.amount > 0)) return false;
      if (st.tab === 'EGRESOS' && !(r.amount < 0)) return false;
      if (st.category && r.category !== st.category) return false;
      if (q && ![r.concept, r.category, r.building_name].some(v => norm(v).includes(q))) return false;
      return true;
    });
  }

  function draw() {
    const all = buildList();
    const rows = filtered(all);
    const cats = [...new Set(all.map(r => r.category).filter(Boolean))].sort();
    const cols = 7 + (showBuildingCol ? 1 : 0) + (st.showBalance ? 1 : 0);
    el.innerHTML = `
      <div style="display:flex; gap:.75rem; flex-wrap:wrap; align-items:center; justify-content:space-between; margin-bottom:.75rem;">
        <div style="display:flex; gap:.4rem; flex-wrap:wrap; align-items:center;">
          ${[['TODOS', 'Todos'], ['INGRESOS', 'Ingresos'], ['EGRESOS', 'Egresos']].map(([k, l]) => `<button class="btn btn-sm ${st.tab === k ? 'btn-primary' : 'btn-outline'}" data-ltab="${k}">${l}</button>`).join('')}
          <span class="badge badge-neutral" style="margin-left:.3rem;">${rows.length} movimiento(s)</span>
        </div>
        <div style="display:flex; gap:.5rem; flex-wrap:wrap; align-items:center;">
          <input id="lg-q" class="form-control" style="min-width:220px;" placeholder="Buscar movimiento..." value="${esc(st.q)}" autocomplete="off">
          <select id="lg-cat" class="form-select" style="min-width:170px;"><option value="">Todas las categorías</option>${cats.map(c => `<option ${c === st.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
          <button class="btn btn-outline btn-sm" id="lg-csv"><i data-lucide="file-spreadsheet"></i> Exportar CSV</button>
          ${onExportPdf ? '<button class="btn btn-sm btn-pdf" id="lg-pdf"><i data-lucide="file-text"></i> Exportar PDF</button>' : ''}
        </div>
      </div>
      ${st.error ? `<p class="form-error">${esc(st.error)}</p>` : ''}
      <div class="table-responsive"><table class="data-table report-table">
        <thead><tr><th>#</th><th>Registro</th><th>Fecha de operación</th><th>Categoría</th><th>Concepto</th>${showBuildingCol ? '<th>Edificio</th>' : ''}
          <th style="text-align:right;">Monto</th><th>Tipo</th>${st.showBalance ? '<th style="text-align:right;">Saldo</th>' : ''}<th style="text-align:right;">Acciones</th></tr></thead>
        <tbody>${rows.length ? rows.slice(0, st.shown).map(r => {
          const voided = r.status === 'ANULADO';
          const income = r.amount > 0;
          const type = voided ? ['ANULADO', 'badge-neutral'] : (income ? ['INGRESO', 'badge-success'] : ['EGRESO', 'badge-danger']);
          const canView = (r.kind === 'GASTO' && r.expense_id) || (r.kind === 'CUOTA' && r.proof_path);
          return `<tr style="${voided || r.before ? 'opacity:.6;' : ''}">
            <td>${r.n}</td>
            <td style="white-space:nowrap;">${r.kind === 'SALDO' ? '—' : esc(fmtDateTime(r.created_at))}</td>
            <td style="white-space:nowrap;"><strong>${formatDate(r.op_date)}</strong>${r.before ? '<span class="cell-note">Previo al saldo inicial</span>' : ''}</td>
            <td><span class="badge badge-building">${esc(r.category)}</span></td>
            <td style="white-space:normal; min-width:220px;">${esc(r.concept)}</td>
            ${showBuildingCol ? `<td style="white-space:normal;">${esc(r.building_name || '')}</td>` : ''}
            <td style="text-align:right; white-space:nowrap;"><strong style="${voided ? 'text-decoration:line-through; color: var(--text-dim);' : (income ? 'color: var(--primary);' : 'color: var(--status-danger);')}">${income ? '+' : '−'}${formatCurrency(Math.abs(r.amount))}</strong></td>
            <td><span class="badge ${type[1]}">${type[0]}</span></td>
            ${st.showBalance ? `<td style="text-align:right; white-space:nowrap;">${r.balance != null ? `<strong>${formatCurrency(r.balance)}</strong>` : '<span style="color: var(--text-dim);">—</span>'}</td>` : ''}
            <td style="text-align:right;">${canView ? `<button class="btn btn-outline btn-sm" data-lview="${esc(r.kind + ':' + r.id)}" title="${r.kind === 'GASTO' ? 'Ver pagos y documentos' : 'Ver comprobante'}"><i data-lucide="eye"></i></button>` : ''}</td></tr>`;
        }).join('') : `<tr><td colspan="${cols}" style="text-align:center; color: var(--text-dim);">No hay movimientos en este período.</td></tr>`}</tbody></table></div>
      ${rows.length > st.shown ? `<div style="text-align:center; margin-top:.75rem;"><button class="btn btn-outline btn-sm" id="lg-more">Ver más (${rows.length - st.shown} restantes)</button></div>` : ''}`;

    el.querySelectorAll('[data-ltab]').forEach(b => b.onclick = () => { st.tab = b.dataset.ltab; st.shown = PAGE; draw(); });
    el.querySelector('#lg-q').oninput = (e) => { st.q = e.target.value; st.shown = PAGE; draw(); const i = el.querySelector('#lg-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); };
    el.querySelector('#lg-cat').onchange = (e) => { st.category = e.target.value; st.shown = PAGE; draw(); };
    el.querySelector('#lg-more')?.addEventListener('click', () => { st.shown += PAGE; draw(); });
    el.querySelector('#lg-csv').onclick = () => downloadCsv(`Libro_de_movimientos_${st.from}_${st.to}.csv`, [
      ['#', 'Registro', 'Fecha de operación', 'Categoría', 'Concepto', 'Edificio', 'Monto', 'Tipo', ...(st.showBalance ? ['Saldo'] : [])],
      ...rows.slice().reverse().map(r => [r.n, r.kind === 'SALDO' ? '' : fmtDateTime(r.created_at), r.op_date, r.category, r.concept, r.building_name || '',
        Number(r.amount).toFixed(2), r.status === 'ANULADO' ? 'ANULADO' : (r.amount > 0 ? 'INGRESO' : 'EGRESO'), ...(st.showBalance ? [r.balance != null ? r.balance.toFixed(2) : ''] : [])])]);
    el.querySelector('#lg-pdf')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const filterParts = [];
      if (st.category) filterParts.push(`Categoría: ${st.category}`);
      if (st.q.trim()) filterParts.push(`Búsqueda: "${st.q.trim()}"`);
      btn.disabled = true;
      try {
        await onExportPdf({ tab: st.tab, rows: rows.filter(r => r.kind !== 'SALDO').slice().reverse(), filtersText: filterParts.join(' · ') });
      } catch (err) {
        alertDialog({ tone: 'danger', title: 'No se pudo generar el PDF', message: err.message });
      } finally {
        btn.disabled = false;
      }
    });
    el.querySelectorAll('[data-lview]').forEach(b => b.onclick = async () => {
      const [kind, id] = b.dataset.lview.split(':');
      const r = st.rows.find(x => x.kind === kind && String(x.id) === id);
      if (!r) return;
      if (kind === 'GASTO') { if (onViewExpense) onViewExpense(r.expense_id); return; }
      const name = decodeURIComponent(String(r.proof_path).split('/').pop() || 'comprobante');
      openDocumentViewer({ doc_type: 'COMPROBANTE', file_name: name.replace(/^\d+-/, ''), file_path: r.proof_path, bucket: 'comprobantes-pagos' });
    });
    if (window.lucide) window.lucide.createIcons();
  }

  return {
    el,
    /** Libro completo en orden cronológico (con saldo acumulado y marca de "previo al saldo inicial"), para el PDF. */
    fullList() { return buildList().reverse(); },
    lastError() { return st.error; },
    /** Carga el período. summary (resultado de cashSummary) sirve para el saldo inicial y el saldo acumulado. */
    async load({ from, to, buildingId = null, summary = null, showBalance = false }) {
      Object.assign(st, { from, to, buildingId, summary, showBalance, shown: PAGE, error: '' });
      el.innerHTML = '<p class="cell-note" style="text-align:center;">Cargando movimientos...</p>';
      try { st.rows = await maintenanceService.cashLedger(from, to, buildingId); }
      catch (err) { st.rows = []; st.error = err.message; }
      draw();
    }
  };
}
