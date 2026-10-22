/* Mensajes de error comprensibles. Convierte errores técnicos (del navegador o de Supabase) en una explicación
 * en español de qué pasó y qué hacer. El texto depende de QUIÉN lo ve y de la causa real:
 *  - Propietarios e inquilinos: lenguaje simple, sin mencionar servicios técnicos ni mostrar errores crudos.
 *  - Administrador: además ve el detalle técnico y cómo resolverlo (por ejemplo, restaurar el proyecto de Supabase). */
import { isAdminAudience } from './errorAudience.js';

// Texto técnico, solo para el administrador
export const CONNECTION_TITLE = 'No hay conexión con el servidor';
export const CONNECTION_MESSAGE =
  'No se pudo comunicar con la base de datos. Su internet funciona, así que el servidor no está respondiendo. Causas comunes:\n' +
  '• El proyecto gratuito de Supabase estuvo sin uso varios días y se pausó automáticamente. ' +
  'Entre a supabase.com, abra el proyecto y pulse "Restore project"; tarda unos minutos.\n' +
  '• Supabase tiene una caída temporal (revise status.supabase.com).\n' +
  'Vuelva a intentarlo en un momento.';

const GENERIC = {
  title: 'No se pudo completar',
  message: 'Ocurrió un problema inesperado. Inténtelo de nuevo en un momento. Si continúa, comuníquese con la administración.'
};

/* ---------- ¿Es un problema de internet del usuario o del servidor? ---------- */
let lastNet = 'unknown';   // 'offline' = el dispositivo no llega ni a este sitio; 'server_down' = hay internet pero no responde el servidor

export function currentNetKind() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  return lastNet === 'offline' ? 'offline' : 'server_down';
}

/** Comprueba si el dispositivo llega al propio sitio. Si llega, hay internet y el problema es del servidor. */
export async function probeConnectivity() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { lastNet = 'offline'; return 'offline'; }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    await fetch(`${location.origin}/assets/logo.svg?probe=${Date.now()}`, { method: 'HEAD', cache: 'no-store', signal: ctrl.signal });
    clearTimeout(timer);
    lastNet = 'server_down';
    return 'server_down';
  } catch {
    lastNet = 'offline';
    return 'offline';
  }
}

/** Aviso de conexión según la causa y quién lo ve. */
export function connectionNotice(kind = currentNetKind()) {
  if (kind === 'offline') {
    return { title: 'Sin conexión a internet',
      message: 'Parece que su dispositivo no tiene conexión a internet. Revise su wifi o sus datos móviles e inténtelo de nuevo.' };
  }
  if (isAdminAudience()) return { title: CONNECTION_TITLE, message: CONNECTION_MESSAGE };
  return { title: 'El sistema no está disponible',
    message: 'No pudimos conectar con el sistema en este momento. Inténtelo de nuevo en unos minutos. Si el problema continúa, comuníquese con la administración.' };
}

// [patrón, título, mensaje]; si título es null, se usa el aviso de conexión según la causa
const RULES = [
  [/failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet|err_network|err_connection|connection_error/i, null, null],
  [/project.*paused|paused.*project|upstream connect error|bad gateway|service unavailable|gateway time-?out|\b(502|503|504|520|521|522|540)\b/i, 'server', null],
  [/jwt expired|invalid jwt|refresh token|session.*(expired|missing)|auth session missing|not authenticated|no hay una sesión/i,
    'Su sesión venció', 'Por seguridad su sesión ya no es válida. Cierre sesión, vuelva a ingresar con su usuario y contraseña y repita la operación.'],
  [/row-level security|permission denied|violates row-level|acceso denegado|not authorized|forbidden/i,
    'No tiene permiso', 'Su cuenta no tiene autorización para hacer esta operación o ver esta información. Si cree que es un error, comuníquese con la administración.'],
  [/too many requests|rate limit|\b429\b/i,
    'Demasiados intentos', 'Se hicieron demasiadas solicitudes seguidas. Espere unos minutos e inténtelo de nuevo.'],
  [/statement timeout|canceling statement|timed? ?out|timeout/i,
    'Tardó demasiado', 'La operación tardó más de lo normal. Espere unos segundos e inténtelo de nuevo; si se repite, comuníquese con la administración.'],
  [/duplicate key|already exists|unique constraint|violates unique/i,
    'Registro duplicado', 'Ya existe un registro igual al que intenta guardar. Revise los datos.'],
  [/foreign key|violates foreign key|still referenced/i,
    'Hay datos relacionados', 'No se puede completar porque este dato está relacionado con otros registros (por ejemplo cuotas, pagos o personas asignadas).'],
  [/payload too large|entity too large|exceeded the maximum allowed size|\b413\b/i,
    'Archivo demasiado grande', 'El archivo pesa más de lo permitido. Elija uno más liviano.'],
  [/bucket not found|object not found|the resource was not found/i,
    'Archivo no encontrado', 'El archivo ya no está disponible. Puede haber sido reemplazado o eliminado.'],
  [/mime type|invalid mime/i,
    'Tipo de archivo no permitido', 'Ese tipo de archivo no está permitido. Use PDF, JPG, PNG o WEBP según corresponda.'],
  [/invalid login credentials/i,
    'Datos incorrectos', 'Usuario o contraseña incorrectos.']
];

// Textos que delatan un error técnico (no escrito para personas): nunca se muestran a propietarios
const TECHNICAL = /PGRST|SQLSTATE|violates|relation "|column "|syntax error|function public\.|schema cache|TypeError|ReferenceError|SyntaxError|RangeError|undefined|null value|is not a function|Cannot read|Unexpected token|JSON|supabase|postgres|postgrest|storage-js|\bRLS\b|\bjwt\b|stack|\bat \w+ \(|invalid input|malformed|exception|\bfetch\b|AbortError|DOMException/i;

/** { title, message, matched } a partir de cualquier error o texto. */
export function friendlyError(input) {
  const raw = (input && typeof input === 'object') ? (input.message || input.error_description || input.error || String(input)) : String(input ?? '');
  for (const [re, title, message] of RULES) {
    if (!re.test(raw)) continue;
    if (title === null) return { ...connectionNotice(), matched: true };
    if (title === 'server') return { ...connectionNotice('server_down'), matched: true };
    return { title, message, matched: true };
  }
  // Sin regla: el administrador ve el texto original; los demás, nunca un error técnico
  if (!isAdminAudience() && (TECHNICAL.test(raw) || !raw.trim())) return { ...GENERIC, matched: true };
  return { title: null, message: raw, matched: false };
}

/** Solo el texto, para cuadros de error dentro de formularios. */
export function friendlyMessage(input) {
  const f = friendlyError(input);
  return f.matched ? `${f.title}. ${f.message}` : f.message;
}
