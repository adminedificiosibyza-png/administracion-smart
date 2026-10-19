/* Inicio del superadmin: elegir el edificio que se va a gestionar */
import { store } from '../../store.js';
import { supabase, isSupabaseConnected } from '../../supabaseClient.js';
import { authService } from '../../services/authService.js';
import { activeBuilding } from '../../services/activeBuilding.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const normalize = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

const countOf = async (query) => {
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count || 0;
};

async function countSummaries(buildings) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
  const entries = await Promise.all(buildings.map(async b => {
    const head = { count: 'exact', head: true };
    const [units, pending, overdue, assigned] = await Promise.all([
      countOf(supabase.from('units').select('id', head).eq('building_id', b.id)),
      countOf(supabase.from('maintenance_fees').select('id', head).eq('building_id', b.id).in('status', ['PENDIENTE', 'MORA_PENDIENTE'])),
      countOf(supabase.from('maintenance_fees').select('id', head).eq('building_id', b.id).in('status', ['PENDIENTE', 'MORA_PENDIENTE']).lt('due_date', today)),
      supabase.from('user_units').select('user_id, units!inner(building_id)').eq('active', true).eq('units.building_id', b.id).range(0, 4999)
    ]);
    if (assigned.error) throw new Error(assigned.error.message);
    return [b.id, {
      building_id: b.id, units, pending_fees: pending, overdue_fees: overdue,
      people: new Set(assigned.data.map(r => r.user_id)).size
    }];
  }));
  return new Map(entries);
}

export function renderAdminHome() {
  const container = document.createElement('div');
  container.className = 'fade-in';

  const user = authService.getContext();
  const buildings = activeBuilding.list();
  let summaries = new Map();
  let search = '';

  function cardHTML(b) {
    const s = summaries.get(b.id) || {};
    const overdue = s.overdue_fees || 0;
    return `
      <button type="button" class="building-pick-row" data-id="${b.id}">
        <div class="building-avatar-lg" style="background: ${esc(b.brand_color || '#4f7609')};">${esc((b.name || '?').trim()[0].toUpperCase())}</div>
        <div class="building-main">
          <strong>${esc(b.name)}</strong>
          <div class="building-tags"><span class="tag">${esc(b.code)}</span></div>
          <span class="cell-note">${esc(b.address || '')}${b.city ? ' · ' + esc(b.city) : ''}</span>
        </div>
        <div class="building-metrics">
          <div><span>Departamentos</span><strong>${s.units ?? '—'}</strong></div>
          <div><span>Personas</span><strong>${s.people ?? '—'}</strong></div>
          <div><span>Cuotas pendientes</span><strong>${s.pending_fees ?? '—'}</strong></div>
          <div><span>Vencidas</span><strong class="${overdue > 0 ? 'highlight-danger' : ''}">${s.overdue_fees ?? '—'}</strong></div>
        </div>
      </button>`;
  }

  function renderCards() {
    const grid = container.querySelector('#home-grid');
    if (!grid) return;
    const q = normalize(search);
    const list = buildings.filter(b => !q || [b.name, b.code, b.address].some(v => normalize(v).includes(q)));
    grid.innerHTML = list.length
      ? list.map(cardHTML).join('')
      : `<div class="card" style="text-align:center; color: var(--text-dim);">
           ${buildings.length ? 'Ningún edificio coincide con la búsqueda.' : 'Aún no hay edificios. Cree el primero en "Gestión de Edificios".'}
         </div>`;
    grid.querySelectorAll('.building-pick-row').forEach(card => card.addEventListener('click', () => {
      activeBuilding.set(card.dataset.id);
      store.setView('admin-dashboard');
    }));
  }

  container.innerHTML = `
    <div class="home-header">
      <div>
        <h2>Bienvenido, ${esc(user ? user.full_name : '')}</h2>
        <p>Seleccione el edificio que desea gestionar.</p>
      </div>
      <div class="home-actions">
        <input type="text" id="home-search" class="form-control" placeholder="Buscar edificio..." autocomplete="off">
        <button class="btn btn-outline btn-sm" id="home-manage"><i data-lucide="building-2"></i> Gestionar edificios</button>
        <button class="btn btn-outline btn-sm" id="home-cash"><i data-lucide="landmark"></i> Caja general</button>
        <button class="btn btn-outline btn-sm" id="home-users"><i data-lucide="key-round"></i> Usuarios y accesos</button>
      </div>
    </div>
    <div id="home-grid" class="building-pick-list"></div>`;

  container.querySelector('#home-search').addEventListener('input', (e) => { search = e.target.value; renderCards(); });
  container.querySelector('#home-manage').addEventListener('click', () => store.setView('admin-edificios'));
  container.querySelector('#home-users').addEventListener('click', () => store.setView('admin-usuarios'));
  container.querySelector('#home-cash').addEventListener('click', () => store.setView('admin-caja'));
  renderCards();
  if (window.lucide) window.lucide.createIcons();

  // Resumen por edificio (desde Supabase); si falla, las tarjetas se quedan sin cifras
  if (isSupabaseConnected()) {
    supabase.rpc('get_building_summaries').then(async ({ data, error }) => {
      if (!error) {
        summaries = new Map(data.map(s => [s.building_id, s]));
      } else {
        // Respaldo: si la función del servidor no está disponible, se cuentan los datos directamente
        console.warn('get_building_summaries no disponible, se usa el respaldo:', error.message);
        try { summaries = await countSummaries(buildings); } catch (e) { console.warn('No se pudo cargar el resumen:', e.message); return; }
      }
      renderCards();
    });
  }

  return container;
}
