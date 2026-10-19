/* Ventanas del módulo Mantenimiento y Servicios / Caja general (formularios, pagos y documentos) */
import { maintenanceService, FREQUENCIES, SERVICE_STATUS, DOC_TYPES, PAYMENT_METHODS, MONTH_NAMES, periodText } from '../services/maintenanceService.js';
import { openAppModal } from './credentials.js';
import { alertDialog, confirmDialog, promptDialog } from './dialog.js';
import { formatCurrency, formatDate } from '../config.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

/** Selector de mes y año (mismo estilo que el resto del sistema). */
export function monthYearHTML(id, iso, withEmpty = false, parts = null) {
  const y0 = new Date().getFullYear();
  // Con 'Todos' (withEmpty) mes y año se eligen por separado: parts = { m: '10' | '', y: '2026' | '' }
  const sel = parts || (iso ? { m: iso.slice(5, 7), y: iso.slice(0, 4) } : { m: '', y: '' });
  const cur = withEmpty ? { y: Number(sel.y) || y0, m: Number(sel.m) || 0 } : (iso ? { y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)) } : { y: y0, m: new Date().getMonth() + 1 });
  const years = Array.from({ length: 11 }, (_, i) => y0 - 5 + i);
  if (!years.includes(cur.y)) years.push(cur.y);
  return `<div style="display:grid; grid-template-columns: minmax(0, 1.4fr) minmax(96px, 1fr); gap:0.5rem;">
    <select id="${id}-m" class="form-select">${withEmpty ? '<option value="">Todos</option>' : ''}${MONTH_NAMES.map((n, i) =>
      `<option value="${String(i + 1).padStart(2, '0')}" ${i + 1 === cur.m ? 'selected' : ''}>${n}</option>`).join('')}</select>
    <select id="${id}-y" class="form-select">${withEmpty ? '<option value="">Todos</option>' : ''}${years.sort().map(y =>
      `<option value="${y}" ${(!withEmpty || sel.y) && y === cur.y ? 'selected' : ''}>${y}</option>`).join('')}</select></div>`;
}
export const readMonthYear = (root, id) => {
  const m = root.querySelector(`#${id}-m`).value, y = root.querySelector(`#${id}-y`).value;
  return (m && y) ? `${y}-${m}-01` : '';
};

const errorBox = (modal, id) => (msg) => { const e = modal.$(id); e.textContent = msg || ''; e.hidden = !msg; };

/* ------------------------------------------------------------------ proveedores */
export function openProvidersModal({ providers, onChange }) {
  let list = providers.slice();
  let editing = null;
  const modal = openAppModal('<i data-lucide="truck" style="color: var(--primary);"></i> Proveedores', '<div id="prov-root"></div>');
  const root = modal.$('prov-root');
  const draw = () => {
    root.innerHTML = `
      <div class="table-responsive" style="margin-bottom:1rem;"><table class="data-table">
        <thead><tr><th>Proveedor</th><th>Teléfono</th><th>Estado</th><th style="text-align:right;">Acciones</th></tr></thead>
        <tbody>${list.length ? list.map(p => `<tr style="${p.is_active ? '' : 'opacity:.6;'}">
          <td><strong>${esc(p.name)}</strong>${p.notes ? `<span class="cell-note">${esc(p.notes)}</span>` : ''}</td>
          <td>${esc(p.phone || '—')}</td><td>${p.is_active ? 'Activo' : 'Inactivo'}</td>
          <td style="text-align:right; white-space:nowrap;">
            <button class="btn btn-outline btn-sm" data-edit="${p.id}"><i data-lucide="pencil"></i> Editar</button>
            <button class="btn btn-outline btn-sm" data-toggle="${p.id}">${p.is_active ? 'Desactivar' : 'Activar'}</button></td></tr>`).join('')
          : '<tr><td colspan="4" style="text-align:center; color: var(--text-dim);">Aún no hay proveedores.</td></tr>'}</tbody></table></div>
      <h4 class="form-section">${editing ? 'Editar proveedor' : 'Nuevo proveedor'}</h4>
      <form id="prov-form" novalidate>
        <div class="form-grid">
          <div class="form-group"><label class="form-label" for="prov-name">Nombre *</label>
            <input id="prov-name" class="form-control" maxlength="150" value="${esc(editing ? editing.name : '')}"></div>
          <div class="form-group"><label class="form-label" for="prov-phone">Teléfono</label>
            <input id="prov-phone" class="form-control" maxlength="40" value="${esc(editing ? editing.phone : '')}"></div>
        </div>
        <div class="form-group"><label class="form-label" for="prov-notes">Notas</label>
          <input id="prov-notes" class="form-control" value="${esc(editing ? editing.notes : '')}"></div>
        <div id="prov-error" class="form-error" hidden></div>
        <div style="display:flex; gap:0.75rem; justify-content:flex-end; margin-top:1rem;">
          ${editing ? '<button type="button" class="btn btn-secondary" id="prov-cancel">Cancelar edición</button>' : ''}
          <button type="submit" class="btn btn-primary"><i data-lucide="save"></i> Guardar</button></div>
      </form>`;
    const showErr = errorBox(modal, 'prov-error');
    root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { editing = list.find(p => p.id === b.dataset.edit); draw(); });
    root.querySelectorAll('[data-toggle]').forEach(b => b.onclick = async () => {
      const p = list.find(x => x.id === b.dataset.toggle);
      try { await maintenanceService.saveProvider({ ...p, is_active: !p.is_active }); await reload(); } catch (e) { showErr(e.message); }
    });
    root.querySelector('#prov-cancel')?.addEventListener('click', () => { editing = null; draw(); });
    root.querySelector('#prov-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = root.querySelector('#prov-name').value.trim();
      if (!name) return showErr('Escriba el nombre del proveedor.');
      try {
        await maintenanceService.saveProvider({ id: editing ? editing.id : null, name,
          phone: root.querySelector('#prov-phone').value, notes: root.querySelector('#prov-notes').value,
          is_active: editing ? editing.is_active : true });
        editing = null; await reload();
      } catch (err) { showErr(err.message); }
    });
    if (window.lucide) window.lucide.createIcons();
  };
  const reload = async () => { list = await maintenanceService.loadProviders(); draw(); if (onChange) onChange(list); };
  draw();
}

