/* Maintenance Fee, Payments & Morosity Service */
import { store } from '../store.js';
import { supabase, isSupabaseConnected } from '../supabaseClient.js';
import { periodLabel } from '../mockData.js';

const PROOF_BUCKET = 'comprobantes-pagos'; // bucket privado existente (storage.sql)
const ALLOWED_PROOF_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const MAX_PROOF_BYTES = 10 * 1024 * 1024; // mismo límite del bucket
const METHODS = ['Transferencia bancaria', 'Yape', 'Plin', 'Efectivo', 'Otro'];
const METHODS_REQUIRING_OPERATION = ['Transferencia bancaria', 'Yape', 'Plin'];

// Modo local (demo): los archivos viven solo en memoria durante la sesión.
// En Supabase se guardan en Storage y aquí no se usa.
const mockProofFiles = new Map(); // paymentId -> File

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(fromStr, toStr) {
  const [y1, m1, d1] = fromStr.split('-').map(Number);
  const [y2, m2, d2] = toStr.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export const feeService = {
  METHODS,
  ALLOWED_PROOF_TYPES,
  MAX_PROOF_BYTES,

  methodRequiresOperation(method) {
    return METHODS_REQUIRING_OPERATION.includes(method);
  },

  /**
   * Cálculo automático de mora para modo local/mock. Replica la lógica del servidor
   * (calculate_late_interest / calc_fee_late en Supabase, fuente de verdad en producción):
   *   fecha de referencia = fecha real de pago (si ya pagó) o la fecha de hoy (si debe)
   *   días = max(0, referencia - vencimiento - días de gracia)
   *   interés = cuota * tasa% * días  (o monto fijo)
   */
  withLateFee(fee) {
    // Con varios edificios, cada cuota usa la regla de su propio edificio
    const rule = (this._rules && this._rules[fee.building_id]) || store.state.interest_rule || {};
    const paid = (fee.status === 'PAGADO' || fee.status === 'POR_VERIFICAR') && fee.payment_date;
    const ref = paid ? fee.payment_date : todayStr();
    const daysLate = Math.max(0, daysBetween(fee.due_date, ref) - Number(rule.grace_days || 0));

    let interest = 0;
    if (rule.is_active !== false && daysLate > 0) {
      interest = rule.type === 'MONTO_FIJO'
        ? Number(rule.fixed_amount || 0)
        : Math.round(fee.fee_amount * (Number(rule.rate_percent || 0) / 100) * daysLate * 100) / 100;
    }
    const total = fee.fee_amount + interest;
    return {
      ...fee,
      days_late: daysLate,
      interest_amount: interest,
      total_amount: total,
      total_pending: fee.status === 'PAGADO' ? 0 : total
    };
  },

  /* ---------------- Períodos ---------------- */

  /** Períodos con cuotas registradas, del más reciente al más antiguo. */
  getAvailablePeriods(fees = store.state.maintenance_fees) {
    const months = [...new Set(fees.map(f => f.period_month))].sort().reverse();
    return months.map(m => ({ value: m, label: periodLabel(m) }));
  },

  /** Mes actual si tiene cuotas; si no, el más reciente. */
  getDefaultPeriod(fees = store.state.maintenance_fees) {
    const periods = this.getAvailablePeriods(fees);
    const current = `${todayStr().slice(0, 7)}-01`;
    return (periods.find(p => p.value === current) || periods[0] || {}).value || current;
  },

  getFeesForPeriod(periodMonth) {
    const month = periodMonth || this.getDefaultPeriod();
    return store.state.maintenance_fees
      .filter(f => f.period_month === month)
      .map(f => this.withLateFee(f));
  },

  /**
   * Get fee status for a specific owner/unit (todos los períodos, más reciente primero)
   */
  getUnitFeeStatus(unitCode) {
    const fees = store.state.maintenance_fees
      .filter(f => f.unit_code === unitCode)
      .map(f => this.withLateFee(f))
      .sort((a, b) => b.period_month.localeCompare(a.period_month));
    const pendingFees = fees.filter(f => f.status === 'PENDIENTE' || f.status === 'POR_VERIFICAR');

    const isAlDia = pendingFees.length === 0;

    // La deuda más antigua es la que corresponde regularizar primero
    const activePending = isAlDia ? null : pendingFees[pendingFees.length - 1];

    return {
      isAlDia: isAlDia,
      activePending: activePending,
      allFees: fees
    };
  },

  /**
   * Métricas de cobranza de un período (por defecto el mes vigente)
   */
  getCollectionDashboardStats(periodMonth) {
    return this.computeStats(this.getFeesForPeriod(periodMonth), store.state.units.length);
  },

  /**
   * Métricas de cobranza a partir de una lista de cuotas ya calculadas (de un solo período).
   * Sirve tanto para los datos locales como para los de Supabase.
   */
  computeStats(fees, totalUnits) {

    let countPaid = 0;
    let countVerifying = 0;
    let countPending = 0;

    let totalExpected = 0;
    let totalCollected = 0;
    let totalPending = 0;

    fees.forEach(f => {
      totalExpected += f.fee_amount;
      if (f.status === 'PAGADO') {
        countPaid++;
        totalCollected += f.fee_amount;
      } else if (f.status === 'POR_VERIFICAR') {
        countVerifying++;
      } else {
        countPending++;
        totalPending += f.fee_amount + f.interest_amount;
      }
    });

    const collectionPercentage = totalExpected > 0
      ? ((totalCollected / totalExpected) * 100).toFixed(2)
      : '0.00';

    return {
      totalUnits,
      countPaid,
      countVerifying,
      countPending,
      totalExpected,
      totalCollected,
      totalPending,
      collectionPercentage
    };
  },

  /* ---------------- Resumen y evolución de la cobranza (dashboard) ---------------- */

  /**
   * Definiciones (una sola lógica para el resumen, el gráfico del mes y el anual):
   *  - Esperado   = suma de la CUOTA BASE de las cuotas del período (sin mora).
   *  - Cobrado    = pagos VERIFICADOS de esa cuota, hasta la cuota base. Un pago del mes
   *                 siguiente por una cuota de este período cuenta en ESTE período.
   *                 Si la cuota figura pagada pero no tiene pagos registrados (datos antiguos),
   *                 se cuenta su cuota base.
   *  - Por verificar = pagos aún sin verificar (nunca se suman a lo cobrado). Si la cuota está
   *                 "por verificar" sin pagos registrados, se usa su cuota base.
   *  - Saldo pendiente = lo que aún se debe de las cuotas pendientes (cuota + mora vigente
   *                 menos lo ya pagado). Es lo que ya mostraba el panel.
   *  - Mora cobrada = lo pagado por encima de la cuota base; se informa aparte y no entra al %.
   * Cada pago se suma una sola vez (se agrupa por identificador de pago).
   */
  _paymentIndex(payments) {
    const verified = new Map();
    const unverified = new Map();
    const seen = new Set();
    payments.forEach(p => {
      if (!p.fee_id || seen.has(p.id)) return;   // sin cuota asociada o repetido
      seen.add(p.id);
      const amount = Number(p.amount) || 0;
      if (p.status === 'RECHAZADO') return;
      const target = (p.status === 'POR_VERIFICAR') ? unverified : verified;
      target.set(p.fee_id, (target.get(p.fee_id) || 0) + amount);
    });
    return { verified, unverified };
  },

  computeCollectionSummary(fees, payments) {
    const { verified, unverified } = this._paymentIndex(payments);
    const r2 = n => Math.round(n * 100) / 100;
    const s = {
      totalUnits: fees.length, countPaid: 0, countVerifying: 0, countPending: 0,
      expected: 0, collected: 0, verifying: 0, balance: 0, moraInBalance: 0, moraCollected: 0
    };

    fees.forEach(f => {
      const base = Number(f.fee_amount) || 0;
      const paid = verified.get(f.id);
      s.expected += base;
      s.collected += paid != null ? Math.min(paid, base) : (f.status === 'PAGADO' ? base : 0);
      if (paid != null) s.moraCollected += Math.max(0, paid - base);

      if (f.status === 'PAGADO') {
        s.countPaid++;
      } else if (f.status === 'POR_VERIFICAR') {
        s.countVerifying++;
        s.verifying += unverified.get(f.id) ?? base;
      } else {
        s.countPending++;
        const owed = Math.max(0, (Number(f.total_amount) || base) - (paid || 0));
        s.balance += owed;
        // Mora que aún falta cobrar: la total de la cuota menos lo que ya se pagó por encima de la cuota base
        s.moraInBalance += Math.max(0, (Number(f.interest_amount) || 0) - Math.max(0, (paid || 0) - base));
      }
    });

    ['expected', 'collected', 'verifying', 'balance', 'moraInBalance', 'moraCollected'].forEach(k => { s[k] = r2(s[k]); });
    s.percentage = s.expected > 0 ? r2((s.collected / s.expected) * 100) : 0;
    return s;
  },

  /** Doce meses de un año: esperado y cobrado de cada uno (sin datos = hasData false). */
  computeYearSeries(fees, payments, year) {
    return Array.from({ length: 12 }, (_, i) => {
      const month = `${year}-${String(i + 1).padStart(2, '0')}-01`;
      const monthFees = fees.filter(f => f.period_month === month);
      if (!monthFees.length) return { month, hasData: false, expected: 0, collected: 0, verifying: 0 };
      const s = this.computeCollectionSummary(monthFees, payments);
      return { month, hasData: true, expected: s.expected, collected: s.collected, verifying: s.verifying };
    });
  },

  /* ---------------- Cuotas de un departamento (portal del propietario) ---------------- */

  /**
   * Cuotas y pagos REALES de un departamento. La base de datos solo devuelve filas si la persona
   * puede ver cuotas de ese departamento (interruptor "puede ver cuotas y pagos"); si no, llega vacío.
   * La mora ya viene calculada por el servidor.
   */
  async loadUnitFees(unitId) {
    await this._requireSession();
    const fees = await this._fetchAll(
      () => supabase.from('vw_maintenance_fees_calc').select('*').eq('unit_id', unitId)
        .order('period_month', { ascending: false }).order('id'),
      'No se pudieron cargar sus cuotas');
    const payments = await this._fetchAll(
      () => supabase.from('payments').select('*').eq('unit_id', unitId)
        .order('registered_at', { ascending: false }).order('id'),
      'No se pudieron cargar sus pagos');
    return { fees, payments };
  },

  /** Misma forma que getUnitFeeStatus, a partir de una lista de cuotas ya calculadas. */
  buildFeeStatus(fees) {
    const sorted = [...fees].sort((a, b) => b.period_month.localeCompare(a.period_month));
    const pending = sorted.filter(f => f.status === 'PENDIENTE' || f.status === 'POR_VERIFICAR' || f.status === 'MORA_PENDIENTE');
    return {
      hasFees: sorted.length > 0,
      isAlDia: sorted.length > 0 && pending.length === 0,
      activePending: pending.length ? pending[pending.length - 1] : null, // la deuda más antigua
      pendingCount: pending.length,
      pendingTotal: Math.round(pending.reduce((s, f) => s + (Number(f.total_pending) || 0), 0) * 100) / 100,
      allFees: sorted
    };
  },

  /* ---------------- Pantalla de cobranza (administradora) ---------------- */

  /**
   * Carga cuotas (con mora ya calculada) y pagos.
   * Supabase: la mora viene de la vista vw_maintenance_fees_calc (calculada en el servidor).
   * Local: se calcula con withLateFee.
   */
  /**
   * Lee TODAS las filas de una consulta. Supabase devuelve como máximo 1000 por petición,
   * así que se pide por tandas; sin esto los totales quedarían recortados sin aviso.
   */
  async _fetchAll(buildQuery, errorLabel) {
    const PAGE = 1000;
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await buildQuery().range(from, from + PAGE - 1);
      if (error) throw new Error(`${errorLabel}: ${error.message}`);
      rows.push(...data);
      if (data.length < PAGE) break;
    }
    return rows;
  },

  async loadCobranza() {
    if (isSupabaseConnected()) {
      await this._requireSession();
      await this._loadAllRules(); // la vista previa del formulario usa las mismas reglas que el servidor
      // RLS limita a los edificios de la persona; el orden fijo evita saltos entre tandas
      const fees = await this._fetchAll(
        () => supabase.from('vw_maintenance_fees_calc').select('*').order('id'),
        'No se pudo cargar la cobranza');
      const payments = await this._fetchAll(
        () => supabase.from('payments').select('*').order('registered_at', { ascending: false }).order('id'),
        'No se pudieron cargar los pagos');
      return { fees, payments };
    }
    return {
      fees: store.state.maintenance_fees.map(f => this.withLateFee(f)),
      payments: store.state.payments
    };
  },

  /**
   * Meses que se pueden generar: del mes actual a 6 meses adelante, indicando si ya existen cuotas.
   */
  getGeneratablePeriods(fees = store.state.maintenance_fees) {
    const existing = new Set(fees.map(f => f.period_month));
    const now = new Date();
    const out = [];
    for (let i = 0; i <= 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      out.push({ value, label: periodLabel(value), exists: existing.has(value) });
    }
    return out;
  },

  /**
   * Genera las cuotas de un mes para todos los departamentos (S/ por departamento, vence el día 5).
   * No duplica: devuelve cuántas cuotas se crearon.
   */
  async generateFees(periodMonth, buildingId) {
    if (!/^\d{4}-\d{2}-01$/.test(periodMonth || '')) throw new Error('Seleccione un período válido.');

    if (isSupabaseConnected()) {
      await this._requireSession();
      if (!buildingId) throw new Error('Seleccione el edificio.');
      const { data, error } = await supabase.rpc('generate_monthly_fees', {
        p_building_id: buildingId,
        p_period_month: periodMonth
      });
      if (error) throw new Error(error.message);
      return data;
    }

    const ym = periodMonth.slice(0, 7);
    const have = new Set(store.state.maintenance_fees.filter(f => f.period_month === periodMonth).map(f => f.unit_code));
    let created = 0;
    store.state.units.forEach(unit => {
      if (have.has(unit.code)) return;
      const amount = Number(unit.monthly_fee) || 150;
      store.state.maintenance_fees.push({
        id: `fee-${ym}-${unit.code}`,
        building_id: store.state.building.id,
        unit_id: unit.id,
        unit_code: unit.code,
        owner_name: unit.owner_name,
        period: periodLabel(periodMonth),
        period_month: periodMonth,
        due_date: `${ym}-05`,
        fee_amount: amount,
        days_late: 0,
        interest_amount: 0,
        total_amount: amount,
        total_pending: amount,
        status: 'PENDIENTE',
        payment_date: null
      });
      created++;
    });
    if (created) store.saveState();
    return created;
  },

  /** En Supabase, las operaciones de cobranza exigen una sesión iniciada (RLS). */
  async _requireSession() {
    const { data } = await supabase.auth.getSession();
    if (!data || !data.session) {
      throw new Error('No hay una sesión iniciada en Supabase. Usa "Acceso Supabase / OTP", abre el enlace que llega al correo de la administradora y vuelve a esta pantalla.');
    }
  },

  validateProofFile(file) {
    if (!file) return null;
    if (!ALLOWED_PROOF_TYPES.includes(file.type)) return 'El comprobante debe ser JPG, JPEG, PNG o PDF.';
    if (file.size > MAX_PROOF_BYTES) return 'El comprobante supera el tamaño máximo de 10 MB.';
    return null;
  },

  /** Validaciones previas al registro (la base de datos las repite). */
  validatePayment({ unitCode, periodMonth, amount, paymentDate, method, operationNumber, proofFile }) {
    if (!unitCode) return 'Seleccione el departamento.';
    if (!periodMonth) return 'Seleccione el período.';
    const amt = parseFloat(amount);
    if (!(amt > 0)) return 'Ingrese un monto pagado mayor a cero.';
    if (!paymentDate) return 'Seleccione la fecha de pago.';
    if (paymentDate > todayStr()) return 'La fecha de pago no puede ser futura.';
    if (!METHODS.includes(method)) return 'Seleccione un método de pago válido.';
    if (this.methodRequiresOperation(method) && !(operationNumber || '').trim()) {
      return `El número de operación es obligatorio para ${method}.`;
    }
    return this.validateProofFile(proofFile);
  },

  /**
   * Registro de pago por la administradora.
   * Devuelve { payment, proofError }: si el pago se registró pero el comprobante falló,
   * proofError trae el motivo (el pago NO se pierde y el comprobante puede adjuntarse luego).
   */
  async registerPayment({ unitId, unitCode, periodMonth, amount, paymentDate, method, operationNumber, notes, proofFile, registeredBy }) {
    const error = this.validatePayment({ unitCode, periodMonth, amount, paymentDate, method, operationNumber, proofFile });
    if (error) throw new Error(error);

    let payment;

    if (isSupabaseConnected()) {
      await this._requireSession();
      const { data, error: rpcError } = await supabase.rpc('register_payment', {
        p_unit_id: unitId,
        p_period_month: periodMonth,
        p_amount: parseFloat(amount),
        p_payment_date: paymentDate,
        p_method: method,
        p_operation_number: (operationNumber || '').trim() || null,
        p_notes: notes || null
      });
      if (rpcError) throw new Error(rpcError.message);
      payment = data;
    } else {
      payment = this._registerPaymentLocal({ unitCode, periodMonth, amount, paymentDate, method, operationNumber, notes, registeredBy });
    }

    let proofError = null;
    if (proofFile) {
      try {
        await this.attachProof(payment, proofFile);
      } catch (err) {
        proofError = err.message;
      }
    }
    return { payment, proofError };
  },

  _registerPaymentLocal({ unitCode, periodMonth, amount, paymentDate, method, operationNumber, notes, registeredBy }) {
    const fee = store.state.maintenance_fees.find(f => f.unit_code === unitCode && f.period_month === periodMonth);
    if (!fee) throw new Error('No existe una cuota para ese departamento y período.');
    if (fee.status === 'PAGADO') throw new Error('La cuota de ese período ya figura como pagada.');

    const amt = parseFloat(amount);

    // La cuota se cierra solo si el monto cubre la cuota base (pago parcial: queda pendiente)
    if (amt >= fee.fee_amount) {
      fee.status = 'PAGADO';
      fee.payment_date = paymentDate;
      Object.assign(fee, this.withLateFee(fee)); // días e interés según la fecha real de pago
    }

    const newPayment = {
      id: `pay-${Date.now()}`,
      fee_id: fee.id,
      unit_id: fee.unit_id,
      unit_code: unitCode,
      owner_name: fee.owner_name,
      period: fee.period,
      period_month: fee.period_month,
      amount: amt,
      payment_date: paymentDate,
      method: method,
      operation_number: (operationNumber || '').trim() || null,
      status: 'VERIFICADO',
      notes: notes || '',
      proof_file_path: null,
      registered_by: registeredBy || 'Administración',
      registered_at: new Date().toISOString()
    };

    store.state.payments.unshift(newPayment);

    store.state.audit_logs.unshift({
      id: `aud-${Date.now()}`,
      building_id: store.state.building.id,
      action: 'REGISTRO_PAGO',
      description: `Registró pago de ${fee.period} para Dpto ${unitCode} por S/ ${amt} (${method}${newPayment.operation_number ? ' Op: ' + newPayment.operation_number : ''})`,
      performed_by: registeredBy || 'Administración',
      timestamp: new Date().toISOString()
    });

    store.saveState();
    return newPayment;
  },

  /* ---------------- Comprobantes ---------------- */

  _safeFileName(name) {
    return name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_');
  },

  /** Nombre legible del archivo guardado en la ruta del comprobante. */
  proofDisplayName(payment) {
    if (!payment.proof_file_path) return '';
    const last = payment.proof_file_path.split('/').pop();
    return last.replace(/^\d+-/, '');
  },

  /**
   * Adjunta o reemplaza el comprobante de un pago.
   * Supabase: sube al bucket privado y guarda solo la ruta en payments.proof_file_path.
   * Ruta: <unit_id>/<payment_id>/<timestamp>-<archivo> (la política exige unit_id como 1.er nivel).
   */
  /**
   * Estado visible de una cuota: es la ÚNICA definición que usan el listado de cobranza, el reporte
   * (pantalla, CSV y PDF) y el portal del propietario. `paid` = suma de pagos válidos de la cuota.
   * Devuelve { key, label, badge (clase CSS), pdf: [fondo, texto] }.
   */
  statusInfo(fee, paid = 0) {
    const info = (key, label, badge, pdf) => ({ key, label, badge, pdf });
    if (fee.status === 'PAGADO') return info('PAGADO', 'Pagado', 'badge-success', [[221, 240, 200], [52, 92, 6]]);
    if (fee.status === 'POR_VERIFICAR') return info('POR_VERIFICAR', 'Por verificar', 'badge-warning', [[254, 243, 199], [133, 77, 14]]);
    if (fee.status === 'MORA_PENDIENTE') return info('MORA_PENDIENTE', 'Mora pendiente', 'badge-info', [[219, 234, 254], [30, 64, 175]]);
    if (paid > 0) return info('PARCIAL', 'Pago parcial', 'badge-orange', [[255, 228, 204], [154, 52, 18]]);
    if ((Number(fee.days_late) || 0) > 0) return info('VENCIDO', 'Vencido', 'badge-danger', [[252, 222, 219], [160, 30, 20]]);
    return info('PENDIENTE', 'Pendiente', 'badge-warning', [[254, 243, 199], [133, 77, 14]]);
  },

  /** Suma de los pagos válidos (no anulados) de una cuota. */
  paidForFee(feeId, payments) {
    return Math.round(payments
      .filter(p => p.fee_id === feeId && p.status !== 'RECHAZADO')
      .reduce((s, p) => s + (Number(p.amount) || 0), 0) * 100) / 100;
  },

  /** Anula un pago (no se borra: queda marcado con su motivo). Solo con Supabase. */
  async voidPayment(paymentId, reason) {
    const { data, error } = await supabase.rpc('void_payment', { p_payment_id: paymentId, p_reason: reason });
    if (error) throw new Error(error.message);
    return data;
  },

  async attachProof(payment, file) {
    const fileError = this.validateProofFile(file);
    if (fileError) throw new Error(fileError);
    const oldPath = payment.proof_file_path;
    const path = `${payment.unit_id || `unit-${payment.unit_code}`}/${payment.id}/${Date.now()}-${this._safeFileName(file.name)}`;

    if (isSupabaseConnected()) {
      const up = await supabase.storage.from(PROOF_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (up.error) throw new Error(`No se pudo subir el comprobante: ${up.error.message}`);

      const upd = await supabase.from('payments').update({ proof_file_path: path }).eq('id', payment.id);
      if (upd.error) {
        await supabase.storage.from(PROOF_BUCKET).remove([path]); // no dejar archivos huérfanos
        throw new Error(`No se pudo asociar el comprobante al pago: ${upd.error.message}`);
      }
      if (oldPath) await supabase.storage.from(PROOF_BUCKET).remove([oldPath]);
    } else {
      mockProofFiles.set(payment.id, file);
      const local = store.state.payments.find(p => p.id === payment.id);
      if (local) { local.proof_file_path = path; store.saveState(); }
    }
    payment.proof_file_path = path;
    return payment;
  },

  /** URL temporal para ver/descargar el comprobante (privado: URL firmada de 5 minutos). */
  async getProofAccess(payment) {
    if (!payment.proof_file_path) return null;
    const name = this.proofDisplayName(payment);
    const isImage = /\.(jpe?g|png)$/i.test(name);

    if (isSupabaseConnected()) {
      const { data, error } = await supabase.storage.from(PROOF_BUCKET)
        .createSignedUrl(payment.proof_file_path, 300, { download: false });
      if (error) throw new Error(`No se pudo abrir el comprobante: ${error.message}`);
      const dl = await supabase.storage.from(PROOF_BUCKET)
        .createSignedUrl(payment.proof_file_path, 300, { download: name });
      return { url: data.signedUrl, downloadUrl: dl.data ? dl.data.signedUrl : data.signedUrl, name, isImage };
    }

    const file = mockProofFiles.get(payment.id);
    if (!file) return { url: null, downloadUrl: null, name, isImage, unavailable: true };
    const url = URL.createObjectURL(file);
    return { url, downloadUrl: url, name, isImage };
  },

  /**
   * Late Fee / Interest Rule configuration
   */
  getInterestRule() {
    return store.state.interest_rule;
  },

  /**
   * Regla de mora vigente. En Supabase se lee de interest_rules (la misma tabla que usa
   * el servidor para calcular), y se deja en memoria para las vistas previas del formulario.
   */
  async _loadAllRules() {
    const { data, error } = await supabase.from('interest_rules').select('*');
    if (error) { console.warn('No se pudieron cargar las reglas de mora:', error.message); return; }
    this._rules = Object.fromEntries(data.map(r => [r.building_id, r]));
  },

  async loadInterestRule(buildingId) {
    if (isSupabaseConnected()) {
      await this._requireSession();
      let query = supabase.from('interest_rules').select('*');
      if (buildingId) query = query.eq('building_id', buildingId);
      const { data, error } = await query.limit(1).maybeSingle();
      if (error) throw new Error(`No se pudo cargar la regla de mora: ${error.message}`);
      if (!data) throw new Error('No hay una regla de mora configurada para el edificio (tabla interest_rules vacía).');
      store.state.interest_rule = { ...store.state.interest_rule, ...data };
    }
    return store.state.interest_rule;
  },

  /** Guarda la regla de mora. En Supabase actualiza interest_rules: desde ese momento el servidor la aplica. */
  async saveInterestRule({ type, rate_percent, grace_days, rounding }) {
    if (!(rate_percent >= 0 && rate_percent <= 100)) throw new Error('La tasa debe estar entre 0 y 100.');
    if (!(Number.isInteger(grace_days) && grace_days >= 0)) throw new Error('Los días de gracia deben ser un número entero (0 o más).');

    if (isSupabaseConnected()) {
      await this._requireSession();
      const current = store.state.interest_rule; // la regla del edificio que se cargó en pantalla
      if (!current || !current.id) throw new Error('Cargue primero la regla de mora del edificio.');
      const { data, error } = await supabase.from('interest_rules')
        .update({ type, rate_percent, grace_days, rounding, updated_at: new Date().toISOString() })
        .eq('id', current.id)
        .select()
        .single();
      if (error) throw new Error(`No se pudo guardar la regla de mora: ${error.message}`);
      store.state.interest_rule = { ...store.state.interest_rule, ...data };
      return data;
    }
    this.updateInterestRule({ type, rate_percent, grace_days, rounding });
    return store.state.interest_rule;
  },

  updateInterestRule(newRule) {
    store.state.interest_rule = {
      ...store.state.interest_rule,
      ...newRule
    };
    store.saveState();
  }
};
