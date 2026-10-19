/* Mantenimiento y servicios, gastos, pagos, documentos y caja general (solo administración, Supabase) */
import { supabase } from '../supabaseClient.js';

const BUCKET = 'mantenimiento';
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

export const FREQUENCIES = {
  MENSUAL: 'Mensual', BIMESTRAL: 'Bimestral', TRIMESTRAL: 'Trimestral',
  SEMESTRAL: 'Semestral', ANUAL: 'Anual', EVENTUAL: 'Eventual'
};
export const SERVICE_STATUS = { ACTIVO: 'Activo', INACTIVO: 'Inactivo', FINALIZADO: 'Finalizado' };
export const EXPENSE_STATUS = {
  PENDIENTE: { label: 'Pendiente', badge: 'badge-warning' },
  VENCIDO: { label: 'Vencido', badge: 'badge-danger' },
  PAGADO: { label: 'Pagado', badge: 'badge-success' },
  ANULADO: { label: 'Anulado', badge: 'badge-neutral' }
};
export const DOC_TYPES = {
  FACTURA: 'Factura', RECIBO: 'Recibo', COTIZACION: 'Cotización',
  COMPROBANTE: 'Comprobante de pago', INFORME: 'Informe de mantenimiento', OTRO: 'Otro'
};
export const PAYMENT_METHODS = ['Transferencia bancaria', 'Yape', 'Plin', 'Efectivo', 'Tarjeta', 'Otro'];
export const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const fail = (error, label) => { if (error) throw new Error(label ? `${label}: ${error.message}` : error.message); };
const safeName = (name) => String(name || 'archivo').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80);

export const periodText = (isoMonth) => {
  const m = String(isoMonth || '').match(/^(\d{4})-(\d{2})/);
  return m ? `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}` : '';
};

