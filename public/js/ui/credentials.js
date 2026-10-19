/* Ventana con el usuario y la contraseña recién generados (se muestran una sola vez) */
import { alertDialog } from './dialog.js';

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

export function showCredentialsModal(title, loginName, password, onDone) {
  const modal = openAppModal(`<i data-lucide="key-round" style="color: var(--primary);"></i> ${esc(title)}`, `
    <p style="margin-bottom: 1rem; font-size: 0.9rem;">Entregue estos datos a la persona. <strong>La contraseña solo se muestra ahora</strong>; si se pierde, se genera una nueva.</p>
    <div class="credential-box">
      <div><span>Usuario</span><strong>${esc(loginName)}</strong></div>
      <div><span>Contraseña</span><strong class="mono">${esc(password)}</strong></div>
    </div>
    <div style="display:flex; gap:0.75rem; justify-content:flex-end; flex-wrap:wrap; margin-top:1.25rem;">
      <button class="btn btn-outline btn-sm" id="cred-copy"><i data-lucide="copy"></i> Copiar</button>
      <button class="btn btn-outline btn-sm" id="cred-print"><i data-lucide="printer"></i> Imprimir hoja</button>
      <button class="btn btn-primary btn-sm" id="cred-done">Listo</button>
    </div>`);

  modal.$('cred-copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(`Usuario: ${loginName}\nContraseña: ${password}`);
      modal.$('cred-copy').textContent = 'Copiado';
    } catch { alertDialog({ tone: 'warning', message: 'No se pudo copiar. Seleccione el texto manualmente.' }); }
  };

  modal.$('cred-print').onclick = () => {
    const w = window.open('', '_blank', 'width=480,height=520');
    if (!w) { alertDialog({ tone: 'warning', message: 'El navegador bloqueó la ventana de impresión. Permita las ventanas emergentes para este sitio.' }); return; }
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Credenciales de acceso</title>
      <style>body{font-family:Arial,sans-serif;padding:32px;color:#1a1f16}h1{font-size:20px;color:#4f7609}
      .box{border:2px solid #4f7609;border-radius:8px;padding:20px;margin-top:16px}
      .l{font-size:12px;color:#5b6355;text-transform:uppercase;margin-top:12px}.v{font-size:20px;font-weight:bold;font-family:monospace}
      p{font-size:13px;color:#5b6355;margin-top:20px}</style></head><body>
      <h1>ADMINISTRACIÓN SMART — Credenciales de acceso</h1><div class="box">
      <div class="l">Usuario (nombre completo)</div><div class="v">${esc(loginName)}</div>
      <div class="l">Contraseña</div><div class="v">${esc(password)}</div></div>
      <p>Guarde esta hoja en un lugar seguro.</p>
      </body></html>`);
    w.document.close();
      w.focus();
      setTimeout(() => w.print(), 300);   // la impresión se pide desde el sistema (la política de seguridad no permite scripts dentro de la hoja)
  };

  modal.$('cred-done').onclick = () => { modal.close(); if (onDone) onDone(); };
  return modal;
}
