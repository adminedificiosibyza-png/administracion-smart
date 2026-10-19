/* Mensajes de error comprensibles. Convierte los errores técnicos (del navegador o de Supabase)
 * en una explicación en español de qué pasó y qué hacer. Todo se muestra con los diálogos del sistema. */

export const CONNECTION_TITLE = 'No hay conexión con el servidor';
export const CONNECTION_MESSAGE =
  'No se pudo comunicar con la base de datos. Las causas más comunes son:\n' +
  '• Su conexión a internet se cortó o es inestable.\n' +
  '• El servidor estuvo sin uso varios días y se pausó automáticamente (ocurre con el plan gratuito de Supabase). ' +
  'En ese caso el administrador debe entrar a supabase.com, abrir el proyecto y pulsar "Restore project"; tarda unos minutos.\n' +
  'Revise su internet y vuelva a intentarlo en un momento.';

// [patrón, título, mensaje] — se usa el primero que coincida
const RULES = [
  [/failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet|err_network|err_connection/i,
    CONNECTION_TITLE, CONNECTION_MESSAGE],
  [/project.*paused|paused.*project|upstream connect error|bad gateway|service unavailable|gateway time-?out|\b(502|503|504|520|521|522|540)\b/i,
    CONNECTION_TITLE, CONNECTION_MESSAGE],
  [/jwt expired|invalid jwt|refresh token|session.*(expired|missing)|auth session missing|not authenticated|no hay una sesión/i,
    'Su sesión venció', 'Por seguridad su sesión ya no es válida. Cierre sesión, vuelva a ingresar con su usuario y contraseña y repita la operación.'],
  [/row-level security|permission denied|violates row-level|acceso denegado|not authorized|forbidden/i,
    'No tiene permiso', 'Su cuenta no tiene autorización para hacer esta operación o ver esta información. Si cree que es un error, comuníquese con la administración.'],
  [/too many requests|rate limit|\b429\b/i,
    'Demasiados intentos', 'Se hicieron demasiadas solicitudes seguidas. Espere unos minutos e inténtelo de nuevo.'],
  [/statement timeout|canceling statement|timed? ?out|timeout/i,
    'El servidor tardó demasiado', 'La base de datos tardó más de lo normal en responder. Espere unos segundos e inténtelo de nuevo; si se repite, avise al administrador.'],
  [/duplicate key|already exists|unique constraint|violates unique/i,
    'Registro duplicado', 'Ya existe un registro igual al que intenta guardar. Revise los datos.'],
  [/foreign key|violates foreign key|still referenced/i,
    'Hay datos relacionados', 'No se puede completar porque este dato está relacionado con otros registros (por ejemplo cuotas, pagos o personas asignadas).'],
  [/payload too large|entity too large|exceeded the maximum allowed size|\b413\b/i,
    'Archivo demasiado grande', 'El archivo pesa más de lo permitido (máximo 10 MB). Elija uno más liviano.'],
  [/bucket not found|object not found|the resource was not found/i,
    'Archivo no encontrado', 'El archivo ya no está disponible en el almacenamiento. Puede haber sido reemplazado o eliminado.'],
  [/mime type|invalid mime/i,
    'Tipo de archivo no permitido', 'Ese tipo de archivo no está permitido. Use PDF, JPG, PNG o WEBP según corresponda.'],
  [/invalid login credentials/i,
    'Datos incorrectos', 'Usuario o contraseña incorrectos.']
];

/** { title, message, matched } a partir de cualquier error o texto. */
export function friendlyError(input) {
  const raw = (input && typeof input === 'object') ? (input.message || input.error_description || input.error || String(input)) : String(input ?? '');
  for (const [re, title, message] of RULES) {
    if (re.test(raw)) return { title, message, matched: true };
  }
  return { title: null, message: raw, matched: false };
}

/** Solo el texto, para cuadros de error dentro de formularios. */
export function friendlyMessage(input) {
  const f = friendlyError(input);
  return f.matched ? `${f.title}. ${f.message}` : f.message;
}