/** Primer y último día de un mes ("2026-10") para los resúmenes de caja. */
export function monthRange(year, month) {
  const last = new Date(year, month, 0).getDate();
  const mm = String(month).padStart(2, '0');
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, '0')}` };
}

export const maintenanceService = {
  /* ---------- Proveedores ---------- */
  async loadProviders() {
    const { data, error } = await supabase.from('service_providers').select('*').order('name').range(0, 999);
    fail(error, 'No se pudieron cargar los proveedores');
    return data || [];
  },
  async saveProvider(p) {
    const { data, error } = await supabase.rpc('save_provider', { p });
    fail(error);
    return data;
  },

  /* ---------- Servicios ---------- */
  async loadServices(buildingId) {
    const { data, error } = await supabase.from('maintenance_services').select('*')
      .eq('building_id', buildingId).order('name').range(0, 999);
    fail(error, 'No se pudieron cargar los servicios');
    return data || [];
  },
  async saveService(p) {
    const { data, error } = await supabase.rpc('save_maintenance_service', { p });
    fail(error);
    return data;
  },

  /* ---------- Gastos ---------- */
  /** Gastos de un edificio (propios y su parte de los compartidos), con saldos ya calculados. */
  async loadBuildingExpenses(buildingId) {
    const { data, error } = await supabase.from('vw_expense_allocations_calc').select('*')
      .eq('building_id', buildingId).order('period_month', { ascending: false }).order('created_at', { ascending: false })
      .range(0, 4999);
    fail(error, 'No se pudieron cargar los gastos');
    return data || [];
  },
  /** Todos los gastos (incluidos los generales) con la lista de edificios de cada uno. */
  async loadAllExpenses() {
    const [exp, alloc] = await Promise.all([
      supabase.from('vw_service_expenses_calc').select('*')
        .order('period_month', { ascending: false }).order('created_at', { ascending: false }).range(0, 4999),
      supabase.from('expense_allocations').select('expense_id, building_id, amount').range(0, 9999)
    ]);
    fail(exp.error, 'No se pudieron cargar los gastos');
    fail(alloc.error, 'No se pudo cargar el reparto de gastos');
    const byExpense = new Map();
    (alloc.data || []).forEach(a => {
      if (!byExpense.has(a.expense_id)) byExpense.set(a.expense_id, []);
      byExpense.get(a.expense_id).push(a);
    });
    return (exp.data || []).map(e => ({ ...e, allocations: byExpense.get(e.id) || [] }));
  },
  async loadExpenseAllocations(expenseId) {
    const { data, error } = await supabase.from('expense_allocations').select('building_id, amount').eq('expense_id', expenseId);
    fail(error);
    return data || [];
  },
  async saveExpense(p) {
    const { data, error } = await supabase.rpc('save_expense', { p });
    fail(error);
    return data;
  },
  async voidExpense(id, reason) {
    const { error } = await supabase.rpc('void_expense', { p_expense: id, p_reason: reason });
    fail(error);
  },

  /* ---------- Pagos ---------- */
  async loadPayments(expenseId) {
    const { data, error } = await supabase.from('expense_payments').select('*')
      .eq('expense_id', expenseId).order('payment_date').order('registered_at').range(0, 499);
    fail(error, 'No se pudieron cargar los pagos');
    return data || [];
  },
  async registerPayment({ expenseId, amount, date, method, operation, notes }) {
    const { data, error } = await supabase.rpc('register_expense_payment', {
      p_expense: expenseId, p_amount: amount, p_date: date, p_method: method, p_operation: operation || null, p_notes: notes || null
    });
    fail(error);
    return data;
  },
  async voidPayment(id, reason) {
    const { data, error } = await supabase.rpc('void_expense_payment', { p_payment: id, p_reason: reason });
    fail(error);
    return data;
  },

  /* ---------- Documentos (bucket privado) ---------- */
  validateFile(file) {
    if (!file) return 'Elija un archivo.';
    if (!ALLOWED_TYPES.includes(file.type)) return 'El archivo debe ser PDF, JPG, PNG o WEBP.';
    if (file.size > MAX_FILE_BYTES) return 'El archivo no puede pesar más de 15 MB.';
    return null;
  },
  async loadDocuments({ expenseId, serviceId }) {
    let q = supabase.from('service_documents').select('*').order('created_at', { ascending: false }).range(0, 199);
    q = expenseId ? q.eq('expense_id', expenseId) : q.eq('service_id', serviceId);
    const { data, error } = await q;
    fail(error, 'No se pudieron cargar los documentos');
    return data || [];
  },
  async uploadDocument({ expenseId, serviceId, paymentId, docType, file }) {
    const err = this.validateFile(file);
    if (err) throw new Error(err);
    const kind = expenseId ? 'expense' : 'service';
    const path = `${kind}/${expenseId || serviceId}/${crypto.randomUUID()}-${safeName(file.name)}`;
    const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    fail(up.error, 'No se pudo subir el archivo');
    const { data, error } = await supabase.rpc('add_service_document', {
      p_expense: expenseId || null, p_service: expenseId ? null : serviceId, p_payment: paymentId || null,
      p_type: docType, p_path: path, p_name: file.name
    });
    if (error) { await supabase.storage.from(BUCKET).remove([path]); throw new Error(error.message); }
    return data;
  },
  async deleteDocument(id) {
    const { data, error } = await supabase.rpc('delete_service_document', { p_id: id });
    fail(error);
    if (data) await supabase.storage.from(BUCKET).remove([data]);
  },
  /** URL temporal para ver el documento dentro del sistema y otra para descargarlo (5 min, solo administración). */
  async documentAccess(path, name, bucket = BUCKET) {
    const view = await supabase.storage.from(bucket).createSignedUrl(path, 300);
    fail(view.error, 'No se pudo abrir el documento');
    const dl = await supabase.storage.from(bucket).createSignedUrl(path, 300, { download: name || true });
    return { url: view.data.signedUrl, downloadUrl: dl.data ? dl.data.signedUrl : view.data.signedUrl, isImage: /\.(jpe?g|png|webp)$/i.test(name || path) };
  },

  /** Enlace temporal (5 min), solo con sesión de administración. */
  async documentUrl(path) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
    fail(error, 'No se pudo abrir el documento');
    return data.signedUrl;
  },

  /* ---------- Caja general y otros ingresos ---------- */
  async cashSummary(from, to, buildingId = null) {
    const { data, error } = await supabase.rpc('get_cash_summary', { p_from: from, p_to: to, p_building: buildingId });
    fail(error);
    return data;
  },
  /** Libro de movimientos del período: una línea por cuota pagada, otro ingreso y pago de gasto (cronológico). */
  async cashLedger(from, to, buildingId = null) {
    const { data, error } = await supabase.rpc('get_cash_ledger', { p_from: from, p_to: to, p_building: buildingId, p_limit: 2000 });
    fail(error);
    return data || [];
  },
  async loadCashAccount() {
    const { data, error } = await supabase.from('admin_cash_account').select('*').eq('id', 1).maybeSingle();
    fail(error, 'No se pudo cargar la cuenta de la administración');
    return data;
  },
  async setCashAccount(name, opening, date) {
    const { error } = await supabase.rpc('set_cash_account', { p_name: name, p_opening: opening, p_date: date });
    fail(error);
  },
  async loadOtherIncome(buildingId = null) {
    let q = supabase.from('other_income').select('*').order('income_date', { ascending: false }).range(0, 999);
    if (buildingId) q = q.eq('building_id', buildingId);
    const { data, error } = await q;
    fail(error, 'No se pudieron cargar los ingresos');
    return data || [];
  },
  async saveOtherIncome(p) {
    const { data, error } = await supabase.rpc('save_other_income', { p });
    fail(error);
    return data;
  },
  async voidOtherIncome(id) {
    const { error } = await supabase.rpc('void_other_income', { p_id: id });
    fail(error);
  }
};

/** Descarga un CSV con tildes correctas en Excel. rows = arreglo de arreglos. */
export function downloadCsv(filename, rows) {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const text = '﻿' + rows.map(r => r.map(q).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
