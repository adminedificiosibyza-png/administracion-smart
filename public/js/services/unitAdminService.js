/* Departamentos de un edificio y las personas asignadas (solo administración, solo con Supabase) */
import { supabase, isSupabaseConnected } from '../supabaseClient.js';

const rpcError = error => new Error(error.message || 'No se pudo completar la operación.');

export const unitAdminService = {
  isAvailable() {
    return isSupabaseConnected();
  },

  /**
   * Directorio del edificio: cada departamento con sus personas asignadas.
   * La asignación (user_units) es la única fuente: lo que se vea aquí es lo mismo que ve cada persona.
   */
  async listDirectory(buildingId) {
    const { data, error } = await supabase
      .from('units')
      .select('id, code, floor, status, building_id, user_units(id, user_id, relation, can_view_fees, active, created_at, user_profiles(id, full_name, phone, contact_email, is_active))')
      .eq('building_id', buildingId)
      .range(0, 999);
    if (error) throw new Error(`No se pudo cargar el directorio: ${error.message}`);

    return data
      .map(u => {
        const people = (u.user_units || [])
          .map(a => ({
            assignment_id: a.id,
            user_id: a.user_id,
            relation: a.relation,
            can_view_fees: a.can_view_fees,
            active: a.active,
            created_at: a.created_at,
            full_name: a.user_profiles ? a.user_profiles.full_name : '(persona eliminada)',
            phone: a.user_profiles ? a.user_profiles.phone : null,
            account_active: a.user_profiles ? a.user_profiles.is_active : false
          }))
          .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
        const activePeople = people.filter(p => p.active);
        // Titular = la primera persona activa con relación PROPIETARIO (misma regla que usa la cobranza)
        const titular = activePeople.find(p => p.relation === 'PROPIETARIO') || null;
        return {
          id: u.id, code: u.code, floor: u.floor, status: u.status, building_id: u.building_id,
          people, titular,
          others: activePeople.filter(p => p !== titular)
        };
      })
      .sort((a, b) => a.floor - b.floor || a.code.localeCompare(b.code, undefined, { numeric: true }));
  },

  /** Todas las personas (no superadmin), para asignarlas a un departamento. */
  async listPeople() {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, full_name, is_active, role')
      .neq('role', 'superadmin')
      .eq('is_active', true)
      .order('full_name')
      .range(0, 999);
    if (error) throw new Error(`No se pudo cargar las personas: ${error.message}`);
    return data;
  },

  async saveUnit(payload) {
    const { data, error } = await supabase.rpc('save_unit', { p_data: payload });
    if (error) throw rpcError(error);
    return data;
  },

  async createUnitsBulk(buildingId, floors) {
    const { data, error } = await supabase.rpc('create_units_bulk', { p_building_id: buildingId, p_floors: floors });
    if (error) throw rpcError(error);
    return data;
  },

  async deleteUnit(unitId) {
    const { error } = await supabase.rpc('delete_unit', { p_unit_id: unitId });
    if (error) throw rpcError(error);
  }
};
