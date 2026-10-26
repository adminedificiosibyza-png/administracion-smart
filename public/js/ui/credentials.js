/* Ventana con el usuario y la contraseña recién generados (se muestran una sola vez) */
import { alertDialog } from './dialog.js';
import { exportCredentialsPdf } from '../services/credentialsPdf.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Abre una ventana (la global de la app) con el título y el contenido indicados. */
export function openAppModal(title, bodyHTML) {
  const overlay = document.getElementById('modal-container');
  document.getElementById('modal-title').innerHTML = title;
  document.getElementById('modal-body').innerHTML = bodyHTML;
  overlay.classList.remove('hidden');
  const close = () => overlay.classList.add('hidden');
  document.getElementById('modal-close-btn').onclick = close;
  if (window.lucide) window.lucide.createIcons();
  return { close, $: id => document.getElementById(id) };
}

/**
 * Muestra el usuario y la contraseña recién generados (solo se ven una vez).
 * places: [{ unit, building }] con el departamento y el edificio de la persona; salen en la hoja de credenciales.
 */
export function showCredentialsModal(title, loginName, password, onDone, places = []) {
  const modal = openAppModal(`<i data-lucide="key-round" style="color: var(--primary);"></i> ${esc(title)}`, `
    <p style="margin-bottom: 1rem; font-size: 0.9rem;">Entregue estos datos a la persona. <strong>La contraseña solo se muestra ahora</strong>; si se pierde, se genera una nueva.</p>
    <div class="credential-box">
      <div><span>Usuario</span><strong>${esc(loginName)}</strong></div>
      <div><span>Contraseña</span><strong class="mono">${esc(password)}</strong></div>
      ${places.length ? `<div><span>${places.length > 1 ? 'Departamentos' : 'Departamento'}</span><strong>${places.map(p => `Dpto ${esc(p.unit)} · ${esc(p.building)}`).join('<br>')}</strong></div>` : ''}
    </div>
    <div style="display:flex; gap:0.75rem; justify-content:flex-end; flex-wrap:wrap; margin-top:1.25rem;">
      <button class="btn btn-outline btn-sm" id="cred-copy"><i data-lucide="copy"></i> Copiar</button>
      <button class="btn btn-outline btn-sm" id="cred-pdf"><i data-lucide="file-down"></i> Descargar PDF</button>
      <button class="btn btn-primary btn-sm" id="cred-done">Listo</button>
    </div>`);

  modal.$('cred-copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(`Usuario: ${loginName}\nContraseña: ${password}`);
      modal.$('cred-copy').textContent = 'Copiado';
    } catch { alertDialog({ tone: 'warning', message: 'No se pudo copiar. Seleccione el texto manualmente.' }); }
  };

  // Hoja de credenciales en PDF (un octavo de hoja A4, con QR y sitio web), lista para imprimir
  modal.$('cred-pdf').onclick = async () => {
    const btn = modal.$('cred-pdf');
    btn.disabled = true;
    try {
      await exportCredentialsPdf({ loginName, password, places });
    } catch (err) {
      alertDialog({ tone: 'danger', title: 'No se pudo generar el PDF', message: err.message });
    } finally {
      btn.disabled = false;
    }
  };

  modal.$('cred-done').onclick = () => { modal.close(); if (onDone) onDone(); };
  return modal;
}