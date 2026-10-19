/* Administradora Dashboard View */
import { store } from '../../store.js';
import { feeService } from '../../services/feeService.js';
import { buildingService } from '../../services/buildingService.js';
import { reservationService } from '../../services/reservationService.js';
import { activeBuilding } from '../../services/activeBuilding.js';
import { isSupabaseConnected } from '../../supabaseClient.js';
import { periodLabel } from '../../mockData.js';
import { formatCurrency, formatDate } from '../../config.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MONTH_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// Aviso dentro del panel por cada solicitud de reserva pendiente (solo datos de demostración por ahora)
function renderReservationNotices() {
  const pending = reservationService.getPendingRequests();
  if (!pending.length) return '';
  const shown = pending.slice(0, 3);
  return `
    <div class="card notice-card" style="margin-bottom: 1.5rem;">
      <div class="card-header" style="margin-bottom: 0.5rem;">
        <h3 class="card-title"><i data-lucide="bell"></i> Nueva solicitud de reserva (${pending.length})</h3>
        <button class="btn btn-primary btn-sm" data-goto-requests>Revisar solicitudes</button>
      </div>
      <ul class="notice-list">
        ${shown.map(r => `<li>Dpto. ${r.unit_code} solicita reservar la ${r.area_name} para el ${formatDate(r.date)} de ${r.start_time} a ${r.end_time}.</li>`).join('')}
        ${pending.length > shown.length ? `<li>y ${pending.length - shown.length} más.</li>` : ''}
      </ul>
    </div>
  `;
}

function heroHTML(subtitleHTML) {
  return `
    <div class="portal-hero">
      <div class="portal-hero-title">
        <h2>Panel de Gestión Administrativa</h2>
        <p>${subtitleHTML}</p>
      </div>
      <span class="badge badge-building"><i data-lucide="shield"></i> Modo Administradora</span>
    </div>`;
}

/** Tarjeta de indicadores. `s` usa los nombres de computeStats (demostración) o del resumen real. */
function metricsHTML(stats, title, extra = {}) {
  const pct = Math.min(100, Math.max(0, Number(stats.collectionPercentage)));
  return `
    <div class="card collection-meter-card" style="margin-bottom: 1.5rem; border-left: 5px solid var(--primary);">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 1rem;">
        <div>
          <span class="badge badge-building" style="margin-bottom: 0.5rem;">DASHBOARD DE COBRANZA</span>
          <h3 style="font-size: 1.35rem; font-weight: 800;">${esc(title)}</h3>
          <p style="font-size: 0.85rem; color: var(--text-muted);">Cálculo automático de porcentajes y morosidad en tiempo real.</p>
        </div>

        <div style="text-align: right;">
          <span style="font-size: 0.8rem; color: var(--text-dim); display: block;">PORCENTAJE DE COBRANZA</span>
          <span style="font-size: 2.25rem; font-weight: 800; color: var(--primary); font-family: var(--font-family-headings);">
            ${Number(stats.collectionPercentage).toFixed(2)} %
          </span>
        </div>
      </div>

      <div class="progress-bar-bg">
        <div class="progress-bar-fill" style="width: ${pct}%;"></div>
      </div>

      <div class="metrics-strip">
        <div class="stat-item">
          <span class="stat-label">Total Departamentos</span>
          <span class="stat-value">${stats.totalUnits}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label" style="color: var(--status-success);">Pagados</span>
          <span class="stat-value" style="color: var(--status-success);">${stats.countPaid}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label" style="color: var(--status-danger);">Pendientes</span>
          <span class="stat-value" style="color: var(--status-danger);">${stats.countPending}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Total Esperado</span>
          <span class="stat-value">${formatCurrency(stats.totalExpected)}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label" style="color: var(--primary);">Total Cobrado</span>
          <span class="stat-value" style="color: var(--primary);">${formatCurrency(stats.totalCollected)}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label" style="color: var(--status-danger);">Pendiente por Cobrar</span>
          <span class="stat-value highlight-danger">${formatCurrency(stats.totalPending)}</span>
        </div>
        ${extra.moraTotal !== undefined ? `
        <div class="stat-item">
          <span class="stat-label" style="color: var(--status-danger);">Mora total</span>
          <span class="stat-value ${extra.moraTotal > 0 ? 'highlight-danger' : ''}">${formatCurrency(extra.moraTotal)}</span>
          <span class="cell-note">cobrada ${formatCurrency(extra.moraCollected)} · por cobrar ${formatCurrency(extra.moraInBalance)}</span>
        </div>` : ''}
      </div>
    </div>`;
}

