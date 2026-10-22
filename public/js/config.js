/* Global Application Configuration & System Constants */

export const CONFIG = {
  APP_NAME: 'Sistema de Administración de Edificios',
  VERSION: '1.0.0',
  
  // Localization & Regional Settings (Arequipa, Perú)
  CURRENCY: 'S/',
  CURRENCY_CODE: 'PEN',
  DATE_FORMAT: 'DD/MM/YYYY',
  TIMEZONE: 'America/Lima', // UTC-5
  TIMEZONE_LABEL: 'Perú (UTC-5)',
  
  // Proyecto de Supabase. La clave "publishable" es pública por diseño (la protegen las reglas RLS).
  // NUNCA escribir aquí la clave service_role / sb_secret_.
  // Fijos: no se pueden cambiar desde el navegador. La CSP de public/_headers solo permite este proyecto.
  SUPABASE_URL: 'https://ykiikobtsahhkmatpqua.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_3XQtKzg-RH8jfHHapjq1YA_f3fyVar9',
  
  // Dominio SOLO para fabricar el correo interno de inicio de sesión (no se envía nada ahí).
  // Debe coincidir con el secreto LOGIN_EMAIL_DOMAIN de la función admin-users.
  LOGIN_EMAIL_DOMAIN: 'ibyzacorp.com',

  // Initial Seed Building Information
  SEED_BUILDING: {
    id: 'bld-parke10',
    code: 'PK10',
    name: 'PARKE10',
    address: 'Av. Ejército 410, Yanahuara, Arequipa, Perú',
    city: 'Arequipa',
    country: 'Perú',
    total_units: 52,
    total_floors: 11,
    default_due_day: 5, // Fee due on the 5th of each month
    created_at: '2026-01-01T00:00:00Z'
  }
};

/**
 * Format currency amount in Peruvian Soles (S/)
 */
export function formatCurrency(amount) {
  const num = parseFloat(amount) || 0;
  return `${CONFIG.CURRENCY} ${num.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Format date string into DD/MM/YYYY
 */
export function formatDate(dateInput) {
  if (!dateInput) return '-';
  // 'YYYY-MM-DD' se formatea tal cual: new Date() lo interpreta en UTC y en Perú (UTC-5) mostraría el día anterior
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateInput);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return dateInput;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Get current Peru ISO string
 */
export function getPeruISOString() {
  return new Date().toISOString();
}
