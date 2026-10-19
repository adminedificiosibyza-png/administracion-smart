/* Propietario Profile View */
import { authService } from '../../services/authService.js';
import { buildingService } from '../../services/buildingService.js';
import { supabase, isSupabaseConnected } from '../../supabaseClient.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const RELATIONS = { PROPIETARIO: 'Propietario', INQUILINO: 'Inquilino', OTRO: 'Otro' };
const STATUS = { OCUPADO: 'Ocupado', EN_ALQUILER: 'En alquiler', DESOCUPADO: 'Desocupado' };

/* Con Supabase: todo sale de lo que la administración asignó a esta persona */
async function renderLivePerfil() {
  const ctx = authService.getContext();
  const active = authService.getActiveAssignment();
  const container = document.createElement('div');
  container.className = 'fade-in';

  // Datos de contacto propios, el departamento activo y su edificio (la persona puede leer solo lo suyo)
  const [{ data: profile }, unitRes, buildingRes] = await Promise.all([
    supabase.from('user_profiles').select('phone, contact_email').eq('id', ctx.user_id).maybeSingle(),
    active ? supabase.from('units').select('floor, status').eq('id', active.unit_id).maybeSingle() : Promise.resolve({ data: null }),
    active ? supabase.from('buildings').select('name, address, city, default_fee').eq('id', active.building_id).maybeSingle() : Promise.resolve({ data: null })
  ]);
  const unit = unitRes.data;
  const bld = buildingRes.data;
  const initials = (ctx.full_name || '').split(/\s+/).filter(w => w && !['de', 'del', 'la', 'las', 'los', 'y', 'e'].includes(w.toLowerCase()))
    .slice(0, 2).map(w => w[0].toUpperCase()).join('');

  container.innerHTML = `
    <div class="card" style="margin-bottom: 1.5rem;">
      <h2 class="card-title"><i data-lucide="user"></i> Mi Perfil y Ficha de Departamento</h2>
      <p>Información de su cuenta y de los departamentos que la administración le asignó.</p>
    </div>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem;">
      <div class="card">
        <div style="text-align: center; margin-bottom: 1.25rem;">
          <div style="width: 72px; height: 72px; border-radius: var(--radius-full); background: linear-gradient(135deg, var(--primary), var(--primary-dark)); color: #fff; font-size: 1.75rem; font-weight: 800; display: flex; align-items: center; justify-content: center; margin: 0 auto 0.75rem auto;">${esc(initials)}</div>
          <h3 style="font-size: 1.2rem; font-weight: 700;">${esc(ctx.full_name)}</h3>
          ${active ? `<span class="badge badge-success" style="margin-top: 0.25rem;">${RELATIONS[active.relation] || active.relation}</span>` : ''}
        </div>
        <div style="display: flex; flex-direction: column; gap: 0.75rem; font-size: 0.9rem; border-top: 1px solid var(--border-color); padding-top: 1rem;">
          <div><span style="color: var(--text-dim); display: block;">Usuario de ingreso:</span><strong>${esc(ctx.full_name)}</strong></div>
          <div><span style="color: var(--text-dim); display: block;">Teléfono:</span><strong>${esc((profile && profile.phone) || 'No registrado')}</strong></div>
          <div><span style="color: var(--text-dim); display: block;">Correo de contacto:</span><strong>${esc((profile && profile.contact_email) || 'No registrado')}</strong></div>
        </div>
      </div>

      <div class="card">
        <h3 class="card-title" style="margin-bottom: 1rem; color: var(--primary);"><i data-lucide="home"></i> Ficha del Inmueble</h3>
        ${active ? `
        <div style="display: flex; flex-direction: column; gap: 0.85rem; font-size: 0.9rem;">
          <div><span style="color: var(--text-dim); display: block;">Edificio:</span>
            <strong>${esc(active.building_name)}${bld && bld.city ? ` (${esc(bld.city)})` : ''}</strong>
            ${bld && bld.address ? `<span class="cell-note">${esc(bld.address)}</span>` : ''}</div>
          <div><span style="color: var(--text-dim); display: block;">Departamento:</span>
            <strong style="font-size: 1.2rem; color: var(--primary);">Dpto ${esc(active.unit_code)}</strong></div>
          <div><span style="color: var(--text-dim); display: block;">Piso:</span><strong>Piso ${unit ? unit.floor : esc(active.floor)}</strong></div>
          ${active.can_view_fees && bld ? `<div><span style="color: var(--text-dim); display: block;">Cuota mensual ordinaria:</span><strong>S/ ${Number(bld.default_fee).toFixed(2)}</strong></div>` : ''}
          <div><span style="color: var(--text-dim); display: block;">Estado de ocupación:</span>
            <span class="badge badge-building">${unit ? (STATUS[unit.status] || unit.status) : '—'}</span></div>
        </div>` : '<p>Todavía no tiene departamentos asignados. Comuníquese con la administración.</p>'}
      </div>

      <div class="card">
        <h3 class="card-title" style="margin-bottom: 1rem; color: var(--primary);"><i data-lucide="key-round"></i> Mis departamentos</h3>
        ${ctx.assignments.length ? `
        <ul style="display: flex; flex-direction: column; gap: 0.6rem; font-size: 0.9rem;">
          ${ctx.assignments.map(a => `
            <li style="display:flex; justify-content: space-between; gap: 0.75rem; border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem;">
              <span><strong>Dpto ${esc(a.unit_code)}</strong> · ${esc(a.building_name)}</span>
              <span class="badge ${active && a.unit_id === active.unit_id ? 'badge-success' : 'badge-neutral'}">${RELATIONS[a.relation] || a.relation}</span>
            </li>`).join('')}
        </ul>
        ${ctx.assignments.length > 1 ? '<p class="cell-note" style="margin-top:0.75rem;">Para cambiar de departamento, use la tarjeta de la barra lateral.</p>' : ''}` : '<p>Sin departamentos asignados.</p>'}
      </div>
    </div>`;

  setTimeout(() => { if (window.lucide) window.lucide.createIcons(); }, 0);
  return container;
}

