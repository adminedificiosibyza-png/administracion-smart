/* Administradora Reports View */
import { store } from '../../store.js';
import { feeService } from '../../services/feeService.js';
import { formatCurrency, formatDate } from '../../config.js';

export function renderAdminReportes() {
  const stats = feeService.getCollectionDashboardStats();
  const fees = feeService.getFeesForPeriod(); // período vigente (el reporte es de un solo mes)

  const container = document.createElement('div');
  container.className = 'fade-in';

  container.innerHTML = `
    <div class="card" style="margin-bottom: 1.5rem;">
      <div class="card-header">
        <h2 class="card-title"><i data-lucide="bar-chart-3"></i> Reportes Financieros y de Cobranza</h2>
        <div style="display: flex; gap: 0.5rem;">
          <button class="btn btn-outline btn-sm" onclick="window.print();">
            <i data-lucide="printer"></i> Imprimir / Exportar a PDF
          </button>
          <button class="btn btn-outline btn-sm" onclick="window.appAlert({ title: 'Exportar a Excel', message: 'Exportando Reporte_Octubre_2026.csv a Excel...' });">
            <i data-lucide="file-spreadsheet"></i> Exportar a Excel
          </button>
        </div>
      </div>
      <p>Generación de reportes mensuales consolidado de facturación, cobros e morosidad del edificio PARKE10.</p>
    </div>

    <!-- Summary Box -->
    <div class="card" style="margin-bottom: 1.5rem; border-left: 5px solid var(--primary);">
      <h3 class="card-title" style="margin-bottom: 1rem;">
        📊 Resumen de Reporte de Cobranza Mensual — OCTUBRE 2026
      </h3>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem;">
        <div class="stat-item">
          <span class="stat-label">Total Facturado</span>
          <span class="stat-value">${formatCurrency(stats.totalExpected)}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label" style="color: var(--primary);">Total Cobrado</span>
          <span class="stat-value" style="color: var(--primary);">${formatCurrency(stats.totalCollected)}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label" style="color: var(--status-danger);">Total Pendiente</span>
          <span class="stat-value highlight-danger">${formatCurrency(stats.totalPending)}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Porcentaje Cobranza</span>
          <span class="stat-value" style="color: var(--primary);">${stats.collectionPercentage}%</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Propietarios Al Día</span>
          <span class="stat-value" style="color: var(--status-success);">${stats.countPaid}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Propietarios Morosos</span>
          <span class="stat-value" style="color: var(--status-danger);">${stats.countPending}</span>
        </div>
      </div>
    </div>

    <!-- Detailed Department Breakdown -->
    <div class="card">
      <h3 class="card-title" style="margin-bottom: 1rem;">
        <i data-lucide="list"></i> Detalle General por Departamento
      </h3>

      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Dpto</th>
              <th>Propietario</th>
              <th>Período</th>
              <th>Cuota Base</th>
              <th>Interés Mora</th>
              <th>Total Cobrado / Pendiente</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            ${fees.map(f => `
              <tr>
                <td><strong>Dpto ${f.unit_code}</strong></td>
                <td>${f.owner_name}</td>
                <td>${f.period}</td>
                <td>${formatCurrency(f.fee_amount)}</td>
                <td>${f.interest_amount > 0 ? formatCurrency(f.interest_amount) : '-'}</td>
                <td><strong>${formatCurrency(f.total_amount)}</strong></td>
                <td>
                  <span class="badge ${f.status === 'PAGADO' ? 'badge-success' : 'badge-danger'}">
                    ${f.status}
                  </span>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  setTimeout(() => {
    if (window.lucide) window.lucide.createIcons();
  }, 0);

  return container;
}
