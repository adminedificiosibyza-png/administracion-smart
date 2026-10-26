/* Administración de usuarios y accesos: una cuenta por persona, con sus departamentos */
import { userAdminService } from '../../services/userAdminService.js';
import { confirmDialog, alertDialog, promptDialog } from '../../ui/dialog.js';
import { showCredentialsModal } from '../../ui/credentials.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const normalize = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const RELATIONS = { PROPIETARIO: 'Propietario', INQUILINO: 'Inquilino', OTRO: 'Otro' };

// Modal global de la aplicación
function openModal(title, bodyHTML) {
  const overlay = document.getElementById('modal-container');
  document.getElementById('modal-title').innerHTML = title;
  document.getElementById('modal-body').innerHTML = bodyHTML;
  overlay.classList.remove('hidden');
  const close = () => overlay.classList.add('hidden');
  document.getElementById('modal-close-btn').onclick = close;
  if (window.lucide) window.lucide.createIcons();
  return { overlay, close, $: id => document.getElementById(id) };
}

export function renderAdminUsuarios() {
  const container = document.createElement('div');
  container.className = 'fade-in';

  if (!userAdminService.isAvailable()) {
    container.innerHTML = `
      <div class="card" style="max-width: 640px;">
        <h2 class="card-title" style="margin-bottom: 0.5rem;"><i data-lucide="key-round"></i> Usuarios y Accesos</h2>
        <p>Esta pantalla crea cuentas reales y solo está disponible con Supabase conectado. En el modo demostración no hay cuentas que administrar.</p>
      </div>`;
    return container;
  }

  let people = [];
  let units = [];
  let search = '';

  /* ---------------- lista ---------------- */

  function chipsHTML(person) {
    if (!person.assignments.length) return '<span class="cell-note">Sin departamentos</span>';
    return person.assignments.map(a => {
      const u = a.units || {};
      const label = `${esc(u.buildings?.name || '')} · Dpto ${esc(u.code || '')} · ${RELATIONS[a.relation] || a.relation}`;
      const flags = (a.can_view_fees ? '' : ' · sin cuotas');
      return `<button type="button" class="assign-chip ${a.active ? '' : 'inactive'}" data-assignment-id="${a.id}" title="Editar asignación">${label}${flags}${a.active ? '' : ' (inactivo)'}</button>`;
    }).join('');
  }

  function rowsHTML() {
    const q = normalize(search);
    const filtered = people.filter(p => !q || normalize(p.full_name).includes(q) ||
      p.assignments.some(a => (a.units?.code || '').includes(q)));
    if (!filtered.length) {
      return `<tr><td colspan="4" style="text-align:center; color: var(--text-dim);">No hay personas que coincidan.</td></tr>`;
    }
    return filtered.map(p => `
      <tr>
        <td>
          <strong>${esc(p.full_name)}</strong>
          ${p.phone ? `<span class="cell-note">${esc(p.phone)}</span>` : ''}
        </td>
        <td><div class="chip-list">${chipsHTML(p)}</div></td>
        <td>${p.is_active ? '<span class="badge badge-success">Activo</span>' : '<span class="badge badge-neutral">Desactivado</span>'}</td>
        <td style="text-align:right; white-space:nowrap;">
          <button class="btn btn-outline btn-sm" data-act="assign" data-user="${p.id}"><i data-lucide="plus"></i> Departamento</button>
          <button class="btn btn-outline btn-sm" data-act="reset" data-user="${p.id}"><i data-lucide="key-round"></i> Nueva contraseña</button>
          <button class="btn btn-outline btn-sm" data-act="toggle" data-user="${p.id}">${p.is_active ? 'Desactivar' : 'Activar'}</button>
        </td>
      </tr>`).join('');
  }

  function updateRows() {
    const tbody = container.querySelector('#usuarios-tbody');
    if (!tbody) return;
    tbody.innerHTML = rowsHTML();
    bindRowActions(tbody);
    if (window.lucide) window.lucide.createIcons();
  }

  function renderShell() {
    container.innerHTML = `
      <div class="card" style="margin-bottom: 1.5rem;">
        <div class="card-header">
          <h2 class="card-title"><i data-lucide="key-round"></i> Usuarios y Accesos</h2>
          <button class="btn btn-primary btn-sm" id="btn-new-user"><i data-lucide="user-plus"></i> Nuevo usuario</button>
        </div>
        <p>Una cuenta por persona, con todos sus departamentos. Usted entrega el usuario (su nombre completo) y la contraseña.</p>
        <div class="form-group" style="margin: 1rem 0 0;">
          <input type="text" id="usuarios-search" class="form-control" placeholder="Buscar por nombre o departamento..." value="${esc(search)}" autocomplete="off">
        </div>
      </div>
      <div class="card">
        <div class="table-responsive">
          <table class="data-table">
            <thead><tr><th>Persona</th><th>Departamentos</th><th>Estado</th><th style="text-align:right;">Acciones</th></tr></thead>
            <tbody id="usuarios-tbody"></tbody>
          </table>
        </div>
      </div>`;
    updateRows();
    container.querySelector('#btn-new-user').addEventListener('click', openCreateModal);
    container.querySelector('#usuarios-search').addEventListener('input', (e) => { search = e.target.value; updateRows(); });
    if (window.lucide) window.lucide.createIcons();
  }

  function bindRowActions(tbody) {
    tbody.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', () => {
      const person = people.find(p => p.id === btn.dataset.user);
      if (!person) return;
      if (btn.dataset.act === 'assign') openAssignModal(person);
      if (btn.dataset.act === 'reset') resetPassword(person);
      if (btn.dataset.act === 'toggle') toggleActive(person);
    }));
    tbody.querySelectorAll('.assign-chip').forEach(chip => chip.addEventListener('click', () => {
      for (const p of people) {
        const a = p.assignments.find(x => x.id === chip.dataset.assignmentId);
        if (a) return openEditAssignmentModal(p, a);
      }
    }));
  }

  async function reload() {
    try {
      [people, units] = await Promise.all([userAdminService.listPeople(), userAdminService.listUnits()]);
      renderShell();
    } catch (err) {
      container.innerHTML = `
        <div class="card" style="text-align:center;">
          <p style="color: var(--status-danger); margin-bottom: 1rem;">${esc(err.message)}</p>
          <button class="btn btn-primary btn-sm" id="btn-retry-users">Reintentar</button>
        </div>`;
      container.querySelector('#btn-retry-users').addEventListener('click', () => { start(); });
    }
  }

  async function start() {
    container.innerHTML = '<div class="card" style="text-align:center; color: var(--text-dim);">Cargando usuarios...</div>';
    await reload();
  }

  /* ---------------- selectores edificio -> departamento ---------------- */

  function buildingOptions() {
    const seen = new Map();
    units.forEach(u => seen.set(u.building_id, u.buildings?.name || 'Edificio'));
    return [...seen.entries()].map(([id, name]) => `<option value="${id}">${esc(name)}</option>`).join('');
  }

  function bindUnitSelects(buildingSelect, unitSelect, withEmpty) {
    const fill = () => {
      const list = units.filter(u => u.building_id === buildingSelect.value);
      unitSelect.innerHTML = (withEmpty ? '<option value="">(sin departamento por ahora)</option>' : '') +
        list.map(u => `<option value="${u.id}">Dpto ${esc(u.code)}</option>`).join('');
    };
    buildingSelect.addEventListener('change', fill);
    fill();
  }

  const relationOptions = (selected = 'PROPIETARIO') =>
    Object.entries(RELATIONS).map(([v, l]) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${l}</option>`).join('');

  /* ---------------- credenciales (se muestran UNA vez) ---------------- */

  // Ventana compartida con el resto del sistema (incluye el PDF con QR); al cerrarla se recarga la lista
  function showCredentials(title, fullName, password, places = []) {
    showCredentialsModal(title, fullName, password, reload, places);
  }

  // Departamento y edificio de cada asignación, para la hoja de credenciales
  const placesFromUnitIds = ids => ids.map(id => units.find(u => u.id === id)).filter(Boolean)
    .map(u => ({ unit: u.code, building: (u.buildings && u.buildings.name) || '' }));
  /* ---------------- nuevo usuario ---------------- */

  function openCreateModal() {
    const modal = openModal('<i data-lucide="user-plus" style="color: var(--primary);"></i> Nuevo usuario', `
      <form id="new-user-form" novalidate>
        <div class="form-group">
          <label class="form-label" for="nu-name">Nombre completo (será su usuario)</label>
          <input type="text" id="nu-name" class="form-control input-upper" placeholder="Ej: JUANA LEONARDA VILCA CONDORI" required autocomplete="off">
        </div>
        <div class="form-grid">
          <div class="form-group">
            <label class="form-label" for="nu-phone">Teléfono (opcional)</label>
            <input type="tel" id="nu-phone" class="form-control" autocomplete="off">
          </div>
          <div class="form-group">
            <label class="form-label" for="nu-email">Correo de contacto (opcional)</label>
            <input type="email" id="nu-email" class="form-control" autocomplete="off">
          </div>
        </div>
        <div class="form-grid">
          <div class="form-group"><label class="form-label" for="nu-building">Edificio</label><select id="nu-building" class="form-select">${buildingOptions()}</select></div>
          <div class="form-group"><label class="form-label" for="nu-unit">Departamento</label><select id="nu-unit" class="form-select"></select></div>
          <div class="form-group"><label class="form-label" for="nu-relation">Relación</label><select id="nu-relation" class="form-select">${relationOptions()}</select></div>
        </div>
        <label class="checkbox-group" style="margin-top:0;">
          <input type="checkbox" id="nu-fees" checked>
          <span class="checkbox-label">Puede ver cuotas y pagos</span>
        </label>
        <div id="nu-error" class="form-error" hidden></div>
        <div id="nu-duplicate" class="form-warning" hidden></div>
        <div style="display:flex; gap:1rem; justify-content:flex-end; margin-top:1.25rem;">
          <button type="button" class="btn btn-secondary" id="nu-cancel">Cancelar</button>
          <button type="submit" class="btn btn-primary" id="nu-submit"><i data-lucide="check"></i> Crear usuario</button>
        </div>
      </form>`);

    bindUnitSelects(modal.$('nu-building'), modal.$('nu-unit'), true);
    modal.$('nu-cancel').onclick = modal.close;
    const showError = m => { const b = modal.$('nu-error'); b.textContent = m || ''; b.hidden = !m; };

    const collect = () => {
      const unitId = modal.$('nu-unit').value;
      return {
        fullName: modal.$('nu-name').value.trim().replace(/\s+/g, ' ').toLocaleUpperCase('es-PE'),
        phone: modal.$('nu-phone').value.trim(),
        contactEmail: modal.$('nu-email').value.trim(),
        assignments: unitId ? [{
          unit_id: unitId,
          relation: modal.$('nu-relation').value,
          can_view_fees: modal.$('nu-fees').checked
        }] : []
      };
    };

    const submit = async (distinguisher) => {
      showError('');
      modal.$('nu-duplicate').hidden = true;
      const btn = modal.$('nu-submit');
      btn.disabled = true;
      try {
        const data = collect();
        const result = await userAdminService.createUser({ ...data, distinguisher });
        showCredentials('Usuario creado', result.login_name || result.full_name, result.password,
          placesFromUnitIds(data.assignments.map(a => a.unit_id)));
      } catch (err) {
        btn.disabled = false;
        if (err.code === 'USERNAME_EXISTS') return askIfSamePerson(err.payload.existing);
        showError(err.message);
      }
    };

    // Ya existe alguien con ese nombre: ¿misma persona (solo asignar) u otra (crear aparte)?
    function askIfSamePerson(existing) {
      const box = modal.$('nu-duplicate');
      box.innerHTML = `
        <strong>Ya existe una persona con ese nombre: ${esc(existing.full_name)}.</strong>
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-top:0.6rem;">
          <button type="button" class="btn btn-primary btn-sm" id="dup-same">Es la misma persona: asignarle este departamento</button>
          <button type="button" class="btn btn-outline btn-sm" id="dup-other">Es otra persona: crear usuario aparte</button>
        </div>`;
      box.hidden = false;
      modal.$('dup-same').onclick = async () => {
        const data = collect();
        if (!data.assignments.length) { showError('Seleccione un departamento para asignarlo a la persona existente.'); return; }
        try {
          await userAdminService.assignUnit({
            userId: existing.id,
            unitId: data.assignments[0].unit_id,
            relation: data.assignments[0].relation,
            canViewFees: data.assignments[0].can_view_fees
          });
          modal.close();
          reload();
        } catch (e) { showError(e.message); }
      };
      modal.$('dup-other').onclick = async () => {
        const extra = await promptDialog({
          title: 'Diferenciar al usuario',
          message: 'Escriba un número o dato que distinga a esta persona (por ejemplo 2). Se agregará al final de su usuario.',
          label: 'Dato para diferenciar',
          defaultValue: '2'
        });
        if (extra) submit(extra);
      };
    }

    modal.$('new-user-form').onsubmit = (e) => { e.preventDefault(); submit(); };
  }

  /* ---------------- asignar / editar departamento ---------------- */

  function openAssignModal(person) {
    const modal = openModal(`<i data-lucide="plus" style="color: var(--primary);"></i> Asignar departamento a ${esc(person.full_name)}`, `
      <form id="assign-form" novalidate>
        <div class="form-grid">
          <div class="form-group"><label class="form-label" for="as-building">Edificio</label><select id="as-building" class="form-select">${buildingOptions()}</select></div>
          <div class="form-group"><label class="form-label" for="as-unit">Departamento</label><select id="as-unit" class="form-select"></select></div>
          <div class="form-group"><label class="form-label" for="as-relation">Relación</label><select id="as-relation" class="form-select">${relationOptions()}</select></div>
        </div>
        <label class="checkbox-group" style="margin-top:0;"><input type="checkbox" id="as-fees" checked><span class="checkbox-label">Puede ver cuotas y pagos</span></label>
        <div id="as-error" class="form-error" hidden></div>
        <div style="display:flex; gap:1rem; justify-content:flex-end; margin-top:1.25rem;">
          <button type="button" class="btn btn-secondary" id="as-cancel">Cancelar</button>
          <button type="submit" class="btn btn-primary">Asignar</button>
        </div>
      </form>`);
    bindUnitSelects(modal.$('as-building'), modal.$('as-unit'), false);
    modal.$('as-cancel').onclick = modal.close;
    modal.$('assign-form').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await userAdminService.assignUnit({
          userId: person.id,
          unitId: modal.$('as-unit').value,
          relation: modal.$('as-relation').value,
          canViewFees: modal.$('as-fees').checked
        });
        modal.close();
        reload();
      } catch (err) {
        const b = modal.$('as-error'); b.textContent = err.message; b.hidden = false;
      }
    };
  }

  function openEditAssignmentModal(person, a) {
    const u = a.units || {};
    const modal = openModal(`<i data-lucide="home" style="color: var(--primary);"></i> ${esc(person.full_name)} · Dpto ${esc(u.code || '')}`, `
      <form id="edit-as-form" novalidate>
        <p style="margin-bottom:1rem; font-size:0.9rem;">${esc(u.buildings?.name || '')} · Dpto ${esc(u.code || '')}</p>
        <div class="form-group"><label class="form-label" for="ea-relation">Relación</label><select id="ea-relation" class="form-select">${relationOptions(a.relation)}</select></div>
        <label class="checkbox-group" style="margin-top:0;"><input type="checkbox" id="ea-fees" ${a.can_view_fees ? 'checked' : ''}><span class="checkbox-label">Puede ver cuotas y pagos</span></label>
        <label class="checkbox-group"><input type="checkbox" id="ea-active" ${a.active ? 'checked' : ''}><span class="checkbox-label">Asignación activa (si se desmarca, deja de ver este departamento y queda el historial)</span></label>
        <div id="ea-error" class="form-error" hidden></div>
        <div style="display:flex; gap:1rem; justify-content:flex-end; margin-top:1.25rem;">
          <button type="button" class="btn btn-secondary" id="ea-cancel">Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>`);
    modal.$('ea-cancel').onclick = modal.close;
    modal.$('edit-as-form').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await userAdminService.updateAssignment(a.id, {
          relation: modal.$('ea-relation').value,
          canViewFees: modal.$('ea-fees').checked,
          active: modal.$('ea-active').checked
        });
        modal.close();
        reload();
      } catch (err) {
        const b = modal.$('ea-error'); b.textContent = err.message; b.hidden = false;
      }
    };
  }

  /* ---------------- contraseña y estado ---------------- */

  async function resetPassword(person) {
    const ok = await confirmDialog({
      title: 'Nueva contraseña',
      message: `Se generará una nueva contraseña para ${person.full_name}. La anterior dejará de funcionar.`,
      confirmText: 'Generar',
      danger: true
    });
    if (!ok) return;
    try {
      const result = await userAdminService.resetPassword(person.id);
      showCredentials('Nueva contraseña', result.login_name || result.full_name, result.password,
        placesFromUnitIds(person.assignments.filter(a => a.active).map(a => a.unit_id)));
    } catch (err) { alertDialog({ tone: 'danger', message: err.message }); }
  }

  async function toggleActive(person) {
    const verb = person.is_active ? 'desactivar' : 'activar';
    const ok = await confirmDialog({
      title: person.is_active ? 'Desactivar cuenta' : 'Activar cuenta',
      message: person.is_active
        ? `${person.full_name} dejará de poder ingresar. Sus datos y su historial se conservan.`
        : `${person.full_name} volverá a poder ingresar con su usuario y contraseña.`,
      confirmText: person.is_active ? 'Desactivar' : 'Activar',
      danger: person.is_active
    });
    if (!ok) return;
    try {
      await userAdminService.setActive(person.id, !person.is_active);
      reload();
    } catch (err) { alertDialog({ tone: 'danger', message: err.message }); }
  }

  start();
  return container;
}
