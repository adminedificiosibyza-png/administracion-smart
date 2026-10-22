/* Main Application Controller & View Router */
import { store } from './store.js';
import { authService } from './services/authService.js';
import { isSupabaseConnected } from './supabaseClient.js';
import { dataService } from './services/dataService.js';
import { reservationService } from './services/reservationService.js';
import { renderLogin } from './views/loginView.js';
import { alertDialog } from './ui/dialog.js';
import { friendlyError } from './ui/errors.js';
import { isAdminAudience } from './ui/errorAudience.js';

// Para los pocos botones con HTML directo (onclick) que necesitan mostrar un aviso del sistema
window.appAlert = alertDialog;
import { renderAdminUsuarios } from './views/admin/usuariosView.js';
import { renderAdminEdificios } from './views/admin/edificiosView.js';
import { renderAdminHome } from './views/admin/edificiosHomeView.js';
import { renderAdminDirectorio } from './views/admin/directorioView.js';
import { renderAdminNormas } from './views/admin/normasAdminView.js';
import { renderAdminAreas } from './views/admin/areasAdminView.js';
import { renderAdminReservasLive } from './views/admin/reservasAdminLiveView.js';
import { reservationAdminApi } from './services/reservationLive.js';
import { activeBuilding, GLOBAL_ADMIN_VIEWS } from './services/activeBuilding.js';

// Import Views
import { renderPropietarioDashboard } from './views/propietario/dashboard.js';
import { renderPropietarioReservas } from './views/propietario/reservas.js';
import { renderPropietarioMisReservas } from './views/propietario/misReservas.js';
import { renderPropietarioCuotasPagos } from './views/propietario/cuotasPagos.js';
import { renderPropietarioNormas } from './views/propietario/normasView.js';
import { renderPropietarioComunicados } from './views/propietario/comunicadosView.js';
import { renderPropietarioPerfil } from './views/propietario/perfilView.js';

import { renderAdminDashboard } from './views/admin/dashboard.js';
import { renderAdminCobranza } from './views/admin/cobranzaView.js';
import { renderAdminMorosidad } from './views/admin/morosidadView.js';
import { renderAdminReservas } from './views/admin/reservasAdminView.js';
import { renderAdminPropietarios } from './views/admin/propietariosView.js';
import { renderAdminReportes } from './views/admin/reportesView.js';
import { renderAdminReportesLive } from './views/admin/reportesLiveView.js';
import { renderAdminDatosPago } from './views/admin/datosPagoView.js';
import { renderAdminMantenimiento } from './views/admin/mantenimientoView.js';
import { renderAdminCajaGeneral } from './views/admin/cajaGeneralView.js';
import { renderAdminResultado } from './views/admin/resultadoEdificioView.js';
import { renderAdminComunicados } from './views/admin/comunicadosAdminView.js';
import { renderAdminConfiguracion } from './views/admin/configuracionView.js';
import { renderAdminAuditoria } from './views/admin/auditoriaView.js';

class AppController {
  async init() {
    this.bindDOM();

    // Con Supabase conectado se exige iniciar sesión; sin él, modo demostración
    if (isSupabaseConnected()) {
      try {
        await authService.init();
      } catch (err) {
        console.error('❌ No se pudo restaurar la sesión:', err);
      }
      if (!authService.getContext()) {
        this.showLogin();
        return;
      }
    }
    this.start();
  }

  showLogin() {
    const root = document.getElementById('login-root');
    document.body.classList.add('logged-out');
    root.hidden = false;
    renderLogin(root, () => window.location.reload()); // recarga limpia con la sesión ya iniciada
    this.finishBoot();
  }

  /** Quita la pantalla de carga: ya se sabe si corresponde el inicio de sesión o el panel. */
  finishBoot() {
    document.body.classList.remove('booting');
  }

  // Con sesión real: el rol sale de la cuenta (no hay selector de vista) y aparece "Cerrar sesión"
  applyLiveChrome() {
    if (!isSupabaseConnected()) return;

    const selector = document.querySelector('.role-selector-wrapper');
    if (selector) selector.style.display = 'none';

    const authBtn = document.getElementById('auth-modal-btn');
    if (authBtn) {
      const fresh = authBtn.cloneNode(false); // sin los listeners del modo demostración
      fresh.className = 'btn btn-outline btn-sm';
      fresh.id = 'auth-modal-btn';
      fresh.innerHTML = '<i data-lucide="log-out"></i><span class="btn-label">Cerrar sesión</span>';
      fresh.setAttribute('aria-label', 'Cerrar sesión');
      // Sin barra lateral en las pantallas globales, el nombre de la persona se ve junto a "Cerrar sesión"
      const ctx = authService.getContext();
      if (ctx && !document.getElementById('demo-user-chip')) {
        const chip = document.createElement('span');
        chip.id = 'demo-user-chip';
        chip.className = 'demo-user-chip';
        chip.textContent = ctx.full_name;
        authBtn.parentElement.insertBefore(chip, authBtn);
      }
      fresh.addEventListener('click', async () => {
        await authService.signOut();
        window.location.reload();
      });
      authBtn.replaceWith(fresh);
    }

    // Con sesión real el edificio se ve y se cambia desde la barra lateral: la etiqueta de arriba sobra
    const buildingBadge = document.getElementById('header-building-badge');
    if (buildingBadge) buildingBadge.style.display = 'none';

    // El indicador de fuente de datos es una herramienta del superadmin
    const badge = document.getElementById('data-source-badge');
    if (badge && !authService.isSuperadmin()) badge.style.display = 'none';

    store.setRole(authService.isSuperadmin() ? 'administradora' : 'propietario');
  }

