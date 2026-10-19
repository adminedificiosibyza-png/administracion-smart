/* Administradora Overdue Interest Rate Configurator View */
import { store } from '../../store.js';
import { feeService } from '../../services/feeService.js';
import { activeBuilding } from '../../services/activeBuilding.js';
import { alertDialog } from '../../ui/dialog.js';

// Edificio elegido al entrar (vacío en modo demostración). Con Supabase la mora se edita en Gestión de Edificios.
const activeBuildings = () => {
  const b = activeBuilding.get();
  return b ? [b] : [];
};
let selectedBuildingId = null;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderAdminMorosidad() {
  const container = document.createElement('div');
  container.className = 'fade-in';

  function renderForm(rule) {
    container.innerHTML = `
      <div class="card" style="margin-bottom: 1.5rem;">
        <div class="card-header">
          <h2 class="card-title"><i data-lucide="percent"></i> Configuración de Intereses Moratorios</h2>
          <span class="badge badge-building">PARKE10</span>
        </div>
        <p>Establece la regla de mora. El sistema calcula automáticamente los días de atraso y el interés de cada cuota con esta regla; no hay que calcular nada a mano.</p>
      </div>

      <div class="card" style="max-width: 680px;">
        <h3 class="card-title" style="margin-bottom: 1.25rem; color: var(--primary);">
          <i data-lucide="sliders"></i> Parámetros de Recargo por Mora
        </h3>

        ${activeBuildings().length > 1 ? `
        <div class="form-group">
          <label class="form-label" for="rule-building">Edificio</label>
          <select id="rule-building" class="form-select">
            ${activeBuildings().map(b => `<option value="${b.id}" ${b.id === selectedBuildingId ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
          </select>
        </div>` : ''}

        <form id="interest-rule-form">
          <div class="form-group">
            <label class="form-label" for="rule-type">Tipo de Interés</label>
            <select id="rule-type" class="form-select">
              <option value="PORCENTAJE_DIARIO" ${rule.type === 'PORCENTAJE_DIARIO' ? 'selected' : ''}>Porcentaje Diario (% diario sobre la cuota vencida)</option>
              <option value="MONTO_FIJO" ${rule.type === 'MONTO_FIJO' ? 'selected' : ''}>Monto Fijo por Atraso (S/ fijo)</option>
            </select>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
            <div class="form-group">
              <label class="form-label" for="rule-rate">Tasa de Interés (% diario)</label>
              <input type="number" step="0.01" min="0" max="100" id="rule-rate" class="form-control" value="${esc(rule.rate_percent)}" required>
              <span style="font-size: 0.75rem; color: var(--text-dim);">Ej: 0.10 = 0.10 % de la cuota por cada día de atraso.</span>
            </div>

            <div class="form-group">
              <label class="form-label" for="rule-grace">Días de gracia</label>
              <input type="number" step="1" min="0" id="rule-grace" class="form-control" value="${esc(rule.grace_days ?? 0)}" required>
              <span style="font-size: 0.75rem; color: var(--text-dim);">Las cuotas vencen el día 5. Con 0 días de gracia, la mora empieza el día 6.</span>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="rule-rounding">Regla de Redondeo</label>
            <select id="rule-rounding" class="form-select">
              <option value="DOS_DECADAS" ${rule.rounding !== 'SIN_REDONDEO' ? 'selected' : ''}>Redondeo estándar a 2 decimales (S/ 0.01)</option>
              <option value="SIN_REDONDEO" ${rule.rounding === 'SIN_REDONDEO' ? 'selected' : ''}>Sin redondeo</option>
            </select>
          </div>

          <div id="rule-error" class="form-error" hidden></div>

          <div style="display: flex; gap: 1rem; justify-content: flex-end; margin-top: 1.5rem;">
            <button type="submit" class="btn btn-primary" id="rule-submit">
              <i data-lucide="save"></i> Guardar Configuración de Morosidad
            </button>
          </div>
        </form>
      </div>
    `;

    const showError = msg => { const b = container.querySelector('#rule-error'); b.textContent = msg || ''; b.hidden = !msg; };

    container.querySelector('#rule-building')?.addEventListener('change', (e) => {
      selectedBuildingId = e.target.value;
      loadRule();
    });

    container.querySelector('#interest-rule-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      showError('');
      const submit = container.querySelector('#rule-submit');
      submit.disabled = true;
      try {
        await feeService.saveInterestRule({
          type: container.querySelector('#rule-type').value,
          rate_percent: parseFloat(container.querySelector('#rule-rate').value),
          grace_days: parseInt(container.querySelector('#rule-grace').value, 10),
          rounding: container.querySelector('#rule-rounding').value
        });
        alertDialog({
          tone: 'success',
          title: 'Mora actualizada',
          message: 'Los parámetros de interés moratorio se guardaron. Se aplican a todas las cuotas de este edificio desde ahora.'
        });
        store.setView('admin-morosidad');
      } catch (err) {
        showError(err.message);
        submit.disabled = false;
      }
    });

    if (window.lucide) window.lucide.createIcons();
  }

  function loadRule() {
    const buildings = activeBuildings();
    if (buildings.length && !buildings.some(b => b.id === selectedBuildingId)) selectedBuildingId = buildings[0].id;
    container.innerHTML = '<div class="card" style="text-align: center; color: var(--text-dim);">Cargando regla de mora...</div>';
    feeService.loadInterestRule(buildings.length ? selectedBuildingId : undefined)
      .then(renderForm)
      .catch(err => {
        container.innerHTML = `<div class="card" style="text-align: center;"><p style="color: var(--status-danger);">${esc(err.message)}</p></div>`;
      });
  }
  loadRule();

  return container;
}
