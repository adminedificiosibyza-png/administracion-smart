/* Data Provider Service Layer (Supabase Live vs Mock Data Isolation) */
import { store } from '../store.js';
import { supabase, isSupabaseConnected } from '../supabaseClient.js';

export const dataService = {
  /**
   * Determine current data source mode
   * @returns {'SUPABASE' | 'MOCK'}
   */
  getDataSourceType() {
    return isSupabaseConnected() ? 'SUPABASE' : 'MOCK';
  },

  /**
   * Get Building Info by building_id
   */
  async getBuildingInfo(buildingId = 'bld-parke10') {
    if (isSupabaseConnected()) {
      try {
        const { data, error } = await supabase
          .from('buildings')
          .select('*')
          .eq('id', buildingId)
          .single();

        if (error) throw error;
        return { data, source: 'SUPABASE' };
      } catch (err) {
        console.warn('⚠️ Fallback a mock data por error en Supabase:', err.message);
        return { data: store.state.building, source: 'MOCK_FALLBACK' };
      }
    }
    return { data: store.state.building, source: 'MOCK' };
  },

  /**
   * Fetch Maintenance Fees for building and optional unit filter
   */
  async getMaintenanceFees(buildingId = 'bld-parke10', unitCode = null) {
    if (isSupabaseConnected()) {
      try {
        let query = supabase
          .from('maintenance_fees')
          .select('*')
          .eq('building_id', buildingId);

        if (unitCode) {
          query = query.eq('unit_code', unitCode);
        }

        const { data, error } = await query;
        if (error) throw error;
        return { data, source: 'SUPABASE' };
      } catch (err) {
        console.warn('⚠️ Fallback a mock data por error en Supabase:', err.message);
        return { 
          data: unitCode ? store.state.maintenance_fees.filter(f => f.unit_code === unitCode) : store.state.maintenance_fees, 
          source: 'MOCK_FALLBACK' 
        };
      }
    }

    const mockFees = unitCode 
      ? store.state.maintenance_fees.filter(f => f.unit_code === unitCode)
      : store.state.maintenance_fees;

    return { data: mockFees, source: 'MOCK' };
  }
};
