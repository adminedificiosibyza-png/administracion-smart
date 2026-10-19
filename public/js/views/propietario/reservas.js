/* Propietario Common Area Reservation Booking View */
import { store } from '../../store.js';
import { reservationService } from '../../services/reservationService.js';
import { authService } from '../../services/authService.js';
import { formatDate } from '../../config.js';
import { alertDialog } from '../../ui/dialog.js';
import { liveReservations } from '../../services/reservationLive.js';
import { isSupabaseConnected } from '../../supabaseClient.js';

const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

const USE_CONDITIONS = [
  'La reserva corresponde únicamente al día y horario indicados en el presente formato.',
  'La actividad deberá finalizar a la hora señalada. Se establece una tolerancia máxima de 15 minutos exclusivamente para recoger las pertenencias, limpiar y retirarse, sin que ello implique una ampliación del horario reservado. Si el uso del área es exclusivamente para labores de limpieza, el responsable podrá permanecer el tiempo necesario para concluirlas, previa comunicación a la Administración y sin realizar ninguna otra actividad durante dicho periodo.',
  'El usuario deberá mantener el orden y la limpieza durante el uso del área y, al finalizar, dejarla limpia y ordenada, retirando toda basura, alimentos, bebidas, adornos, objetos y materiales utilizados.',
  'El usuario será responsable por los daños o deterioros ocasionados por él o por las personas que lo acompañen.',
  'Al finalizar el uso, el responsable deberá enviar a la Administración fotografías que evidencien que el área ha quedado limpia y ordenada. Estas serán revisadas dentro del horario de trabajo de la Administración.',
  'El usuario deberá respetar las normas de convivencia y las disposiciones internas del edificio. El incumplimiento podrá dar lugar a una advertencia y, en caso de reincidencia, a la suspensión temporal del derecho a reservar el área común, sin perjuicio de otras medidas que correspondan conforme a las normas internas.'
];

const USER_DECLARATION = 'Declaro que conozco y acepto las condiciones de uso del área común y me hago responsable de su adecuado uso durante el período reservado, así como de las personas que me acompañen. Asimismo, me comprometo expresamente a entregar el área limpia, ordenada y libre de residuos al finalizar la actividad.';

function toMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function pad(n) { return String(n).padStart(2, '0'); }

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Opciones de hora cada 30 minutos entre open y close (inclusive)
function buildTimeOptions(open, close) {
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const out = [];
  for (let m = toMin(open); m <= toMin(close); m += 30) {
    out.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
  }
  return out;
}