  start() {
    document.body.classList.remove('logged-out');
    const loginRoot = document.getElementById('login-root');
    if (loginRoot) loginRoot.hidden = true;
    this.applyLiveChrome();
    this.guardView();

    this.history = [];
    this.lastView = null;
    this.navigatingBack = false;
    this.trackHistory();
    document.getElementById('btn-back')?.addEventListener('click', () => this.goBack());
    document.getElementById('sidebar-building-card')?.addEventListener('click', (e) => { e.stopPropagation(); this.openBuildingSwitcher(e.currentTarget); });

    this.updateDataSourceBadge();
    this.updateBuildingChrome();
    this.updateBell();
    const navReady = this.renderSidebarNav();
    this.renderMobileBottomNav();
    const viewReady = this.renderCurrentView();
    // El panel se muestra cuando la primera pantalla ya está lista (o falló), nunca a medias
    Promise.allSettled([navReady, viewReady]).then(() => this.finishBoot());

    // Subscribe to state changes
    store.subscribe(() => {
      this.guardView();
      this.trackHistory();
      this.updateBuildingChrome();
      this.updateDataSourceBadge();
      this.updateBell();
      this.renderSidebarNav().catch(err => console.error('❌ renderSidebarNav error:', err));
      this.renderMobileBottomNav();
      this.renderCurrentView().catch(err => console.error('❌ renderCurrentView error:', err));
    });
  }

  // El superadmin no puede abrir pantallas "de un edificio" sin haber elegido uno: vuelve a Mis edificios
  // ¿El propietario/inquilino no tiene permiso para ver cuotas en su departamento activo? (solo con Supabase)
  ownerCannotSeeFees() {
    if (!isSupabaseConnected() || store.currentRole !== 'propietario') return false;
    const a = authService.getActiveAssignment();
    return !!a && !a.can_view_fees;
  }

  guardView() {
    if (isSupabaseConnected() && store.currentRole === 'propietario'
        && store.currentView === 'propietario-cuotas' && this.ownerCannotSeeFees()) {
      store.currentView = 'propietario-dashboard';
      return;
    }
    if (!isSupabaseConnected() || store.currentRole !== 'administradora') return;
    const view = store.currentView;
    if (view.startsWith('admin-') && !GLOBAL_ADMIN_VIEWS.includes(view) && !activeBuilding.get()) {
      store.currentView = 'admin-home';
    }
  }

  // Tarjeta de la barra lateral y etiqueta superior: muestran el edificio actual, no uno fijo
  updateBuildingChrome() {
    if (!isSupabaseConnected()) return;

    // Fuera de un edificio (inicio y configuración global) no hay barra lateral: sus accesos ya están en la pantalla
    document.body.classList.toggle('no-sidebar',
      store.currentRole === 'administradora' && !activeBuilding.isInside(store.currentView));

    let name = '';
    let subtitle = '';
    let color = '#4f7609';
    let headerText = '';

    // Solo se puede cambiar de edificio estando dentro de uno
    const switchable = store.currentRole === 'administradora' && activeBuilding.isInside(store.currentView);
    // El propietario con más de un departamento también puede alternar entre ellos
    const ctxAssignments = (authService.getContext() && authService.getContext().assignments) || [];
    const ownerSwitchable = store.currentRole === 'propietario' && ctxAssignments.length > 1;
    document.getElementById('sidebar-building-card')?.classList.toggle('switchable', switchable || ownerSwitchable);

    if (store.currentRole === 'administradora') {
      const b = switchable ? activeBuilding.get() : null;
      if (b) {
        name = b.name;
        subtitle = (b.total_units != null && b.total_floors != null)
          ? `${b.total_units} Departamentos • ${b.total_floors} Pisos`
          : (b.code || '');
        color = b.brand_color || color;
        headerText = b.city ? `${b.name} - ${b.city}` : b.name;
      } else {
        name = 'Mis edificios';
        subtitle = `${activeBuilding.list().length} edificio(s) a su cargo`;
        headerText = 'Todos los edificios';
      }
    } else {
      const a = authService.getActiveAssignment();
      if (a) {
        name = a.building_name;
        subtitle = `Dpto ${a.unit_code}`;
        color = a.brand_color || color;
        headerText = a.building_name;
      }
    }

    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set('sidebar-building-title', name);
    set('sidebar-building-sub', subtitle);
    set('current-building-name', headerText);
    const avatar = document.getElementById('sidebar-building-avatar');
    if (avatar) {
      avatar.textContent = (name.trim()[0] || 'E').toUpperCase();
      avatar.style.background = color;
    }
  }

  // Historial de pantallas para el botón "Atrás"
  trackHistory() {
    const current = store.currentView;
    if (this.lastView && current !== this.lastView && !this.navigatingBack) {
      this.history.push(this.lastView);
      if (this.history.length > 25) this.history.shift();
    }
    this.navigatingBack = false;
    this.lastView = current;

    // En las pantallas de inicio no hay a dónde volver
    const isRoot = ['admin-home', 'propietario-dashboard'].includes(current);
    const btn = document.getElementById('btn-back');
    if (btn) btn.hidden = this.history.length === 0 || isRoot;
  }

