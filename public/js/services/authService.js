/* Authentication & Security Service (Supabase Auth & Identity Resolution) */
import { store } from '../store.js';
import { supabase, isSupabaseConnected, sendMagicLinkOrOTP } from '../supabaseClient.js';
import { loginEmailFor } from '../utils/username.js';
import { friendlyError, CONNECTION_TITLE, CONNECTION_MESSAGE } from '../ui/errors.js';

const ACTIVE_UNIT_KEY = 'parke10_active_unit';

let context = null; // resultado de get_my_context() (solo modo Supabase)

function readActiveUnitId() {
  try { return sessionStorage.getItem(ACTIVE_UNIT_KEY); } catch { return null; }
}

export const authService = {
  /**
   * Request Magic Link or OTP code (se conserva para el modo demostración)
   */
  async requestOwnerAccess(emailOrPhone) {
    if (!emailOrPhone || emailOrPhone.trim() === '') {
      throw new Error('Por favor ingrese un correo electrónico o teléfono válido.');
    }

    const cleanInput = emailOrPhone.trim();
    const isEmail = cleanInput.includes('@');

    return await sendMagicLinkOrOTP(
      isEmail ? cleanInput : null,
      !isEmail ? cleanInput : null
    );
  },

  /* ---------------- Sesión real (Supabase) ---------------- */

  /** Restaura la sesión guardada y carga el contexto de la persona. */
  async init() {
    if (!isSupabaseConnected()) return;
    const { data } = await supabase.auth.getSession();
    if (data && data.session) await this.loadContext();
  },

  async loadContext() {
    const { data, error } = await supabase.rpc('get_my_context');
    if (error) throw new Error(`No se pudo cargar tu perfil: ${error.message}`);
    context = data || null;
    return context;
  },

  /** Contexto de la sesión (null si no hay sesión o la cuenta no tiene acceso configurado). */
  getContext() {
    return context;
  },

  isSuperadmin() {
    return !!(context && context.is_superadmin);
  },

  /**
   * Inicia sesión con usuario (nombre completo) o correo + contraseña.
   * Mensaje genérico a propósito: no revela si el usuario existe.
   */
  async signIn(userOrEmail, password) {
    if (!userOrEmail || !userOrEmail.trim() || !password) {
      throw new Error('Ingrese su usuario y su contraseña.');
    }
    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmailFor(userOrEmail),
      password
    });
    if (error) {
      if (error.status === 429 || /rate/i.test(error.message)) {
        throw new Error('Demasiados intentos. Espere unos minutos e inténtelo de nuevo.');
      }
      // Servidor sin respuesta (internet o proyecto pausado): no es una clave incorrecta
      if (error.status >= 500 || error.code === 'connection_error' || friendlyError(error).title === CONNECTION_TITLE) {
        throw new Error(`${CONNECTION_TITLE}. ${CONNECTION_MESSAGE}`);
      }
      throw new Error('Usuario o contraseña incorrectos.');
    }

    await this.loadContext();
    if (!context) {
      await supabase.auth.signOut();
      throw new Error('Su cuenta no tiene acceso configurado o está desactivada. Comuníquese con la administración.');
    }
    return context;
  },

  async signOut() {
    context = null;
    try { sessionStorage.removeItem(ACTIVE_UNIT_KEY); } catch { /* sin acceso a sessionStorage */ }
    if (isSupabaseConnected()) await supabase.auth.signOut();
  },

  /** Departamento activo del propietario (por ahora el primero; el selector llega en la Fase 4). */
  getActiveAssignment() {
    if (!context || !context.assignments || !context.assignments.length) return null;
    const saved = readActiveUnitId();
    return context.assignments.find(a => a.unit_id === saved) || context.assignments[0];
  },

  setActiveUnit(unitId) {
    try { sessionStorage.setItem(ACTIVE_UNIT_KEY, unitId); } catch { /* ignorar */ }
  },

  /**
   * Identidad activa y permisos.
   * Con Supabase: sale del contexto de la sesión. En demostración: del selector local.
   *
   * NOTE: async. Callers must use: const user = await authService.getCurrentUser();
   */
  async getCurrentUser() {
    if (isSupabaseConnected() && context) {
      const active = this.getActiveAssignment();
      return {
        id: context.user_id,
        name: context.full_name,
        role: context.is_superadmin ? 'administradora' : 'propietario',
        email: context.username || '',
        phone: '',
        unit: active ? active.unit_code : '',
        unitId: active ? active.unit_id : null,
        buildingName: active ? active.building_name : '',
        canViewFees: active ? active.can_view_fees : false,
        assignments: context.assignments || []
      };
    }

    // Demo Mode Identity Resolution
    const role = store.currentRole;
    if (role === 'administradora') {
      return {
        id: 'usr-admin',
        name: 'Administración PARKE10',
        role: 'administradora',
        email: 'admin@parke10.pe',
        unit: 'OFICINA-ADMIN'
      };
    } else {
      const unitCode = store.currentUnitCode;
      const unit = store.state.units.find(u => u.code === unitCode) || store.state.units[0];
      return {
        id: `usr-${unit.code}`,
        name: unit.owner_name,
        role: 'propietario',
        email: unit.email,
        phone: unit.phone,
        unit: unit.code
      };
    }
  }
};
