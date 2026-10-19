/* Gestión de edificios: lista, alta, edición, desactivación y orden manual */
import { buildingAdminService } from '../../services/buildingAdminService.js';
import { authService } from '../../services/authService.js';
import { formatCurrency } from '../../config.js';
import { confirmDialog, alertDialog } from '../../ui/dialog.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const normalize = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

function openModal(title, bodyHTML) {
  const overlay = document.getElementById('modal-container');
  document.getElementById('modal-title').innerHTML = title;
  document.getElementById('modal-body').innerHTML = bodyHTML;
  overlay.classList.remove('hidden');
  const close = () => overlay.classList.add('hidden');
  document.getElementById('modal-close-btn').onclick = close;
  if (window.lucide) window.lucide.createIcons();
  return { close, $: id => document.getElementById(id) };
}

export function renderAdminEdificios() {
  const container = document.createElement('div');
  container.className = 'fade-in';

  if (!buildingAdminService.isAvailable()) {
    container.innerHTML = `
      <div class="card" style="max-width: 640px;">
        <h2 class="card-title" style="margin-bottom: 0.5rem;"><i data-lucide="building-2"></i> Gestión de Edificios</h2>
        <p>Esta pantalla administra edificios reales y solo está disponible con Supabase conectado.</p>
      </div>`;
    return container;
  }

  let buildings = [];
  let search = '';
  let showInactive = false;
  let highlightId = null;

  /* ---------------- lista ---------------- */

  const visible = () => {
    const q = normalize(search);
    return buildings.filter(b =>
      (showInactive || b.is_active) &&
      (!q || [b.name, b.legal_name, b.tax_id, b.code].some(v => normalize(v).includes(q))));
  };

  function rowHTML(b, canDrag) {
    const rule = b.rule;
    return `
      <div class="building-row ${b.is_active ? '' : 'inactive'} ${b.id === highlightId ? 'highlight' : ''}" data-id="${b.id}" ${canDrag ? 'draggable="true"' : ''}>
        <span class="drag-handle ${canDrag ? '' : 'disabled'}" title="${canDrag ? 'Arrastre para ordenar' : 'Borre la búsqueda para ordenar'}"><i data-lucide="grip-vertical"></i></span>
        <div class="building-avatar-lg" style="background: ${esc(b.brand_color)};">${esc((b.name || '?').trim()[0].toUpperCase())}</div>
        <div class="building-main">
          <strong>${esc(b.name)}</strong>
          <div class="building-tags">
            <span class="tag">${esc(b.code)}</span>
            ${b.tax_id ? `<span class="tag tag-primary">RUC: ${esc(b.tax_id)}</span>` : ''}
            ${b.is_active ? '' : '<span class="tag tag-muted">Inactivo</span>'}
          </div>
          ${b.legal_name ? `<span class="cell-note">${esc(b.legal_name)}</span>` : ''}
          <span class="cell-note">${esc(b.address)}${b.city ? ' · ' + esc(b.city) : ''}</span>
        </div>
        <div class="building-metrics">
          <div><span>Departamentos</span><strong>${b.unit_count}</strong></div>
          <div><span>Cuota</span><strong>${formatCurrency(b.default_fee)}</strong></div>
          <div><span>Vence</span><strong>día ${b.default_due_day}</strong></div>
          <div><span>Mora</span><strong>${rule ? `${Number(rule.rate_percent)} % diario` : '—'}${rule && rule.grace_days ? ` · ${rule.grace_days} d gracia` : ''}</strong></div>
        </div>
        <div class="building-actions">
          <button class="btn-icon" data-act="edit" data-id="${b.id}" title="Editar"><i data-lucide="square-pen"></i></button>
          <button class="btn-icon ${b.is_active ? 'danger' : 'ok'}" data-act="toggle" data-id="${b.id}" title="${b.is_active ? 'Desactivar' : 'Reactivar'}">
            <i data-lucide="${b.is_active ? 'ban' : 'rotate-ccw'}"></i>
          </button>
        </div>
      </div>`;
  }

  function renderList() {
    const list = container.querySelector('#building-list');
    const counter = container.querySelector('#building-counter');
    if (!list) return;
    const items = visible();
    const canDrag = !search.trim(); // se ordena solo sin búsqueda activa
    list.innerHTML = items.length
      ? items.map(b => rowHTML(b, canDrag)).join('')
      : '<div class="card" style="text-align:center; color: var(--text-dim);">No hay edificios que coincidan.</div>';
    counter.textContent = `${items.length} / ${buildings.length}`;
    bindList(list);
    if (window.lucide) window.lucide.createIcons();
  }

  function bindList(list) {
    list.querySelectorAll('[data-act="edit"]').forEach(btn => btn.addEventListener('click', () => {
      openForm(buildings.find(b => b.id === btn.dataset.id));
    }));
    list.querySelectorAll('[data-act="toggle"]').forEach(btn => btn.addEventListener('click', () => {
      toggleActive(buildings.find(b => b.id === btn.dataset.id));
    }));

    // Arrastrar para reordenar (HTML5 drag & drop)
    let dragId = null;
    list.querySelectorAll('.building-row[draggable="true"]').forEach(row => {
      row.addEventListener('dragstart', () => { dragId = row.dataset.id; row.classList.add('dragging'); });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
      row.addEventListener('dragover', (e) => e.preventDefault());
      row.addEventListener('drop', async (e) => {
        e.preventDefault();
        if (!dragId || dragId === row.dataset.id) return;
        const ids = buildings.map(b => b.id);
        ids.splice(ids.indexOf(dragId), 1);
        ids.splice(ids.indexOf(row.dataset.id), 0, dragId);
        try {
          await buildingAdminService.reorder(ids);
          await reload();
        } catch (err) { alertDialog({ tone: 'danger', message: err.message }); }
      });
    });
  }

  function renderShell() {
    container.innerHTML = `
      <div class="card" style="margin-bottom: 1.5rem;">
        <div class="card-header">
          <h2 class="card-title"><i data-lucide="building-2"></i> Gestión de Edificios</h2>
        </div>
        <p>Cree y configure los edificios que administra. Cada edificio tiene sus propios departamentos, personas, cuota y regla de mora.</p>
        <div class="building-toolbar">
          <button class="btn btn-primary btn-sm" id="btn-new-building"><i data-lucide="plus"></i> Nuevo edificio</button>
          <input type="text" id="building-search" class="form-control" placeholder="Buscar por nombre, razón social, RUC o código..." value="${esc(search)}" autocomplete="off">
          <label class="checkbox-inline"><input type="checkbox" id="building-inactive" ${showInactive ? 'checked' : ''}> Mostrar inactivos</label>
          <span class="cell-note" id="building-counter" style="margin:0;"></span>
        </div>
      </div>
      <div id="building-list" class="building-list"></div>`;
    renderList();
    container.querySelector('#btn-new-building').addEventListener('click', () => openForm(null));
    container.querySelector('#building-search').addEventListener('input', (e) => { search = e.target.value; renderList(); });
    container.querySelector('#building-inactive').addEventListener('change', (e) => { showInactive = e.target.checked; renderList(); });
    if (window.lucide) window.lucide.createIcons();
  }

  async function reload() {
    try {
      buildings = await buildingAdminService.list();
      // Mantiene actualizada la lista de edificios de la sesión (selectores de otras pantallas)
      await authService.loadContext();
      renderShell();
      if (highlightId) setTimeout(() => { highlightId = null; }, 3500);
    } catch (err) {
      container.innerHTML = `
        <div class="card" style="text-align:center;">
          <p style="color: var(--status-danger); margin-bottom: 1rem;">${esc(err.message)}</p>
          <button class="btn btn-primary btn-sm" id="btn-retry-buildings">Reintentar</button>
        </div>`;
      container.querySelector('#btn-retry-buildings').addEventListener('click', () => { start(); });
    }
  }

  async function start() {
    container.innerHTML = '<div class="card" style="text-align:center; color: var(--text-dim);">Cargando edificios...</div>';
    await reload();
  }

  /* ---------------- formulario ---------------- */

  function openForm(b) {
    const editing = !!b;
    const v = b || { name: '', code: '', legal_name: '', tax_id: '', address: '', city: 'Arequipa', country: 'Perú',
      total_floors: 1, total_units: 0, default_fee: 150, default_due_day: 5, brand_color: '#4f7609', rule: null };
    const rule = v.rule || { rate_percent: 0.10, grace_days: 0 };

    const modal = openModal(
      `<i data-lucide="building-2" style="color: var(--primary);"></i> ${editing ? 'Editar edificio' : 'Nuevo edificio'}`, `
      <form id="building-form" novalidate>
        <h4 class="form-section">Identidad</h4>
        <div class="form-grid">
          <div class="form-group"><label class="form-label" for="bf-name">Nombre del edificio *</label>
            <input type="text" id="bf-name" class="form-control" value="${esc(v.name)}" required></div>
          <div class="form-group"><label class="form-label" for="bf-code">Código *</label>
            <input type="text" id="bf-code" class="form-control" value="${esc(v.code)}" maxlength="10" placeholder="Ej: PK10" ${editing ? 'readonly' : ''} required>
            ${editing ? '<span class="cell-note">El código no se puede cambiar.</span>' : '<span class="cell-note">De 2 a 10 letras o números, sin espacios.</span>'}</div>
          <div class="form-group"><label class="form-label" for="bf-legal">Razón social (opcional)</label>
            <input type="text" id="bf-legal" class="form-control" value="${esc(v.legal_name)}"></div>
          <div class="form-group"><label class="form-label" for="bf-tax">RUC (opcional)</label>
            <input type="text" id="bf-tax" class="form-control" value="${esc(v.tax_id)}" inputmode="numeric" maxlength="11"></div>
        </div>

        <h4 class="form-section">Ubicación y estructura</h4>
        <div class="form-grid">
          <div class="form-group" style="grid-column: 1 / -1;"><label class="form-label" for="bf-address">Dirección *</label>
            <input type="text" id="bf-address" class="form-control" value="${esc(v.address)}" required></div>
          <div class="form-group"><label class="form-label" for="bf-city">Ciudad</label>
            <input type="text" id="bf-city" class="form-control" value="${esc(v.city)}"></div>
          <div class="form-group"><label class="form-label" for="bf-country">País</label>
            <input type="text" id="bf-country" class="form-control" value="${esc(v.country)}"></div>
          <div class="form-group"><label class="form-label" for="bf-floors">Pisos *</label>
            <input type="number" id="bf-floors" class="form-control" min="1" step="1" value="${v.total_floors}" required></div>
          <div class="form-group"><label class="form-label">Departamentos</label>
            <input type="text" class="form-control" value="${editing ? `${b.unit_count} registrados` : 'Se crean después'}" readonly>
            <span class="cell-note">Se gestionan en "Departamentos y Personas" del edificio.</span></div>
        </div>

        <h4 class="form-section">Cobranza</h4>
        <div class="form-grid">
          <div class="form-group"><label class="form-label" for="bf-fee">Cuota mensual por defecto (S/) *</label>
            <input type="number" id="bf-fee" class="form-control" min="0.01" step="0.01" value="${v.default_fee}" required></div>
          <div class="form-group"><label class="form-label" for="bf-due">Día de vencimiento *</label>
            <input type="number" id="bf-due" class="form-control" min="1" max="28" step="1" value="${v.default_due_day}" required></div>
          <div class="form-group"><label class="form-label" for="bf-rate">Mora (% diario) *</label>
            <input type="number" id="bf-rate" class="form-control" min="0" max="100" step="0.01" value="${Number(rule.rate_percent)}" required></div>
          <div class="form-group"><label class="form-label" for="bf-grace">Días de gracia</label>
            <input type="number" id="bf-grace" class="form-control" min="0" step="1" value="${rule.grace_days ?? 0}"></div>
        </div>

        <h4 class="form-section">Características</h4>
        <div class="form-grid">
          <div class="form-group"><label class="form-label" for="bf-elev">Ascensores</label>
            <input type="number" id="bf-elev" class="form-control" min="0" step="1" value="${v.elevators_count ?? 0}"></div>
          <div class="form-group"><label class="form-label" for="bf-park">Estacionamientos</label>
            <input type="number" id="bf-park" class="form-control" min="0" step="1" value="${v.parking_spots_count ?? 0}"></div>
          <div class="form-group"><label class="form-label" for="bf-base">Sótanos</label>
            <input type="number" id="bf-base" class="form-control" min="0" step="1" value="${v.basements_count ?? 0}"></div>
          <div class="form-group"><label class="form-label" for="bf-doors">Puertas de garaje</label>
            <input type="number" id="bf-doors" class="form-control" min="0" step="1" value="${v.garage_doors_count ?? 0}"></div>
          <div class="form-group"><label class="form-label" for="bf-guard">Horario de vigilancia</label>
            <input type="text" id="bf-guard" class="form-control" maxlength="100" placeholder="Ej: 24/7" value="${esc(v.surveillance_hours || '')}"></div>
        </div>

        <h4 class="form-section">Marca</h4>
        <div class="form-group"><label class="form-label" for="bf-color">Color del edificio</label>
          <input type="color" id="bf-color" value="${esc(v.brand_color)}" class="color-input"></div>

        <div id="bf-error" class="form-error" hidden></div>
        <div style="display:flex; gap:1rem; justify-content:flex-end; margin-top:1.25rem;">
          <button type="button" class="btn btn-secondary" id="bf-cancel">Cancelar</button>
          <button type="submit" class="btn btn-primary" id="bf-submit"><i data-lucide="check"></i> ${editing ? 'Guardar cambios' : 'Crear edificio'}</button>
        </div>
      </form>`);

    modal.$('bf-cancel').onclick = modal.close;
    const showError = m => { const e = modal.$('bf-error'); e.textContent = m || ''; e.hidden = !m; };

    modal.$('building-form').onsubmit = async (e) => {
      e.preventDefault();
      showError('');
      const payload = {
        id: editing ? b.id : null,
        code: modal.$('bf-code').value,
        name: modal.$('bf-name').value,
        legal_name: modal.$('bf-legal').value,
        tax_id: modal.$('bf-tax').value,
        address: modal.$('bf-address').value,
        city: modal.$('bf-city').value,
        country: modal.$('bf-country').value,
        total_floors: parseInt(modal.$('bf-floors').value, 10),
        total_units: editing ? b.total_units : 0, // el total lo calcula el sistema a partir de los departamentos
        default_fee: parseFloat(modal.$('bf-fee').value),
        default_due_day: parseInt(modal.$('bf-due').value, 10),
        rate_percent: parseFloat(modal.$('bf-rate').value),
        grace_days: parseInt(modal.$('bf-grace').value || '0', 10),
        brand_color: modal.$('bf-color').value,
        elevators_count: modal.$('bf-elev').value,
        parking_spots_count: modal.$('bf-park').value,
        basements_count: modal.$('bf-base').value,
        garage_doors_count: modal.$('bf-doors').value,
        surveillance_hours: modal.$('bf-guard').value
      };
      if ([payload.total_floors, payload.default_fee, payload.default_due_day, payload.rate_percent].some(n => Number.isNaN(n))) {
        showError('Revise los campos numéricos: hay valores vacíos o inválidos.');
        return;
      }
      const submit = modal.$('bf-submit');
      submit.disabled = true;
      try {
        const saved = await buildingAdminService.save(payload);
        highlightId = saved.id;
        modal.close();
        await reload();
      } catch (err) {
        showError(err.message);
        submit.disabled = false;
      }
    };
  }

  /* ---------------- desactivar / reactivar ---------------- */

  async function toggleActive(b) {
    try {
      if (b.is_active) {
        const impact = await buildingAdminService.impact(b.id);
        const ok = await confirmDialog({
          title: `Desactivar ${b.name}`,
          message:
            `• ${impact.people} persona(s) con acceso dejarán de verlo.\n` +
            `• ${impact.pending_fees} cuota(s) pendiente(s) quedarán sin gestionar.\n` +
            `• ${impact.units} departamento(s) se conservan.\n\n` +
            `No se borra nada: podrá reactivarlo cuando quiera.`,
          confirmText: 'Desactivar',
          danger: true
        });
        if (!ok) return;
        await buildingAdminService.setActive(b.id, false);
      } else {
        await buildingAdminService.setActive(b.id, true);
      }
      highlightId = b.id;
      await reload();
    } catch (err) { alertDialog({ tone: 'danger', message: err.message }); }
  }

  start();
  return container;
}
