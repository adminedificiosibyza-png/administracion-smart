/* Propietario Categorized Regulations Accordion View */
import { ruleService } from '../../services/ruleService.js';
import { authService } from '../../services/authService.js';
import { supabase, isSupabaseConnected } from '../../supabaseClient.js';
import { exportRulesPdf } from '../../services/rulesPdf.js';
import { alertDialog } from '../../ui/dialog.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// categories = [{ category, items: [texto, ...] }]
function renderContent(container, { intro, categories }, buildingName, ctx = null) {
  container.innerHTML = `
    <div class="card" style="margin-bottom: 1.5rem;">
      <div class="card-header">
        <h2 class="card-title"><i data-lucide="book-open"></i> Normas de Convivencia${buildingName ? ` — ${esc(buildingName)}` : ' y Reglamento Interno'}</h2>
        <button class="btn btn-outline btn-sm" id="btn-download-pdf">
          <i data-lucide="file-text"></i> Descargar Documento Completo (PDF)
        </button>
      </div>
      ${intro ? `<p>${esc(intro)}</p>` : ''}
    </div>

    ${categories.length ? `
    <div style="margin-bottom: 2rem;">
      ${categories.map((cat, idx) => `
        <div class="accordion-item ${idx === 0 ? 'expanded' : ''}" data-cat-idx="${idx}">
          <div class="accordion-header">
            <span style="display: flex; align-items: center; gap: 0.6rem; font-size: 1.05rem;">
              <i data-lucide="shield-check" style="color: var(--primary);"></i> ${esc(cat.category)}
            </span>
            <i data-lucide="chevron-down" class="accordion-icon" style="transition: transform 0.25s;"></i>
          </div>
          <div class="accordion-content">
            <ul style="display: flex; flex-direction: column; gap: 0.6rem;">
              ${cat.items.map(item => `
                <li style="display: flex; align-items: flex-start; gap: 0.6rem; font-size: 0.9rem; line-height: 1.5;">
                  <i data-lucide="check" style="width: 16px; height: 16px; color: var(--primary); flex-shrink: 0; margin-top: 3px;"></i>
                  <span>${esc(item)}</span>
                </li>
              `).join('')}
            </ul>
          </div>
        </div>
      `).join('')}
    </div>` : `
    <div class="card" style="text-align:center; color: var(--text-dim);">
      La administración aún no publicó las normas de convivencia de este edificio.
    </div>`}
  `;

  container.querySelectorAll('.accordion-header').forEach(header => {
    header.addEventListener('click', () => header.parentElement.classList.toggle('expanded'));
  });

  container.querySelector('#btn-download-pdf')?.addEventListener('click', async (e) => {
    if (!ctx) {
      alertDialog({ title: 'Descarga no disponible', message: 'La descarga del PDF solo está disponible con Supabase conectado.' });
      return;
    }
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      // Siempre desde lo último guardado del edificio del departamento activo
      const [data, bld] = await Promise.all([
        ruleService.loadBuildingRules(ctx.buildingId),
        supabase.from('buildings').select('name, code, address, city').eq('id', ctx.buildingId).maybeSingle()
      ]);
      const b = bld.data || { name: ctx.buildingName, code: ctx.buildingCode };
      await exportRulesPdf({ building: b, intro: data.intro, categories: data.categories });
    } catch (err) {
      alertDialog({ tone: 'danger', title: 'No se pudo generar el PDF', message: err.message });
    } finally {
      btn.disabled = false;
    }
  });

  if (window.lucide) window.lucide.createIcons();
}

export function renderPropietarioNormas() {
  const container = document.createElement('div');
  container.className = 'fade-in';

  // Con Supabase: las normas del edificio del departamento activo
  if (isSupabaseConnected() && authService.getContext()) {
    const active = authService.getActiveAssignment();
    if (!active) {
      container.innerHTML = '<div class="card"><p>Todavía no tiene un departamento asignado.</p></div>';
      return container;
    }
    container.innerHTML = '<div class="card" style="text-align:center; color: var(--text-dim);">Cargando normas...</div>';
    ruleService.loadBuildingRules(active.building_id)
      .then(data => renderContent(container, data, active.building_name,
        { buildingId: active.building_id, buildingName: active.building_name, buildingCode: active.building_code }))
      .catch(err => { container.innerHTML = `<div class="card"><p style="color: var(--status-danger);">${esc(err.message)}</p></div>`; });
    return container;
  }

  // Modo demostración: normas locales
  renderContent(container, {
    intro: ruleService.getIntro(),
    categories: ruleService.getRules().map(c => ({ category: c.category, items: c.items }))
  }, '');
  return container;
}
