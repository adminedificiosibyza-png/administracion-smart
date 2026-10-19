/* Building Parameters & Directory Service */
import { store } from '../store.js';

export const buildingService = {
  getBuildingInfo() {
    return store.state.building;
  },

  updateBuildingConfig(newConfig) {
    store.state.building = {
      ...store.state.building,
      ...newConfig
    };
    store.saveState();
  },

  getUnits() {
    return store.state.units;
  },

  getUnitByCode(unitCode) {
    return store.state.units.find(u => u.code === unitCode);
  }
};
