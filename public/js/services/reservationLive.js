/* Reservas y áreas comunes con Supabase */
import { supabase } from '../supabaseClient.js';
import { reservationService } from './reservationService.js';

const pad = n => String(n).padStart(2, '0');
const hhmm = v => String(v || '').slice(0, 5);   // '08:00:00' -> '08:00'
const rpcError = e => new Error(e.message || 'No se pudo completar la operación.');

/**
 * Proveedor para la pantalla de reservas del propietario.
 * Hereda toda la lógica de horarios del servicio local (getDayStatus, validateRange, ...) y solo
 * cambia de dónde salen los datos: las áreas y los horarios ocupados vienen de Supabase.
 */
export const liveReservations = Object.assign(Object.create(reservationService), {
  _areas: [],
  _busy: new Map(),   // 'areaId|YYYY-MM-DD' -> [{ start_time, end_time, type }]

  async loadAreas(buildingId, { includeInactive = false } = {}) {
    let query = supabase.from('common_areas').select('*').eq('building_id', buildingId)
      .order('sort_order').order('created_at');
    if (!includeInactive) query = query.eq('is_active', true);
    const { data, error } = await query;
    if (error) throw new Error(`No se pudieron cargar las áreas comunes: ${error.message}`);
    this._areas = data.map(a => ({
      ...a,
      schedule: {
        weekday: { open: hhmm(a.weekday_open), close: hhmm(a.weekday_close) },
        weekend: { open: hhmm(a.weekend_open), close: hhmm(a.weekend_close) }
      }
    }));
    return this._areas;
  },

  getCommonAreas() { return this._areas.filter(a => a.is_active); },
  getAllCommonAreas() { return this._areas; },
  getAreaById(id) { return this._areas.find(a => a.id === id); },

  /** Trae los horarios ocupados (reservas aprobadas y bloqueos) de un mes. Solo horarios, sin datos de otras personas. */
  async prepare(areaId, year, month) {
    const prefix = `${year}-${pad(month + 1)}`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const { data, error } = await supabase
      .from('vw_reservation_availability')
      .select('date, start_time, end_time, status')
      .eq('area_id', areaId)
      .gte('date', `${prefix}-01`)
      .lte('date', `${prefix}-${pad(lastDay)}`);
    if (error) throw new Error(`No se pudo cargar la disponibilidad: ${error.message}`);

    [...this._busy.keys()].filter(k => k.startsWith(`${areaId}|${prefix}`)).forEach(k => this._busy.delete(k));
    data.forEach(r => {
      const key = `${areaId}|${r.date}`;
      if (!this._busy.has(key)) this._busy.set(key, []);
      this._busy.get(key).push({ start_time: hhmm(r.start_time), end_time: hhmm(r.end_time), type: r.status });
    });
  },

  getOccupiedRanges(areaId, dateStr) {
    return (this._busy.get(`${areaId}|${dateStr}`) || []).slice()
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
  },

  /** Envía la solicitud. El estado, el código, la hora de creación, el propietario y el departamento los fija el servidor. */
  async createReservation({ areaId, date, startTime, endTime, unitId, phone, motive, acceptedTerms }) {
    if (!acceptedTerms) throw new Error('Debe aceptar las normas de uso del área común para continuar.');
    const missing = [];
    if (!areaId) missing.push('área común');
    if (!date) missing.push('fecha');
    if (!startTime) missing.push('hora de inicio');
    if (!endTime) missing.push('hora de término');
    if (!unitId) missing.push('departamento');
    if (!phone || phone.trim().length < 7) missing.push('teléfono de contacto');
    if (!motive || !motive.trim()) missing.push('actividad / motivo');
    if (missing.length) throw new Error(`Complete todos los campos antes de enviar: ${missing.join(', ')}.`);

    const rangeError = this.validateRange(areaId, date, startTime, endTime);
    if (rangeError) throw new Error(rangeError);

    const area = this.getAreaById(areaId);
    const { data, error } = await supabase.from('reservations').insert({
      building_id: area.building_id,
      area_id: areaId,
      unit_id: unitId,
      phone: phone.trim(),
      date,
      start_time: startTime,
      end_time: endTime,
      motive: motive.trim(),
      accepted_terms: true
    }).select().single();
    if (error) throw rpcError(error);
    return { ...data, area_name: area.name, start_time: hhmm(data.start_time), end_time: hhmm(data.end_time) };
  }
});

/* ---------------- Propietario: sus reservas ---------------- */

export const ownerReservationApi = {
  async listForUnit(unitId) {
    const { data, error } = await supabase
      .from('reservations')
      .select('*, common_areas(name)')
      .eq('unit_id', unitId)
      .order('date', { ascending: false })
      .range(0, 999);
    if (error) throw new Error(`No se pudieron cargar sus reservas: ${error.message}`);
    return data.map(r => ({
      ...r,
      area_name: r.common_areas ? r.common_areas.name : 'Área común',
      start_time: hhmm(r.start_time),
      end_time: hhmm(r.end_time)
    }));
  },

  async cancel(id) {
    const { error } = await supabase.from('reservations').update({ status: 'CANCELADA' }).eq('id', id);
    if (error) throw rpcError(error);
  }
};

