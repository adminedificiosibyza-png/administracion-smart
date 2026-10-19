/* Gestión de usuarios y accesos (solo superadmin, solo con Supabase conectado) */
import { supabase, isSupabaseConnected } from '../supabaseClient.js';
import { CONNECTION_TITLE, CONNECTION_MESSAGE } from '../ui/errors.js';

// La función admin-users responde errores con JSON; supabase-js los envuelve en error.context
async function invoke(body) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (!error) return data;
  if (error.name === 'FunctionsFetchError') throw new Error(`${CONNECTION_TITLE}. ${CONNECTION_MESSAGE}`);

  let payload = null;
  try { payload = await error.context.json(); } catch { /* sin cuerpo */ }
  const err = new Error((payload && payload.error) || error.message || 'No se pudo completar la operación.');
  err.code = payload && payload.code;
  err.payload = payload;
  throw err;
}

export const userAdminService = {
  isAvailable() {
    return isSupabaseConnected();
  },

  /** Personas (sin el superadmin) con sus asignaciones. */
  async listPeople() {
    const people = await supabase
      .from('user_profiles')
      .select('id, full_name, username, contact_email, phone, is_active, role')
      .neq('role', 'superadmin')
      .order('full_name');
    if (people.error) throw new Error(`No se pudo cargar las personas: ${people.error.message}`);

    const assignments = await supabase
      .from('user_units')
      .select('id, user_id, unit_id, relation, can_view_fees, active, units(code, floor, building_id, buildings(name))');
    if (assignments.error) throw new Error(`No se pudieron cargar las asignaciones: ${assignments.error.message}`);

    const byUser = new Map();
    assignments.data.forEach(a => {
      if (!byUser.has(a.user_id)) byUser.set(a.user_id, []);
      byUser.get(a.user_id).push(a);
    });
    return people.data.map(p => ({ ...p, assignments: byUser.get(p.id) || [] }));
  },

  /** Departamentos de todos los edificios, para asignar. */
  async listUnits() {
    const { data, error } = await supabase
      .from('units')
      .select('id, code, floor, building_id, buildings(name)');
    if (error) throw new Error(`No se pudieron cargar los departamentos: ${error.message}`);
    return data.sort((a, b) =>
      (a.buildings?.name || '').localeCompare(b.buildings?.name || '') ||
      a.code.localeCompare(b.code, undefined, { numeric: true }));
  },

  createUser({ fullName, phone, contactEmail, assignments, distinguisher }) {
    return invoke({
      action: 'create_user',
      full_name: fullName,
      phone,
      contact_email: contactEmail,
      assignments,
      distinguisher
    });
  },

  resetPassword(userId) {
    return invoke({ action: 'reset_password', user_id: userId });
  },

  setActive(userId, active) {
    return invoke({ action: 'set_active', user_id: userId, active });
  },

  /** Asigna (o reactiva) un departamento a una persona. */
  async assignUnit({ userId, unitId, relation, canViewFees }) {
    const { error } = await supabase.from('user_units').upsert({
      user_id: userId,
      unit_id: unitId,
      relation,
      can_view_fees: canViewFees,
      active: true,
      valid_to: null
    }, { onConflict: 'user_id,unit_id' });
    if (error) throw new Error(`No se pudo asignar el departamento: ${error.message}`);
  },

  /** Cambia relación, interruptor de cuotas o desactiva (con fecha de término). */
  async updateAssignment(id, { relation, canViewFees, active }) {
    const patch = { relation, can_view_fees: canViewFees, active };
    patch.valid_to = active ? null : new Date().toISOString().slice(0, 10);
    const { error } = await supabase.from('user_units').update(patch).eq('id', id);
    if (error) throw new Error(`No se pudo actualizar la asignación: ${error.message}`);
  }
};
