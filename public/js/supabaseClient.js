/* Supabase Client Integration & Fallback Layer */
import { CONFIG } from './config.js';
import { friendlyError } from './ui/errors.js';

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
    return fail(503, friendlyError('Failed to fetch').message);
  }
  if (res.ok || url.includes('/functions/v1/')) return res;   // la función admin-users ya responde con sus propios mensajes

  // Servidor caído o pausado: respuesta sin JSON útil
  let text = '';
  try { text = await res.clone().text(); } catch { /* sin cuerpo */ }
  if (res.status >= 502 || res.status === 540) return fail(503, friendlyError('503').message);

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

/**
 * Validate and save Supabase credentials atomically.
 * Rules:
 *  - Both url and key must be non-empty strings.
 *  - url must match https://<ref>.supabase.co (HTTPS, supabase.co domain).
 *  - Only writes to localStorage when BOTH fields are valid — never partially.
 *  - Never overwrites existing valid config if new input fails validation.
 *  - Returns { ok: true } on success (and triggers reload) or
 *    { ok: false, error: string } on failure so callers can show inline errors.
 */
export function saveSupabaseConfig(url, key) {
  const trimmedUrl = (url || '').trim();
  const trimmedKey = (key || '').trim();

  // Validate presence of both fields
  if (!trimmedUrl && !trimmedKey) {
    return { ok: false, error: 'Debes ingresar la Project URL y la Anon Key de tu proyecto Supabase.' };
  }
  if (!trimmedUrl) {
    return { ok: false, error: 'La Project URL no puede estar vacía.' };
  }
  if (!trimmedKey) {
    return { ok: false, error: 'La Publishable/Anon Key no puede estar vacía.' };
  }

  // Validate URL format: must be https://<anything>.supabase.co
  const supabaseUrlPattern = /^https:\/\/[a-zA-Z0-9-]+\.supabase\.co\/?$/;
  if (!supabaseUrlPattern.test(trimmedUrl)) {
    return {
      ok: false,
      error: 'La URL no es válida. Debe tener el formato: https://tu-proyecto.supabase.co'
    };
  }

  // Validate key format — accept both formats:
  //   • Legacy anon/JWT key:   starts with "eyJ"          (e.g. eyJhbGciOiJI...)
  //   • New Publishable key:   starts with "sb_publishable_" (e.g. sb_publishable_abc123...)
  // Explicitly reject service_role / secret keys (sb_secret_ prefix).
  if (trimmedKey.startsWith('sb_secret_')) {
    return {
      ok: false,
      error: 'No uses la Secret/Service Role key en el frontend. Usa únicamente la Publishable key (sb_publishable_...) o la Anon key (eyJ...).'
    };
  }
  const isValidKey = trimmedKey.startsWith('eyJ') || trimmedKey.startsWith('sb_publishable_');
  if (!isValidKey) {
    return {
      ok: false,
      error: 'La key no parece válida. Debe empezar con "eyJ..." (Anon key) o "sb_publishable_..." (Publishable key).'
    };
  }

  // All validations passed — write both atomically and reload
  window.localStorage.setItem('VITE_SUPABASE_URL', trimmedUrl);
  window.localStorage.setItem('VITE_SUPABASE_ANON_KEY', trimmedKey);
  window.location.reload();
  return { ok: true };
}