/* ---------------- Administración: áreas, solicitudes y bloqueos ---------------- */

export const reservationAdminApi = {
  async listAreas(buildingId) {
    return liveReservations.loadAreas(buildingId, { includeInactive: true });
  },

  async saveArea(payload) {
    const { data, error } = await supabase.rpc('save_common_area', { p_data: payload });
    if (error) throw rpcError(error);
    return data;
  },

  async deleteArea(id) {
    const { error } = await supabase.rpc('delete_common_area', { p_area_id: id });
    if (error) throw rpcError(error);
  },

  async listReservations(buildingId) {
    const { data, error } = await supabase
      .from('reservations')
      .select('*, common_areas(name)')
      .eq('building_id', buildingId)
      .order('created_at', { ascending: true })
      .range(0, 4999);
    if (error) throw new Error(`No se pudieron cargar las reservas: ${error.message}`);
    return data.map(r => ({
      ...r,
      area_name: r.common_areas ? r.common_areas.name : 'Área común',
      start_time: hhmm(r.start_time),
      end_time: hhmm(r.end_time)
    }));
  },

  async listBlocks(buildingId) {
    const { data, error } = await supabase
      .from('reservation_blocks')
      .select('*, common_areas(name)')
      .eq('building_id', buildingId)
      .order('date', { ascending: false })
      .range(0, 999);
    if (error) throw new Error(`No se pudieron cargar los bloqueos: ${error.message}`);
    return data.map(b => ({
      ...b,
      area_name: b.common_areas ? b.common_areas.name : 'Área común',
      start_time: hhmm(b.start_time),
      end_time: hhmm(b.end_time)
    }));
  },

  async createBlock({ buildingId, areaId, date, startTime, endTime, reason, createdBy }) {
    const { error } = await supabase.from('reservation_blocks').insert({
      building_id: buildingId, area_id: areaId, date,
      start_time: startTime, end_time: endTime, reason, created_by: createdBy
    });
    if (error) throw rpcError(error);
  },

  async deleteBlock(id) {
    const { error } = await supabase.from('reservation_blocks').delete().eq('id', id);
    if (error) throw rpcError(error);
  },

  /** Aprueba una solicitud pendiente. Si se cruza con otra ya aprobada, la base de datos lo rechaza. */
  async approve(id) {
    const { data, error } = await supabase.from('reservations')
      .update({ status: 'CONFIRMADA' }).eq('id', id).eq('status', 'PENDIENTE').select();
    if (error) throw rpcError(error);
    if (!data.length) throw new Error('La solicitud ya no está pendiente.');
  },

  async reject(id, reason) {
    const { data, error } = await supabase.from('reservations')
      .update({ status: 'RECHAZADA', rejection_reason: reason || null }).eq('id', id).eq('status', 'PENDIENTE').select();
    if (error) throw rpcError(error);
    if (!data.length) throw new Error('La solicitud ya no está pendiente.');
  },

  async cancel(id) {
    const { error } = await supabase.from('reservations').update({ status: 'CANCELADA' }).eq('id', id);
    if (error) throw rpcError(error);
  },

  /** Departamentos del edificio con las personas que los tienen asignados (titular primero). */
  async listUnitsWithPeople(buildingId) {
    const units = await supabase.from('units').select('id, code, floor').eq('building_id', buildingId);
    if (units.error) throw new Error(`No se pudieron cargar los departamentos: ${units.error.message}`);
    const ids = units.data.map(u => u.id);
    const links = ids.length
      ? await supabase.from('user_units').select('unit_id, user_id, relation').eq('active', true).in('unit_id', ids)
      : { data: [], error: null };
    if (links.error) throw new Error(`No se pudieron cargar las asignaciones: ${links.error.message}`);
    const userIds = [...new Set(links.data.map(l => l.user_id))];
    const profiles = userIds.length
      ? await supabase.from('user_profiles').select('id, full_name, phone, is_active').in('id', userIds)
      : { data: [], error: null };
    if (profiles.error) throw new Error(`No se pudieron cargar las personas: ${profiles.error.message}`);
    const byId = new Map(profiles.data.filter(p => p.is_active).map(p => [p.id, p]));
    const order = { PROPIETARIO: 0, INQUILINO: 1 };
    return units.data
      .map(u => ({
        ...u,
        people: links.data.filter(l => l.unit_id === u.id && byId.has(l.user_id))
          .map(l => ({ user_id: l.user_id, relation: l.relation, full_name: byId.get(l.user_id).full_name, phone: byId.get(l.user_id).phone || '' }))
          .sort((a, b) => (order[a.relation] ?? 2) - (order[b.relation] ?? 2) || a.full_name.localeCompare(b.full_name))
      }))
      .sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
  },

  /** Registra una reserva a nombre de un propietario. Las reglas (horario, cruces, fecha) las valida el servidor. */
  async createForOwner(payload) {
    const { data, error } = await supabase.rpc('admin_create_reservation', { p: payload });
    if (error) throw rpcError(error);
    return data;
  },

  async countPending(buildingId) {
    const { count, error } = await supabase.from('reservations')
      .select('id', { count: 'exact', head: true })
      .eq('building_id', buildingId).eq('status', 'PENDIENTE');
    if (error) return 0;
    return count || 0;
  }
};
