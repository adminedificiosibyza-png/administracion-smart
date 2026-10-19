/* Common Area Reservation Service */
import { store } from '../store.js';

const DEFAULT_SCHEDULE = {
  weekday: { open: '08:00', close: '18:00' }, // Lunes a viernes
  weekend: { open: '08:00', close: '20:00' }  // Sábados y domingos
};

export const reservationService = {
  getCommonAreas() {
    return store.state.common_areas.filter(a => a.is_active);
  },

  getAllCommonAreas() {
    return store.state.common_areas;
  },

  getAreaById(areaId) {
    return store.state.common_areas.find(a => a.id === areaId);
  },

  /**
   * Horario máximo de uso para una fecha (YYYY-MM-DD):
   * lunes a viernes 08:00-18:00, sábados y domingos 08:00-20:00.
   */
  getScheduleForDate(areaId, dateStr) {
    const area = this.getAreaById(areaId);
    if (!area || !dateStr) return null;
    const [y, m, d] = dateStr.split('-').map(Number);
    const dow = new Date(y, m - 1, d).getDay(); // 0 = domingo, 6 = sábado
    const sch = area.schedule || DEFAULT_SCHEDULE;
    return (dow === 0 || dow === 6) ? sch.weekend : sch.weekday;
  },

  _toMinutes(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  },

  /**
   * Rangos ocupados (reservas confirmadas y bloqueos) de una fecha.
   * Solo expone horarios, nunca datos de otros propietarios.
   */
  getOccupiedRanges(areaId, dateStr) {
    const reserved = store.state.reservations
      .filter(r => r.area_id === areaId && r.date === dateStr && r.status === 'CONFIRMADA')
      .map(r => ({ start_time: r.start_time, end_time: r.end_time, type: 'RESERVADO' }));
    const blocked = store.state.reservation_blocks
      .filter(b => b.area_id === areaId && b.date === dateStr)
      .map(b => ({ start_time: b.start_time, end_time: b.end_time, type: 'BLOQUEADO' }));
    return [...reserved, ...blocked].sort((a, b) => a.start_time.localeCompare(b.start_time));
  },

  /**
   * Estado de un día para el calendario mensual: 'DISPONIBLE' | 'RESERVADO' | 'BLOQUEADO'.
   * RESERVADO = tiene al menos una reserva (puede conservar horas libres).
   */
  getDayStatus(areaId, dateStr) {
    const ranges = this.getOccupiedRanges(areaId, dateStr);
    const sch = this.getScheduleForDate(areaId, dateStr);
    const fullBlock = sch && ranges.some(r =>
      r.type === 'BLOQUEADO' &&
      this._toMinutes(r.start_time) <= this._toMinutes(sch.open) &&
      this._toMinutes(r.end_time) >= this._toMinutes(sch.close));
    if (fullBlock) return 'BLOQUEADO';
    return ranges.length ? 'RESERVADO' : 'DISPONIBLE';
  },

  /**
   * Valida un rango horario: dentro del horario permitido del día y sin cruzarse
   * con otras reservas/bloqueos. Devuelve null si es válido, o el mensaje de error.
   */
  validateRange(areaId, dateStr, startTime, endTime) {
    if (!dateStr || !startTime || !endTime) return 'Seleccione fecha, hora de inicio y hora de término.';
    const sch = this.getScheduleForDate(areaId, dateStr);
    if (!sch) return 'Área común no encontrada.';
    const s = this._toMinutes(startTime);
    const e = this._toMinutes(endTime);
    if (e <= s) return 'La hora de término debe ser posterior a la hora de inicio.';
    if (s < this._toMinutes(sch.open) || e > this._toMinutes(sch.close)) {
      return `El horario debe estar entre ${sch.open} y ${sch.close} para la fecha seleccionada.`;
    }
    const clash = this.getOccupiedRanges(areaId, dateStr)
      .some(r => s < this._toMinutes(r.end_time) && e > this._toMinutes(r.start_time));
    if (clash) return 'El horario seleccionado se cruza con una reserva o bloqueo existente. Por favor seleccione otro.';
    return null;
  },

  /**
   * Create a new reservation with PK10-XXXXX code generation & double-booking prevention
   */
  createReservation({ areaId, date, startTime, endTime, unitCode, ownerName, phone, motive, acceptedTerms }) {
    if (!acceptedTerms) {
      throw new Error('Debe aceptar las normas de uso del área común para continuar.');
    }

    // Ninguna solicitud puede enviarse con datos incompletos
    const missing = [];
    if (!areaId) missing.push('área común');
    if (!date) missing.push('fecha');
    if (!startTime) missing.push('hora de inicio');
    if (!endTime) missing.push('hora de término');
    if (!ownerName || !ownerName.trim()) missing.push('propietario');
    if (!unitCode || !String(unitCode).trim()) missing.push('departamento');
    if (!phone || phone.trim().length < 7) missing.push('teléfono de contacto');
    if (!motive || !motive.trim()) missing.push('actividad / motivo');
    if (missing.length) throw new Error(`Complete todos los campos antes de enviar: ${missing.join(', ')}.`);

    const rangeError = this.validateRange(areaId, date, startTime, endTime);
    if (rangeError) throw new Error(rangeError);

    const area = this.getAreaById(areaId);
    const buildingCode = store.state.building.code || 'PK10';

    // Generate sequential PK10-XXXXX code
    const seq = store.state.reservations.length + 1;
    const code = `${buildingCode}-${String(seq).padStart(5, '0')}`;

    const newReservation = {
      id: `res-${Date.now()}`,
      code: code,
      building_id: store.state.building.id,
      area_id: areaId,
      area_name: area.name,
      unit_code: unitCode,
      owner_name: ownerName,
      phone: phone,
      date: date,
      start_time: startTime,
      end_time: endTime,
      motive: motive.trim(),
      accepted_terms: true,
      // La solicitud queda pendiente hasta que la administradora la apruebe.
      // En Supabase, status y created_at los fija el servidor (trigger), no el cliente.
      status: 'PENDIENTE',
      created_at: new Date().toISOString()
    };

    store.state.reservations.unshift(newReservation);
    store.saveState();

    return newReservation;
  },

  /* ---------------- Solicitudes (vista administradora) ---------------- */

  STATUS_LABELS: {
    PENDIENTE: 'Pendiente',
    CONFIRMADA: 'Aprobada',
    RECHAZADA: 'Rechazada',
    CANCELADA: 'Cancelada',
    FINALIZADA: 'Finalizada',
    BLOQUEADA: 'Bloqueada'
  },

  statusLabel(status) {
    return this.STATUS_LABELS[status] || status;
  },

  statusBadgeClass(status) {
    if (status === 'CONFIRMADA') return 'badge-success';
    if (status === 'PENDIENTE') return 'badge-warning';
    if (status === 'RECHAZADA') return 'badge-danger';
    return 'badge-neutral';
  },

  /** Solicitudes pendientes, de la más antigua a la más reciente (orden de prioridad). */
  getPendingRequests() {
    return store.state.reservations
      .filter(r => r.status === 'PENDIENTE')
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  },

  getPendingCount() {
    return store.state.reservations.filter(r => r.status === 'PENDIENTE').length;
  },

  _overlaps(a, b) {
    return a.area_id === b.area_id && a.date === b.date &&
      this._toMinutes(a.start_time) < this._toMinutes(b.end_time) &&
      this._toMinutes(a.end_time) > this._toMinutes(b.start_time);
  },

  /** Otras solicitudes pendientes que se cruzan con esta, por orden de creación. */
  getConflictingRequests(request) {
    return this.getPendingRequests().filter(r => r.id !== request.id && this._overlaps(r, request));
  },

  /** Reserva ya aprobada que se cruza con esta solicitud (impide aprobarla). */
  getApprovedConflict(request) {
    return store.state.reservations.find(r =>
      r.id !== request.id && r.status === 'CONFIRMADA' && this._overlaps(r, request)) || null;
  },

  /**
   * Restricción/sanción vigente del propietario. Aún no está definido cómo se gestionan
   * las sanciones: se deja el punto de extensión. Debe devolver { reason } si hay una vigente.
   */
  getOwnerRestriction(unitCode) { // eslint-disable-line no-unused-vars
    return null;
  },

  approveRequest(reservationId, approvedBy) {
    const res = store.state.reservations.find(r => r.id === reservationId);
    if (!res || res.status !== 'PENDIENTE') throw new Error('La solicitud ya no está pendiente.');

    // Validación definitiva de solapamiento (en Supabase la repite el trigger con lock)
    if (this.getApprovedConflict(res)) {
      throw new Error('No se puede aprobar: se superpone con una reserva ya aprobada.');
    }
    const blocked = store.state.reservation_blocks.some(b => this._overlaps(b, res));
    if (blocked) throw new Error('No se puede aprobar: el horario está bloqueado por administración.');

    res.status = 'CONFIRMADA';
    res.decided_by = approvedBy || 'Administración';
    res.decided_at = new Date().toISOString();
    this._audit('APROBACION_RESERVA', `Aprobó la solicitud ${res.code} de Dpto ${res.unit_code} para el ${res.date} (${res.start_time}-${res.end_time}).`, res.decided_by);
    store.saveState();
    return res;
  },

  rejectRequest(reservationId, reason, rejectedBy) {
    const res = store.state.reservations.find(r => r.id === reservationId);
    if (!res || res.status !== 'PENDIENTE') throw new Error('La solicitud ya no está pendiente.');

    res.status = 'RECHAZADA';
    res.rejection_reason = reason || '';
    res.decided_by = rejectedBy || 'Administración';
    res.decided_at = new Date().toISOString();
    this._audit('RECHAZO_RESERVA', `Rechazó la solicitud ${res.code} de Dpto ${res.unit_code} para el ${res.date} (${res.start_time}-${res.end_time}).${reason ? ' Motivo: ' + reason : ''}`, res.decided_by);
    store.saveState();
    return res;
  },

  _audit(action, description, performedBy) {
    store.state.audit_logs.unshift({
      id: `aud-${Date.now()}`,
      building_id: store.state.building.id,
      action,
      description,
      performed_by: performedBy,
      timestamp: new Date().toISOString()
    });
  },

  /**
   * Cancel reservation
   */
  cancelReservation(reservationId) {
    const res = store.state.reservations.find(r => r.id === reservationId);
    if (res) {
      res.status = 'CANCELADA';
      store.saveState();
    }
    return res;
  },

  /**
   * Admin Block time slot
   */
  createBlock({ areaId, date, startTime, endTime, reason, createdBy }) {
    const area = this.getAreaById(areaId);
    const newBlock = {
      id: `blk-${Date.now()}`,
      building_id: store.state.building.id,
      area_id: areaId,
      area_name: area ? area.name : 'Área Común',
      date: date,
      start_time: startTime,
      end_time: endTime,
      reason: reason || 'Mantenimiento administrativo',
      created_by: createdBy || 'Administración',
      created_at: new Date().toISOString()
    };

    store.state.reservation_blocks.unshift(newBlock);

    // Log audit event
    store.state.audit_logs.unshift({
      id: `aud-${Date.now()}`,
      building_id: store.state.building.id,
      action: 'BLOQUEO_RESERVA',
      description: `Bloqueó horario en ${area ? area.name : 'área'} para el ${date} (${startTime}-${endTime}). Motivo: ${reason}`,
      performed_by: createdBy || 'Administración',
      timestamp: new Date().toISOString()
    });

    store.saveState();
    return newBlock;
  },

  getOwnerReservations(unitCode) {
    return store.state.reservations.filter(r => r.unit_code === unitCode);
  }
};
