/* Registro de auditoría del edificio activo (solo lectura) */
import { auditService } from '../../services/ruleService.js';
import { activeBuilding } from '../../services/activeBuilding.js';
import { authService } from '../../services/authService.js';
import { supabase, isSupabaseConnected } from '../../supabaseClient.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PAGE = 100;

const ACTION_LABELS = {
  CREAR_COMUNICADO: 'Comunicado creado', EDITAR_COMUNICADO: 'Comunicado editado', ELIMINAR_COMUNICADO: 'Comunicado eliminado',
  EDITAR_NORMAS: 'Normas editadas', PUBLICACION_COMUNICADO: 'Comunicado publicado',
  CREAR_RESERVA_ADMIN: 'Reserva registrada por la administración'
};
const actionLabel = a => ACTION_LABELS[a] || String(a || '').replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase());

function fmtDateTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function renderAdminAuditoria() {
  const container = document.createElement('div');
  container.className = 'fade-in';
  const live = isSupabaseConnected() && !!authService.getContext();
  const building = live ? activeBuilding.get() : null;
  if (live && !building) return container;

  let logs = [];
  let hasMore = false;
  const filters = { from: '', to: '', action: '', person: '' };

  async function fetchLogs(append) {
    if (!live) {
      logs = auditService.getAuditLogs().slice();
      hasMore = false;
      return;
    }
    let q = supabase.from('audit_logs').select('id, action, description, performed_by, timestamp')
      .eq('building_id', building.id).order('timestamp', { ascending: false });
    // Las fechas se interpretan en hora de Perú (UTC-5)
    if (filters.from) q = q.gte('timestamp', `${filters.from}T00:00:00-05:00`);
    if (filters.to) q = q.lte('timestamp', `${filters.to}T23:59:59.999-05:00`);
    if (filters.action) q = q.eq('action', filters.action);
    if (filters.person) q = q.ilike('performed_by', `%${filters.person.replace(/[%_,()]/g, ' ')}%`);
    const start = append ? logs.length : 0;
    const { data, error } = await q.range(start, start + PAGE - 1);
    if (error) throw new Error(`No se pudo cargar el registro: ${error.message}`);
    logs = append ? logs.concat(data) : data;
    hasMore = data.length === PAGE;
  }

  async function loadActions() {
    if (!live) return [...new Set(auditService.getAuditLogs().map(l => l.action))];
    const { data } = await supabase.from('audit_logs').select('action').eq('building_id', building.id).range(0, 4999);
    return [...new Set((data || []).map(r => r.action))].sort();
  }

  let actions = [];

  function rowsHtml() {
    if (!logs.length) return '<tr><td colspan="4" style="text-align:center; color: var(--text-dim);">No hay registros con esos filtros.</td></tr>';
    return logs.map(log => `
      <tr>
        <td><span style="font-size:0.85rem; color: var(--text-dim); white-space:nowrap;">${fmtDateTime(log.timestamp)}</span></td>
        <td><span class="badge badge-building">${esc(actionLabel(log.action))}</span></td>
        <td><strong>${esc(log.description)}</strong></td>
        <td><span style="color: var(--primary); font-weight:600;">${esc(log.performed_by)}</span></td>
      </tr>`).join('');
  }

  function refreshTable() {
    container.querySelector('#aud-body').innerHTML = rowsHtml();
    const more = container.querySelector('#aud-more');
    more.hidden = !hasMore;
    container.querySelector('#aud-count').textContent = `${logs.length} registro${logs.length === 1 ? '' : 's'}${hasMore ? ' (hay más)' : ''}`;
  }

  async function reload(append = false) {
    try {
      await fetchLogs(append);
      refreshTable();
    } catch (err) {
      container.querySelector('#aud-body').innerHTML = `<tr><td colspan="4" class="form-error">${esc(err.message)}</td></tr>`;
    }
  }

  function render() {
    container.innerHTML = `
      <div class="card" style="margin-bottom: 1.5rem;">
        <div class="card-header">
          <h2 class="card-title"><i data-lucide="history"></i> Registro de Auditoría${building ? ` — ${esc(building.name)}` : ''}</h2>
          <span id="aud-count" class="badge badge-neutral"></span>
        </div>
        <p>Historial de las acciones de administración de este edificio: cobros, reservas, normas, comunicados y cambios de datos. Solo lectura.</p>
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap:0.75rem; margin-top:1rem;">
          <div class="form-group" style="margin:0;"><label class="form-label" for="aud-from">Desde</label><input type="date" id="aud-from" class="form-control"></div>
          <div class="form-group" style="margin:0;"><label class="form-label" for="aud-to">Hasta</label><input type="date" id="aud-to" class="form-control"></div>
          <div class="form-group" style="margin:0;"><label class="form-label" for="aud-action">Acción</label>
            <select id="aud-action" class="form-select"><option value="">Todas</option>
              ${actions.map(a => `<option value="${esc(a)}">${esc(actionLabel(a))}</option>`).join('')}</select></div>
          <div class="form-group" style="margin:0;"><label class="form-label" for="aud-person">Persona</label><input type="text" id="aud-person" class="form-control" placeholder="Nombre..."></div>
        </div>
      </div>
      <div class="card">
        <div class="table-responsive">
          <table class="data-table">
            <thead><tr><th>Fecha y hora</th><th>Acción</th><th>Descripción</th><th>Realizado por</th></tr></thead>
            <tbody id="aud-body"><tr><td colspan="4" style="text-align:center; color: var(--text-dim);">Cargando...</td></tr></tbody>
          </table>
        </div>
        <div style="text-align:center; margin-top:1rem;"><button class="btn btn-outline btn-sm" id="aud-more" hidden>Ver más antiguos</button></div>
      </div>`;

    const bind = (id, key, ev) => container.querySelector(id).addEventListener(ev, e => { filters[key] = e.target.value; reload(false); });
    bind('#aud-from', 'from', 'change');
    bind('#aud-to', 'to', 'change');
    bind('#aud-action', 'action', 'change');
    let timer;
    container.querySelector('#aud-person').addEventListener('input', e => {
      filters.person = e.target.value.trim();
      clearTimeout(timer);
      timer = setTimeout(() => reload(false), 350);
    });
    container.querySelector('#aud-more').addEventListener('click', () => reload(true));
    if (window.lucide) window.lucide.createIcons();
  }

  loadActions().then(list => { actions = list; render(); reload(false); }).catch(() => { render(); reload(false); });
  return container;
}
