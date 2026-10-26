/* Departamentos y personas de un edificio (con Supabase) */
import { store } from '../../store.js';
import { activeBuilding } from '../../services/activeBuilding.js';
import { authService } from '../../services/authService.js';
import { unitAdminService } from '../../services/unitAdminService.js';
import { userAdminService } from '../../services/userAdminService.js';
import { openAppModal, showCredentialsModal } from '../../ui/credentials.js';
import { confirmDialog, alertDialog, promptDialog } from '../../ui/dialog.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const normalize = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const RELATIONS = { PROPIETARIO: 'Propietario', INQUILINO: 'Inquilino', OTRO: 'Otro' };
const STATUS = { OCUPADO: 'Ocupado', EN_ALQUILER: 'En alquiler', DESOCUPADO: 'Desocupado' };

export function renderAdminDirectorio() {
  const container = document.createElement('div');
  container.className = 'fade-in';

  const building = activeBuilding.get();
  if (!building) return container;

  let units = [];
  let search = '';
  let floorFilter = '';
  let onlyNoTitular = false;

  const relationOptions = (selected = 'PROPIETARIO') =>
    Object.entries(RELATIONS).map(([v, l]) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${l}</option>`).join('');

  /* ---------------- lista ---------------- */

  function filtered() {
    const q = normalize(search);
    return units.filter(u =>
      (!floorFilter || String(u.floor) === floorFilter) &&
      (!onlyNoTitular || !u.titular) &&
      (!q || normalize(u.code).includes(q) || u.people.some(p => p.active && normalize(p.full_name).includes(q))));
  }

  function personChip(p, unit) {
    return `<button type="button" class="assign-chip ${p.can_view_fees ? '' : 'no-fees'}" data-assignment="${p.assignment_id}" data-unit="${unit.id}"
              title="Editar asignación">${esc(p.full_name)} · ${RELATIONS[p.relation] || p.relation}${p.can_view_fees ? '' : ' · sin cuotas'}</button>`;
  }

  function rowsHTML() {
    const list = filtered();
    if (!list.length) {
      return `<tr><td colspan="6" style="text-align:center; color: var(--text-dim);">${units.length ? 'No hay departamentos que coincidan.' : 'Este edificio todavía no tiene departamentos. Use "Crear por piso" o "Agregar departamento".'}</td></tr>`;
    }
    return list.map(u => `
      <tr>
        <td><strong style="color: var(--primary);">Dpto ${esc(u.code)}</strong></td>
        <td>Piso ${u.floor}</td>
        <td>${u.titular
          ? `<strong>${esc(u.titular.full_name)}</strong>${u.titular.phone ? `<span class="cell-note">${esc(u.titular.phone)}</span>` : ''}
             <div class="chip-list" style="margin-top:0.25rem;">${personChip(u.titular, u)}</div>`
          : '<span class="badge badge-warning">Sin titular</span>'}</td>
        <td><div class="chip-list">${u.others.length ? u.others.map(p => personChip(p, u)).join('') : '<span class="cell-note">—</span>'}</div></td>
        <td><span class="badge ${u.status === 'OCUPADO' ? 'badge-success' : 'badge-neutral'}">${STATUS[u.status] || u.status}</span></td>
        <td style="text-align:right; white-space:nowrap;">
          <button class="btn btn-outline btn-sm" data-act="assign" data-unit="${u.id}"><i data-lucide="user-plus"></i> Persona</button>
          <button class="btn-icon" data-act="edit" data-unit="${u.id}" title="Editar departamento"><i data-lucide="square-pen"></i></button>
          <button class="btn-icon danger" data-act="delete" data-unit="${u.id}" title="Eliminar departamento"><i data-lucide="trash-2"></i></button>
        </td>
      </tr>`).join('');
  }

  function updateRows() {
    const tbody = container.querySelector('#dir-tbody');
    if (!tbody) return;
    tbody.innerHTML = rowsHTML();
    container.querySelector('#dir-counter').textContent = `${filtered().length} de ${units.length}`;

    tbody.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', () => {
      const unit = units.find(u => u.id === btn.dataset.unit);
      if (!unit) return;
      if (btn.dataset.act === 'assign') openAssignModal(unit);
      if (btn.dataset.act === 'edit') openUnitModal(unit);
      if (btn.dataset.act === 'delete') removeUnit(unit);
    }));
    tbody.querySelectorAll('.assign-chip').forEach(chip => chip.addEventListener('click', () => {
      const unit = units.find(u => u.id === chip.dataset.unit);
      const person = unit && unit.people.find(p => p.assignment_id === chip.dataset.assignment);
      if (person) openEditAssignmentModal(unit, person);
    }));
    if (window.lucide) window.lucide.createIcons();
  }

  function renderShell() {
    const floors = [...new Set(units.map(u => u.floor))].sort((a, b) => a - b);
    const withTitular = units.filter(u => u.titular).length;
    container.innerHTML = `
      <div class="card" style="margin-bottom: 1.5rem;">
        <div class="card-header">
          <h2 class="card-title"><i data-lucide="users"></i> Departamentos y Personas — ${esc(building.name)}</h2>
          <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
            <button class="btn btn-outline btn-sm" id="btn-bulk"><i data-lucide="layers"></i> Crear por piso</button>
            <button class="btn btn-primary btn-sm" id="btn-add-unit"><i data-lucide="plus"></i> Agregar departamento</button>
          </div>
        </div>
        <p>${units.length} departamento(s) · ${withTitular} con titular · ${units.length - withTitular} sin titular. Lo que se asigna aquí es lo que ve cada persona en su portal.</p>
        <div class="dir-toolbar">
          <input type="text" id="dir-search" class="form-control" placeholder="Buscar por departamento o nombre..." value="${esc(search)}" autocomplete="off">
          <select id="dir-floor" class="form-select">
            <option value="">Todos los pisos</option>
            ${floors.map(f => `<option value="${f}" ${String(f) === floorFilter ? 'selected' : ''}>Piso ${f}</option>`).join('')}
          </select>
          <label class="checkbox-inline"><input type="checkbox" id="dir-notitular" ${onlyNoTitular ? 'checked' : ''}> Solo sin titular</label>
          <span class="cell-note" id="dir-counter" style="margin:0;"></span>
        </div>
      </div>
      <div class="card">
        <div class="table-responsive">
          <table class="data-table">
            <thead><tr><th>Dpto.</th><th>Piso</th><th>Titular</th><th>Otras personas</th><th>Estado</th><th style="text-align:right;">Acciones</th></tr></thead>
            <tbody id="dir-tbody"></tbody>
          </table>
        </div>
      </div>`;
    updateRows();
    container.querySelector('#btn-add-unit').addEventListener('click', () => openUnitModal(null));
    container.querySelector('#btn-bulk').addEventListener('click', openBulkModal);
    container.querySelector('#dir-search').addEventListener('input', (e) => { search = e.target.value; updateRows(); });
    container.querySelector('#dir-floor').addEventListener('change', (e) => { floorFilter = e.target.value; updateRows(); });
    container.querySelector('#dir-notitular').addEventListener('change', (e) => { onlyNoTitular = e.target.checked; updateRows(); });
    if (window.lucide) window.lucide.createIcons();
  }

  async function reload() {
    try {
      units = await unitAdminService.listDirectory(building.id);
      await authService.loadContext(); // los totales del edificio (barra lateral) se mantienen al día
      renderShell();
    } catch (err) {
      container.innerHTML = `
        <div class="card" style="text-align:center;">
          <p style="color: var(--status-danger); margin-bottom: 1rem;">${esc(err.message)}</p>
          <button class="btn btn-primary btn-sm" id="btn-retry-dir">Reintentar</button>
        </div>`;
      container.querySelector('#btn-retry-dir').addEventListener('click', () => { start(); });
    }
  }

  async function start() {
    container.innerHTML = '<div class="card" style="text-align:center; color: var(--text-dim);">Cargando departamentos...</div>';
    await reload();
  }

  /* ---------------- departamento: agregar / editar / eliminar ---------------- */

  function openUnitModal(unit) {
    const editing = !!unit;
    const modal = openAppModal(
      `<i data-lucide="home" style="color: var(--primary);"></i> ${editing ? `Editar Dpto ${esc(unit.code)}` : 'Agregar departamento'}`, `
      <form id="unit-form" novalidate>
        <div class="form-grid">
          <div class="form-group"><label class="form-label" for="uf-code">Número *</label>
            <input type="text" id="uf-code" class="form-control" maxlength="10" value="${esc(unit ? unit.code : '')}" placeholder="Ej: 101" required></div>
          <div class="form-group"><label class="form-label" for="uf-floor">Piso *</label>
            <input type="number" id="uf-floor" class="form-control" min="0" max="100" step="1" value="${unit ? unit.floor : ''}" required></div>
          <div class="form-group"><label class="form-label" for="uf-status">Estado de ocupación</label>
            <select id="uf-status" class="form-select">
              ${Object.entries(STATUS).map(([v, l]) => `<option value="${v}" ${(unit ? unit.status : 'OCUPADO') === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select></div>
        </div>
        <div id="uf-error" class="form-error" hidden></div>
        <div style="display:flex; gap:1rem; justify-content:flex-end; margin-top:1.25rem;">
          <button type="button" class="btn btn-secondary" id="uf-cancel">Cancelar</button>
          <button type="submit" class="btn btn-primary" id="uf-submit">${editing ? 'Guardar' : 'Agregar'}</button>
        </div>
      </form>`);

    modal.$('uf-cancel').onclick = modal.close;
    modal.$('unit-form').onsubmit = async (e) => {
      e.preventDefault();
      const err = modal.$('uf-error');
      err.hidden = true;
      const submit = modal.$('uf-submit');
      submit.disabled = true;
      try {
        await unitAdminService.saveUnit({
          id: editing ? unit.id : null,
          building_id: building.id,
          code: modal.$('uf-code').value,
          floor: parseInt(modal.$('uf-floor').value, 10),
          status: modal.$('uf-status').value
        });
        modal.close();
        reload();
      } catch (ex) {
        err.textContent = ex.message; err.hidden = false; submit.disabled = false;
      }
    };
  }

  async function removeUnit(unit) {
    const ok = await confirmDialog({
      title: `Eliminar Dpto ${unit.code}`,
      message: 'Se eliminará el departamento del edificio. Solo es posible si no tiene personas asignadas ni cuotas, pagos o reservas.',
      confirmText: 'Eliminar',
      danger: true
    });
    if (!ok) return;
    try {
      await unitAdminService.deleteUnit(unit.id);
      reload();
    } catch (err) { alertDialog({ tone: 'danger', message: err.message }); }
  }

  /* ---------------- crear varios departamentos por piso ---------------- */

  function openBulkModal() {
    const modal = openAppModal('<i data-lucide="layers" style="color: var(--primary);"></i> Crear departamentos por piso', `
      <p style="font-size:0.9rem; margin-bottom:1rem;">Indique cuántos departamentos tiene cada piso. Se numeran como <strong>piso + 01, 02, 03…</strong>
        (piso 1 → 101, 102…; piso 10 → 1001, 1002…). Los que ya existen se omiten.</p>
      <div class="bulk-fill">
        <span>Rellenar pisos del</span><input type="number" id="bk-from" min="1" max="100" value="1" class="form-control">
        <span>al</span><input type="number" id="bk-to" min="1" max="100" value="${Math.max(1, building.total_floors || 1)}" class="form-control">
        <span>con</span><input type="number" id="bk-count" min="1" max="30" value="5" class="form-control">
        <span>por piso</span>
        <button type="button" class="btn btn-outline btn-sm" id="bk-fill">Rellenar</button>
      </div>
      <div id="bk-rows" class="bulk-rows"></div>
      <button type="button" class="btn btn-outline btn-sm" id="bk-add" style="margin-top:0.5rem;"><i data-lucide="plus"></i> Agregar piso</button>
      <p class="cell-note" id="bk-total" style="margin-top:0.75rem;"></p>
      <div id="bk-error" class="form-error" hidden></div>
      <div style="display:flex; gap:1rem; justify-content:flex-end; margin-top:1.25rem;">
        <button type="button" class="btn btn-secondary" id="bk-cancel">Cancelar</button>
        <button type="button" class="btn btn-primary" id="bk-submit">Crear departamentos</button>
      </div>`);

    const rows = []; // { floor, count }
    const draw = () => {
      modal.$('bk-rows').innerHTML = rows.map((r, i) => `
        <div class="bulk-row">
          <label>Piso <input type="number" min="1" max="100" value="${r.floor}" data-i="${i}" data-k="floor" class="form-control"></label>
          <label>Departamentos <input type="number" min="1" max="30" value="${r.count}" data-i="${i}" data-k="count" class="form-control"></label>
          <button type="button" class="btn-icon danger" data-del="${i}" title="Quitar"><i data-lucide="x"></i></button>
        </div>`).join('') || '<p class="cell-note">Aún no hay pisos en la lista.</p>';
      modal.$('bk-total').textContent = `Se crearán hasta ${rows.reduce((s, r) => s + (Number(r.count) || 0), 0)} departamentos.`;
      modal.$('bk-rows').querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => {
        rows[Number(inp.dataset.i)][inp.dataset.k] = parseInt(inp.value, 10) || 0;
        modal.$('bk-total').textContent = `Se crearán hasta ${rows.reduce((s, r) => s + (Number(r.count) || 0), 0)} departamentos.`;
      }));
      modal.$('bk-rows').querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { rows.splice(Number(b.dataset.del), 1); draw(); }));
      if (window.lucide) window.lucide.createIcons();
    };

    modal.$('bk-fill').onclick = () => {
      const from = parseInt(modal.$('bk-from').value, 10), to = parseInt(modal.$('bk-to').value, 10), count = parseInt(modal.$('bk-count').value, 10);
      if (!(from >= 1 && to >= from && count >= 1)) return;
      for (let f = from; f <= to; f++) {
        const existing = rows.find(r => r.floor === f);
        if (existing) existing.count = count; else rows.push({ floor: f, count });
      }
      rows.sort((a, b) => a.floor - b.floor);
      draw();
    };
    modal.$('bk-add').onclick = () => { rows.push({ floor: (rows.length ? rows[rows.length - 1].floor + 1 : 1), count: 5 }); draw(); };
    modal.$('bk-cancel').onclick = modal.close;
    modal.$('bk-submit').onclick = async () => {
      const err = modal.$('bk-error');
      err.hidden = true;
      const btn = modal.$('bk-submit');
      btn.disabled = true;
      try {
        const created = await unitAdminService.createUnitsBulk(building.id, rows);
        modal.close();
        await reload();
        alertDialog({
          tone: created > 0 ? 'success' : 'info',
          title: created > 0 ? 'Departamentos creados' : 'Sin cambios',
          message: created > 0 ? `Se crearon ${created} departamentos.` : 'Todos esos departamentos ya existían.'
        });
      } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
    };
    draw();
  }

  /* ---------------- personas: asignar / editar ---------------- */

  async function openAssignModal(unit) {
    let people = [];
    try { people = await unitAdminService.listPeople(); } catch (err) { alertDialog({ tone: 'danger', message: err.message }); return; }
    const assignedIds = new Set(unit.people.filter(p => p.active).map(p => p.user_id));
    const available = people.filter(p => !assignedIds.has(p.id));

    const modal = openAppModal(`<i data-lucide="user-plus" style="color: var(--primary);"></i> Persona en Dpto ${esc(unit.code)}`, `
      <div class="tab-switch">
        <button type="button" class="tab-btn active" data-tab="existing">Persona existente</button>
        <button type="button" class="tab-btn" data-tab="new">Persona nueva</button>
      </div>
      <form id="assign-form" novalidate>
        <div id="tab-existing">
          <div class="form-group">
            <label class="form-label" for="ap-person">Persona</label>
            <select id="ap-person" class="form-select">
              ${available.length ? available.map(p => `<option value="${p.id}">${esc(p.full_name)}</option>`).join('') : '<option value="">(no hay más personas registradas)</option>'}
            </select>
          </div>
        </div>
        <div id="tab-new" hidden>
          <div class="form-group"><label class="form-label" for="ap-name">Nombre completo (será su usuario) *</label>
            <input type="text" id="ap-name" class="form-control input-upper" autocomplete="off" placeholder="Ej: JUANA LEONARDA VILCA CONDORI"></div>
          <div class="form-grid">
            <div class="form-group"><label class="form-label" for="ap-phone">Teléfono (opcional)</label><input type="tel" id="ap-phone" class="form-control" autocomplete="off"></div>
            <div class="form-group"><label class="form-label" for="ap-email">Correo de contacto (opcional)</label><input type="email" id="ap-email" class="form-control" autocomplete="off"></div>
          </div>
        </div>
        <div class="form-grid">
          <div class="form-group"><label class="form-label" for="ap-relation">Relación</label>
            <select id="ap-relation" class="form-select">${relationOptions(unit.titular ? 'INQUILINO' : 'PROPIETARIO')}</select></div>
        </div>
        <label class="checkbox-group" style="margin-top:0;"><input type="checkbox" id="ap-fees" checked><span class="checkbox-label">Puede ver cuotas y pagos</span></label>
        ${unit.titular ? `<p class="cell-note" id="ap-hint">Este departamento ya tiene titular: <strong>${esc(unit.titular.full_name)}</strong>. La cobranza seguirá mostrando a esa persona.</p>` : ''}
        <div id="ap-error" class="form-error" hidden></div>
        <div id="ap-duplicate" class="form-warning" hidden></div>
        <div style="display:flex; gap:1rem; justify-content:flex-end; margin-top:1.25rem;">
          <button type="button" class="btn btn-secondary" id="ap-cancel">Cancelar</button>
          <button type="submit" class="btn btn-primary" id="ap-submit">Asignar</button>
        </div>
      </form>`);

    let tab = 'existing';
    modal.$('ap-cancel').onclick = modal.close;
    document.querySelectorAll('#modal-body .tab-btn').forEach(btn => btn.addEventListener('click', () => {
      tab = btn.dataset.tab;
      document.querySelectorAll('#modal-body .tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      modal.$('tab-existing').hidden = tab !== 'existing';
      modal.$('tab-new').hidden = tab !== 'new';
      modal.$('ap-submit').textContent = tab === 'new' ? 'Crear y asignar' : 'Asignar';
    }));

    const showError = m => { const b = modal.$('ap-error'); b.textContent = m || ''; b.hidden = !m; };
    const assignment = () => ({ unit_id: unit.id, relation: modal.$('ap-relation').value, can_view_fees: modal.$('ap-fees').checked });

    const createNew = async (distinguisher) => {
      modal.$('ap-duplicate').hidden = true;
      const btn = modal.$('ap-submit');
      btn.disabled = true;
      try {
        const result = await userAdminService.createUser({
          fullName: modal.$('ap-name').value.trim().replace(/\s+/g, ' ').toLocaleUpperCase('es-PE'),
          phone: modal.$('ap-phone').value.trim(),
          contactEmail: modal.$('ap-email').value.trim(),
          assignments: [assignment()],
          distinguisher
        });
        showCredentialsModal('Persona creada y asignada', result.login_name || result.full_name, result.password, reload,
          [{ unit: unit.code, building: building ? building.name : '' }]);
      } catch (err) {
        btn.disabled = false;
        if (err.code === 'USERNAME_EXISTS') return askIfSame(err.payload.existing);
        showError(err.message);
      }
    };

    // Ya existe alguien con ese nombre: ¿misma persona (solo asignar) u otra (crear aparte)?
    function askIfSame(existing) {
      const box = modal.$('ap-duplicate');
      box.innerHTML = `
        <strong>Ya existe una persona con ese nombre: ${esc(existing.full_name)}.</strong>
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-top:0.6rem;">
          <button type="button" class="btn btn-primary btn-sm" id="dup-same">Es la misma persona: asignarla a este departamento</button>
          <button type="button" class="btn btn-outline btn-sm" id="dup-other">Es otra persona: crear usuario aparte</button>
        </div>`;
      box.hidden = false;
      modal.$('dup-same').onclick = async () => {
        try {
          const a = assignment();
          await userAdminService.assignUnit({ userId: existing.id, unitId: a.unit_id, relation: a.relation, canViewFees: a.can_view_fees });
          modal.close();
          reload();
        } catch (err) { showError(err.message); }
      };
      modal.$('dup-other').onclick = async () => {
        const extra = await promptDialog({
          title: 'Diferenciar al usuario',
          message: 'Escriba un número o dato que distinga a esta persona (por ejemplo 2). Se agregará al final de su usuario.',
          label: 'Dato para diferenciar', defaultValue: '2'
        });
        if (extra) createNew(extra);
      };
    }

    modal.$('assign-form').onsubmit = async (e) => {
      e.preventDefault();
      showError('');
      if (tab === 'new') return createNew();
      const userId = modal.$('ap-person').value;
      if (!userId) { showError('Seleccione una persona o cree una nueva.'); return; }
      const btn = modal.$('ap-submit');
      btn.disabled = true;
      try {
        const a = assignment();
        await userAdminService.assignUnit({ userId, unitId: a.unit_id, relation: a.relation, canViewFees: a.can_view_fees });
        modal.close();
        reload();
      } catch (err) { showError(err.message); btn.disabled = false; }
    };
  }

  function openEditAssignmentModal(unit, person) {
    const modal = openAppModal(`<i data-lucide="user" style="color: var(--primary);"></i> ${esc(person.full_name)} · Dpto ${esc(unit.code)}`, `
      <form id="edit-form" novalidate>
        <div class="form-group"><label class="form-label" for="ed-relation">Relación</label>
          <select id="ed-relation" class="form-select">${relationOptions(person.relation)}</select></div>
        <label class="checkbox-group" style="margin-top:0;"><input type="checkbox" id="ed-fees" ${person.can_view_fees ? 'checked' : ''}><span class="checkbox-label">Puede ver cuotas y pagos</span></label>
        <label class="checkbox-group"><input type="checkbox" id="ed-active" ${person.active ? 'checked' : ''}><span class="checkbox-label">Asignación activa (si se desmarca, deja de ver este departamento y queda el historial)</span></label>
        <div id="ed-error" class="form-error" hidden></div>
        <div style="display:flex; gap:1rem; justify-content:flex-end; margin-top:1.25rem;">
          <button type="button" class="btn btn-secondary" id="ed-cancel">Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>`);
    modal.$('ed-cancel').onclick = modal.close;
    modal.$('edit-form').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await userAdminService.updateAssignment(person.assignment_id, {
          relation: modal.$('ed-relation').value,
          canViewFees: modal.$('ed-fees').checked,
          active: modal.$('ed-active').checked
        });
        modal.close();
        reload();
      } catch (err) { const b = modal.$('ed-error'); b.textContent = err.message; b.hidden = false; }
    };
  }

  start();
  return container;
}