/* ------------------------------------------------------------------ servicio */
export function openServiceForm({ service, buildingId, providers, onSaved }) {
  const s = service || { status: 'ACTIVO', frequency: 'EVENTUAL' };
  const modal = openAppModal(`<i data-lucide="wrench" style="color: var(--primary);"></i> ${service ? 'Editar servicio' : 'Nuevo servicio'}`, `
    <form id="svc-form" novalidate>
      <div class="form-group"><label class="form-label" for="svc-name">Nombre del servicio *</label>
        <input id="svc-name" class="form-control" maxlength="200" value="${esc(s.name)}"></div>
      <div class="form-grid">
        <div class="form-group"><label class="form-label" for="svc-cat">Categoría</label>
          <input id="svc-cat" class="form-control" maxlength="100" value="${esc(s.category)}" placeholder="Ej: Seguridad"></div>
        <div class="form-group"><label class="form-label" for="svc-prov">Proveedor</label>
          <select id="svc-prov" class="form-select"><option value="">Sin proveedor</option>
            ${providers.filter(p => p.is_active || p.id === s.provider_id).map(p => `<option value="${p.id}" ${p.id === s.provider_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label" for="svc-freq">Frecuencia</label>
          <select id="svc-freq" class="form-select">${Object.entries(FREQUENCIES).map(([k, v]) => `<option value="${k}" ${k === s.frequency ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label" for="svc-amount">Importe estimado (S/)</label>
          <input id="svc-amount" type="number" min="0" step="0.01" class="form-control" value="${s.estimated_amount ?? ''}"></div>
        <div class="form-group"><label class="form-label" for="svc-next">Próximo mantenimiento</label>
          <input id="svc-next" type="date" class="form-control" value="${esc(s.next_maintenance_date || '')}"></div>
        <div class="form-group"><label class="form-label" for="svc-due">Próximo vencimiento de pago</label>
          <input id="svc-due" type="date" class="form-control" value="${esc(s.next_due_date || '')}"></div>
        <div class="form-group"><label class="form-label" for="svc-status">Estado</label>
          <select id="svc-status" class="form-select">${Object.entries(SERVICE_STATUS).map(([k, v]) => `<option value="${k}" ${k === s.status ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      </div>
      <div class="form-group"><label class="form-label" for="svc-desc">Descripción u observaciones</label>
        <textarea id="svc-desc" class="form-control" rows="3">${esc(s.description)}</textarea></div>
      <p class="cell-note">El importe estimado es solo una referencia; no es un gasto ni un pago.</p>
      <div id="svc-error" class="form-error" hidden></div>
      <div style="display:flex; gap:1rem; justify-content:flex-end; margin-top:1rem;">
        <button type="button" class="btn btn-secondary" id="svc-cancel">Cancelar</button>
        <button type="submit" class="btn btn-primary" id="svc-save"><i data-lucide="save"></i> Guardar</button></div>
    </form>`);
  const showErr = errorBox(modal, 'svc-error');
  modal.$('svc-cancel').onclick = modal.close;
  modal.$('svc-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = modal.$('svc-name').value.trim();
    if (!name) return showErr('Escriba el nombre del servicio.');
    const btn = modal.$('svc-save'); btn.disabled = true;
    try {
      await maintenanceService.saveService({
        id: service ? service.id : null, building_id: buildingId, name,
        category: modal.$('svc-cat').value, provider_id: modal.$('svc-prov').value, frequency: modal.$('svc-freq').value,
        estimated_amount: modal.$('svc-amount').value, next_maintenance_date: modal.$('svc-next').value,
        next_due_date: modal.$('svc-due').value, status: modal.$('svc-status').value, description: modal.$('svc-desc').value
      });
      modal.close(); if (onSaved) await onSaved();
    } catch (err) { showErr(err.message); btn.disabled = false; }
  });
}

/* ------------------------------------------------------------------ gasto */
/**
 * buildings: edificios que se pueden elegir [{id,name,total_units}]; defaultBuildingId: edificio preseleccionado.
 * allowGeneral: permite "General" (sin edificio). expense: gasto existente (fila de vw_service_expenses_calc o de asignaciones).
 */
export async function openExpenseForm({ expense, buildings, defaultBuildingId, allowGeneral, providers, onSaved }) {
  const editing = !!expense;
  const id = expense ? (expense.expense_id || expense.id) : null;
  let scope = expense ? expense.scope : 'EDIFICIO';
  let allocs = new Map(); // building_id -> amount (texto)
  let services = [];
  let buildingId = defaultBuildingId || (buildings[0] && buildings[0].id);
  if (editing && scope !== 'GENERAL') {
    const rows = await maintenanceService.loadExpenseAllocations(id);
    rows.forEach(a => allocs.set(a.building_id, String(a.amount)));
    if (scope === 'EDIFICIO' && rows[0]) buildingId = rows[0].building_id;
  }
  const loadServicesFor = async (b) => { try { services = b ? (await maintenanceService.loadServices(b)).filter(x => x.status !== 'FINALIZADO') : []; } catch { services = []; } };
  await loadServicesFor(scope === 'EDIFICIO' ? buildingId : null);

  const e0 = expense || {};
  const modal = openAppModal(`<i data-lucide="receipt" style="color: var(--primary);"></i> ${editing ? 'Editar gasto' : 'Nuevo gasto'}`, '<div id="exp-root"></div>');
  modal.$('modal-card')?.classList?.add('modal-wide');
  const card = document.getElementById('modal-card'); card.classList.add('modal-wide');
  const overlay = document.getElementById('modal-container');
  const watcher = new MutationObserver(() => { if (overlay.classList.contains('hidden')) { card.classList.remove('modal-wide'); watcher.disconnect(); } });
  watcher.observe(overlay, { attributes: true, attributeFilter: ['class'] });
  const root = modal.$('exp-root');

  // Se arma en cada dibujo para que el botón marcado siempre sea el tipo elegido (antes quedaba fijo y no dejaba cambiar)
  const scopeRadios = () => editing ? '' : `
    <div class="form-group"><label class="form-label">Tipo de gasto</label>
      <div style="display:flex; gap:1.25rem; flex-wrap:wrap;">
        <label><input type="radio" name="exp-scope" value="EDIFICIO" ${scope === 'EDIFICIO' ? 'checked' : ''}> De un edificio</label>
        <label><input type="radio" name="exp-scope" value="COMPARTIDO" ${scope === 'COMPARTIDO' ? 'checked' : ''}> Compartido entre edificios</label>
        ${allowGeneral ? `<label><input type="radio" name="exp-scope" value="GENERAL" ${scope === 'GENERAL' ? 'checked' : ''}> General (sin edificio)</label>` : ''}
      </div></div>`;

  const draw = () => {
    const amount = root.querySelector('#exp-amount') ? root.querySelector('#exp-amount').value : (e0.amount ?? '');
    root.innerHTML = `
      <form id="exp-form" novalidate>
        ${scopeRadios()}
        ${editing ? `<p class="cell-note" style="margin-bottom:.75rem;">Tipo: <strong>${scope === 'EDIFICIO' ? 'De un edificio' : scope === 'COMPARTIDO' ? 'Compartido' : 'General'}</strong></p>` : ''}
        ${scope === 'EDIFICIO' ? `
        <div class="form-grid">
          <div class="form-group"><label class="form-label" for="exp-building">Edificio *</label>
            <select id="exp-building" class="form-select" ${editing ? 'disabled' : ''}>${buildings.map(b => `<option value="${b.id}" ${b.id === buildingId ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label" for="exp-service">Servicio</label>
            <select id="exp-service" class="form-select"><option value="">Sin servicio del catálogo</option>
              ${services.map(s => `<option value="${s.id}" data-cat="${esc(s.category)}" data-prov="${s.provider_id || ''}" data-amt="${s.estimated_amount ?? ''}" ${s.id === e0.service_id ? 'selected' : ''}>${esc(s.name)}${s.status === 'INACTIVO' ? ' (inactivo)' : ''}</option>`).join('')}</select></div>
        </div>` : ''}
        ${scope === 'COMPARTIDO' ? `
        <div class="form-group"><label class="form-label">Reparto entre edificios *</label>
          <div class="table-responsive"><table class="data-table"><tbody>${buildings.map(b => `
            <tr><td style="width:36px;"><input type="checkbox" data-alloc-check="${b.id}" ${allocs.has(b.id) ? 'checked' : ''}></td>
              <td>${esc(b.name)}<span class="cell-note">${b.total_units != null ? b.total_units + ' departamentos' : ''}</span></td>
              <td style="width:160px;"><input type="number" min="0" step="0.01" class="form-control" data-alloc-amt="${b.id}" value="${esc(allocs.get(b.id) || '')}" placeholder="S/" ${allocs.has(b.id) ? '' : 'disabled'}></td></tr>`).join('')}</tbody></table></div>
          <div style="display:flex; gap:.5rem; flex-wrap:wrap; margin-top:.5rem; align-items:center;">
            <button type="button" class="btn btn-outline btn-sm" id="alloc-equal">Partes iguales</button>
            <button type="button" class="btn btn-outline btn-sm" id="alloc-prop">Proporcional a departamentos</button>
            <span id="alloc-sum" class="cell-note" style="display:inline;"></span></div>
        </div>` : ''}
        <div class="form-grid">
          <div class="form-group" style="grid-column: 1 / -1;"><label class="form-label" for="exp-concept">Concepto *</label>
            <input id="exp-concept" class="form-control" maxlength="250" value="${esc(root.querySelector('#exp-concept') ? root.querySelector('#exp-concept').value : e0.concept)}" placeholder="Ej: Mantenimiento mensual de ascensores"></div>
          <div class="form-group"><label class="form-label" for="exp-provider">Proveedor</label>
            <select id="exp-provider" class="form-select"><option value="">Sin proveedor</option>
              ${providers.filter(p => p.is_active || p.id === e0.provider_id).map(p => `<option value="${p.id}" ${p.id === e0.provider_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label" for="exp-category">Categoría</label>
            <input id="exp-category" class="form-control" maxlength="100" value="${esc(root.querySelector('#exp-category') ? root.querySelector('#exp-category').value : e0.category)}"></div>
          <div class="form-group"><label class="form-label">Período al que corresponde *</label>${monthYearHTML('exp-period', e0.period_month || todayStr().slice(0, 7) + '-01')}</div>
          <div class="form-group"><label class="form-label" for="exp-amount">Importe real (S/) *</label>
            <input id="exp-amount" type="number" min="0.01" step="0.01" class="form-control" value="${esc(amount)}"></div>
          <div class="form-group"><label class="form-label" for="exp-due">Fecha de vencimiento</label>
            <input id="exp-due" type="date" class="form-control" value="${esc(e0.due_date || '')}"></div>
        </div>
        <div class="form-group"><label class="form-label" for="exp-obs">Observaciones</label>
          <textarea id="exp-obs" class="form-control" rows="2">${esc(e0.observations ? String(e0.observations).split('[ANULADO]')[0].trim() : '')}</textarea></div>
        <div id="exp-error" class="form-error" hidden></div>
        <div style="display:flex; gap:1rem; justify-content:flex-end; margin-top:1rem;">
          <button type="button" class="btn btn-secondary" id="exp-cancel">Cancelar</button>
          <button type="submit" class="btn btn-primary" id="exp-save"><i data-lucide="save"></i> Guardar</button></div>
      </form>`;
    bind();
    if (window.lucide) window.lucide.createIcons();
  };

  const sumAllocs = () => r2([...root.querySelectorAll('[data-alloc-amt]:not([disabled])')].reduce((s, i) => s + (parseFloat(i.value) || 0), 0));
  const refreshSum = () => {
    const el = root.querySelector('#alloc-sum'); if (!el) return;
    const total = parseFloat(root.querySelector('#exp-amount').value) || 0;
    const sum = sumAllocs();
    el.textContent = `Suma del reparto: ${formatCurrency(sum)} de ${formatCurrency(total)}${Math.abs(sum - total) > 0.01 ? ' — debe coincidir con el importe' : ' ✓'}`;
    el.style.color = Math.abs(sum - total) > 0.01 ? 'var(--status-danger)' : 'var(--primary)';
  };
  const distribute = (weights) => {
    const total = parseFloat(root.querySelector('#exp-amount').value) || 0;
    const chosen = [...root.querySelectorAll('[data-alloc-check]:checked')].map(c => c.dataset.allocCheck);
    if (chosen.length < 1 || !total) return;
    const wsum = chosen.reduce((s, b) => s + weights(b), 0) || chosen.length;
    let left = total;
    chosen.forEach((b, i) => {
      const part = i === chosen.length - 1 ? r2(left) : r2(total * (weights(b) / wsum));
      left -= part;
      const inp = root.querySelector(`[data-alloc-amt="${b}"]`); inp.value = part.toFixed(2);
    });
    refreshSum();
  };

  function bind() {
    const showErr = errorBox(modal, 'exp-error');
    root.querySelector('#exp-cancel').onclick = modal.close;
    root.querySelectorAll('input[name="exp-scope"]').forEach(r => r.addEventListener('change', async () => {
      scope = r.value; await loadServicesFor(scope === 'EDIFICIO' ? buildingId : null); draw();
    }));
    root.querySelector('#exp-building')?.addEventListener('change', async (e) => { buildingId = e.target.value; await loadServicesFor(buildingId); draw(); });
    root.querySelector('#exp-service')?.addEventListener('change', (e) => {
      const o = e.target.selectedOptions[0]; if (!o || !o.value) return;
      const cat = root.querySelector('#exp-category'); if (!cat.value) cat.value = o.dataset.cat || '';
      const prov = root.querySelector('#exp-provider'); if (!prov.value && o.dataset.prov) prov.value = o.dataset.prov;
      const amt = root.querySelector('#exp-amount'); if (!amt.value && o.dataset.amt) amt.value = o.dataset.amt;
      const concept = root.querySelector('#exp-concept'); if (!concept.value) concept.value = o.textContent.replace(' (inactivo)', '');
    });
    root.querySelectorAll('[data-alloc-check]').forEach(c => c.addEventListener('change', () => {
      const inp = root.querySelector(`[data-alloc-amt="${c.dataset.allocCheck}"]`);
      inp.disabled = !c.checked; if (!c.checked) inp.value = ''; refreshSum();
    }));
    root.querySelectorAll('[data-alloc-amt]').forEach(i => i.addEventListener('input', refreshSum));
    root.querySelector('#exp-amount').addEventListener('input', refreshSum);
    root.querySelector('#alloc-equal')?.addEventListener('click', () => distribute(() => 1));
    root.querySelector('#alloc-prop')?.addEventListener('click', () => distribute(b => (buildings.find(x => x.id === b) || {}).total_units || 1));
    refreshSum();

    root.querySelector('#exp-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const concept = root.querySelector('#exp-concept').value.trim();
      const amount = parseFloat(root.querySelector('#exp-amount').value);
      const period = readMonthYear(root, 'exp-period');
      if (!concept) return showErr('Escriba el concepto del gasto.');
      if (!(amount > 0)) return showErr('Ingrese un importe mayor a cero.');
      const payload = {
        id, scope, concept, amount, period_month: period,
        provider_id: root.querySelector('#exp-provider').value, category: root.querySelector('#exp-category').value,
        due_date: root.querySelector('#exp-due').value, observations: root.querySelector('#exp-obs').value
      };
      if (scope === 'EDIFICIO') { payload.building_id = buildingId; payload.service_id = root.querySelector('#exp-service').value; }
      if (scope === 'COMPARTIDO') {
        payload.allocations = [...root.querySelectorAll('[data-alloc-check]:checked')].map(c => ({
          building_id: c.dataset.allocCheck, amount: parseFloat(root.querySelector(`[data-alloc-amt="${c.dataset.allocCheck}"]`).value) || 0 }));
        if (payload.allocations.length < 2) return showErr('Elija al menos dos edificios para el reparto.');
        if (Math.abs(sumAllocs() - amount) > 0.01) return showErr('El reparto debe sumar exactamente el importe total.');
      }
      const btn = root.querySelector('#exp-save'); btn.disabled = true;
      try { await maintenanceService.saveExpense(payload); modal.close(); if (onSaved) await onSaved(); }
      catch (err) { showErr(err.message); btn.disabled = false; }
    });
  }
  draw();
}

/* ------------------------------------------------------------------ pagos y documentos de un gasto */
export async function openPaymentsModal({ expense, onChange, readOnly = false }) {
  const id = expense.expense_id || expense.id;
  const modal = openAppModal(`<i data-lucide="receipt" style="color: var(--primary);"></i> Pagos y documentos`, '<div id="pay-root">Cargando...</div>');
  const card = document.getElementById('modal-card'); card.classList.add('modal-wide');
  const overlay = document.getElementById('modal-container');
  const watcher = new MutationObserver(() => { if (overlay.classList.contains('hidden')) { card.classList.remove('modal-wide'); watcher.disconnect(); } });
  watcher.observe(overlay, { attributes: true, attributeFilter: ['class'] });
  const root = modal.$('pay-root');
  let current = expense;

  const draw = async () => {
    let payments, docs;
    try {
      [payments, docs] = await Promise.all([maintenanceService.loadPayments(id), maintenanceService.loadDocuments({ expenseId: id })]);
    } catch (err) { root.innerHTML = `<p class="form-error">${esc(err.message)}</p>`; return; }
    const valid = payments.filter(p => p.status === 'VALIDO');
    const paid = r2(valid.reduce((s, p) => s + Number(p.amount), 0));
    const total = Number(current.amount);
    const balance = Math.max(0, r2(total - paid));
    const voidedExpense = current.calc_status === 'ANULADO';

    root.innerHTML = `
      <div class="fee-info-box">
        <div><span>Concepto</span><strong>${esc(current.concept)}</strong></div>
        <div><span>Importe</span><strong>${formatCurrency(total)}</strong></div>
        <div><span>Pagado</span><strong>${formatCurrency(paid)}</strong></div>
        <div><span>Saldo</span><strong>${formatCurrency(balance)}</strong></div>
      </div>
      <h4 class="form-section">Pagos</h4>
      <div class="table-responsive"><table class="data-table pagos-table"><thead><tr><th>Fecha</th><th>Monto</th><th>Método</th><th>N.º operación</th><th>Registró</th><th>Estado</th><th style="text-align:right;">Acciones</th></tr></thead><tbody>
        ${payments.length ? payments.map(p => `<tr style="${p.status === 'ANULADO' ? 'opacity:.6;' : ''}">
          <td>${formatDate(p.payment_date)}</td><td style="white-space:nowrap;"><strong style="${p.status === 'ANULADO' ? 'text-decoration:line-through;' : ''}">${formatCurrency(p.amount)}</strong></td>
          <td>${esc(p.method)}</td><td>${esc(p.operation_number || '—')}</td><td>${esc(p.registered_by || '—')}</td>
          <td>${p.status === 'ANULADO' ? `<span class="badge badge-danger">Anulado</span><div class="cell-note">${esc(p.void_reason || '')}</div>` : '<span class="badge badge-success">Válido</span>'}${p.notes ? `<div class="cell-note">${esc(p.notes)}</div>` : ''}</td>
          <td style="text-align:right;">${(p.status === 'VALIDO' && !readOnly) ? `<button class="btn btn-outline btn-sm" data-void-pay="${p.id}" style="color: var(--status-danger);"><i data-lucide="ban"></i> Anular</button>` : ''}</td></tr>`).join('')
          : '<tr><td colspan="7" style="text-align:center; color: var(--text-dim);">Aún no hay pagos registrados.</td></tr>'}</tbody></table></div>

      ${(!readOnly && !voidedExpense && balance > 0) ? `
      <h4 class="form-section">Registrar pago</h4>
      <form id="pay-form" novalidate>
        <div class="form-grid">
          <div class="form-group"><label class="form-label" for="pf-amount">Monto (S/) *</label><input id="pf-amount" type="number" min="0.01" step="0.01" class="form-control" value="${balance.toFixed(2)}"></div>
          <div class="form-group"><label class="form-label" for="pf-date">Fecha de pago *</label><input id="pf-date" type="date" class="form-control" value="${todayStr()}" max="${todayStr()}"></div>
          <div class="form-group"><label class="form-label" for="pf-method">Método *</label><select id="pf-method" class="form-select">${PAYMENT_METHODS.map(m => `<option>${m}</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label" for="pf-op">N.º de operación o comprobante</label><input id="pf-op" class="form-control" maxlength="100"></div>
        </div>
        <div class="form-group"><label class="form-label" for="pf-notes">Observaciones</label><input id="pf-notes" class="form-control"></div>
        <div id="pf-error" class="form-error" hidden></div>
        <div style="display:flex; justify-content:flex-end;"><button type="submit" class="btn btn-primary" id="pf-save"><i data-lucide="check"></i> Registrar pago</button></div>
      </form>` : (balance === 0 && !voidedExpense ? '<p class="cell-note">El gasto está pagado por completo.</p>' : '')}

      <h4 class="form-section">Documentos</h4>
      <div class="table-responsive"><table class="data-table pagos-table"><thead><tr><th>Tipo</th><th>Archivo</th><th>Subido por</th><th>Fecha</th><th style="text-align:right;">Acciones</th></tr></thead><tbody>
        ${docs.length ? docs.map(d => `<tr><td>${esc(DOC_TYPES[d.doc_type] || d.doc_type)}</td><td>${esc(d.file_name)}</td><td>${esc(d.uploaded_by || '—')}</td><td>${formatDate(d.created_at)}</td>
          <td style="text-align:right; white-space:nowrap;"><button class="btn btn-outline btn-sm" data-doc-open="${d.id}"><i data-lucide="paperclip"></i> Ver</button>
            ${readOnly ? '' : `<button class="btn btn-outline btn-sm" data-doc-del="${d.id}" style="color: var(--status-danger);"><i data-lucide="trash-2"></i></button>`}</td></tr>`).join('')
          : '<tr><td colspan="5" style="text-align:center; color: var(--text-dim);">Sin documentos adjuntos.</td></tr>'}</tbody></table></div>
      ${readOnly ? '' : `<form id="doc-form" style="display:flex; gap:.5rem; flex-wrap:wrap; align-items:flex-end; margin-top:.75rem;">
        <div class="form-group" style="margin:0;"><label class="form-label" for="doc-type">Tipo</label>
          <select id="doc-type" class="form-select">${Object.entries(DOC_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div class="form-group" style="margin:0; flex:1; min-width:200px;"><label class="form-label" for="doc-file">Archivo (PDF o imagen, máx. 15 MB)</label>
          <input id="doc-file" type="file" class="form-control" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"></div>
        <button type="submit" class="btn btn-outline" id="doc-save"><i data-lucide="upload"></i> Adjuntar</button>
      </form>`}
      <div id="doc-error" class="form-error" hidden></div>`;
    if (window.lucide) window.lucide.createIcons();

    const showPf = errorBox(modal, 'pf-error'), showDoc = errorBox(modal, 'doc-error');
    const refreshOuter = async () => { if (onChange) { const fresh = await onChange(); if (fresh) current = fresh; } await draw(); };

    root.querySelector('#pay-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const amount = parseFloat(root.querySelector('#pf-amount').value);
      if (!(amount > 0)) return showPf('Ingrese un monto mayor a cero.');
      if (amount > balance + 0.001) return showPf(`El monto excede el saldo pendiente (${formatCurrency(balance)}).`);
      const btn = root.querySelector('#pf-save'); btn.disabled = true;
      try {
        await maintenanceService.registerPayment({ expenseId: id, amount, date: root.querySelector('#pf-date').value,
          method: root.querySelector('#pf-method').value, operation: root.querySelector('#pf-op').value, notes: root.querySelector('#pf-notes').value });
        await refreshOuter();
      } catch (err) { showPf(err.message); btn.disabled = false; }
    });
    root.querySelectorAll('[data-void-pay]').forEach(b => b.addEventListener('click', async () => {
      const reason = await promptDialog({ title: 'Anular pago', message: 'Escriba el motivo de la anulación (obligatorio). El pago no se borra: queda marcado como anulado.', label: 'Motivo', confirmText: 'Continuar' });
      if (reason === null) return;
      if (reason.trim().length < 3) return alertDialog({ tone: 'warning', message: 'Escriba un motivo de al menos 3 letras.' });
      if (!(await confirmDialog({ title: 'Confirmar anulación', message: '¿Anular este pago? El saldo del gasto volverá a subir.', confirmText: 'Anular pago', danger: true }))) return;
      try { await maintenanceService.voidPayment(b.dataset.voidPay, reason.trim()); await refreshOuter(); }
      catch (err) { alertDialog({ tone: 'danger', message: err.message }); }
    }));
    root.querySelector('#doc-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const file = root.querySelector('#doc-file').files[0];
      const bad = maintenanceService.validateFile(file); if (bad) return showDoc(bad);
      const btn = root.querySelector('#doc-save'); btn.disabled = true; showDoc('');
      try { await maintenanceService.uploadDocument({ expenseId: id, docType: root.querySelector('#doc-type').value, file }); await draw(); }
      catch (err) { showDoc(err.message); btn.disabled = false; }
    });
    root.querySelectorAll('[data-doc-open]').forEach(b => b.addEventListener('click', async () => {
      const d = docs.find(x => x.id === b.dataset.docOpen);
      openDocumentViewer(d, () => openPaymentsModal({ expense: current, onChange }));
    }));
    root.querySelectorAll('[data-doc-del]').forEach(b => b.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: 'Eliminar documento', message: 'Se eliminará el archivo adjunto. Esta acción no se puede deshacer.', confirmText: 'Eliminar', danger: true }))) return;
      try { await maintenanceService.deleteDocument(b.dataset.docDel); await draw(); }
      catch (err) { alertDialog({ tone: 'danger', message: err.message }); }
    }));
  };
  await draw();
}

/* ------------------------------------------------------------------ visor de documentos (dentro del sistema) */
export async function openDocumentViewer(doc, onBack) {
  const modal = openAppModal('<i data-lucide="paperclip" style="color: var(--primary);"></i> Documento', `
    <div class="fee-info-box"><div><span>Tipo</span><strong>${esc(DOC_TYPES[doc.doc_type] || doc.doc_type)}</strong></div>
      <div><span>Archivo</span><strong>${esc(doc.file_name)}</strong></div></div>
    <div id="dv-view" class="proof-view">Cargando documento...</div>
    <div id="dv-error" class="form-error" hidden></div>
    <div style="display:flex; gap:.75rem; justify-content:flex-end; flex-wrap:wrap; margin-top:1rem;">
      ${onBack ? '<button type="button" class="btn btn-secondary btn-sm" id="dv-back"><i data-lucide="arrow-left"></i> Volver a los pagos</button>' : ''}
      <span id="dv-actions"></span></div>`);
  modal.$('dv-back')?.addEventListener('click', onBack);
  try {
    const a = await maintenanceService.documentAccess(doc.file_path, doc.file_name, doc.bucket);
    modal.$('dv-view').innerHTML = a.isImage
      ? `<img src="${a.url}" alt="Documento" class="proof-full">`
      : `<iframe src="${a.url}" class="proof-frame" title="Documento PDF"></iframe>`;
    modal.$('dv-actions').innerHTML = `<a class="btn btn-primary btn-sm" href="${a.downloadUrl}" download="${esc(doc.file_name)}" target="_blank" rel="noopener"><i data-lucide="download"></i> Descargar</a>`;
    if (window.lucide) window.lucide.createIcons();
  } catch (err) {
    modal.$('dv-view').innerHTML = '';
    const e = modal.$('dv-error'); e.textContent = err.message; e.hidden = false;
  }
}
/* ------------------------------------------------------------------ otros ingresos */
export function openIncomeForm({ income, buildings, defaultBuildingId, allowGeneral, onSaved }) {
  const i0 = income || {};
  const current = income ? (income.building_id || '') : (defaultBuildingId || '');
  const modal = openAppModal(`<i data-lucide="plus-circle" style="color: var(--primary);"></i> ${income ? 'Editar ingreso' : 'Otro ingreso'}`, `
    <form id="inc-form" novalidate>
      <div class="form-grid">
        <div class="form-group"><label class="form-label" for="inc-building">Edificio</label>
          <select id="inc-building" class="form-select" ${income ? 'disabled' : ''}>
            ${allowGeneral ? `<option value="" ${current === '' ? 'selected' : ''}>General (sin edificio)</option>` : ''}
            ${buildings.map(b => `<option value="${b.id}" ${b.id === current ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label" for="inc-date">Fecha *</label><input id="inc-date" type="date" class="form-control" value="${esc(i0.income_date || todayStr())}" max="${todayStr()}"></div>
        <div class="form-group" style="grid-column: 1 / -1;"><label class="form-label" for="inc-concept">Concepto *</label><input id="inc-concept" class="form-control" maxlength="250" value="${esc(i0.concept)}" placeholder="Ej: Alquiler de la terraza"></div>
        <div class="form-group"><label class="form-label" for="inc-amount">Importe (S/) *</label><input id="inc-amount" type="number" min="0.01" step="0.01" class="form-control" value="${i0.amount ?? ''}"></div>
      </div>
      <div class="form-group"><label class="form-label" for="inc-notes">Observaciones</label><input id="inc-notes" class="form-control" value="${esc(i0.notes)}"></div>
      <div id="inc-error" class="form-error" hidden></div>
      <div style="display:flex; gap:1rem; justify-content:flex-end; margin-top:1rem;">
        <button type="button" class="btn btn-secondary" id="inc-cancel">Cancelar</button>
        <button type="submit" class="btn btn-primary" id="inc-save"><i data-lucide="save"></i> Guardar</button></div>
    </form>`);
  const showErr = errorBox(modal, 'inc-error');
  modal.$('inc-cancel').onclick = modal.close;
  modal.$('inc-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const concept = modal.$('inc-concept').value.trim(); const amount = parseFloat(modal.$('inc-amount').value);
    if (!concept) return showErr('Escriba el concepto.');
    if (!(amount > 0)) return showErr('Ingrese un importe mayor a cero.');
    const btn = modal.$('inc-save'); btn.disabled = true;
    try {
      await maintenanceService.saveOtherIncome({ id: income ? income.id : null, building_id: modal.$('inc-building').value,
        income_date: modal.$('inc-date').value, concept, amount, notes: modal.$('inc-notes').value });
      modal.close(); if (onSaved) await onSaved();
    } catch (err) { showErr(err.message); btn.disabled = false; }
  });
}

export { periodText };