// 08:00 -> 8:00 a.m.
function to12h(t) {
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'p.m.' : 'a.m.';
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(m)} ${suffix}`;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function renderPropietarioReservas() {
  const user = await authService.getCurrentUser();
  const live = isSupabaseConnected() && !!authService.getContext();
  // Con Supabase las áreas y los horarios ocupados salen de la base de datos; la lógica de horarios es la misma
  const svc = live ? liveReservations : reservationService;

  const container = document.createElement('div');
  container.className = 'fade-in';

  const notice = (title, text) => {
    container.innerHTML = `<div class="card" style="max-width: 640px;"><h2 class="card-title" style="margin-bottom:0.5rem;"><i data-lucide="calendar"></i> ${title}</h2><p>${text}</p></div>`;
    setTimeout(() => { if (window.lucide) window.lucide.createIcons(); }, 0);
    return container;
  };

  if (live) {
    const active = authService.getActiveAssignment();
    if (!active) return notice('Sin departamento asignado', 'Todavía no tiene un departamento asignado. Comuníquese con la administración.');
    try {
      await svc.loadAreas(active.building_id);
    } catch (err) {
      return notice('No se pudo cargar', esc(err.message));
    }
  }

  const areas = svc.getCommonAreas();
  if (!areas.length) return notice('Reservar Área Común', 'Este edificio todavía no tiene áreas comunes habilitadas para reservar.');
  let area = areas[0];

  let selectedDate = todayStr();
  let startTime = '';
  let endTime = '';
  let acceptedTerms = false;
  let phone = user.phone || '';
  let motive = '';
  let viewYear = new Date().getFullYear();
  let viewMonth = new Date().getMonth();

  function calendarHTML() {
    const first = new Date(viewYear, viewMonth, 1);
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const offset = (first.getDay() + 6) % 7; // semana inicia en lunes
    const today = todayStr();

    let cells = '';
    for (let i = 0; i < offset; i++) cells += '<span class="cal-cell cal-empty"></span>';
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${viewYear}-${pad(viewMonth + 1)}-${pad(d)}`;
      const status = svc.getDayStatus(area.id, dateStr);
      const isPast = dateStr < today;
      const cls = [
        'cal-cell',
        'cal-day',
        status === 'RESERVADO' ? 'cal-reserved' : '',
        status === 'BLOQUEADO' ? 'cal-blocked' : '',
        dateStr === today ? 'cal-today' : '',
        dateStr === selectedDate ? 'cal-selected' : '',
        isPast ? 'cal-past' : ''
      ].filter(Boolean).join(' ');
      const label = status === 'RESERVADO' ? 'Reservado' : (status === 'BLOQUEADO' ? 'No disponible' : 'Disponible');
      cells += `<button type="button" class="${cls}" data-date="${dateStr}" ${isPast ? 'disabled' : ''} title="${label}" aria-label="${d} de ${MONTH_NAMES[viewMonth]}: ${label}">${d}</button>`;
    }

    return `
      <div class="cal-header">
        <button type="button" class="btn-icon" id="cal-prev" aria-label="Mes anterior"><i data-lucide="chevron-left"></i></button>
        <strong>${MONTH_NAMES[viewMonth]} ${viewYear}</strong>
        <button type="button" class="btn-icon" id="cal-next" aria-label="Mes siguiente"><i data-lucide="chevron-right"></i></button>
      </div>
      <div class="cal-grid">
        ${WEEKDAYS.map(w => `<span class="cal-cell cal-weekday">${w}</span>`).join('')}
        ${cells}
      </div>
      <div class="cal-legend">
        <span><i class="cal-dot cal-dot-free"></i> Disponible</span>
        <span><i class="cal-dot cal-dot-reserved"></i> Con reservas</span>
        <span><i class="cal-dot cal-dot-blocked"></i> No disponible</span>
      </div>
    `;
  }

  function renderContent() {
    const sch = svc.getScheduleForDate(area.id, selectedDate);
    const options = sch ? buildTimeOptions(sch.open, sch.close) : [];
    // Si el horario elegido ya no es válido para la fecha, se limpia
    if (startTime && !options.slice(0, -1).includes(startTime)) startTime = '';
    if (endTime && (!options.includes(endTime) || (startTime && endTime <= startTime))) endTime = '';
    const occupied = svc.getOccupiedRanges(area.id, selectedDate);

    // Horas dentro de un rango ya reservado/bloqueado no se pueden elegir
    const busy = occupied.map(r => [toMin(r.start_time), toMin(r.end_time)]);
    const startFree = t => !busy.some(([s, e]) => toMin(t) < e && toMin(t) + 30 > s);
    const endFree = t => startTime
      ? !busy.some(([s, e]) => toMin(startTime) < e && toMin(t) > s)
      : !busy.some(([s, e]) => toMin(t) - 30 < e && toMin(t) > s);
    if (startTime && !startFree(startTime)) startTime = '';
    if (endTime && !endFree(endTime)) endTime = '';
    const optionHTML = (t, selected, free) =>
      `<option value="${t}" ${selected ? 'selected' : ''} ${free ? '' : 'disabled'}>${to12h(t)}${free ? '' : ' (ocupado)'}</option>`;

    container.innerHTML = `
      <div class="card" style="margin-bottom: 1.5rem;">
        <div class="card-header">
          <h2 class="card-title"><i data-lucide="calendar"></i> Reservar Área Común</h2>
          <button class="btn btn-outline btn-sm" id="btn-mis-reservas">
            <i data-lucide="bookmark-check"></i> Ver Mis Reservas
          </button>
        </div>
        <p>Elige la fecha y el horario de uso del área común. Tu reserva quedará pendiente hasta que la administración la apruebe.</p>
      </div>

      <!-- Área común -->
      <div class="card" style="margin-bottom: 1.5rem; display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;">
        <div style="width: 120px; height: 90px; border-radius: var(--radius-sm); overflow: hidden; flex-shrink: 0; background: var(--primary-soft); display: flex; align-items: center; justify-content: center; color: var(--primary);">
          ${area.image_url
            ? `<img src="${esc(area.image_url)}" alt="${esc(area.name)}" style="width: 100%; height: 100%; object-fit: cover;">`
            : '<i data-lucide="umbrella" style="width: 36px; height: 36px;"></i>'}
        </div>
        <div style="flex: 1; min-width: 200px;">
          <h3 style="font-size: 1.1rem; font-weight: 700; margin-bottom: 0.25rem;">${esc(area.name)}</h3>
          <p style="font-size: 0.85rem;">${esc(area.description || '')}</p>
        </div>
        ${areas.length > 1 ? `
        <div class="form-group" style="margin: 0; min-width: 220px;">
          <label class="form-label" for="area-select">Área común</label>
          <select id="area-select" class="form-select">
            ${areas.map(a => `<option value="${a.id}" ${a.id === area.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
          </select>
        </div>` : ''}
      </div>

      <!-- Horarios de uso (los de esta área) -->
      <div class="schedule-notice" style="margin-bottom: 1.5rem;">
        <h3><i data-lucide="clock"></i> Horario de uso — ${esc(area.name)}</h3>
        <ul>
          <li><span>Lunes a viernes</span><strong>de ${to12h(area.schedule.weekday.open)} a ${to12h(area.schedule.weekday.close)}</strong></li>
          <li><span>Sábados y domingos</span><strong>de ${to12h(area.schedule.weekend.open)} a ${to12h(area.schedule.weekend.close)}</strong></li>
        </ul>
      </div>

      <div class="reservation-layout" style="margin-bottom: 1.5rem;">
        <!-- Calendario compacto -->
        <div class="card">
          <h3 style="font-size: 1rem; font-weight: 700; margin-bottom: 0.75rem;">Disponibilidad del mes</h3>
          ${calendarHTML()}
        </div>

        <!-- Formulario de reserva -->
        <div class="card">
          <h3 class="card-title" style="margin-bottom: 1rem; color: var(--primary);">
            <i data-lucide="edit-3"></i> Formulario de Reserva
          </h3>

          <form id="reservation-form">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1rem;">
              <div class="form-group">
                <label class="form-label" for="reservation-date-input">Fecha</label>
                <input type="date" id="reservation-date-input" class="form-control" value="${selectedDate}" min="${todayStr()}" required>
              </div>
              <div class="form-group">
                <label class="form-label" for="form-start">Hora de inicio</label>
                <select id="form-start" class="form-select" required>
                  <option value="">Seleccionar</option>
                  ${options.slice(0, -1).map(t => optionHTML(t, t === startTime, startFree(t))).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label" for="form-end">Hora de término</label>
                <select id="form-end" class="form-select" required>
                  <option value="">Seleccionar</option>
                  ${options.slice(1).filter(t => !startTime || t > startTime).map(t => optionHTML(t, t === endTime, endFree(t))).join('')}
                </select>
              </div>
            </div>

            <p style="font-size: 0.8rem; margin-bottom: 1rem;">
              Para el ${formatDate(selectedDate)} el horario permitido es de
              <strong>${sch ? to12h(sch.open) : ''}</strong> a <strong>${sch ? to12h(sch.close) : ''}</strong>.
            </p>

            ${occupied.length ? `
              <div class="occupied-box">
                <strong>Horarios ya reservados ese día:</strong>
                <div class="occupied-list">
                  ${occupied.map(r => `<span class="badge badge-neutral">${to12h(r.start_time)} – ${to12h(r.end_time)} · ${r.type === 'BLOQUEADO' ? 'No disponible' : 'Reservado'}</span>`).join('')}
                </div>
              </div>` : ''}

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem;">
              <div class="form-group">
                <label class="form-label">Propietario / Residente</label>
                <input type="text" class="form-control" value="${user.name}" readonly>
              </div>
              <div class="form-group">
                <label class="form-label">Departamento</label>
                <input type="text" class="form-control" value="${user.unit}" readonly>
              </div>
              <div class="form-group">
                <label class="form-label">Teléfono de contacto</label>
                <input type="tel" id="form-phone" class="form-control" value="${phone}" minlength="7" required>
              </div>
            </div>

            <div class="form-group" style="margin-top: 0.5rem;">
              <label class="form-label">Actividad / Motivo</label>
              <input type="text" id="form-motive" class="form-control" value="${motive.replace(/"/g, '&quot;')}" placeholder="Ej: Tarde familiar o cumpleaños" required>
            </div>

            <!-- Condiciones de uso -->
            <div class="conditions-box">
              <h4>Condiciones de uso</h4>
              <ul>
                ${USE_CONDITIONS.map(c => `<li>${c}</li>`).join('')}
              </ul>
              <h4>Declaración y firma del usuario</h4>
              <p>${USER_DECLARATION}</p>
            </div>

            <!-- Mandatory Rules Acceptance Checkbox -->
            <div class="checkbox-group">
              <input type="checkbox" id="accept-rules-checkbox" ${acceptedTerms ? 'checked' : ''} required>
              <label for="accept-rules-checkbox" class="checkbox-label">
                Estoy conforme: declaro que conozco y acepto las condiciones de uso del área común y me comprometo a cumplirlas.
              </label>
            </div>

            <div style="display: flex; gap: 1rem; justify-content: flex-end; margin-top: 1rem;">
              <button type="submit" id="btn-submit-request" class="btn btn-primary" ${acceptedTerms ? '' : 'disabled style="opacity:.5;cursor:not-allowed;"'}><i data-lucide="send"></i> ENVIAR SOLICITUD</button>
            </div>
          </form>
        </div>
      </div>
    `;

    // Event listeners
    setTimeout(() => {
      container.querySelector('#btn-mis-reservas')?.addEventListener('click', () => {
        store.setView('propietario-mis-reservas');
      });

      container.querySelector('#area-select')?.addEventListener('change', (e) => {
        area = areas.find(a => a.id === e.target.value) || area;
        startTime = ''; endTime = '';
        go();
      });

      container.querySelector('#cal-prev')?.addEventListener('click', () => {
        viewMonth--;
        if (viewMonth < 0) { viewMonth = 11; viewYear--; }
        go();
      });
      container.querySelector('#cal-next')?.addEventListener('click', () => {
        viewMonth++;
        if (viewMonth > 11) { viewMonth = 0; viewYear++; }
        go();
      });

      container.querySelectorAll('.cal-day:not([disabled])').forEach(btn => {
        btn.addEventListener('click', () => {
          selectedDate = btn.getAttribute('data-date');
          renderContent();
        });
      });

      container.querySelector('#reservation-date-input')?.addEventListener('change', (e) => {
        if (!e.target.value) return;
        selectedDate = e.target.value;
        const [y, m] = selectedDate.split('-').map(Number);
        viewYear = y; viewMonth = m - 1;
        go();
      });

      container.querySelector('#form-start')?.addEventListener('change', (e) => {
        startTime = e.target.value;
        renderContent();
      });
      container.querySelector('#form-end')?.addEventListener('change', (e) => {
        endTime = e.target.value;
      });
      container.querySelector('#form-phone')?.addEventListener('input', (e) => { phone = e.target.value; });
      container.querySelector('#form-motive')?.addEventListener('input', (e) => { motive = e.target.value; });

      // El envío queda bloqueado hasta aceptar las condiciones
      container.querySelector('#accept-rules-checkbox')?.addEventListener('change', (e) => {
        acceptedTerms = e.target.checked;
        const btn = container.querySelector('#btn-submit-request');
        btn.disabled = !acceptedTerms;
        btn.style.opacity = acceptedTerms ? '' : '.5';
        btn.style.cursor = acceptedTerms ? '' : 'not-allowed';
      });

      container.querySelector('#reservation-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const phoneValue = container.querySelector('#form-phone').value.trim();
        const motiveValue = container.querySelector('#form-motive').value.trim();
        const accepted = container.querySelector('#accept-rules-checkbox').checked;
        if (!accepted) {
          alertDialog({ tone: 'warning', message: 'Debe aceptar las condiciones de uso para enviar la solicitud.' });
          return;
        }
        const start = container.querySelector('#form-start').value;
        const end = container.querySelector('#form-end').value;

        // Todos los datos son obligatorios: se avisa cuáles faltan antes de enviar
        const missing = [];
        if (!selectedDate) missing.push('fecha');
        if (!start) missing.push('hora de inicio');
        if (!end) missing.push('hora de término');
        if (phoneValue.replace(/\D/g, '').length < 7) missing.push('teléfono de contacto (mínimo 7 dígitos)');
        if (motiveValue.length < 3) missing.push('actividad / motivo');
        if (missing.length) {
          alertDialog({ tone: 'warning', title: 'Falta completar datos', message: `Complete todos los datos para enviar su solicitud: ${missing.join(', ')}.` });
          return;
        }

        const submitBtn = container.querySelector('#btn-submit-request');
        submitBtn.disabled = true; // evita enviar dos veces la misma solicitud
        try {
          const reservation = await svc.createReservation({
            areaId: area.id,
            date: selectedDate,
            startTime: start,
            endTime: end,
            unitCode: user.unit,
            unitId: user.unitId,
            ownerName: user.name,
            phone: phoneValue,
            motive: motiveValue,
            acceptedTerms: accepted
          });

          // Show Confirmation Modal with PK10-00001 code
          showConfirmationModal(reservation);
        } catch (err) {
          submitBtn.disabled = false;
          await alertDialog({ tone: 'danger', title: 'No se pudo enviar la solicitud', message: err.message });
          go(); // por si otro horario se ocupó mientras tanto: vuelve a traer la disponibilidad
        }
      });

      if (window.lucide) window.lucide.createIcons();
    }, 0);
  }

  // Con Supabase, cada cambio de mes o de área primero trae los horarios ocupados de ese mes
  async function go() {
    try {
      if (live) await svc.prepare(area.id, viewYear, viewMonth);
    } catch (err) {
      alertDialog({ tone: 'danger', message: err.message });
    }
    renderContent();
  }

  await go();
  return container;
}

function showConfirmationModal(reservation) {
  const modalOverlay = document.getElementById('modal-container');
  const modalTitle = document.getElementById('modal-title');
  const modalBody = document.getElementById('modal-body');

  modalTitle.innerHTML = `<i data-lucide="send" style="color: var(--primary);"></i> Solicitud enviada correctamente`;

  modalBody.innerHTML = `
    <p style="margin-bottom: 1rem;">Tu solicitud de reserva está pendiente de aprobación por la administración. Podrás ver si fue aprobada o rechazada en Mis Reservas.</p>
    <div class="voucher-card">
      <span class="badge badge-warning">ESTADO: PENDIENTE DE APROBACIÓN</span>
      <p style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.5rem;">Código de solicitud:</p>
      <div class="voucher-code">${reservation.code}</div>

      <div style="text-align: left; background: var(--bg-card); padding: 1rem; border-radius: var(--radius-sm); margin-top: 1rem; font-size: 0.9rem;">
        <p style="margin-bottom: 0.35rem;"><strong>Edificio:</strong> PARKE10</p>
        <p style="margin-bottom: 0.35rem;"><strong>Área:</strong> ${reservation.area_name}</p>
        <p style="margin-bottom: 0.35rem;"><strong>Fecha:</strong> ${formatDate(reservation.date)}</p>
        <p style="margin-bottom: 0.35rem;"><strong>Horario:</strong> ${to12h(reservation.start_time)} – ${to12h(reservation.end_time)}</p>
        <p style="margin-bottom: 0.35rem;"><strong>Departamento:</strong> ${reservation.unit_code}</p>
        <p><strong>Propietario:</strong> ${reservation.owner_name}</p>
      </div>
    </div>

    <div style="display: flex; gap: 1rem; justify-content: flex-end; margin-top: 1.5rem;">
      <button class="btn btn-primary" id="btn-close-confirm">
        <i data-lucide="bookmark-check"></i> Ir a Mis Reservas
      </button>
    </div>
  `;

  modalOverlay.classList.remove('hidden');

  document.getElementById('modal-close-btn').onclick = () => {
    modalOverlay.classList.add('hidden');
    store.setView('propietario-mis-reservas');
  };

  document.getElementById('btn-close-confirm').onclick = () => {
    modalOverlay.classList.add('hidden');
    store.setView('propietario-mis-reservas');
  };

  if (window.lucide) window.lucide.createIcons();
}