/* ---------------- Gráficos (HTML/SVG propios, sin librerías) ---------------- */

// Gráfico del mes: barras horizontales esperado / cobrado
function monthChartHTML(s, label) {
  const max = Math.max(s.expected, s.collected, 1);
  const bar = (name, value, cls, scale = max) => `
    <div class="hbar-row">
      <span class="hbar-label">${name}</span>
      <div class="hbar-track"><div class="hbar-fill ${cls}" style="width: ${(value / scale) * 100}%;"></div></div>
      <span class="hbar-value">${formatCurrency(value)}</span>
    </div>`;
  // La mora es mucho menor que la cuota: tiene su propia escala para que se pueda leer
  const moraTotal = Math.round((s.moraInBalance + s.moraCollected) * 100) / 100;
  const moraBar = (name, value, cls) => bar(name, value, cls, Math.max(moraTotal, 1));
  return `
    <div class="card chart-card" style="margin-bottom: 1.5rem;">
      <h3 class="chart-title">COBRANZA DEL MES — ${esc(label.toUpperCase())}</h3>
      ${bar('Total esperado', s.expected, 'expected')}
      ${bar('Total cobrado', s.collected, 'collected')}
      ${moraTotal > 0 ? `
      <h4 class="chart-subtitle">Mora del mes</h4>
      ${moraBar('Mora generada', moraTotal, 'mora')}
      ${moraBar('Mora cobrada', s.moraCollected, 'mora-paid')}` : ''}
      <div class="chart-footnote">
        <span>Pendiente por cobrar: <strong class="${s.balance > 0 ? 'highlight-danger' : ''}">${formatCurrency(s.balance)}</strong></span>
      </div>
    </div>`;
}

// Escala "bonita" para el eje vertical (1, 2, 5 × 10^n)
function niceMax(value) {
  if (value <= 0) return 100;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  const f = value / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
}

const shortMoney = n => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.0', '')}k` : String(Math.round(n));

