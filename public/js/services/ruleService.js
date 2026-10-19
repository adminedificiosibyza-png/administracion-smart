/* Categorized Regulations & Audit Logging Service */
import { store } from '../store.js';
import { supabase } from '../supabaseClient.js';

export const ruleService = {
  /**
   * Normas REALES de un edificio (Supabase): introducción + categorías con sus normas, en orden.
   * Devuelve { intro, categories: [{ category, items: [texto, ...] }] }.
   */
  async loadBuildingRules(buildingId) {
    const [rules, building] = await Promise.all([
      supabase.from('rules').select('category, category_order, item_order, content')
        .eq('building_id', buildingId)
        .order('category_order').order('item_order')
        .range(0, 4999),
      supabase.from('buildings').select('rules_intro').eq('id', buildingId).maybeSingle()
    ]);
    if (rules.error) throw new Error(`No se pudieron cargar las normas: ${rules.error.message}`);

    const byCategory = new Map();
    rules.data.forEach(r => {
      if (!byCategory.has(r.category)) byCategory.set(r.category, { category: r.category, items: [] });
      byCategory.get(r.category).items.push(r.content);
    });
    return { intro: (building.data && building.data.rules_intro) || '', categories: [...byCategory.values()] };
  },

  /** Reemplaza todas las normas del edificio en una sola operación (solo administración). */
  async saveBuildingRules(buildingId, intro, categories) {
    const { data, error } = await supabase.rpc('save_building_rules', {
      p_building_id: buildingId,
      p_intro: intro,
      p_rules: categories.map(c => ({ category: c.category, items: c.items }))
    });
    if (error) throw new Error(error.message);
    return data;
  },

  getRules() {
    return store.state.rules;
  },

  getIntro() {
    return store.state.rules_intro || '';
  },

  updateCategoryRules(categoryName, newItems) {
    const category = store.state.rules.find(r => r.category === categoryName);
    if (category) {
      category.items = newItems;
      store.saveState();
    }
  }
};

export const auditService = {
  getAuditLogs() {
    return store.state.audit_logs;
  }
};