export async function renderPropietarioPerfil() {
  if (isSupabaseConnected() && authService.getContext()) return renderLivePerfil();
  const user = await authService.getCurrentUser();
  const unit = buildingService.getUnitByCode(user.unit);

  const container = document.createElement('div');
  container.className = 'fade-in';

  container.innerHTML = `
    <div class="card" style="margin-bottom: 1.5rem;">
      <h2 class="card-title"><i data-lucide="user"></i> Mi Perfil y Ficha de Departamento</h2>
      <p>Información del propietario y detalles del inmueble en el edificio PARKE10.</p>
    </div>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem;">
      <!-- Profile Card -->
      <div class="card">
        <div style="text-align: center; margin-bottom: 1.25rem;">
          <div style="width: 72px; height: 72px; border-radius: var(--radius-full); background: linear-gradient(135deg, var(--primary), var(--primary-dark)); color: #fff; font-size: 1.75rem; font-weight: 800; display: flex; align-items: center; justify-content: center; margin: 0 auto 0.75rem auto;">
            ${user.name ? user.name.split(' ').map(n=>n[0]).join('').substring(0,2) : 'CM'}
          </div>
          <h3 style="font-size: 1.2rem; font-weight: 700;">${user.name}</h3>
          <span class="badge badge-success" style="margin-top: 0.25rem;">Propietario Titular</span>
        </div>

        <div style="display: flex; flex-direction: column; gap: 0.75rem; font-size: 0.9rem; border-top: 1px solid var(--border-color); padding-top: 1rem;">
          <div>
            <span style="color: var(--text-dim); display: block;">Correo electrónico:</span>
            <strong>${user.email || 'No registrado'}</strong>
          </div>
          <div>
            <span style="color: var(--text-dim); display: block;">Teléfono registrado:</span>
            <strong>${user.phone || 'No registrado'}</strong>
          </div>
          <div>
            <span style="color: var(--text-dim); display: block;">Acceso al portal:</span>
            <span style="color: var(--primary); font-weight: 600;"><i data-lucide="shield-check" style="width: 14px; height: 14px;"></i> Autenticado vía OTP / Magic Link</span>
          </div>
        </div>
      </div>

      <!-- Unit Card -->
      <div class="card">
        <h3 class="card-title" style="margin-bottom: 1rem; color: var(--primary);">
          <i data-lucide="home"></i> Ficha del Inmueble
        </h3>

        <div style="display: flex; flex-direction: column; gap: 0.85rem; font-size: 0.9rem;">
          <div>
            <span style="color: var(--text-dim); display: block;">Edificio:</span>
            <strong>PARKE10 (Arequipa, Perú)</strong>
          </div>
          <div>
            <span style="color: var(--text-dim); display: block;">Departamento:</span>
            <strong style="font-size: 1.2rem; color: var(--primary);">Dpto ${unit ? unit.code : user.unit}</strong>
          </div>
          <div>
            <span style="color: var(--text-dim); display: block;">Piso:</span>
            <strong>Piso ${unit ? unit.floor : 5}</strong>
          </div>
          <div>
            <span style="color: var(--text-dim); display: block;">Cuota mensual ordinaria:</span>
            <strong>S/ ${unit ? unit.monthly_fee.toFixed(2) : '150.00'}</strong>
          </div>
          <div>
            <span style="color: var(--text-dim); display: block;">Estado de ocupación:</span>
            <span class="badge badge-building">${unit ? unit.status : 'OCUPADO'}</span>
          </div>
        </div>
      </div>
    </div>
  `;

  setTimeout(() => {
    if (window.lucide) window.lucide.createIcons();
  }, 0);

  return container;
}