// Gráfico anual: 12 meses, barras agrupadas esperado / cobrado
function yearChartSVG(series, year) {
  const W = 720, H = 300, left = 52, right = 10, top = 16, bottom = 34;
  const plotW = W - left - right, plotH = H - top - bottom;
  const max = niceMax(Math.max(...series.map(m => Math.max(m.expected, m.collected))));
  const y = v => top + plotH - (v / max) * plotH;
  const group = plotW / 12;
  const barW = group * 0.3;

  const grid = [0, 0.25, 0.5, 0.75, 1].map(t => {
    const v = max * t;
    return `<line x1="${left}" x2="${W - right}" y1="${y(v)}" y2="${y(v)}" class="grid-line"/>
            <text x="${left - 6}" y="${y(v) + 3}" text-anchor="end" class="axis-text">${shortMoney(v)}</text>`;
  }).join('');

  const bars = series.map((m, i) => {
    const x0 = left + i * group + group / 2;
    const name = periodLabel(m.month);
    const tip = m.hasData
      ? `${name}: esperado ${formatCurrency(m.expected)}, cobrado ${formatCurrency(m.collected)}`
      : `${name}: sin datos`;
    const label = `<text x="${x0}" y="${H - 14}" text-anchor="middle" class="axis-text ${m.hasData ? '' : 'dim'}">${MONTH_SHORT[i]}</text>`;
    if (!m.hasData) {
      return `<g><title>${esc(tip)}</title>${label}<text x="${x0}" y="${top + plotH - 6}" text-anchor="middle" class="axis-text dim">—</text></g>`;
    }
    const hE = plotH - (y(m.expected) - top), hC = plotH - (y(m.collected) - top);
    return `<g><title>${esc(tip)}</title>
      <rect x="${x0 - barW - 1}" y="${y(m.expected)}" width="${barW}" height="${hE}" rx="2" class="bar-expected"/>
      <rect x="${x0 + 1}" y="${y(m.collected)}" width="${barW}" height="${hC}" rx="2" class="bar-collected"/>
      ${m.expected > 0 ? `<text x="${x0 - barW / 2 - 1}" y="${y(m.expected) - 3}" text-anchor="middle" class="bar-value">${shortMoney(m.expected)}</text>` : ''}
      ${m.collected > 0 ? `<text x="${x0 + barW / 2 + 1}" y="${y(m.collected) - 3}" text-anchor="middle" class="bar-value">${shortMoney(m.collected)}</text>` : ''}
      ${label}</g>`;
  }).join('');

  const summary = series.filter(m => m.hasData)
    .map(m => `${periodLabel(m.month)}: esperado ${formatCurrency(m.expected)}, cobrado ${formatCurrency(m.collected)}`).join('. ') || 'Sin datos';
  return `<svg viewBox="0 0 ${W} ${H}" class="year-chart" role="img" aria-label="Cobranza anual ${year}. ${esc(summary)}" preserveAspectRatio="xMidYMid meet">${grid}${bars}</svg>`;
}

/* ---------------- Con Supabase: datos reales del edificio elegido ---------------- */

