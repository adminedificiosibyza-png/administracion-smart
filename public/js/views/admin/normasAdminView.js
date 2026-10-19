/* Editor de las normas de convivencia del edificio activo */
import { activeBuilding } from '../../services/activeBuilding.js';
import { authService } from '../../services/authService.js';
import { ruleService } from '../../services/ruleService.js';
import { isSupabaseConnected } from '../../supabaseClient.js';
import { OFFICIAL_RULES, RULES_INTRO } from '../../rulesData.js';
import { confirmDialog, alertDialog } from '../../ui/dialog.js';
import { openAppModal } from '../../ui/credentials.js';
import { exportRulesPdf } from '../../services/rulesPdf.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderAdminNormas() {
  const container = document.createElement('div');
  container.className = 'fade-in';

  if (!isSupabaseConnected() || !authService.getContext()) {
    container.innerHTML = '<div class="card" style="max-width:640px;"><p>El editor de normas por edificio solo está disponible con Supabase conectado.</p></div>';
    return container;
  }
  const building = activeBuilding.get();
  if (!building) return container;

  // Modelo en memoria: se edita aquí y solo se guarda al pulsar "Guardar cambios"
  let model = { intro: '', categories: [] };
  let dirty = false;

  const setDirty = (value = true) => {
    dirty = value;
    const flag = container.querySelector('#rules-status');
    if (flag) {
      flag.textContent = dirty ? 'Cambios sin guardar' : 'Todo guardado';
      flag.className = `badge ${dirty ? 'badge-warning' : 'badge-success'}`;
    }
    const save = container.querySelector('#rules-save');
    if (save) save.disabled = !dirty;
  };

  const autosize = (el) => { el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px`; };

  function render() {
    container.innerHTML = `
      <div class="card" style="margin-bottom: 1.5rem;">
        <div class="card-header">
          <h2 class="card-title"><i data-lucide="book-open"></i> Normas de Convivencia — ${esc(building.name)}</h2>
          <div style="display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;">
            <span id="rules-status" class="badge badge-success">Todo guardado</span>
            <button class="btn btn-outline btn-sm" id="rules-import"><i data-lucide="file-down"></i> Cargar normas base de PARKE10</button>
            <button class="btn btn-outline btn-sm" id="rules-pdf"><i data-lucide="file-text"></i> Descargar PDF</button>
            <button class="btn btn-primary btn-sm" id="rules-save" disabled><i data-lucide="save"></i> Guardar cambios</button>
          </div>
        </div>
        <p>Estas normas son <strong>solo de ${esc(building.name)}</strong>: es lo que ven sus propietarios e inquilinos en su portal. Cada edificio tiene las suyas.</p>
        <div class="form-group" style="margin: 1rem 0 0;">
          <label class="form-label" for="rules-intro">Introducción (opcional)</label>
          <textarea id="rules-intro" class="form-control" rows="3" placeholder="Texto que aparece al inicio de las normas...">${esc(model.intro)}</textarea>
        </div>
      </div>

      <div id="rules-cats">
        ${model.categories.map((cat, ci) => `
          <div class="card rules-cat" data-ci="${ci}">
            <div class="rules-cat-head">
              <input type="text" class="form-control rules-cat-name" data-ci="${ci}" value="${esc(cat.name)}" placeholder="Nombre de la categoría" maxlength="150">
              <div class="rules-actions">
                <button class="btn-icon" data-act="cat-up" data-ci="${ci}" title="Subir categoría" ${ci === 0 ? 'disabled' : ''}><i data-lucide="arrow-up"></i></button>
                <button class="btn-icon" data-act="cat-down" data-ci="${ci}" title="Bajar categoría" ${ci === model.categories.length - 1 ? 'disabled' : ''}><i data-lucide="arrow-down"></i></button>
                <button class="btn-icon danger" data-act="cat-del" data-ci="${ci}" title="Eliminar categoría"><i data-lucide="trash-2"></i></button>
              </div>
            </div>
            ${cat.items.map((text, ii) => `
              <div class="rule-row">
                <span class="rule-num">${ii + 1}</span>
                <textarea class="form-control rule-text" rows="2" data-ci="${ci}" data-ii="${ii}" placeholder="Escriba la norma...">${esc(text)}</textarea>
                <div class="rules-actions">
                  <button class="btn-icon" data-act="item-up" data-ci="${ci}" data-ii="${ii}" title="Subir" ${ii === 0 ? 'disabled' : ''}><i data-lucide="arrow-up"></i></button>
                  <button class="btn-icon" data-act="item-down" data-ci="${ci}" data-ii="${ii}" title="Bajar" ${ii === cat.items.length - 1 ? 'disabled' : ''}><i data-lucide="arrow-down"></i></button>
                  <button class="btn-icon danger" data-act="item-del" data-ci="${ci}" data-ii="${ii}" title="Quitar norma"><i data-lucide="x"></i></button>
                </div>
              </div>`).join('')}
            <button class="btn btn-outline btn-sm" data-act="item-add" data-ci="${ci}" style="margin-top:0.5rem;"><i data-lucide="plus"></i> Agregar norma</button>
          </div>`).join('')}
        ${model.categories.length ? '' : '<div class="card" style="text-align:center; color: var(--text-dim);">Este edificio todavía no tiene normas. Agregue una categoría o cargue las normas base de PARKE10 y edítelas.</div>'}
      </div>

      <button class="btn btn-outline" id="rules-add-cat"><i data-lucide="plus"></i> Agregar categoría</button>`;

    container.querySelectorAll('.rule-text').forEach(autosize);
    setDirty(dirty);
    bind();
    if (window.lucide) window.lucide.createIcons();
  }

  function bind() {
    container.querySelector('#rules-intro').addEventListener('input', (e) => { model.intro = e.target.value; setDirty(); });
    container.querySelectorAll('.rules-cat-name').forEach(inp => inp.addEventListener('input', () => {
      model.categories[Number(inp.dataset.ci)].name = inp.value; setDirty();
    }));
    container.querySelectorAll('.rule-text').forEach(area => area.addEventListener('input', () => {
      model.categories[Number(area.dataset.ci)].items[Number(area.dataset.ii)] = area.value;
      autosize(area); setDirty();
    }));

    container.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', () => {
      const ci = Number(btn.dataset.ci), ii = Number(btn.dataset.ii);
      const cats = model.categories;
      const swap = (arr, a, b) => { [arr[a], arr[b]] = [arr[b], arr[a]]; };
      switch (btn.dataset.act) {
        case 'cat-up': swap(cats, ci, ci - 1); break;
        case 'cat-down': swap(cats, ci, ci + 1); break;
        case 'cat-del': cats.splice(ci, 1); break;
        case 'item-up': swap(cats[ci].items, ii, ii - 1); break;
        case 'item-down': swap(cats[ci].items, ii, ii + 1); break;
        case 'item-del': cats[ci].items.splice(ii, 1); break;
        case 'item-add': cats[ci].items.push(''); break;
        default: return;
      }
      dirty = true;
      render();
      // la norma recién agregada queda lista para escribir
      if (btn.dataset.act === 'item-add') {
        const areas = container.querySelectorAll(`.rule-text[data-ci="${ci}"]`);
        if (areas.length) areas[areas.length - 1].focus();
      }
    }));

    container.querySelector('#rules-add-cat').addEventListener('click', () => {
      model.categories.push({ name: '', items: [''] });
      dirty = true;
      render();
      const names = container.querySelectorAll('.rules-cat-name');
      if (names.length) names[names.length - 1].focus();
    });

    container.querySelector('#rules-import').addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Cargar normas base de PARKE10',
        message: 'Se copiarán al editor las normas oficiales de PARKE10 como punto de partida, reemplazando lo que hay ahora en pantalla. Podrá editarlas, y nada cambia hasta que pulse "Guardar cambios".',
        confirmText: 'Cargar en el editor'
      });
      if (!ok) return;
      model = { intro: RULES_INTRO, categories: OFFICIAL_RULES.map(c => ({ name: c.category, items: [...c.items] })) };
      dirty = true;
      render();
    });

    container.querySelector('#rules-save').addEventListener('click', () => save());
    container.querySelector('#rules-pdf').addEventListener('click', downloadPdf);
  }

  async function downloadPdf() {
    if (dirty) {
      const ok = await confirmDialog({
        title: 'Hay cambios sin guardar',
        message: 'El PDF se genera con las normas guardadas. ¿Desea guardar los cambios y luego descargar el documento?',
        confirmText: 'Guardar y descargar'
      });
      if (!ok) return;
      if (!(await save(true))) return;
    }
    const modal = openAppModal('<i data-lucide="file-text" style="color: var(--primary);"></i> Descargar normas en PDF', `
      <p style="margin-bottom:1rem; font-size:0.9rem;">Se generará el documento de <strong>${esc(building.name)}</strong> con las normas guardadas, en el orden del editor.</p>
      <label style="display:flex; gap:0.5rem; align-items:flex-start; margin-bottom:1.25rem;">
        <input type="checkbox" id="pdf-receipt" style="margin-top:0.2rem;">
        <span>Agregar al final una página de <strong>constancia de recepción</strong> (campos en blanco para nombre, departamento, fecha y firmas).</span>
      </label>
      <div id="pdf-error" class="form-error" role="alert" hidden></div>
      <div style="display:flex; gap:1rem; justify-content:flex-end;">
        <button class="btn btn-secondary" id="pdf-cancel">Cancelar</button>
        <button class="btn btn-primary" id="pdf-go"><i data-lucide="download"></i> Descargar</button>
      </div>`);
    modal.$('pdf-cancel').onclick = modal.close;
    modal.$('pdf-go').onclick = async () => {
      const go = modal.$('pdf-go');
      const err = modal.$('pdf-error');
      go.disabled = true; err.hidden = true;
      try {
        const data = await ruleService.loadBuildingRules(building.id); // lo último guardado en la base
        await exportRulesPdf({
          building: { name: building.name, code: building.code, address: building.address, city: building.city },
          intro: data.intro, categories: data.categories, includeReceipt: modal.$('pdf-receipt').checked
        });
        modal.close();
      } catch (e) {
        err.textContent = e.message; err.hidden = false; go.disabled = false;
      }
    };
  }

  async function save(silent = false) {
    // Validación previa con mensajes claros (el servidor la repite)
    const categories = model.categories.map(c => ({
      category: c.name.trim(),
      items: c.items.map(t => t.trim()).filter(Boolean)
    }));
    const unnamed = categories.findIndex(c => !c.category);
    if (unnamed >= 0) { alertDialog({ tone: 'warning', message: `La categoría ${unnamed + 1} no tiene nombre.` }); return false; }
    const empty = categories.find(c => c.items.length === 0);
    if (empty) { alertDialog({ tone: 'warning', message: `La categoría "${empty.category}" no tiene normas. Agregue al menos una o elimínela.` }); return false; }

    const btn = container.querySelector('#rules-save');
    btn.disabled = true;
    try {
      const total = await ruleService.saveBuildingRules(building.id, model.intro, categories);
      await load();
      if (!silent) alertDialog({ tone: 'success', title: 'Normas guardadas', message: `Se guardaron ${total} normas de ${building.name}. Los propietarios ya las ven en su portal.` });
      return true;
    } catch (err) {
      btn.disabled = false;
      alertDialog({ tone: 'danger', title: 'No se pudieron guardar', message: err.message });
      return false;
    }
  }

  async function load() {
    try {
      const data = await ruleService.loadBuildingRules(building.id);
      model = { intro: data.intro, categories: data.categories.map(c => ({ name: c.category, items: [...c.items] })) };
      dirty = false;
      render();
    } catch (err) {
      container.innerHTML = `
        <div class="card" style="text-align:center;">
          <p style="color: var(--status-danger); margin-bottom: 1rem;">${esc(err.message)}</p>
          <button class="btn btn-primary btn-sm" id="rules-retry">Reintentar</button>
        </div>`;
      container.querySelector('#rules-retry').addEventListener('click', () => { load(); });
    }
  }

  container.innerHTML = '<div class="card" style="text-align:center; color: var(--text-dim);">Cargando normas...</div>';
  load();
  return container;
}
