/* Gestión de edificios (solo superadmin, solo con Supabase conectado) */
import { supabase, isSupabaseConnected } from '../supabaseClient.js';

function rpcError(error) {
  // Los mensajes de las funciones del servidor ya vienen redactados para el usuario
  return new Error(error.message || 'No se pudo completar la operación.');
}

export const buildingAdminService = {
  isAvailable() {
    return isSupabaseConnected();
  },

  /** Todos los edificios (activos e inactivos) con su cantidad de departamentos y su regla de mora. */
  async list() {
    const buildings = await supabase
      .from('buildings')
      .select('*, units(count)')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (buildings.error) throw new Error(`No se pudieron cargar los edificios: ${buildings.error.message}`);

    const rules = await supabase.from('interest_rules').select('building_id, rate_percent, grace_days, type, is_active');
    if (rules.error) throw new Error(`No se pudieron cargar las reglas de mora: ${rules.error.message}`);

    const ruleByBuilding = new Map(rules.data.map(r => [r.building_id, r]));
    return buildings.data.map(b => ({
      ...b,
      unit_count: b.units && b.units[0] ? b.units[0].count : 0,
      rule: ruleByBuilding.get(b.id) || null
    }));
  },

  async save(payload) {
    const { data, error } = await supabase.rpc('save_building', { p_data: payload });
    if (error) throw rpcError(error);
    return data;
  },

  async impact(buildingId) {
    const { data, error } = await supabase.rpc('building_impact', { p_building_id: buildingId });
    if (error) throw rpcError(error);
    return data;
  },

  async setActive(buildingId, active) {
    const { error } = await supabase.rpc('set_building_active', { p_building_id: buildingId, p_active: active });
    if (error) throw rpcError(error);
  },

  async reorder(ids) {
    const { error } = await supabase.rpc('reorder_buildings', { p_ids: ids });
    if (error) throw rpcError(error);
  }
};
