/* Administradora Building Parameters Configuration View */
import { store } from '../../store.js';
import { buildingService } from '../../services/buildingService.js';
import { alertDialog } from '../../ui/dialog.js';

export function renderAdminConfiguracion() {
  const bld = buildingService.getBuildingInfo();

  const container = document.createElement('div');
  container.className = 'fade-in';

  container.innerHTML = `
    <div class="card" style="margin-bottom: 1.5rem;">
      <div class="card-header">
        <h2 class="card-title"><i data-lucide="settings"></i> Configuración de Parámetros del Edificio</h2>
        <span class="badge badge-building">PARKE10 - Arequipa</span>
      </div>
      <p>Ajusta los parámetros arquitectónicos y operativos del edificio según se vayan definiendo.</p>
    </div>

    <div class="card" style="max-width: 720px;">
      <h3 class="card-title" style="margin-bottom: 1.25rem; color: var(--primary);">
        <i data-lucide="sliders"></i> Especificaciones del Edificio
      </h3>

      <form id="building-config-form">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem;">
          <div class="form-group">
            <label class="form-label">Nombre del Edificio</label>
            <input type="text" id="cfg-name" class="form-control" value="${bld.name}" required>
          </div>

          <div class="form-group">
            <label class="form-label">Código de Edificio</label>
            <input type="text" id="cfg-code" class="form-control" value="${bld.code}" required>
          </div>

          <div class="form-group">
            <label class="form-label">Número de Departamentos</label>
            <input type="number" id="cfg-units" class="form-control" value="${bld.total_units}" required>
          </div>

          <div class="form-group">
            <label class="form-label">Número de Pisos</label>
            <input type="number" id="cfg-floors" class="form-control" value="${bld.total_floors}" required>
          </div>

          <div class="form-group">
            <label class="form-label">Número de Ascensores (Configurable)</label>
            <input type="number" id="cfg-elevators" class="form-control" value="${bld.elevators_count || 2}">
          </div>

          <div class="form-group">
            <label class="form-label">Cantidad de Estacionamientos (Configurable)</label>
            <input type="number" id="cfg-parkings" class="form-control" value="${bld.parking_spots_count || 52}">
          </div>

          <div class="form-group">
            <label class="form-label">Cantidad de Sótanos (Configurable)</label>
            <input type="number" id="cfg-basements" class="form-control" value="${bld.basements_count || 2}">
          </div>

          <div class="form-group">
            <label class="form-label">Puertas de Garaje (Configurable)</label>
            <input type="number" id="cfg-garage-doors" class="form-control" value="${bld.garage_doors_count || 2}">
          </div>
        </div>

        <div class="form-group" style="margin-top: 1rem;">
          <label class="form-label">Dirección Completa</label>
          <input type="text" id="cfg-address" class="form-control" value="${bld.address}">
        </div>

        <div style="display: flex; gap: 1rem; justify-content: flex-end; margin-top: 1.5rem;">
          <button type="submit" class="btn btn-primary">
            <i data-lucide="save"></i> Guardar Cambios de Configuración
          </button>
        </div>
      </form>
    </div>
  `;

  setTimeout(() => {
    container.querySelector('#building-config-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      buildingService.updateBuildingConfig({
        name: container.querySelector('#cfg-name').value,
        code: container.querySelector('#cfg-code').value,
        total_units: parseInt(container.querySelector('#cfg-units').value, 10),
        total_floors: parseInt(container.querySelector('#cfg-floors').value, 10),
        elevators_count: parseInt(container.querySelector('#cfg-elevators').value, 10),
        parking_spots_count: parseInt(container.querySelector('#cfg-parkings').value, 10),
        basements_count: parseInt(container.querySelector('#cfg-basements').value, 10),
        garage_doors_count: parseInt(container.querySelector('#cfg-garage-doors').value, 10),
        address: container.querySelector('#cfg-address').value
      });

      alertDialog({ tone: 'success', title: 'Parámetros guardados', message: 'Los parámetros del edificio se actualizaron correctamente.' });
      store.setView('admin-configuracion');
    });

    if (window.lucide) window.lucide.createIcons();
  }, 0);

  return container;
}
