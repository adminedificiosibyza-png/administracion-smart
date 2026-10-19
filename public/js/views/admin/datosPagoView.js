/* Editor de los datos de pago del edificio activo (cuentas, WhatsApp, nota) */
import { activeBuilding } from '../../services/activeBuilding.js';
import { authService } from '../../services/authService.js';
import { paymentInfoService } from '../../services/paymentInfoService.js';
import { isSupabaseConnected } from '../../supabaseClient.js';
import { confirmDialog, alertDialog } from '../../ui/dialog.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderAdminDatosPago() {
  const container = document.createElement('div');
  container.className = 'fade-in';

  if (!isSupabaseConnected() || !authService.getContext()) {
    container.innerHTML = '<div class="card" style="max-width:640px;"><p>Los datos de pago solo se pueden editar con Supabase conectado.</p></div>';
    return container;
  }
  const building = activeBuilding.get();
  if (!building) return container;

  let model = { whatsapp: '', note: '', accounts: [] };
  let dirty = false;

  const setDirty = (v = true) => {
    dirty = v;
    const flag = container.querySelector('#pay-status');
    if (flag) { flag.textContent = dirty ? 'Cambios sin guardar' : 'Todo guardado'; flag.className = `badge ${dirty ? 'badge-warning' : 'badge-success'}`; }
    const save = container.querySelector('#pay-save');
    if (save) save.disabled = !dirty;
  };

  function render() {
    container.innerHTML = `
      <div class="card" style="margin-bottom: 1.5rem;">
        <div class="card-header">
          <h2 class="card-title"><i data-lucide="landmark"></i> Datos de pago — ${esc(building.name)}</h2>
          <div style="display:flex; gap:0.5rem; align-items:center;">
            <span id="pay-status" class="badge badge-success">Todo guardado</span>
            <button class="btn btn-primary btn-sm" id="pay-save" disabled><i data-lucide="save"></i> Guardar cambios</button>
          </div>
        </div>
        <p>Es lo que ven los propietarios e inquilinos de <strong>${esc(building.name)}</strong> en "Cuotas y Pagos": las cuentas donde deben depositar y el WhatsApp para enviar su captura. Cada edificio tiene los suyos.</p>

        <div class="form-grid" style="margin-top:1rem;">
          <div class="form-group">
            <label class="form-label" for="pay-wa">WhatsApp para enviar la captura del pago</label>
            <input type="tel" id="pay-wa" class="form-control" placeholder="Ej: +51 987 380 781" value="${esc(model.whatsapp)}" maxlength="25">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="pay-note">Nota adicional (opcional)</label>
          <textarea id="pay-note" class="form-control" rows="2" maxlength="1000" placeholder="Ej: Indique en el concepto su número de departamento y el mes que paga.">${esc(model.note)}</textarea>
        </div>
      </div>

      <div id="pay-accounts">
        ${model.accounts.map((a, i) => `
          <div class="card" style="margin-bottom:1rem;">
            <div class="card-header">
              <h3 class="card-title" style="font-size:1rem;">Cuenta ${i + 1}</h3>
              <div class="rules-actions">
                <button class="btn-icon" data-act="up" data-i="${i}" title="Subir" ${i === 0 ? 'disabled' : ''}><i data-lucide="arrow-up"></i></button>
                <button class="btn-icon" data-act="down" data-i="${i}" title="Bajar" ${i === model.accounts.length - 1 ? 'disabled' : ''}><i data-lucide="arrow-down"></i></button>
                <button class="btn-icon danger" data-act="del" data-i="${i}" title="Eliminar cuenta"><i data-lucide="trash-2"></i></button>
              </div>
            </div>
            <div class="form-grid">
              <div class="form-group"><label class="form-label">Banco o billetera *</label>
                <input type="text" class="form-control" data-f="bank" data-i="${i}" maxlength="100" placeholder="Ej: BCP, Interbank, Yape" value="${esc(a.bank)}"></div>
              <div class="form-group"><label class="form-label">Nombre de la cuenta (titular)</label>
                <input type="text" class="form-control" data-f="account_holder" data-i="${i}" maxlength="200" value="${esc(a.account_holder)}"></div>
              <div class="form-group"><label class="form-label">Número de cuenta</label>
                <input type="text" class="form-control" data-f="account_number" data-i="${i}" maxlength="60" value="${esc(a.account_number)}"></div>
              <div class="form-group"><label class="form-label">CCI (cuenta interbancaria)</label>
                <input type="text" class="form-control" data-f="cci" data-i="${i}" maxlength="60" value="${esc(a.cci)}"></div>
            </div>
          </div>`).join('')}
        ${model.accounts.length ? '' : '<div class="card" style="text-align:center; color: var(--text-dim); margin-bottom:1rem;">Aún no hay cuentas. Agregue la primera con el botón de abajo.</div>'}
      </div>

      <button class="btn btn-outline" id="pay-add"><i data-lucide="plus"></i> Agregar cuenta</button>`;

    setDirty(dirty);
    bind();
    if (window.lucide) window.lucide.createIcons();
  }

  function bind() {
    container.querySelector('#pay-wa').addEventListener('input', e => { model.whatsapp = e.target.value; setDirty(); });
    container.querySelector('#pay-note').addEventListener('input', e => { model.note = e.target.value; setDirty(); });
    container.querySelectorAll('[data-f]').forEach(inp => inp.addEventListener('input', () => {
      model.accounts[Number(inp.dataset.i)][inp.dataset.f] = inp.value; setDirty();
    }));
    container.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', async () => {
      const i = Number(btn.dataset.i);
      const list = model.accounts;
      if (btn.dataset.act === 'del') {
        const ok = await confirmDialog({ title: 'Eliminar cuenta', message: `Se quitará la cuenta ${i + 1} cuando guarde los cambios.`, confirmText: 'Eliminar', danger: true });
        if (!ok) return;
        list.splice(i, 1);
      } else {
        const j = btn.dataset.act === 'up' ? i - 1 : i + 1;
        [list[i], list[j]] = [list[j], list[i]];
      }
      dirty = true; render();
    }));
    container.querySelector('#pay-add').addEventListener('click', () => {
      model.accounts.push({ bank: '', account_holder: '', account_number: '', cci: '' });
      dirty = true; render();
      const banks = container.querySelectorAll('[data-f="bank"]');
      if (banks.length) banks[banks.length - 1].focus();
    });
    container.querySelector('#pay-save').addEventListener('click', save);
  }

  async function save() {
    const unnamed = model.accounts.findIndex(a => !String(a.bank || '').trim());
    if (unnamed >= 0) { alertDialog({ tone: 'warning', message: `La cuenta ${unnamed + 1} necesita el nombre del banco o billetera.` }); return; }
    const btn = container.querySelector('#pay-save');
    btn.disabled = true;
    try {
      const n = await paymentInfoService.save(building.id, model);
      await load();
      alertDialog({ tone: 'success', title: 'Datos guardados', message: `Se guardaron los datos de pago de ${building.name} (${n} cuenta(s)). Los residentes ya los ven en "Cuotas y Pagos".` });
    } catch (err) {
      btn.disabled = false;
      alertDialog({ tone: 'danger', title: 'No se pudieron guardar', message: err.message });
    }
  }

  async function load() {
    try {
      model = await paymentInfoService.load(building.id);
      dirty = false;
      render();
    } catch (err) {
      container.innerHTML = `<div class="card" style="text-align:center;"><p style="color: var(--status-danger); margin-bottom:1rem;">${esc(err.message)}</p>
        <button class="btn btn-primary btn-sm" id="pay-retry">Reintentar</button></div>`;
      container.querySelector('#pay-retry').addEventListener('click', load);
    }
  }

  container.innerHTML = '<div class="card" style="text-align:center; color: var(--text-dim);">Cargando...</div>';
  load();
  return container;
}
