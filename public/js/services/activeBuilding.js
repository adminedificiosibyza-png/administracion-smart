/* Edificio activo del superadmin: todo lo que se ve "dentro" de un edificio se limita a él */
import { authService } from './authService.js';

const KEY = 'parke10_active_building';

// Pantallas que no pertenecen a un edificio concreto (se pueden abrir sin haber elegido uno)
export const GLOBAL_ADMIN_VIEWS = ['admin-home', 'admin-edificios', 'admin-usuarios', 'admin-caja'];

// Pantallas que trabajan "dentro" de un edificio: el menú lateral muestra sus módulos
export const BUILDING_VIEWS = [
  'admin-dashboard', 'admin-cobranza', 'admin-morosidad', 'admin-reservas', 'admin-propietarios', 'admin-normas', 'admin-areas',
  'admin-reportes', 'admin-comunicados', 'admin-configuracion', 'admin-auditoria', 'admin-datos-pago', 'admin-mantenimiento', 'admin-resultado'
];

export const activeBuilding = {
  /** ¿La pantalla actual es de un edificio y hay uno elegido? */
  isInside(view) {
    return BUILDING_VIEWS.includes(view) && !!this.get();
  },

  /** Edificios activos que la sesión puede administrar. */
  list() {
    const ctx = authService.getContext();
    return ((ctx && ctx.buildings) || []).filter(b => b.is_active !== false);
  },

  getId() {
    try { return sessionStorage.getItem(KEY); } catch { return null; }
  },

  /** Datos del edificio elegido, o null si no hay uno elegido (o ya no está activo). */
  get() {
    const id = this.getId();
    return this.list().find(b => b.id === id) || null;
  },

  set(id) {
    try { sessionStorage.setItem(KEY, id); } catch { /* sin acceso a sessionStorage */ }
  },

  clear() {
    try { sessionStorage.removeItem(KEY); } catch { /* ignorar */ }
  }
};