async function fillLiveDashboard(container) {
  const building = activeBuilding.get();
  if (!building) return;

  container.innerHTML = '<div class="card" style="text-align:center; color: var(--text-dim);">Cargando panel...</div>';

  let raw;
  try {
    raw = await feeService.loadCobranza();
  } catch (err) {
    container.innerHTML = `<div class="card" style="text-align:center;"><p style="color: var(--status-danger);">${esc(err.message)}</p></div>`;
    return;
  }

  // Solo lo de este edificio; cada pago se asocia a su cuota (y por ella, a su período)
  const fees = raw.fees.filter(f => f.building_id === building.id);
  const feeIds = new Set(fees.map(f => f.id));
  const payments = raw.payments.filter(p => p.building_id === building.id || feeIds.has(p.fee_id));

  const now = new Date();
  const currentYear = now.getFullYear();
  const state = {
    month: fees.length ? feeService.getDefaultPeriod(fees) : `${currentYear}-${String(now.getMonth() + 1).padStart(2, '0')}-01`,
  };
  state.year = Number(state.month.slice(0, 4));

  // Meses seleccionables: los que tienen cuotas + todos los del año en curso
  const monthSet = new Set(fees.map(f => f.period_month));
  for (let m = 1; m <= 12; m++) monthSet.add(`${currentYear}-${String(m).padStart(2, '0')}-01`);
  monthSet.add(state.month);
  const monthOptions = [...monthSet].sort().reverse();

  const yearSet = new Set(fees.map(f => Number(f.period_month.slice(0, 4))));
  yearSet.add(currentYear);
  yearSet.add(state.year);
  const yearOptions = [...yearSet].sort((a, b) => b - a);

  const structure = (building.total_units != null && building.total_floors != null)
    ? ` • <strong>${building.total_units} Departamentos (${building.total_floors} Pisos)</strong>` : '';

  container.innerHTML = `
    ${heroHTML(`Edificio <strong>${esc(building.name)}</strong>${building.city ? ' • ' + esc(building.city) : ''}${structure}`)}

    <div class="dash-toolbar">
      <h3>Dashboard de cobranza</h3>
      <label class="dash-select">
        <span>Período</span>
        <select id="dash-month" class="form-select">
          ${monthOptions.map(m => `<option value="${m}" ${m === state.month ? 'selected' : ''}>${esc(periodLabel(m))}</option>`).join('')}
        </select>
      </label>
    </div>

    <div id="dash-summary"></div>
    <div id="dash-month-chart"></div>

    <div class="card chart-card">
      <div class="chart-head">
        <h3 class="chart-title" id="dash-year-title"></h3>
        <label class="dash-select">
          <span>Año</span>
          <select id="dash-year" class="form-select">
            ${yearOptions.map(y => `<option value="${y}" ${y === state.year ? 'selected' : ''}>${y}</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="chart-legend">
        <span><i class="swatch expected"></i> Total esperado</span>
        <span><i class="swatch collected"></i> Total cobrado</span>
      </div>
      <div class="chart-scroll" id="dash-year-chart"></div>
    </div>`;

  // Resumen y gráfico del mes: dependen solo del selector de período
  const renderMonth = () => {
    const label = periodLabel(state.month);
    const monthFees = fees.filter(f => f.period_month === state.month);
    const s = feeService.computeCollectionSummary(monthFees, payments);

    container.querySelector('#dash-summary').innerHTML =
      metricsHTML({
        totalUnits: s.totalUnits, countPaid: s.countPaid, countVerifying: s.countVerifying, countPending: s.countPending,
        totalExpected: s.expected, totalCollected: s.collected, totalPending: s.balance,
        collectionPercentage: s.percentage
      }, `CUOTAS — ${label.toUpperCase()}`, {
        verifyingAmount: s.verifying, moraCollected: s.moraCollected, moraInBalance: s.moraInBalance,
        moraTotal: Math.round((s.moraInBalance + s.moraCollected) * 100) / 100
      }) +
      (monthFees.length ? '' : `
        <div class="card notice-card" style="margin: -0.75rem 0 1.5rem;">
          <p style="color: var(--text-main);">No hay cuotas registradas para <strong>${esc(label)}</strong>; por eso los valores están en cero.
          Puede generarlas desde el Listado de Cobranza.</p>
        </div>`);

    container.querySelector('#dash-month-chart').innerHTML = monthChartHTML(s, label);
    if (window.lucide) window.lucide.createIcons();
  };

  // Gráfico anual: depende solo del selector de año
  const renderYear = () => {
    container.querySelector('#dash-year-title').textContent = `EVOLUCIÓN DE LA COBRANZA ANUAL — ${state.year}`;
    const series = feeService.computeYearSeries(fees, payments, state.year);
    container.querySelector('#dash-year-chart').innerHTML =
      series.some(m => m.hasData)
        ? yearChartSVG(series, state.year)
        : `<p class="chart-empty">No hay cuotas registradas en ${state.year}.</p>`;
  };

  container.querySelector('#dash-month').addEventListener('change', (e) => { state.month = e.target.value; renderMonth(); });
  container.querySelector('#dash-year').addEventListener('change', (e) => { state.year = Number(e.target.value); renderYear(); });

  renderMonth();
  renderYear();
  if (window.lucide) window.lucide.createIcons();
}

/* ---------------- Modo demostración (datos locales) ---------------- */

export function renderAdminDashboard() {
  const container = document.createElement('div');
  container.className = 'fade-in';

  if (isSupabaseConnected()) {
    fillLiveDashboard(container);
    return container;
  }

  const stats = feeService.getCollectionDashboardStats();
  const building = buildingService.getBuildingInfo();

  container.innerHTML = `
    ${heroHTML(`Edificio <strong>${building.name}</strong> • Arequipa, Perú • <strong>${building.total_units} Departamentos (${building.total_floors} Pisos)</strong>`)}

    ${renderReservationNotices()}

    ${metricsHTML(stats, `CUOTAS — ${periodLabel(feeService.getDefaultPeriod()).toUpperCase()}`)}

    <!-- Quick Admin Actions Bar -->
    <div style="display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.5rem;">
      <button class="btn btn-primary" id="btn-quick-pago">
        <i data-lucide="plus-circle"></i> Registrar Pago Manual
      </button>
      <button class="btn btn-secondary" id="btn-quick-bloqueo">
        <i data-lucide="lock"></i> Bloquear Horario Área Común
      </button>
      <button class="btn btn-secondary" id="btn-quick-comunicado">
        <i data-lucide="megaphone"></i> Publicar Comunicado
      </button>
      <button class="btn btn-outline" id="btn-quick-reportes">
        <i data-lucide="bar-chart-3"></i> Generar Reporte Mensual
      </button>
    </div>

    <!-- Quick Overview Modules Grid -->
    <div class="grid-cards">
      <div class="card card-interactive" id="admin-nav-cobranza">
        <h3 class="card-title"><i data-lucide="dollar-sign" style="color: var(--status-warning);"></i> Listado de Cobranza</h3>
        <p>Ver y filtrar el estado individual de los 52 departamentos.</p>
      </div>

      <div class="card card-interactive" id="admin-nav-morosidad">
        <h3 class="card-title"><i data-lucide="percent" style="color: var(--status-danger);"></i> Reglas de Interés Moratorio</h3>
        <p>Configurar tasa de morosidad, días de gracia y fórmula de cálculo.</p>
      </div>

      <div class="card card-interactive" id="admin-nav-reservas">
        <h3 class="card-title"><i data-lucide="calendar" style="color: var(--primary);"></i> Gestión de Reservas y Bloqueos</h3>
        <p>Ver calendario global y gestionar mantenimientos de áreas comunes.</p>
      </div>

      <div class="card card-interactive" id="admin-nav-propietarios">
        <h3 class="card-title"><i data-lucide="users" style="color: var(--primary);"></i> Directorio de Propietarios</h3>
        <p>Fichas individuales, teléfonos y correos de residentes.</p>
      </div>

      <div class="card card-interactive" id="admin-nav-config">
        <h3 class="card-title"><i data-lucide="settings" style="color: var(--primary);"></i> Parámetros del Edificio</h3>
        <p>Configurar ascensores, estacionamientos, sótanos y puertas de garaje.</p>
      </div>

      <div class="card card-interactive" id="admin-nav-auditoria">
        <h3 class="card-title"><i data-lucide="history" style="color: var(--text-muted);"></i> Registro de Auditoría</h3>
        <p>Trazabilidad de acciones administrativas realizadas en el sistema.</p>
      </div>
    </div>
  `;

  setTimeout(() => {
    container.querySelector('[data-goto-requests]')?.addEventListener('click', () => store.setView('admin-reservas'));
    container.querySelector('#btn-quick-pago')?.addEventListener('click', () => store.setView('admin-cobranza'));
    container.querySelector('#btn-quick-bloqueo')?.addEventListener('click', () => store.setView('admin-reservas'));
    container.querySelector('#btn-quick-comunicado')?.addEventListener('click', () => store.setView('admin-comunicados'));
    container.querySelector('#btn-quick-reportes')?.addEventListener('click', () => store.setView('admin-reportes'));

    container.querySelector('#admin-nav-cobranza')?.addEventListener('click', () => store.setView('admin-cobranza'));
    container.querySelector('#admin-nav-morosidad')?.addEventListener('click', () => store.setView('admin-morosidad'));
    container.querySelector('#admin-nav-reservas')?.addEventListener('click', () => store.setView('admin-reservas'));
    container.querySelector('#admin-nav-propietarios')?.addEventListener('click', () => store.setView('admin-propietarios'));
    container.querySelector('#admin-nav-config')?.addEventListener('click', () => store.setView('admin-configuracion'));
    container.querySelector('#admin-nav-auditoria')?.addEventListener('click', () => store.setView('admin-auditoria'));

    if (window.lucide) window.lucide.createIcons();
  }, 0);

  return container;
}
