/* Usuario de ingreso = nombre completo. Se normaliza para que no importen mayúsculas, tildes ni espacios. */
import { CONFIG } from '../config.js';

// DEBE ser idéntica a normalizeUsername de supabase/functions/admin-users/index.ts
export function normalizeUsername(input) {
  return String(input ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Correo interno con el que Supabase Auth identifica la cuenta.
 * - Si el usuario escribe un correo (contiene "@"), se usa tal cual (caso del superadmin).
 * - Si escribe su nombre, se fabrica el correo interno a partir del nombre normalizado.
 */
export function loginEmailFor(input) {
  const value = String(input ?? '').trim();
  if (value.includes('@')) return value.toLowerCase();
  return `${normalizeUsername(value).replace(/ /g, '.')}@${CONFIG.LOGIN_EMAIL_DOMAIN}`;
}