  goBack() {
    // Salta pantallas que la guarda no permitiría (por ejemplo, de un edificio sin elegir uno)
    while (this.history.length) {
      const previous = this.history.pop();
      if (previous === store.currentView) continue;
      this.navigatingBack = true;
      store.setView(previous);
      return;
    }
  }

  // Menú para cambiar de edificio (desde la cabecera o la tarjeta de la barra lateral)
  // Propietario / inquilino: alternar entre los departamentos que tiene asignados
  async openUnitSwitcher(trigger) {
    // Releer el contexto: si la administración cambió el color o nombre de un edificio, se refleja aquí
    try { await authService.loadContext(); this.updateBuildingChrome(); } catch (e) { /* se usa el contexto anterior */ }
    const ctx = authService.getContext();
    const assignments = (ctx && ctx.assignments) || [];
    const current = authService.getActiveAssignment();
    const menu = document.createElement('div');
    menu.id = 'building-switcher';
    menu.className = 'switcher-menu';
    const relation = { PROPIETARIO: 'Propietario', INQUILINO: 'Inquilino', OTRO: 'Otro' };
    menu.innerHTML = `
      <div class="switcher-title">Mis departamentos</div>
      ${assignments.map(a => `
        <button type="button" class="switcher-item ${current && a.unit_id === current.unit_id ? 'current' : ''}" data-unit="${a.unit_id}">
          <span class="switcher-avatar" style="background:${a.brand_color || '#4f7609'};">${(a.building_name || '?').trim()[0].toUpperCase()}</span>
          <span class="switcher-name">Dpto ${a.unit_code} · ${a.building_name}<small>${relation[a.relation] || a.relation}</small></span>
          ${current && a.unit_id === current.unit_id ? '<i data-lucide="check"></i>' : ''}
        </button>`).join('')}`;
    document.body.appendChild(menu);
    if (window.lucide) window.lucide.createIcons();

    const rect = trigger.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 6}px`;
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;

    menu.querySelectorAll('.switcher-item').forEach(item => item.addEventListener('click', () => {
      this.closeBuildingSwitcher();
      authService.setActiveUnit(item.dataset.unit);
      store.setView(store.currentView); // misma pantalla, ahora del otro departamento
      this.setSidebarOpen(false);
    }));

    setTimeout(() => {
      this._switcherOutside = (e) => { if (!menu.contains(e.target)) this.closeBuildingSwitcher(); };
      this._switcherEsc = (e) => { if (e.key === 'Escape') this.closeBuildingSwitcher(); };
      document.addEventListener('click', this._switcherOutside);
      document.addEventListener('keydown', this._switcherEsc);
    }, 0);
  }

  openBuildingSwitcher(trigger) {
    this.closeBuildingSwitcher();
    if (!trigger.classList.contains('switchable')) return;
    if (store.currentRole === 'propietario') { this.openUnitSwitcher(trigger); return; }

    const current = activeBuilding.get();
    const menu = document.createElement('div');
    menu.id = 'building-switcher';
    menu.className = 'switcher-menu';
    menu.innerHTML = `
      <div class="switcher-title">Cambiar de edificio</div>
      ${activeBuilding.list().map(b => `
        <button type="button" class="switcher-item ${current && b.id === current.id ? 'current' : ''}" data-id="${b.id}">
          <span class="switcher-avatar" style="background:${b.brand_color || '#4f7609'};">${(b.name || '?').trim()[0].toUpperCase()}</span>
          <span class="switcher-name">${b.name}<small>${b.code}</small></span>
          ${current && b.id === current.id ? '<i data-lucide="check"></i>' : ''}
        </button>`).join('')}
      <button type="button" class="switcher-item switcher-all" data-all="1">
        <i data-lucide="layout-grid"></i><span class="switcher-name">Ver todos los edificios</span>
      </button>`;
    document.body.appendChild(menu);
    if (window.lucide) window.lucide.createIcons();

    const rect = trigger.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 6}px`;
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;

    menu.querySelectorAll('.switcher-item').forEach(item => item.addEventListener('click', () => {
      this.closeBuildingSwitcher();
      if (item.dataset.all) { store.setView('admin-home'); return; }
      activeBuilding.set(item.dataset.id);
      store.setView(store.currentView); // misma pantalla, ahora del otro edificio
      this.setSidebarOpen(false);
    }));

