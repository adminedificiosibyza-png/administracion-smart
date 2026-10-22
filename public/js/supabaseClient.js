/* Supabase Client Integration & Fallback Layer */
import { CONFIG } from './config.js';
import { friendlyError, connectionNotice, probeConnectivity } from './ui/errors.js';

let supabaseClient = null;

// Initialize Supabase Client if CDN / SDK is available
/**
 * Todas las llamadas a Supabase pasan por aquí. Si el servidor no responde (internet caído o proyecto
 * gratuito pausado por inactividad) o devuelve un error técnico, el mensaje que llega a la pantalla ya
 * viene explicado en español y lo muestra el sistema, no el navegador.
 */
async function systemFetch(input, init) {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  const fail = (status, message) => new Response(
    JSON.stringify({ message, msg: message, error: message, error_description: message, code: 'connection_error' }),
    { status, headers: { 'Content-Type': 'application/json' } });

  let res;
  try {
    res = await fetch(input, init);
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    // Se averigua si el problema es el internet del usuario o el servidor, y el texto se adapta a quien lo ve
    const kind = await probeConnectivity();
    const n = connectionNotice(kind);
    if (kind === 'server_down') console.warn('Sin respuesta del servidor de datos. Si el proyecto gratuito de Supabase se pausó por inactividad, restáurelo en supabase.com (Restore project).');
    return fail(503, `${n.title}. ${n.message}`);
  }
  if (res.ok || url.includes('/functions/v1/')) return res;   // la función admin-users ya responde con sus propios mensajes

  // Servidor caído o pausado: respuesta sin JSON útil
  let text = '';
  try { text = await res.clone().text(); } catch { /* sin cuerpo */ }
  if (res.status >= 502 || res.status === 540) { const n = connectionNotice('server_down'); return fail(503, `${n.title}. ${n.message}`); }

  // Errores técnicos con JSON: se reescribe el texto si es reconocible
  try {
    const body = JSON.parse(text);
    const key = ['message', 'msg', 'error_description', 'error'].find(k => typeof body[k] === 'string');
    if (key) {
      const f = friendlyError(body[key]);
      if (f.matched && f.title !== 'Datos incorrectos') {
        const friendly = `${f.title}. ${f.message}`;
        ['message', 'msg', 'error_description', 'error'].forEach(k => { if (typeof body[k] === 'string') body[k] = friendly; });
        return new Response(JSON.stringify(body), { status: res.status, statusText: res.statusText, headers: res.headers });
      }
    }
  } catch { /* no es JSON: se deja pasar */ }
  return res;
}

if (window.supabase) {
  try {
    supabaseClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, { global: { fetch: systemFetch } });
    console.log('✅ Supabase Client initialized');
  } catch (e) {
    console.warn('⚠️ Supabase SDK warning, operating in dynamic mock mode:', e.message);
  }
}

export const supabase = supabaseClient;

/**
 * Check if live Supabase is connected
 */
export function isSupabaseConnected() {
  return !!supabaseClient && CONFIG.SUPABASE_URL !== 'https://xyzcompany.supabase.co';
}

/**
 * Magic Link / OTP Authentication Request Helper
 * Supabase JS v2: signInWithOtp() only accepts email OR phone, never both.
 */
export async function sendMagicLinkOrOTP(email, phone) {
  if (isSupabaseConnected()) {
    // Build options with only the provided field — v2 rejects null fields alongside a valid one
    const otpOptions = email ? { email } : { phone };
    return await supabase.auth.signInWithOtp(otpOptions);
  } else {
    // Dynamic simulation mode
    return {
      data: { user: { id: 'usr-502', email, phone }, message: 'Código OTP o enlace mágico enviado exitosamente.' },
      error: null
    };
  }
}

// Limpieza: valores que versiones anteriores guardaban en el navegador y ya no se usan
try { window.localStorage.removeItem('VITE_SUPABASE_URL'); window.localStorage.removeItem('VITE_SUPABASE_ANON_KEY'); } catch { /* sin acceso al almacenamiento */ }
