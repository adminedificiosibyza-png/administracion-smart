/* Cuadros de diálogo propios del sistema (reemplazan alert / confirm / prompt del navegador) */

import { friendlyError } from './errors.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICONS = { info: 'info', success: 'check-circle-2', warning: 'alert-triangle', danger: 'alert-octagon' };

// Dibuja un diálogo sobre cualquier otra ventana abierta y resuelve con lo que elija la persona
function mount({ title, message, tone = 'info', body = '', buttons }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
      <div class="dialog-card" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="dialog-head dialog-${tone}">
          <i data-lucide="${ICONS[tone] || 'info'}"></i>
          <h3>${esc(title)}</h3>
        </div>
        <div class="dialog-body">
          ${message ? `<p class="dialog-message" style="white-space: pre-line;">${esc(message)}</p>` : ''}
          ${body}
        </div>
        <div class="dialog-actions">
          ${buttons.map((b, i) => `<button type="button" class="btn ${b.className}" data-i="${i}">${esc(b.label)}</button>`).join('')}
        </div>
      </div>`;
    document.body.appendChild(overlay);
    if (window.lucide) window.lucide.createIcons();

    const finish = (value) => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(value);
    };
    const cancelValue = buttons.find(b => b.cancel)?.value;
    const onKey = (e) => { if (e.key === 'Escape') finish(cancelValue); };
    document.addEventListener('keydown', onKey);

    overlay.querySelectorAll('[data-i]').forEach(btn => btn.addEventListener('click', () => {
      const b = buttons[Number(btn.dataset.i)];
      finish(typeof b.value === 'function' ? b.value(overlay) : b.value);
    }));

    const focusTarget = overlay.querySelector('input') || overlay.querySelector('.btn-primary, .btn-danger');
    if (focusTarget) focusTarget.focus();
  });
}

/** Pregunta Aceptar / Cancelar. Devuelve true o false. */
export function confirmDialog({ title = 'Confirmar', message, confirmText = 'Aceptar', cancelText = 'Cancelar', danger = false }) {
  return mount({
    title, message, tone: danger ? 'warning' : 'info',
    buttons: [
      { label: cancelText, className: 'btn-secondary', value: false, cancel: true },
      { label: confirmText, className: danger ? 'btn-danger' : 'btn-primary', value: true }
    ]
  });
}

/** Informa algo (éxito, aviso o error). */
export function alertDialog({ title, message, tone = 'info', buttonText = 'Entendido' }) {
  // Los errores se explican en lenguaje claro (conexión caída, proyecto pausado, permisos, etc.)
  if ((tone === 'danger' || tone === 'warning') && message) {
    const f = friendlyError(message);
    if (f.matched) { message = f.message; title = f.title; }
  }
  const defaults = { info: 'Aviso', success: 'Listo', warning: 'Atención', danger: 'No se pudo completar' };
  return mount({
    title: title || defaults[tone] || 'Aviso', message, tone,
    buttons: [{ label: buttonText, className: 'btn-primary', value: undefined, cancel: true }]
  });
}

/** Pide un texto. Devuelve el texto escrito o null si cancela. */
export function promptDialog({ title = 'Ingrese un dato', message = '', label = '', defaultValue = '', placeholder = '', confirmText = 'Aceptar', cancelText = 'Cancelar' }) {
  const body = `
    <div class="form-group" style="margin: 0.75rem 0 0;">
      ${label ? `<label class="form-label" for="dialog-input">${esc(label)}</label>` : ''}
      <input type="text" id="dialog-input" class="form-control" value="${esc(defaultValue)}" placeholder="${esc(placeholder)}" autocomplete="off">
    </div>`;
  return mount({
    title, message, body,
    buttons: [
      { label: cancelText, className: 'btn-secondary', value: null, cancel: true },
      { label: confirmText, className: 'btn-primary', value: (overlay) => overlay.querySelector('#dialog-input').value.trim() }
    ]
  });
}