    // Se cierra al hacer clic fuera o con Escape
    setTimeout(() => {
      this._switcherOutside = (e) => { if (!menu.contains(e.target)) this.closeBuildingSwitcher(); };
      this._switcherEsc = (e) => { if (e.key === 'Escape') this.closeBuildingSwitcher(); };
      document.addEventListener('click', this._switcherOutside);
      document.addEventListener('keydown', this._switcherEsc);
    }, 0);
  }

  closeBuildingSwitcher() {
    document.getElementById('building-switcher')?.remove();
    if (this._switcherOutside) document.removeEventListener('click', this._switcherOutside);
    if (this._switcherEsc) document.removeEventListener('keydown', this._switcherEsc);
    this._switcherOutside = this._switcherEsc = null;
  }

  /** Abre o cierra el menú lateral en el celular (junto con su fondo oscuro). */
  setSidebarOpen(open) {
    document.getElementById('sidebar')?.classList.toggle('open', !!open);
    document.getElementById('sidebar-backdrop')?.classList.toggle('show', !!open);
  }

  updateBell() {
    // La campanita es solo de administración (avisa de reservas pendientes); el propietario no la ve
    const bell = document.getElementById('notifications-btn');
    if (bell) bell.hidden = store.currentRole !== 'administradora';
    const dot = document.querySelector('#notifications-btn .notification-dot');
    if (!dot) return;
    // Con Supabase el conteo real lo calcula renderSidebarNav; en demostración sale de los datos locales
    const count = store.currentRole !== 'administradora' ? 0
      : (isSupabaseConnected() ? (this.livePending || 0) : reservationService.getPendingCount());
    dot.style.display = count > 0 ? '' : 'none';
  }

  updateDataSourceBadge() {
    const badge = document.getElementById('data-source-badge');
    if (!badge) return;

    const source = dataService.getDataSourceType();
    if (source === 'SUPABASE') {
      badge.className = 'badge badge-success';
      badge.style.fontSize = '0.7rem';
      badge.style.marginLeft = '0.5rem';
      badge.innerHTML = '<i data-lucide="database" style="width: 12px; height: 12px;"></i> Fuente: SUPABASE (Live)';
    } else {
      badge.className = 'badge badge-warning';
      badge.style.fontSize = '0.7rem';
      badge.style.marginLeft = '0.5rem';
      badge.innerHTML = '<i data-lucide="file-code" style="width: 12px; height: 12px;"></i> Fuente: MOCK (Local)';
    }
    if (window.lucide) window.lucide.createIcons();
  }

  bindDOM() {
    // En celular las tablas se muestran como tarjetas: cada celda lleva el nombre de su columna
    const labelTables = () => document.querySelectorAll('table.table-cards').forEach(tbl => {
      const heads = [...tbl.querySelectorAll('thead th')].map(th => th.textContent.trim());
      tbl.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td, i) => {
        if (td.colSpan > 1 || td.dataset.label !== undefined) return;
        if (heads[i]) td.dataset.label = heads[i];
      }));
    });
    const viewRoot = document.getElementById('view-container');
    if (viewRoot) new MutationObserver(labelTables).observe(viewRoot, { childList: true, subtree: true });
    labelTables();

    // Errores no controlados y campos incompletos: siempre se muestran con los diálogos del sistema
    let errorDialogOpen = false;
    const showSystemError = (err) => {
      const text = String((err && err.message) || err || '');
      if (!text || /ResizeObserver|^Script error\.?$/i.test(text) || errorDialogOpen) return;
      console.error('❌ Error no controlado:', err);
      errorDialogOpen = true;
      alertDialog({ tone: 'danger', title: 'Ocurrió un problema', message: text }).finally(() => { errorDialogOpen = false; });
    };
    window.addEventListener('unhandledrejection', (e) => { showSystemError(e.reason); });
    window.addEventListener('error', (e) => { if (e.error) showSystemError(e.error); });
    let invalidShown = false;
    document.addEventListener('invalid', (e) => {
      e.preventDefault();   // se reemplaza el globo del navegador por el aviso del sistema
      if (invalidShown) return;
      invalidShown = true;
      const field = e.target;
      const label = (field.id && document.querySelector(`label[for="${field.id}"]`)) || field.closest('.form-group')?.querySelector('label');
      const name = label ? label.textContent.replace(/\*|\(.*?\)/g, '').trim() : '';
      alertDialog({ tone: 'warning', title: 'Falta completar un dato',
        message: name ? `Complete o corrija el campo "${name}" para continuar.` : 'Complete o corrija los campos marcados para continuar.' })
        .finally(() => { invalidShown = false; try { field.focus(); } catch { /* campo ya no existe */ } });
    }, true);
    // Role selector change
    const roleSelect = document.getElementById('role-select');
    if (roleSelect) {
      roleSelect.value = store.currentRole;
      roleSelect.addEventListener('change', (e) => {
        store.setRole(e.target.value);
      });
    }

    // Auth / Supabase credentials modal
    const authBtn = document.getElementById('auth-modal-btn');
    if (authBtn) {
      authBtn.addEventListener('click', () => this.openAuthModal());
    }

    // Bell: para la administradora lleva a las solicitudes de reserva pendientes
    document.getElementById('notifications-btn')?.addEventListener('click', () => {
      if (store.currentRole === 'administradora') store.setView('admin-reservas');
    });

    // Mobile menu toggle
    const menuToggle = document.getElementById('mobile-menu-toggle');
    const sidebar = document.getElementById('sidebar');
    if (menuToggle && sidebar) {
      // Fondo oscuro detrás del menú en el celular: tocarlo (o pulsar Esc) cierra el menú
      const backdrop = document.createElement('div');
      backdrop.id = 'sidebar-backdrop';
      backdrop.className = 'sidebar-backdrop';
      document.body.appendChild(backdrop);
      backdrop.addEventListener('click', () => this.setSidebarOpen(false));
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.setSidebarOpen(false); });
      menuToggle.addEventListener('click', () => this.setSidebarOpen(!sidebar.classList.contains('open')));
    }

    // Set current date
    const dateDisplay = document.getElementById('current-date-display');
    if (dateDisplay) {
      const today = new Date();
      const dd = String(today.getDate()).padStart(2, '0');
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const yyyy = today.getFullYear();
      dateDisplay.textContent = `${dd}/${mm}/${yyyy}`;
    }
  }

  async renderSidebarNav() {
    const nav = document.getElementById('sidebar-nav');
    if (!nav) return;

    const user = await authService.getCurrentUser();
    const role = store.currentRole;

    // Update user badge in footer
    const avatar = document.getElementById('user-avatar-initials');
    const nameEl = document.getElementById('user-display-name');
    const roleEl = document.getElementById('user-display-role');

    if (avatar && nameEl && roleEl) {
      const live = isSupabaseConnected();
      // Iniciales de las dos primeras palabras significativas (sin "de", "del", "la"...)
      const initials = (user.name || '').split(/\s+/)
        .filter(w => w && !['de', 'del', 'la', 'las', 'los', 'y', 'e'].includes(w.toLowerCase()))
        .slice(0, 2).map(w => w[0].toUpperCase()).join('');
      if (role === 'administradora') {
        avatar.textContent = live ? initials : 'ADM';
        nameEl.textContent = live ? user.name : 'Administración PARKE10';
        roleEl.textContent = live ? 'Superadministrador' : 'Administradora del Edificio';
      } else {
        avatar.textContent = initials || 'CM';
        nameEl.textContent = user.name;
        roleEl.textContent = `Propietario • Dpto ${user.unit}`;
      }
    }

    const live = isSupabaseConnected();
    let items = [];

    if (role === 'propietario') {
      // demo: pantallas que todavía muestran datos de ejemplo (se conectan a Supabase en las próximas fases)
      items = [
        { id: 'propietario-dashboard', label: '🏠 Inicio', icon: 'home' },
        { id: 'propietario-normas', label: '📖 Normas de Convivencia', icon: 'book-open' },
        { id: 'propietario-reservas', label: '📅 Reservar Área Común', icon: 'calendar' },
        { id: 'propietario-mis-reservas', label: '📋 Mis Reservas', icon: 'bookmark-check' },
        { id: 'propietario-cuotas', label: '💰 Cuotas y Pagos', icon: 'dollar-sign' },
        { id: 'propietario-comunicados', label: '📢 Comunicados', icon: 'megaphone' },
        { id: 'propietario-perfil', label: '👤 Mi Perfil', icon: 'user' }
      ];
      // Sin permiso para ver cuotas en el departamento activo: esa opción no aparece
      if (this.ownerCannotSeeFees()) items = items.filter(i => i.id !== 'propietario-cuotas');
    } else if (live) {
      // Superadmin con Supabase. Dos menús separados:
      //  - dentro de un edificio: solo los módulos de ese edificio
      //  - fuera (inicio y configuración global): solo "Mis edificios" y la configuración global
      const building = activeBuilding.get();
      if (activeBuilding.isInside(store.currentView)) {
        items = [
          { id: 'admin-home', label: '← Todos mis edificios', icon: 'layout-grid', back: true },
          { section: `Edificio: ${building.name}` },
          { id: 'admin-dashboard', label: '📊 Dashboard', icon: 'bar-chart-2' },
          { id: 'admin-cobranza', label: '💰 Listado de Cobranza', icon: 'dollar-sign' },
          { id: 'admin-reservas', label: '📅 Solicitudes y Bloqueos', icon: 'calendar' },
          { id: 'admin-propietarios', label: '👥 Departamentos y Personas', icon: 'users' },
          { id: 'admin-normas', label: '📖 Normas de Convivencia', icon: 'book-open' },
          { id: 'admin-comunicados', label: '📢 Gestionar Comunicados', icon: 'megaphone' },
          { id: 'admin-datos-pago', label: '🏦 Datos de Pago', icon: 'landmark' },
          { id: 'admin-areas', label: '🏊 Áreas Comunes', icon: 'umbrella' },
          { id: 'admin-mantenimiento', label: '🛠️ Mantenimiento y Servicios', icon: 'wrench' },
          { id: 'admin-reportes', label: '📈 Reporte de Cuotas', icon: 'file-text' },
          { id: 'admin-resultado', label: '📊 Resultado del Edificio', icon: 'scale' },
          { id: 'admin-auditoria', label: '📜 Registro de Auditoría', icon: 'history' }
        ];
      } else {
        items = [
          { id: 'admin-home', label: '🏠 Mis edificios', icon: 'layout-grid' },
          { section: 'Configuración global' },
          { id: 'admin-edificios', label: '🏢 Gestión de Edificios', icon: 'building-2' },
          { id: 'admin-caja', label: '🏦 Caja General', icon: 'landmark' },
          { id: 'admin-usuarios', label: '🔑 Usuarios y Accesos', icon: 'key-round' }
        ];
      }
    } else {
      items = [
        { id: 'admin-dashboard', label: '📊 Dashboard General', icon: 'bar-chart-2' },
        { id: 'admin-cobranza', label: '💰 Listado de Cobranza', icon: 'dollar-sign' },
        { id: 'admin-morosidad', label: '📊 Intereses Moratorios', icon: 'percent' },
        { id: 'admin-reservas', label: '📅 Solicitudes y Bloqueos', icon: 'calendar' },
        { id: 'admin-edificios', label: '🏢 Gestión de Edificios', icon: 'building-2' },
        { id: 'admin-usuarios', label: '🔑 Usuarios y Accesos', icon: 'key-round' },
        { id: 'admin-propietarios', label: '👥 Directorio Propietarios', icon: 'users' },
        { id: 'admin-reportes', label: '📈 Reportes Financieros', icon: 'file-text' },
        { id: 'admin-comunicados', label: '📢 Gestionar Comunicados', icon: 'megaphone' },
        { id: 'admin-configuracion', label: '⚙️ Parámetros Edificio', icon: 'settings' },
        { id: 'admin-auditoria', label: '📜 Registro Auditoría', icon: 'history' }
      ];
    }

    // Solicitudes de reserva pendientes: reales con Supabase (del edificio activo), de ejemplo en demostración
    let pendingCount = 0;
    if (role === 'administradora') {
      if (!live) {
        pendingCount = reservationService.getPendingCount();
      } else if (activeBuilding.get()) {
        pendingCount = await reservationAdminApi.countPending(activeBuilding.get().id);
      }
    }
    this.livePending = pendingCount;
    this.updateBell();
    const countBadge = item => (item.id === 'admin-reservas' && pendingCount > 0)
      ? `<span class="nav-counter">${pendingCount}</span>` : '';
    const demoTag = item => (live && item.demo) ? '<span class="nav-tag" title="Esta pantalla todavía muestra datos de ejemplo">demo</span>' : '';

    nav.innerHTML = items.map(item => item.section
      ? `<div class="nav-section">${item.section}</div>`
      : `
      <div class="nav-item ${store.currentView === item.id ? 'active' : ''} ${item.back ? 'nav-item-switch' : ''}" data-view="${item.id}">
        <i data-lucide="${item.icon}"></i>
        <span>${item.label.replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/u, '')}</span>
        ${countBadge(item)}${demoTag(item)}
      </div>
    `).join('');

    // Click handlers
    nav.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        const viewId = item.getAttribute('data-view');
        store.setView(viewId);
        this.setSidebarOpen(false);
      });
    });

    if (window.lucide) window.lucide.createIcons();
  }

  renderMobileBottomNav() {
    const nav = document.getElementById('mobile-bottom-nav');
    if (!nav) return;

    const role = store.currentRole;
    let items = [];

    if (role === 'propietario') {
      items = [
        { id: 'propietario-dashboard', label: 'Inicio', icon: 'home' },
        { id: 'propietario-normas', label: 'Normas', icon: 'book-open' },
        { id: 'propietario-reservas', label: 'Reservar', icon: 'calendar' },
        { id: 'propietario-cuotas', label: 'Cuotas', icon: 'dollar-sign' },
        { id: 'propietario-comunicados', label: 'Avisos', icon: 'megaphone' }
      ];
      if (this.ownerCannotSeeFees()) items = items.filter(i => i.id !== 'propietario-cuotas');
    } else if (isSupabaseConnected()) {
      items = [{ id: 'admin-home', label: 'Edificios', icon: 'layout-grid' }];
      if (activeBuilding.isInside(store.currentView)) {
        items.push(
          { id: 'admin-dashboard', label: 'Dashboard', icon: 'bar-chart-2' },
          { id: 'admin-cobranza', label: 'Cobranza', icon: 'dollar-sign' },
          { id: 'admin-reservas', label: this.livePending > 0 ? `Reservas (${this.livePending})` : 'Reservas', icon: 'calendar' }
        );
      } else {
        items.push(
          { id: 'admin-edificios', label: 'Gestión', icon: 'building-2' },
          { id: 'admin-usuarios', label: 'Usuarios', icon: 'key-round' }
        );
      }
    } else {
      items = [
        { id: 'admin-dashboard', label: 'Dashboard', icon: 'bar-chart-2' },
        { id: 'admin-cobranza', label: 'Cobranza', icon: 'dollar-sign' },
        { id: 'admin-reservas', label: 'Reservas', icon: 'calendar' },
        { id: 'admin-reportes', label: 'Reportes', icon: 'file-text' },
        { id: 'admin-configuracion', label: 'Config', icon: 'settings' }
      ];
    }

    nav.innerHTML = items.map(item => `
      <div class="mobile-nav-item ${store.currentView === item.id ? 'active' : ''}" data-view="${item.id}">
        <i data-lucide="${item.icon}"></i>
        <span>${item.label}${(item.id === 'admin-reservas' && !isSupabaseConnected() && reservationService.getPendingCount() > 0) ? ` (${reservationService.getPendingCount()})` : ''}</span>
      </div>
    `).join('');

    nav.querySelectorAll('.mobile-nav-item').forEach(item => {
      item.addEventListener('click', () => {
        store.setView(item.getAttribute('data-view'));
      });
    });

    if (window.lucide) window.lucide.createIcons();
  }

  async renderCurrentView() {
    const container = document.getElementById('view-container');
    const titleEl = document.getElementById('page-title');
    if (!container) return;

    // Cada pantalla se arma de forma asíncrona. Si el usuario cambia de pantalla antes de que termine
    // la anterior, el resultado viejo se descarta (antes se agregaba debajo de la nueva y se "juntaban").
    const token = (this._renderToken = (this._renderToken || 0) + 1);
    this.setSidebarOpen(false); // al cambiar de pantalla el menú del celular se cierra
    const isStale = () => token !== this._renderToken;

    container.innerHTML = '';
    let element = null;
    let pageTitle = 'Sistema de Edificios';

    try {
      switch (store.currentView) {
        // Propietario views
        case 'propietario-dashboard':
          element = await renderPropietarioDashboard();
          // El nombre sale del edificio del departamento activo (no es siempre PARKE10)
          pageTitle = `Portal de Propietarios — ${(isSupabaseConnected() && authService.getActiveAssignment()) ? authService.getActiveAssignment().building_name : 'PARKE10'}`;
          break;
        case 'propietario-reservas':
          element = await renderPropietarioReservas();
          pageTitle = 'Reservar Área Común';
          break;
        case 'propietario-mis-reservas':
          element = await renderPropietarioMisReservas();
          pageTitle = 'Mis Reservas';
          break;
        case 'propietario-cuotas':
          element = await renderPropietarioCuotasPagos();
          pageTitle = 'Cuotas de Mantenimiento y Pagos';
          break;
        case 'propietario-normas':
          element = renderPropietarioNormas();
          pageTitle = 'Normas de Convivencia';
          break;
        case 'propietario-comunicados':
          element = renderPropietarioComunicados();
          pageTitle = 'Comunicados de Administración';
          break;
        case 'propietario-perfil':
          element = await renderPropietarioPerfil();
          pageTitle = 'Mi Perfil';
          break;

        // Admin views
        case 'admin-dashboard':
          element = renderAdminDashboard();
          pageTitle = 'Dashboard General Administradora';
          break;
        case 'admin-cobranza':
          element = renderAdminCobranza();
          pageTitle = 'Listado y Registro de Cobranza';
          break;
        case 'admin-morosidad':
          element = renderAdminMorosidad();
          pageTitle = 'Configuración de Intereses Moratorios';
          break;
        case 'admin-reservas':
          element = isSupabaseConnected() ? renderAdminReservasLive() : renderAdminReservas();
          pageTitle = 'Administrar Reservas y Bloqueos';
          break;
        case 'admin-areas':
          element = renderAdminAreas();
          pageTitle = `Áreas Comunes — ${(activeBuilding.get() || {}).name || ''}`;
          break;
        case 'admin-datos-pago':
          element = renderAdminDatosPago();
          pageTitle = `Datos de Pago — ${(activeBuilding.get() || {}).name || ''}`;
          break;
        case 'admin-mantenimiento':
          element = renderAdminMantenimiento();
          pageTitle = `Mantenimiento y Servicios — ${(activeBuilding.get() || {}).name || ''}`;
          break;
        case 'admin-resultado':
          element = renderAdminResultado();
          pageTitle = `Resultado del Edificio — ${(activeBuilding.get() || {}).name || ''}`;
          break;
        case 'admin-caja':
          element = renderAdminCajaGeneral();
          pageTitle = 'Caja General';
          break;
        case 'admin-normas':
          element = renderAdminNormas();
          pageTitle = `Normas de Convivencia — ${(activeBuilding.get() || {}).name || ''}`;
          break;
        case 'admin-home':
          element = renderAdminHome();
          pageTitle = 'Mis edificios';
          break;
        case 'admin-edificios':
          element = renderAdminEdificios();
          pageTitle = 'Gestión de Edificios';
          break;
        case 'admin-usuarios':
          element = renderAdminUsuarios();
          pageTitle = 'Usuarios y Accesos';
          break;
        case 'admin-propietarios':
          element = isSupabaseConnected() ? renderAdminDirectorio() : renderAdminPropietarios();
          pageTitle = isSupabaseConnected() ? 'Departamentos y Personas' : 'Directorio de Propietarios';
          break;
        case 'admin-reportes':
          element = isSupabaseConnected() ? renderAdminReportesLive() : renderAdminReportes();
          pageTitle = 'Reporte de Cuotas';
          break;
        case 'admin-comunicados':
          element = renderAdminComunicados();
          pageTitle = 'Publicar y Administrar Comunicados';
          break;
        case 'admin-configuracion':
          element = renderAdminConfiguracion();
          pageTitle = `Parámetros del Edificio ${(isSupabaseConnected() && activeBuilding.get()) ? activeBuilding.get().name : 'PARKE10'}`;
          break;
        case 'admin-auditoria':
          element = renderAdminAuditoria();
          pageTitle = 'Registro de Auditoría';
          break;

        default:
          element = await renderPropietarioDashboard();
          pageTitle = 'Portal PARKE10';
          break;
      }

      if (isStale()) return; // ya se pidió otra pantalla: no mezclar resultados
      if (titleEl) titleEl.textContent = pageTitle;
      if (element) container.appendChild(element);

    } catch (err) {
      if (isStale()) return;
      console.error('❌ Error al renderizar la vista:', err);
      const friendly = friendlyError(err);
      const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      if (titleEl) titleEl.textContent = 'Error al Cargar la Vista';

      // Clean Error State UI (Point 10 requirement)
      container.innerHTML = `
        <div class="card" style="border-left: 5px solid var(--status-danger); padding: 2rem;">
          <h3 style="color: var(--status-danger); margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem;">
            <i data-lucide="alert-octagon"></i> Estamos teniendo problemas para cargar esta vista.
          </h3>
          <p style="margin-bottom: 1rem; white-space: pre-line;">${escHtml(friendly.title ? friendly.title + '. ' : '')}${escHtml(friendly.message)}</p>
          ${(friendly.matched && isAdminAudience()) ? `<details style="margin-bottom: 1rem; font-size: 0.8rem; color: var(--text-dim);"><summary>Detalle técnico</summary><code>${escHtml(err.message)}</code></details>` : ''}
          <button class="btn btn-primary btn-sm" id="btn-retry-render">
            <i data-lucide="refresh-cw"></i> Reintentar Cargar
          </button>
        </div>
      `;

      setTimeout(() => {
        container.querySelector('#btn-retry-render')?.addEventListener('click', () => {
          this.renderCurrentView();
        });
      }, 0);
    }

    if (window.lucide) window.lucide.createIcons();
  }

  openAuthModal() {
    const modalOverlay = document.getElementById('modal-container');
    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');

    modalTitle.innerHTML = `<i data-lucide="key-round" style="color: var(--primary);"></i> Acceso Seguro &amp; Configuracion Supabase Auth`;

    modalBody.innerHTML = `
      <p style="margin-bottom: 1rem; font-size: 0.9rem;">
        El sistema soporta acceso para propietarios mediante <strong>Magic Link u OTP por correo/celular</strong>.
      </p>

      <form id="auth-otp-form" style="margin-bottom: 1.5rem; border-bottom: 1px solid var(--border-color); padding-bottom: 1rem;">
        <h4 style="font-size: 0.95rem; margin-bottom: 0.5rem; color: var(--primary);">Solicitar Codigo de Acceso / Magic Link (Propietario)</h4>
        <div class="form-group">
          <label class="form-label">Correo electronico o Telefono celular</label>
          <input type="text" id="otp-input" class="form-control" placeholder="ingresa.tu.correo@dominio.pe o +51 987..." required>
        </div>
        <button type="submit" class="btn btn-primary btn-sm"><i data-lucide="send"></i> Enviar Enlace / Codigo OTP</button>
        <!-- Inline feedback zone: B (MOCK warning) and C (Supabase error) -->
        <div id="otp-msg" style="display:none; margin-top: 0.75rem; padding: 0.6rem 0.9rem; border-radius: var(--radius-md); font-size: 0.85rem;"></div>
      </form>
    `;

    modalOverlay.classList.remove('hidden');

    document.getElementById('modal-close-btn').onclick = () => modalOverlay.classList.add('hidden');

    // ── Inline message helpers ─────────────────────────────────────────────
    function showMsg(zoneId, text, isError) {
      const el = document.getElementById(zoneId);
      if (!el) return;
      el.style.display = 'block';
      el.style.background = isError ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)';
      el.style.border = `1px solid ${isError ? 'rgba(239,68,68,0.4)' : 'rgba(34,197,94,0.4)'}`;
      el.style.color = isError ? 'var(--status-danger, #ef4444)' : 'var(--status-success, #22c55e)';
      el.textContent = text;
    }
    function clearMsg(zoneId) {
      const el = document.getElementById(zoneId);
      if (el) el.style.display = 'none';
    }

    // ── B & C: OTP form ────────────────────────────────────────────────────
    document.getElementById('auth-otp-form').onsubmit = (e) => {
      e.preventDefault();
      clearMsg('otp-msg');

      // B: Block OTP if Supabase credentials are not configured
      if (!isSupabaseConnected()) {
        showMsg(
          'otp-msg',
          'Aviso: La aplicacion esta en modo demo (MOCK). Para enviar un codigo OTP real, el envio de codigos no esta disponible.',
          true
        );
        return;
      }

      const val = document.getElementById('otp-input').value.trim();
      const submitBtn = e.target.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;

      // C: Handle both Supabase result.error and Promise rejections
      authService.requestOwnerAccess(val)
        .then(result => {
          if (result.error) {
            // Supabase returned an error object — never show success
            showMsg(
              'otp-msg',
              `No se pudo enviar el enlace: ${result.error.message || 'Error desconocido de Supabase Auth.'}`,
              true
            );
          } else {
            showMsg(
              'otp-msg',
              `Enlace / Codigo OTP enviado a "${val}". Revisa tu correo o telefono.`,
              false
            );
            setTimeout(() => modalOverlay.classList.add('hidden'), 2500);
          }
        })
        .catch(err => {
          // Network error, exception, or unexpected rejection
          showMsg(
            'otp-msg',
            `Error al contactar Supabase: ${err.message || 'Verifica tu conexion e intentalo nuevamente.'}`,
            true
          );
        })
        .finally(() => {
          if (submitBtn) submitBtn.disabled = false;
        });
    };

    if (window.lucide) window.lucide.createIcons();
  }
}

// Robust execution trigger (Solves "Cargando..." issue when DOM is ready before or during module load)
function startApp() {
  const app = new AppController();
  // Si algo se cuelga, la pantalla de carga no se queda para siempre
  const safety = setTimeout(() => app.finishBoot(), 15000);
  Promise.resolve(app.init()).catch(err => console.error('❌ Error al iniciar:', err)).finally(() => {
    // En el modo con sesión, start() ya retira la pantalla de carga al terminar de armar el panel
    if (document.body.classList.contains('logged-out')) clearTimeout(safety);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}
