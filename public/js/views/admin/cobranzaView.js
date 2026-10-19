/* Administradora Collection & Manual Payment Registration View */
import { store } from '../../store.js';
import { feeService } from '../../services/feeService.js';
import { activeBuilding } from '../../services/activeBuilding.js';
import { alertDialog, confirmDialog, promptDialog } from '../../ui/dialog.js';
import { isSupabaseConnected } from '../../supabaseClient.js';
import { formatCurrency, formatDate } from '../../config.js';

// Los filtros sobreviven a los re-renders (el modo local re-dibuja la app al guardar)
const ui = { building: null, period: null, search: '', status: 'TODOS' };

// Con Supabase, la cobranza trabaja SOLO con el edificio elegido al entrar (en demostración no hay edificio)
const activeBuildings = () => {
  const b = activeBuilding.get();
  return b ? [b] : [];
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Minúsculas y sin tildes, para que "perez" encuentre "Pérez"
const normalize = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function renderAdminCobranza() {
  let raw = { fees: [], payments: [] };   // todo lo que devuelve el servidor
  let data = { fees: [], payments: [] };  // lo del edificio seleccionado

  const container = document.createElement('div');
  container.className = 'fade-in';

  /* ---------------- datos derivados ---------------- */

  const periods = () => feeService.getAvailablePeriods(data.fees);
  const periodFees = () => data.fees.filter(f => f.period_month === ui.period);

  // Todos los pagos de una cuota (los anulados incluidos, para el historial)
  const paymentsFor = fee => data.payments.filter(p => p.fee_id === fee.id);
  const paidFor = fee => feeService.paidForFee(fee.id, data.payments);
  // Lo que falta por pagar de una cuota pendiente (cuota + mora - lo ya pagado)
  const balanceFor = fee => fee.status === 'PAGADO' ? 0 : Math.max(0, Math.round(((Number(fee.total_amount) || 0) - paidFor(fee)) * 100) / 100);

  function getFiltered() {
    const q = normalize(ui.search);
    return periodFees()
      .filter(f => {
        const matchStatus = ui.status === 'TODOS' || f.status === ui.status
          || (ui.status === 'PENDIENTE' && f.status === 'MORA_PENDIENTE');
        const matchSearch = f.unit_code.includes(q) || normalize(f.owner_name).includes(q);
        return matchStatus && matchSearch;
      })
      .sort((a, b) => a.unit_code.localeCompare(b.unit_code, undefined, { numeric: true }));
  }

  /* ---------------- HTML ---------------- */

  function statusBadge(fee) {
    const info = feeService.statusInfo(fee, paidFor(fee));
    return `<span class="badge ${info.badge}">${info.label}</span>`;
  }

  function rowsHTML(filtered) {
    if (filtered.length === 0) {
      return `<tr><td colspan="12" style="text-align: center; color: var(--text-dim);">No se encontraron departamentos con los filtros seleccionados.</td></tr>`;
    }
    return filtered.map(fee => {
      const feePayments = paymentsFor(fee);
      const validCount = feePayments.filter(p => p.status !== 'RECHAZADO').length;
      const paidSoFar = paidFor(fee);
      const balance = balanceFor(fee);
      const unpaid = fee.status !== 'PAGADO';
      return `
        <tr>
          <td><strong style="color: var(--primary);">Dpto ${esc(fee.unit_code)}</strong></td>
          <td>${esc(fee.owner_name)}</td>
          <td>${formatCurrency(fee.fee_amount)}</td>
          <td>${formatDate(fee.due_date)}</td>
          <td>${fee.days_late > 0
            ? `<span style="color: var(--status-danger); font-weight: 700;">${fee.days_late} ${fee.days_late === 1 ? 'día' : 'días'}</span>`
            : '<span style="color: var(--text-dim);">0 días</span>'}</td>
          <td>
            ${statusBadge(fee)}
            ${fee.payment_date ? `<div class="cell-note">${fee.status === 'PAGADO' ? 'Pagó' : (fee.status === 'MORA_PENDIENTE' ? 'Cuota cubierta' : 'Registrado')} el ${formatDate(fee.payment_date)}</div>` : ''}
          </td>
          <td>${fee.interest_amount > 0 ? `<span style="color: var(--status-danger); font-weight: 700;">${formatCurrency(fee.interest_amount)}</span>` : formatCurrency(0)}</td>
          <td><strong>${formatCurrency(fee.total_amount)}</strong></td>
          <td>${paidSoFar > 0 ? `<strong style="color: var(--primary);">${formatCurrency(paidSoFar)}</strong>` : '<span style="color: var(--text-dim);">—</span>'}</td>
          <td><strong style="${unpaid ? 'color: var(--status-danger); font-size: 1rem;' : 'color: var(--text-dim);'}">${formatCurrency(balance)}</strong></td>
          <td style="text-align: right; white-space: nowrap;">
            ${unpaid
              ? `<button class="btn btn-primary btn-sm btn-registrar-pago-row" data-unit-code="${esc(fee.unit_code)}">
                  <i data-lucide="check-square"></i> Registrar Pago
                </button>`
              : `<button class="btn btn-outline btn-sm" disabled title="La cuota ya está pagada"><i data-lucide="check-square"></i> Registrar Pago</button>`}
          </td>
          <td style="text-align: center; white-space: nowrap;">
            <button class="btn-eye ${validCount ? 'has-payments' : ''}" data-fee-id="${esc(fee.id)}"
                    ${feePayments.length ? '' : 'disabled'}
                    title="${validCount ? `Ver pagos y comprobantes (${validCount})` : (feePayments.length ? 'Solo hay pagos anulados' : 'Sin pagos registrados')}"
                    aria-label="Ver pagos">
              <i data-lucide="eye"></i>${validCount ? `<span class="btn-eye-count">${validCount}</span>` : ''}
            </button>
          </td>
        </tr>`;
    }).join('');
  }

  function summaryHTML() {
    const fees = periodFees();
    const due = fees[0] ? formatDate(fees[0].due_date) : '-';
    const paid = fees.filter(f => f.status === 'PAGADO');
    const verifying = fees.filter(f => f.status === 'POR_VERIFICAR');
    const debt = fees.filter(f => f.status === 'PENDIENTE' || f.status === 'MORA_PENDIENTE');
    // Por cobrar: lo que falta de cada cuota pendiente (descontando pagos parciales)
    const toCollect = debt.reduce((s, f) => s + balanceFor(f), 0);
    // Cobrado: pagos válidos del período (incluye parciales); una cuota pagada sin registro de pago cuenta por su total
    const collected = fees.reduce((s, f) => {
      const p = paidFor(f);
      return s + (p > 0 ? p : (f.status === 'PAGADO' ? Number(f.total_amount) || 0 : 0));
    }, 0);
    const label = (periods().find(p => p.value === ui.period) || {}).label || '';
    return `
      <div class="cobranza-summary">
        <div class="stat-item"><span class="stat-label">Período</span><span class="stat-value">${esc(label)}</span><span class="cell-note">Vence ${due}</span></div>
        <div class="stat-item"><span class="stat-label">Pagaron</span><span class="stat-value" style="color: var(--primary);">${paid.length} de ${fees.length}</span></div>
        <div class="stat-item"><span class="stat-label">Con deuda</span><span class="stat-value ${debt.length ? 'highlight-danger' : ''}">${debt.length}</span></div>
        <div class="stat-item"><span class="stat-label">Por cobrar</span><span class="stat-value ${toCollect ? 'highlight-danger' : ''}">${formatCurrency(toCollect)}</span></div>
        <div class="stat-item"><span class="stat-label">Cobrado</span><span class="stat-value">${formatCurrency(collected)}</span></div>
      </div>`;
  }

  function renderShell() {
    container.innerHTML = `
      <div class="card" style="margin-bottom: 1.5rem;">
        <div class="card-header">
          <h2 class="card-title"><i data-lucide="dollar-sign"></i> Listado y Registro de Cobranza</h2>
          <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
            <button class="btn btn-outline btn-sm" id="btn-generate-fees">
              <i data-lucide="calendar-plus"></i> Generar cuotas del mes
            </button>
            <button class="btn btn-primary btn-sm" id="btn-open-payment-modal">
              <i data-lucide="plus-circle"></i> Registrar Pago Manual
            </button>
          </div>
        </div>
        <p>Control de cuotas mensuales, cobranza y registro de depósitos / transferencias con su comprobante.</p>

        <!-- Filtros: período, búsqueda y estado -->
        <div class="cobranza-filters">
          ${activeBuildings().length > 1 ? `
          <div class="form-group">
            <label class="form-label" for="cobranza-building">Edificio</label>
            <select id="cobranza-building" class="form-select">
              ${activeBuildings().map(b => `<option value="${b.id}" ${b.id === ui.building ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
            </select>
          </div>` : ''}
          <div class="form-group">
            <label class="form-label" for="cobranza-period">Período / Mes</label>
            <select id="cobranza-period" class="form-select">
              ${periods().map(p => `<option value="${p.value}" ${p.value === ui.period ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="flex: 1; min-width: 220px;">
            <label class="form-label" for="cobranza-search-input">Buscar</label>
            <input type="text" id="cobranza-search-input" class="form-control" placeholder="Buscar por departamento o propietario..." value="${esc(ui.search)}" autocomplete="off">
          </div>
          <div class="form-group">
            <label class="form-label" for="cobranza-filter-status">Estado</label>
            <select id="cobranza-filter-status" class="form-select">
              <option value="TODOS" ${ui.status === 'TODOS' ? 'selected' : ''}>Todos los estados</option>
              <option value="PAGADO" ${ui.status === 'PAGADO' ? 'selected' : ''}>Pagados</option>
              <option value="PENDIENTE" ${ui.status === 'PENDIENTE' ? 'selected' : ''}>Pendientes / vencidos / con mora</option>
            </select>
          </div>
        </div>
      </div>

      <div id="cobranza-summary-slot"></div>

      <div class="card">
        <div class="table-responsive">
          <table class="data-table cobranza-table">
            <thead>
              <tr>
                <th>Dpto.</th>
                <th>Propietario</th>
                <th>Cuota Base</th>
                <th>Vencimiento</th>
                <th>Días de atraso</th>
                <th>Estado</th>
                <th>Interés</th>
                <th>Total</th>
                <th>Pagado</th>
                <th>Saldo</th>
                <th style="text-align: right;">Registrar</th>
                <th style="text-align: center;">Pagos</th>
              </tr>
            </thead>
            <tbody id="cobranza-tbody"></tbody>
          </table>
        </div>
      </div>
    `;

    updateResults();

    // Search: actualiza solo la tabla, el input conserva el foco
    container.querySelector('#cobranza-search-input')?.addEventListener('input', (e) => {
      ui.search = e.target.value;
      updateResults();
    });
    container.querySelector('#cobranza-building')?.addEventListener('change', (e) => {
      ui.building = e.target.value;
      ui.period = null;
      scopeToBuilding();
      if (!data.fees.length) { load(); return; } // el edificio aún no tiene cuotas: muestra el aviso con "Generar cuotas"
      ui.period = feeService.getDefaultPeriod(data.fees);
      renderShell();
    });
    container.querySelector('#cobranza-period')?.addEventListener('change', (e) => {
      ui.period = e.target.value;
      updateResults();
    });
    container.querySelector('#cobranza-filter-status')?.addEventListener('change', (e) => {
      ui.status = e.target.value;
      updateResults();
    });
    container.querySelector('#btn-open-payment-modal')?.addEventListener('click', () => openPaymentModal());
    container.querySelector('#btn-generate-fees')?.addEventListener('click', () => openGenerateModal());

    if (window.lucide) window.lucide.createIcons();
  }

  // Actualiza solo resumen + filas (los filtros no se vuelven a dibujar)
  function updateResults() {
    const slot = container.querySelector('#cobranza-summary-slot');
    const tbody = container.querySelector('#cobranza-tbody');
    if (!slot || !tbody) return;
    slot.innerHTML = summaryHTML();
    tbody.innerHTML = rowsHTML(getFiltered());

    tbody.querySelectorAll('.btn-registrar-pago-row').forEach(btn => {
      btn.addEventListener('click', () => openPaymentModal(btn.getAttribute('data-unit-code')));
    });
    tbody.querySelectorAll('.btn-eye:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => {
        const fee = data.fees.find(f => String(f.id) === btn.getAttribute('data-fee-id'));
        if (fee) openPaymentsModal(fee);
      });
    });
    if (window.lucide) window.lucide.createIcons();
  }

  /* ---------------- carga de datos ---------------- */

  // Limita los datos al edificio elegido (si el usuario administra varios)
  function scopeToBuilding() {
    const buildings = activeBuildings();
    if (!buildings.length) { data = raw; return; }
    if (!ui.building || !buildings.some(b => b.id === ui.building)) ui.building = buildings[0].id;
    data = {
      fees: raw.fees.filter(f => f.building_id === ui.building),
      payments: raw.payments.filter(p => p.building_id === ui.building)
    };
  }

  async function refresh() {
    try {
      raw = await feeService.loadCobranza();
      scopeToBuilding();
    } catch (err) {
      container.innerHTML = `
        <div class="card" style="text-align: center;">
          <p style="color: var(--status-danger); margin-bottom: 1rem;">${esc(err.message)}</p>
          <button class="btn btn-primary btn-sm" id="btn-retry-load">Reintentar</button>
        </div>`;
      container.querySelector('#btn-retry-load')?.addEventListener('click', () => { load(); });
      return;
    }
    if (data.fees.length === 0) {
      container.innerHTML = `
        <div class="card" style="max-width: 720px;">
          <h3 class="card-title" style="margin-bottom: 0.5rem;"><i data-lucide="info"></i> No hay cuotas para mostrar</h3>
          ${activeBuildings().length > 0 ? `
            <p style="margin-bottom: 0.75rem;">
              ${esc((activeBuildings().find(b => b.id === ui.building) || {}).name || 'Este edificio')} todavía no tiene cuotas generadas.
            </p>
            <p style="font-size: 0.9rem; color: var(--text-muted);">
              Las cuotas se crean para los departamentos del edificio. Si el edificio es nuevo y aún no tiene departamentos,
              primero hay que cargarlos; después podrá usar "Generar cuotas del mes".
            </p>` : `
            <p style="margin-bottom: 0.75rem;">No hay cuotas para mostrar.</p>
            <p style="font-size: 0.9rem; color: var(--text-muted);">Use "Generar cuotas del mes" para crearlas.</p>`}
          <div style="display: flex; gap: 0.5rem; margin-top: 1rem;">
            <button class="btn btn-primary btn-sm" id="btn-generate-fees"><i data-lucide="calendar-plus"></i> Generar cuotas del mes</button>
            <button class="btn btn-outline btn-sm" id="btn-retry-load">Reintentar</button>
          </div>
        </div>`;
      container.querySelector('#btn-retry-load')?.addEventListener('click', () => { load(); });
      container.querySelector('#btn-generate-fees')?.addEventListener('click', () => openGenerateModal());
      if (window.lucide) window.lucide.createIcons();
      return;
    }
    const available = periods().map(p => p.value);
    if (!ui.period || !available.includes(ui.period)) ui.period = feeService.getDefaultPeriod(data.fees);
    renderShell();
  }

  async function load() {
    container.innerHTML = '<div class="card" style="text-align: center; color: var(--text-dim);">Cargando cobranza...</div>';
    await refresh();
  }

  /* ---------------- modal: generar cuotas del mes ---------------- */

  function openGenerateModal() {
    const modalOverlay = document.getElementById('modal-container');
    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');
    const options = feeService.getGeneratablePeriods(data.fees);
    const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const thisYear = new Date().getFullYear();
    const yearOptions = Array.from({ length: 11 }, (_, i) => thisYear - 3 + i);
    // Edificios que puede administrar (en modo demostración no hay selección)
    const buildings = activeBuildings();
    // Sugerido: el primer mes que todavía no tiene cuotas
    const suggested = (options.find(o => !o.exists) || options[0]).value;

    modalTitle.innerHTML = `<i data-lucide="calendar-plus" style="color: var(--primary);"></i> Generar cuotas del mes`;
    modalBody.innerHTML = `
      <p style="margin-bottom: 1rem; font-size: 0.9rem;">
        Crea la cuota del mes para <strong>todos los departamentos</strong> (monto de cada departamento, vencimiento el día 5).
        Si algún departamento ya tiene la cuota de ese mes, no se duplica.
      </p>
      ${buildings.length > 1 ? `
      <div class="form-group">
        <label class="form-label" for="gen-building">Edificio</label>
        <select id="gen-building" class="form-select">
          ${buildings.map(b => `<option value="${b.id}" ${b.id === ui.building ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
        </select>
      </div>` : ''}
      <div class="form-group">
        <label class="form-label" for="gen-month">Mes a generar</label>
        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 0.75rem;">
          <select id="gen-month" class="form-select">${MONTH_NAMES.map((m, i) => `<option value="${String(i + 1).padStart(2, '0')}" ${i + 1 === Number(suggested.slice(5, 7)) ? 'selected' : ''}>${m}</option>`).join('')}</select>
          <select id="gen-year" class="form-select">${yearOptions.map(y => `<option value="${y}" ${y === Number(suggested.slice(0, 4)) ? 'selected' : ''}>${y}</option>`).join('')}</select>
        </div>
        <span id="gen-hint" class="cell-note"></span>
      </div>
      <div id="gen-error" class="form-error" hidden></div>
      <div style="display: flex; gap: 1rem; justify-content: flex-end; margin-top: 1.25rem;">
        <button type="button" class="btn btn-secondary" id="gen-cancel">Cancelar</button>
        <button type="button" class="btn btn-primary" id="gen-confirm"><i data-lucide="check"></i> Generar cuotas</button>
      </div>
    `;
    modalOverlay.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();

    const close = () => modalOverlay.classList.add('hidden');
    document.getElementById('modal-close-btn').onclick = close;
    document.getElementById('gen-cancel').onclick = close;
    const existing = new Set(data.fees.map(f => f.period_month));
    const monthSel = document.getElementById('gen-month');
    const yearSel = document.getElementById('gen-year');
    const currentValue = () => `${yearSel.value}-${monthSel.value}`;
    const refreshHint = () => {
      const v = currentValue();
      document.getElementById('gen-hint').textContent = v && existing.has(v + '-01') ? 'Ese mes ya tiene cuotas: solo se crearán las que falten.' : '';
    };
    monthSel.addEventListener('change', refreshHint);
    yearSel.addEventListener('change', refreshHint);
    refreshHint();
    document.getElementById('gen-confirm').onclick = async () => {
      const btn = document.getElementById('gen-confirm');
      const errBox = document.getElementById('gen-error');
      const monthValue = currentValue();
      if (!/^\d{4}-\d{2}$/.test(monthValue)) { errBox.textContent = 'Elija un mes y un año válidos.'; errBox.hidden = false; return; }
      const period = `-01`;
      btn.disabled = true;
      errBox.hidden = true;
      try {
        const buildingSelect = document.getElementById('gen-building');
        const buildingId = buildingSelect ? buildingSelect.value : (ui.building || (buildings[0] && buildings[0].id));
        const created = await feeService.generateFees(period, buildingId);
        ui.period = period;
        if (buildingId) ui.building = buildingId;
        close();
        await refresh();
        alertDialog({
          tone: created > 0 ? 'success' : 'info',
          title: created > 0 ? 'Cuotas generadas' : 'Sin cambios',
          message: created > 0
            ? `Se generaron ${created} cuotas de ${feeService.getAvailablePeriods(data.fees).find(p => p.value === period)?.label || ''}.`
            : 'Ese mes ya tenía todas sus cuotas generadas. No se creó ninguna nueva.'
        });
      } catch (err) {
        errBox.textContent = err.message;
        errBox.hidden = false;
        btn.disabled = false;
      }
    };
  }

  /* ---------------- modal: registrar pago ---------------- */

  function openPaymentModal(defaultUnitCode) {
    const modalOverlay = document.getElementById('modal-container');
    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');

    // Departamentos y propietarios salen de las cuotas cargadas: no hay forma de combinarlos mal
    const unitMap = new Map();
    data.fees.forEach(f => { if (!unitMap.has(f.unit_code)) unitMap.set(f.unit_code, { id: f.unit_id, code: f.unit_code, owner: f.owner_name }); });
    const units = [...unitMap.values()].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    const firstUnit = units.find(u => u.code === defaultUnitCode) || units[0];

    modalTitle.innerHTML = `<i data-lucide="plus-circle" style="color: var(--primary);"></i> Registrar Pago Manual de Cuota`;

    modalBody.innerHTML = `
      <form id="manual-payment-form" novalidate>
        <div class="form-grid">
          <div class="form-group">
            <label class="form-label" for="modal-pay-unit">Departamento</label>
            <select id="modal-pay-unit" class="form-select" required>
              ${units.map(u => `<option value="${esc(u.code)}" ${u.code === firstUnit.code ? 'selected' : ''}>Dpto ${esc(u.code)} - ${esc(u.owner)}</option>`).join('')}
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">Propietario asociado</label>
            <input type="text" id="modal-pay-owner" class="form-control" value="${esc(firstUnit.owner)}" readonly>
          </div>

          <div class="form-group">
            <label class="form-label" for="modal-pay-period">Período / Mes</label>
            <select id="modal-pay-period" class="form-select" required>
              ${periods().map(p => `<option value="${p.value}" ${p.value === ui.period ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
            </select>
          </div>

          <div class="form-group">
            <label class="form-label" for="modal-pay-date">Fecha de Pago <span id="modal-pay-date-text" class="cell-note" style="display:inline;"></span></label>
            <input type="date" id="modal-pay-date" class="form-control" value="${todayStr()}" max="${todayStr()}" required>
          </div>
        </div>

        <div id="modal-older-warning" class="form-warning" hidden></div>
        <div id="modal-fee-info" class="fee-info-box"></div>

        <div class="form-grid">
          <div class="form-group">
            <label class="form-label" for="modal-pay-amount">Monto Pagado (S/)</label>
            <input type="number" step="0.01" min="0.01" id="modal-pay-amount" class="form-control" required>
          </div>

          <div class="form-group">
            <label class="form-label" for="modal-pay-method">Método de Pago</label>
            <select id="modal-pay-method" class="form-select" required>
              ${feeService.METHODS.map(m => `<option value="${m}" ${m === 'Transferencia bancaria' ? 'selected' : ''}>${m}</option>`).join('')}
            </select>
          </div>

          <div class="form-group" style="grid-column: 1 / -1;">
            <label class="form-label" for="modal-pay-opnum">Número de Operación / Constancia <span id="modal-pay-op-hint" class="cell-note" style="display:inline;"></span></label>
            <input type="text" id="modal-pay-opnum" class="form-control" placeholder="Ej: BCP-98451204" autocomplete="off">
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Comprobante de pago (opcional)</label>
          <div class="proof-picker">
            <label class="btn btn-outline btn-sm" for="modal-pay-proof"><i data-lucide="paperclip"></i> Adjuntar comprobante</label>
            <input type="file" id="modal-pay-proof" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" hidden>
            <span id="modal-proof-name" class="cell-note" style="display:inline;">JPG, PNG o PDF · máx. 10 MB</span>
            <button type="button" class="btn-icon" id="modal-proof-clear" hidden aria-label="Quitar comprobante"><i data-lucide="x"></i></button>
          </div>
          <div id="modal-proof-preview"></div>
        </div>

        <div class="form-group" style="margin-top: 0.5rem;">
          <label class="form-label" for="modal-pay-notes">Observaciones (Opcional)</label>
          <textarea id="modal-pay-notes" class="form-control" rows="2" placeholder="Notas administrativas sobre la verificación del depósito..."></textarea>
        </div>

        <div id="modal-pay-error" class="form-error" hidden></div>

        <div style="display: flex; gap: 1rem; justify-content: flex-end; margin-top: 1.25rem;">
          <button type="button" class="btn btn-secondary" id="modal-pay-cancel">Cancelar</button>
          <button type="submit" class="btn btn-primary" id="modal-pay-submit"><i data-lucide="check"></i> Registrar Pago</button>
        </div>
      </form>
    `;

    modalOverlay.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();

    const $ = id => document.getElementById(id);
    let amountTouched = false;
    let proofFile = null;
    let previewUrl = null;
    let currentFee = null;
    let currentEst = null;

    const closeModal = () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      modalOverlay.classList.add('hidden');
    };
    $('modal-close-btn').onclick = closeModal;
    $('modal-pay-cancel').onclick = closeModal;

    function showError(msg) {
      const box = $('modal-pay-error');
      box.textContent = msg || '';
      box.hidden = !msg;
    }

    // Cuota seleccionada + vista previa de mora a la fecha de pago elegida
    function refreshFeeInfo() {
      const unitCode = $('modal-pay-unit').value;
      const period = $('modal-pay-period').value;
      const date = $('modal-pay-date').value;
      $('modal-pay-owner').value = (unitMap.get(unitCode) || {}).owner || '';
      $('modal-pay-date-text').textContent = date ? `(${formatDate(date)})` : '';

      const fee = data.fees.find(f => f.unit_code === unitCode && f.period_month === period);
      currentFee = fee || null;

      // Aviso (no bloquea): el departamento debe cuotas de meses anteriores
      const older = data.fees
        .filter(f => f.unit_code === unitCode && f.period_month < period && f.status !== 'PAGADO')
        .sort((a, b) => a.period_month.localeCompare(b.period_month));
      const warn = $('modal-older-warning');
      if (older.length) {
        warn.innerHTML = `<strong>Este departamento tiene cuotas anteriores pendientes:</strong> ${older.map(f => `${esc(f.period)} (${formatCurrency(f.total_amount)})`).join(', ')}. Puedes registrar este pago, pero se recomienda cancelar primero la más antigua.`;
        warn.hidden = false;
      } else {
        warn.hidden = true;
      }
      const box = $('modal-fee-info');
      const submit = $('modal-pay-submit');

      if (!fee) {
        box.innerHTML = '<strong>No existe una cuota para ese departamento y período.</strong>';
        submit.disabled = true;
        return;
      }
      if (fee.status === 'PAGADO') {
        box.innerHTML = `<strong>La cuota de ${esc(fee.period)} ya figura como pagada${fee.payment_date ? ' el ' + formatDate(fee.payment_date) : ''}.</strong>`;
        submit.disabled = true;
        return;
      }
      submit.disabled = false;

      // Estimado con la fecha de pago elegida; el cálculo definitivo lo hace el servidor
      // Con la cuota base ya cubierta (mora pendiente) la mora está congelada; si no, se estima a la fecha elegida
      const est = (date && fee.status !== 'MORA_PENDIENTE') ? feeService.withLateFee({ ...fee, status: 'PAGADO', payment_date: date }) : fee;
      currentEst = est;
      const paidSoFar = paidFor(fee);
      const saldo = Math.max(0, Math.round((est.total_amount - paidSoFar) * 100) / 100);
      box.innerHTML = `
        <div><span>Cuota base</span><strong>${formatCurrency(fee.fee_amount)}</strong></div>
        <div><span>Vencimiento</span><strong>${formatDate(fee.due_date)}</strong></div>
        <div><span>Días de atraso</span><strong>${est.days_late}</strong></div>
        <div><span>Interés moratorio</span><strong>${formatCurrency(est.interest_amount)}</strong></div>
        <div><span>Total a cobrar</span><strong>${formatCurrency(est.total_amount)}</strong></div>
        ${paidSoFar > 0 ? `
        <div><span>Ya pagado</span><strong>${formatCurrency(paidSoFar)}</strong></div>
        <div><span>Saldo a cobrar</span><strong>${formatCurrency(saldo)}</strong></div>` : ''}`;

      if (!amountTouched) $('modal-pay-amount').value = saldo.toFixed(2);
      refreshPartialWarning();
    }

    function refreshPartialWarning() {
      const amt = parseFloat($('modal-pay-amount').value);
      const hint = $('modal-pay-op-hint');
      hint.textContent = feeService.methodRequiresOperation($('modal-pay-method').value) ? '(obligatorio)' : '(opcional)';
      const already = currentFee ? paidFor(currentFee) : 0;
      if (currentFee && amt > 0 && already + amt < currentFee.fee_amount) {
        showError(`Con este pago el acumulado será ${formatCurrency(already + amt)} de la cuota base ${formatCurrency(currentFee.fee_amount)}: se registrará como pago parcial y la cuota seguirá pendiente.`);
      } else if (currentFee && currentEst && amt > 0 && already + amt < currentEst.total_amount - 0.005) {
        showError(`Con este pago la cuota base quedará cubierta, pero faltarán ${formatCurrency(currentEst.total_amount - already - amt)} de mora: la cuota quedará como "Mora pendiente" hasta que se pague.`);
      } else {
        showError('');
      }
    }

    ['modal-pay-unit', 'modal-pay-period', 'modal-pay-date'].forEach(id => $(id).addEventListener('change', () => {
      amountTouched = false;
      refreshFeeInfo();
    }));
    $('modal-pay-amount').addEventListener('input', () => { amountTouched = true; refreshPartialWarning(); });
    $('modal-pay-method').addEventListener('change', refreshPartialWarning);

    // Comprobante: validación + vista previa
    function setProof(file) {
      if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
      proofFile = file;
      $('modal-proof-clear').hidden = !file;
      $('modal-proof-name').textContent = file ? file.name : 'JPG, PNG o PDF · máx. 10 MB';
      const preview = $('modal-proof-preview');
      if (file && file.type.startsWith('image/')) {
        previewUrl = URL.createObjectURL(file);
        preview.innerHTML = `<img src="${previewUrl}" alt="Vista previa del comprobante" class="proof-thumb">`;
      } else {
        preview.innerHTML = file ? '<span class="cell-note">Archivo PDF adjunto</span>' : '';
      }
    }
    $('modal-pay-proof').addEventListener('change', (e) => {
      const file = e.target.files[0];
      const err = feeService.validateProofFile(file);
      if (err) { e.target.value = ''; setProof(null); showError(err); return; }
      showError('');
      setProof(file || null);
    });
    $('modal-proof-clear').addEventListener('click', () => { $('modal-pay-proof').value = ''; setProof(null); });

    refreshFeeInfo();
    refreshPartialWarning();

    $('manual-payment-form').onsubmit = async (e) => {
      e.preventDefault();
      const unitCode = $('modal-pay-unit').value;
      const unit = unitMap.get(unitCode);
      const payload = {
        unitId: unit.id,
        unitCode,
        periodMonth: $('modal-pay-period').value,
        amount: $('modal-pay-amount').value,
        paymentDate: $('modal-pay-date').value,
        method: $('modal-pay-method').value,
        operationNumber: $('modal-pay-opnum').value,
        notes: $('modal-pay-notes').value,
        proofFile,
        registeredBy: 'Administradora PARKE10'
      };

      const invalid = feeService.validatePayment(payload);
      if (invalid) { showError(invalid); return; }

      const submit = $('modal-pay-submit');
      submit.disabled = true;
      submit.textContent = 'Registrando...';
      try {
        const result = await feeService.registerPayment(payload);
        ui.period = payload.periodMonth;
        closeModal();
        await refresh();
        if (result.proofError) {
          alertDialog({
            tone: 'warning',
            title: 'Pago registrado sin comprobante',
            message: `El pago se registró, pero el comprobante no se pudo guardar: ${result.proofError}\nPuede adjuntarlo desde la lista con "Adjuntar comprobante".`
          });
        }
      } catch (err) {
        showError(err.message);
        submit.disabled = false;
        submit.innerHTML = '<i data-lucide="check"></i> Registrar Pago';
        if (window.lucide) window.lucide.createIcons();
      }
    };
  }

  /* ---------------- modal: todos los pagos de una cuota (ver comprobantes, anular) ---------------- */

  function openPaymentsModal(fee) {
    const modalOverlay = document.getElementById('modal-container');
    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');
    const canVoid = isSupabaseConnected();
    const list = paymentsFor(fee).slice().sort((a, b) => String(a.registered_at).localeCompare(String(b.registered_at)));
    const paid = paidFor(fee);

    modalTitle.innerHTML = `<i data-lucide="receipt" style="color: var(--primary);"></i> Pagos — Dpto ${esc(fee.unit_code)} · ${esc(fee.period)}`;
    // Ventana ancha mientras esté abierta; al cerrarse vuelve al ancho normal para los demás formularios
    const card = document.getElementById('modal-card');
    card.classList.add('modal-wide');
    const watcher = new MutationObserver(() => {
      if (modalOverlay.classList.contains('hidden')) { card.classList.remove('modal-wide'); watcher.disconnect(); }
    });
    watcher.observe(modalOverlay, { attributes: true, attributeFilter: ['class'] });
    modalOverlay.classList.remove('hidden');
    document.getElementById('modal-close-btn').onclick = () => modalOverlay.classList.add('hidden');

    modalBody.innerHTML = `
      <div class="fee-info-box">
        <div><span>Cuota base</span><strong>${formatCurrency(fee.fee_amount)}</strong></div>
        <div><span>Interés moratorio</span><strong>${formatCurrency(fee.interest_amount)}</strong></div>
        <div><span>Total pagado</span><strong>${formatCurrency(paid)}</strong></div>
        <div><span>Saldo</span><strong>${formatCurrency(balanceFor(fee))}</strong></div>
      </div>
      <div class="table-responsive" style="margin-top: 1rem;">
        <table class="data-table pagos-table">
          <thead><tr><th>Fecha</th><th>Monto</th><th>Método</th><th>N.º operación</th><th>Registró</th><th>Observaciones</th><th>Estado</th><th style="text-align:right;">Acciones</th></tr></thead>
          <tbody>
            ${list.map(p => {
              const voided = p.status === 'RECHAZADO';
              const reason = voided ? String(p.notes || '').split('[ANULADO').pop() : '';
              return `
              <tr style="${voided ? 'opacity: 0.6;' : ''}">
                <td>${formatDate(p.payment_date)}</td>
                <td style="white-space: nowrap;"><strong style="${voided ? 'text-decoration: line-through;' : ''}">${formatCurrency(p.amount)}</strong></td>
                <td>${esc(p.method)}</td>
                <td>${esc(p.operation_number || '-')}</td>
                <td>${esc(p.registered_by || '-')}</td>
                <td style="white-space: pre-line; min-width: 90px;">${esc(String(p.notes || '').split('[ANULADO')[0].trim()) || '<span style="color: var(--text-dim);">—</span>'}</td>
                <td>${voided
                  ? `<span class="badge badge-danger">Anulado</span><div class="cell-note">${esc(reason ? '[ANULADO' + reason : '')}</div>`
                  : '<span class="badge badge-success">Válido</span>'}</td>
                <td style="text-align:right; white-space:nowrap;">
                  <button class="btn btn-outline btn-sm" data-act="proof" data-id="${esc(p.id)}"><i data-lucide="paperclip"></i> ${p.proof_file_path ? 'Comprobante' : 'Adjuntar'}</button>
                  ${canVoid && !voided ? `<button class="btn btn-outline btn-sm" data-act="void" data-id="${esc(p.id)}" style="color: var(--status-danger);"><i data-lucide="ban"></i> Anular</button>` : ''}
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <p class="cell-note" style="margin-top: 0.75rem;">Un pago anulado no se borra: queda en la lista como "Anulado" con su motivo y no cuenta en los totales.</p>`;
    if (window.lucide) window.lucide.createIcons();

    modalBody.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', async () => {
      const payment = data.payments.find(p => String(p.id) === btn.dataset.id);
      if (!payment) return;
      if (btn.dataset.act === 'proof') { openProofModal(payment, fee); return; }

      const reason = await promptDialog({
        title: 'Anular pago',
        message: `Se anulará el pago de ${formatCurrency(payment.amount)} del ${formatDate(payment.payment_date)}. Escriba el motivo (obligatorio).`,
        label: 'Motivo de la anulación', placeholder: 'Ej: monto mal digitado', confirmText: 'Continuar'
      });
      if (reason === null) return;
      if (reason.trim().length < 3) { alertDialog({ tone: 'warning', message: 'Escriba un motivo de al menos 3 letras.' }); return; }
      const ok = await confirmDialog({
        title: 'Confirmar anulación',
        message: `¿Anular el pago de ${formatCurrency(payment.amount)}? Si la cuota estaba pagada, volverá a quedar pendiente por la diferencia.`,
        confirmText: 'Anular pago', danger: true
      });
      if (!ok) return;
      try {
        await feeService.voidPayment(payment.id, reason.trim());
        await refresh();
        const freshFee = data.fees.find(f => f.id === fee.id);
        if (freshFee) openPaymentsModal(freshFee); else modalOverlay.classList.add('hidden');
      } catch (err) {
        alertDialog({ tone: 'danger', title: 'No se pudo anular', message: err.message });
      }
    }));
  }

  /* ---------------- modal: ver / descargar / reemplazar comprobante ---------------- */

  async function openProofModal(payment, backFee = null) {
    const modalOverlay = document.getElementById('modal-container');
    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');

    modalTitle.innerHTML = `<i data-lucide="paperclip" style="color: var(--primary);"></i> Comprobante de pago`;
    modalOverlay.classList.remove('hidden');
    document.getElementById('modal-close-btn').onclick = () => modalOverlay.classList.add('hidden');

    modalBody.innerHTML = `
      <div class="fee-info-box">
        <div><span>Departamento</span><strong>Dpto ${esc(payment.unit_code)}</strong></div>
        <div><span>Período</span><strong>${esc(payment.period)}</strong></div>
        <div><span>Monto</span><strong>${formatCurrency(payment.amount)}</strong></div>
        <div><span>Fecha de pago</span><strong>${formatDate(payment.payment_date)}</strong></div>
        <div><span>Método</span><strong>${esc(payment.method)}</strong></div>
        <div><span>N.º operación</span><strong>${esc(payment.operation_number || '-')}</strong></div>
      </div>
      <div id="proof-view" class="proof-view">Cargando comprobante...</div>
      <div id="proof-error" class="form-error" hidden></div>
      <div style="display: flex; gap: 0.75rem; justify-content: flex-end; flex-wrap: wrap; margin-top: 1rem;">
        ${backFee ? '<button type="button" class="btn btn-secondary btn-sm" id="proof-back"><i data-lucide="arrow-left"></i> Volver a los pagos</button>' : ''}
        <span id="proof-actions"></span>
        <label class="btn btn-outline btn-sm" for="proof-replace-input">
          <i data-lucide="upload"></i> ${payment.proof_file_path ? 'Reemplazar comprobante' : 'Adjuntar comprobante'}
        </label>
        <input type="file" id="proof-replace-input" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" hidden>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();

    const showError = msg => { const b = document.getElementById('proof-error'); b.textContent = msg || ''; b.hidden = !msg; };
    document.getElementById('proof-back')?.addEventListener('click', () => {
      const freshFee = data.fees.find(f => f.id === backFee.id) || backFee;
      openPaymentsModal(freshFee);
    });

    document.getElementById('proof-replace-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const err = feeService.validateProofFile(file);
      if (err) { e.target.value = ''; showError(err); return; }
      showError('');
      try {
        document.getElementById('proof-view').textContent = 'Subiendo comprobante...';
        await feeService.attachProof(payment, file);
        await refresh();
        const fresh = data.payments.find(p => String(p.id) === String(payment.id)) || payment;
        openProofModal(fresh, backFee);
      } catch (error) {
        showError(error.message);
        document.getElementById('proof-view').textContent = '';
      }
    });

    const view = document.getElementById('proof-view');
    if (!payment.proof_file_path) {
      view.innerHTML = '<span class="cell-note">Este pago aún no tiene comprobante adjunto.</span>';
      return;
    }
    try {
      const access = await feeService.getProofAccess(payment);
      if (access.unavailable) {
        view.innerHTML = `<span class="cell-note">${esc(access.name)} · la vista previa no está disponible después de recargar (modo demo local). En Supabase el archivo queda guardado en Storage.</span>`;
        return;
      }
      view.innerHTML = access.isImage
        ? `<img src="${access.url}" alt="Comprobante" class="proof-full">`
        : `<div class="cell-note" style="margin-bottom:.5rem;">${esc(access.name)}</div><iframe src="${access.url}" class="proof-frame" title="Comprobante PDF"></iframe>`;
      document.getElementById('proof-actions').innerHTML = `
        <a class="btn btn-primary btn-sm" href="${access.downloadUrl}" download="${esc(access.name)}" target="_blank" rel="noopener">
          <i data-lucide="download"></i> Descargar
        </a>`;
      if (window.lucide) window.lucide.createIcons();
    } catch (err) {
      view.innerHTML = '';
      showError(err.message);
    }
  }

  load();
  return container;
}
