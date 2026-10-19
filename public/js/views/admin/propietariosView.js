/* Administradora Owners Directory View */
import { store } from '../../store.js';

export function renderAdminPropietarios() {
  const units = store.state.units;

  const container = document.createElement('div');
  container.className = 'fade-in';

  container.innerHTML = `
    <div class="card" style="margin-bottom: 1.5rem;">
      <div class="card-header">
        <h2 class="card-title"><i data-lucide="users"></i> Directorio de Propietarios (52 Departamentos)</h2>
        <span class="badge badge-building">PARKE10</span>
      </div>
      <p>Padrón oficial de propietarios y residentes del edificio PARKE10.</p>
    </div>

    <div class="card">
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Dpto</th>
              <th>Piso</th>
              <th>Propietario Titular</th>
              <th>Teléfono</th>
              <th>Correo Electrónico</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            ${units.map(unit => `
              <tr>
                <td><strong style="color: var(--primary);">Dpto ${unit.code}</strong></td>
                <td>Piso ${unit.floor}</td>
                <td><strong>${unit.owner_name}</strong></td>
                <td>${unit.phone}</td>
                <td>${unit.email}</td>
                <td><span class="badge badge-success">${unit.status}</span></td>
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
