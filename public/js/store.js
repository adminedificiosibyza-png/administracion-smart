/* Reactive State Store & Persistence Layer */
import { INITIAL_SEED, generateFeeHistory } from './mockData.js';

class AppStore {
  constructor() {
    this.listeners = [];
    
    // Load state from LocalStorage or initialize with seed
    const savedData = localStorage.getItem('parke10_app_data');
    if (savedData) {
      try {
        this.state = JSON.parse(savedData);
      } catch (e) {
        this.state = this.getInitialState();
      }
    } else {
      this.state = this.getInitialState();
      this.saveState();
    }

    this.migrateLegacyAreas();
    this.migrateRules();
    this.migrateFees();

    this.currentRole = localStorage.getItem('parke10_role') || 'propietario'; // 'propietario' or 'administradora'
    this.currentUnitCode = localStorage.getItem('parke10_unit') || '502';
    this.currentView = this.currentRole === 'propietario' ? 'propietario-dashboard' : 'admin-dashboard';
  }

  getInitialState() {
    return JSON.parse(JSON.stringify(INITIAL_SEED));
  }

  // Datos locales guardados antes de unificar la zona común en una sola terraza
  migrateLegacyAreas() {
    const areas = this.state.common_areas || [];
    if (areas.length === 1 && areas[0].id === 'area-terraza' && areas[0].schedule) return;
    const terraza = INITIAL_SEED.common_areas[0];
    this.state.common_areas = JSON.parse(JSON.stringify([terraza]));
    const remap = r => {
      if (r.area_id !== terraza.id) { r.area_id = terraza.id; r.area_name = terraza.name; }
    };
    (this.state.reservations || []).forEach(remap);
    (this.state.reservation_blocks || []).forEach(remap);
    this.saveState();
  }

  // Datos locales con una sola cuota por depto: agrega el campo period_month real
  // y completa los demás meses sin tocar los pagos ya registrados.
  migrateFees() {
    const fees = this.state.maintenance_fees || [];
    let changed = false;
    fees.forEach(f => {
      if (!f.period_month) { f.period_month = `${f.due_date.slice(0, 7)}-01`; changed = true; }
      if (!f.unit_id) { f.unit_id = `unit-${f.unit_code}`; changed = true; }
    });
    const have = new Set(fees.map(f => `${f.unit_code}|${f.period_month}`));
    generateFeeHistory().forEach(f => {
      if (!have.has(`${f.unit_code}|${f.period_month}`)) { fees.push(f); changed = true; }
    });
    this.state.maintenance_fees = fees;
    if (changed) this.saveState();
  }

  // Reemplaza las normas guardadas localmente por la versión oficial vigente
  migrateRules() {
    if (this.state.rules_version === INITIAL_SEED.rules_version) return;
    this.state.rules_version = INITIAL_SEED.rules_version;
    this.state.rules_intro = INITIAL_SEED.rules_intro;
    this.state.rules = JSON.parse(JSON.stringify(INITIAL_SEED.rules));
    this.saveState();
  }

  saveState() {
    localStorage.setItem('parke10_app_data', JSON.stringify(this.state));
    this.notify();
  }

  resetToDefaults() {
    this.state = this.getInitialState();
    this.saveState();
  }

  // Role Management
  setRole(role) {
    this.currentRole = role;
    localStorage.setItem('parke10_role', role);
    this.currentView = role === 'propietario' ? 'propietario-dashboard' : 'admin-dashboard';
    this.notify();
  }

  // Unit Selector Management
  setUnitCode(unitCode) {
    this.currentUnitCode = unitCode;
    localStorage.setItem('parke10_unit', unitCode);
    this.notify();
  }

  // View Navigation
  setView(viewId) {
    this.currentView = viewId;
    this.notify();
  }

  // Pub/Sub Pattern
  subscribe(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  notify() {
    this.listeners.forEach(listener => listener(this.state, this.currentRole, this.currentView));
  }
}

export const store = new AppStore();
