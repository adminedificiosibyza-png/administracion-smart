// ==============================================================================
// Edge Function: admin-users
// Crea cuentas, regenera contraseñas y activa/desactiva personas.
// SOLO la puede usar un SUPERADMIN con sesión iniciada.
//
// Por qué existe: crear usuarios con contraseña requiere la clave de servicio
// (service_role), que NUNCA debe estar en el navegador. Aquí vive en el servidor
// (Supabase la inyecta sola como SUPABASE_SERVICE_ROLE_KEY).
//
// Acciones (POST, JSON):
//   { action: "create_user",   full_name, assignments?: [{unit_id, relation, can_view_fees}],
//                              phone?, contact_email?, distinguisher? }
//   { action: "reset_password", user_id }
//   { action: "set_active",     user_id, active }
// ==============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Dominio SOLO para fabricar el correo interno de inicio de sesión. No se envía nada a él.
// Debe coincidir con LOGIN_EMAIL_DOMAIN de js/config.js. Se puede cambiar con un secreto.
const LOGIN_EMAIL_DOMAIN = Deno.env.get("LOGIN_EMAIL_DOMAIN") ?? "ibyzacorp.com";

// Solo el portal (y la copia local de pruebas) pueden llamar a esta función desde un navegador.
// Se puede ampliar con el secreto ALLOWED_ORIGINS (orígenes separados por coma).
const ALLOWED_ORIGINS = new Set([
  "https://portal.ibyzaedificios.com",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  ...(Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
]);

function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://portal.ibyzaedificios.com",
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

// DEBE ser idéntica a normalizeUsername de js/utils/username.js
function normalizeUsername(s: string): string {
  return String(s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const loginEmailFor = (username: string) => `${username.replace(/ /g, ".")}@${LOGIN_EMAIL_DOMAIN}`;

// Lo que la persona escribe para ingresar: su nombre + el dato que la diferencia (si lo hubo)
function loginNameOf(fullName: string, username: string | null): string {
  const base = normalizeUsername(fullName);
  const suffix = username && username.startsWith(base) ? username.slice(base.length).trim() : "";
  return suffix ? `${fullName} ${suffix}` : fullName;
}

// Iniciales (sin conectores) + departamento + 6 caracteres aleatorios sin símbolos confusos
const CONNECTORS = new Set(["de", "del", "la", "las", "los", "y", "e", "da", "di"]);
function initialsOf(fullName: string): string {
  const words = normalizeUsername(fullName).split(" ").filter((w) => w && !CONNECTORS.has(w));
  return words.slice(0, 5).map((w) => w[0]).join("").toUpperCase();
}
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"; // sin I, O, l, 0, 1
function randomChars(n: number): string {
  const buf = new Uint32Array(n);
  crypto.getRandomValues(buf);
  return Array.from(buf, (v) => ALPHABET[v % ALPHABET.length]).join("");
}
function generatePassword(fullName: string, unitCode?: string): string {
  const parts = [initialsOf(fullName) || "USR"];
  if (unitCode) parts.push(unitCode);
  parts.push(randomChars(6));
  return parts.join("-");
}

Deno.serve(async (req) => {
  const CORS = corsFor(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  // Diagnóstico: si Supabase no entrega alguna clave a la función, se dice cuál falta
  const missing = [
    ["SUPABASE_URL", SUPABASE_URL],
    ["SUPABASE_ANON_KEY", ANON_KEY],
    ["SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY],
  ].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) return json({ error: `Configuración del servidor incompleta: falta ${missing.join(", ")}.` }, 500);

  // 1. Quién llama: sesión válida y SUPERADMIN activo
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Sesión no válida." }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: caller, error: callerErr } = await admin.from("user_profiles").select("role,is_active").eq("id", userData.user.id).maybeSingle();
  if (callerErr) return json({ error: `No se pudo verificar su perfil: ${callerErr.message}` }, 500);
  if (!caller || caller.role !== "superadmin" || !caller.is_active) {
    return json({ error: "Acceso denegado: solo el superadmin puede gestionar usuarios." }, 403);
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "JSON inválido." }, 400); }

  try {
    // ---------------------------------------------------------------- create_user
    if (body.action === "create_user") {
      // Los nombres se guardan siempre en mayúsculas (la base de datos también lo fuerza)
      const fullName = String(body.full_name ?? "").trim().replace(/\s+/g, " ").toLocaleUpperCase("es-PE");
      if (fullName.length < 3) return json({ error: "Ingrese el nombre completo." }, 400);

      let username = normalizeUsername(fullName);
      if (!username) return json({ error: "El nombre no tiene caracteres válidos." }, 400);
      if (body.distinguisher) username = `${username} ${String(body.distinguisher).trim()}`;

      // ¿Ya existe una persona con ese usuario? -> la app pregunta si es la misma persona
      const { data: existing } = await admin.from("user_profiles").select("id,full_name").eq("username", username).maybeSingle();
      if (existing) return json({ code: "USERNAME_EXISTS", existing }, 409);

      const assignments: any[] = Array.isArray(body.assignments) ? body.assignments : [];
      let firstUnitCode: string | undefined;
      if (assignments[0]?.unit_id) {
        const { data: u } = await admin.from("units").select("code").eq("id", assignments[0].unit_id).maybeSingle();
        firstUnitCode = u?.code;
      }

      const password = generatePassword(fullName, firstUnitCode);
      const loginEmail = loginEmailFor(username);

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: loginEmail,
        password,
        email_confirm: true, // no se envía ningún correo
        user_metadata: { full_name: fullName },
      });
      if (createErr || !created?.user) return json({ error: `No se pudo crear la cuenta: ${createErr?.message}` }, 400);
      const uid = created.user.id;

      const { error: profErr } = await admin.from("user_profiles").insert({
        id: uid, role: "propietario", full_name: fullName, username, email: loginEmail,
        contact_email: body.contact_email || null, phone: body.phone || null, is_active: true,
      });
      if (profErr) {
        await admin.auth.admin.deleteUser(uid); // no dejar una cuenta a medias
        return json({ error: `No se pudo crear el perfil: ${profErr.message}` }, 400);
      }

      if (assignments.length) {
        const rows = assignments.map((a) => ({
          user_id: uid, unit_id: a.unit_id,
          relation: a.relation || "PROPIETARIO",
          can_view_fees: a.can_view_fees !== false,
          created_by: userData.user.id,
        }));
        const { error: unitErr } = await admin.from("user_units").insert(rows);
        if (unitErr) {
          await admin.auth.admin.deleteUser(uid); // el perfil se borra en cascada
          return json({ error: `No se pudieron asignar los departamentos: ${unitErr.message}` }, 400);
        }
      }

      return json({ user_id: uid, full_name: fullName, username, login_name: loginNameOf(fullName, username), password });
    }

    // ------------------------------------------------------------- reset_password
    if (body.action === "reset_password") {
      const { data: prof } = await admin.from("user_profiles").select("id,full_name,username").eq("id", body.user_id).maybeSingle();
      if (!prof) return json({ error: "Persona no encontrada." }, 404);
      const { data: ua } = await admin.from("user_units").select("unit_id").eq("user_id", prof.id).eq("active", true).limit(1);
      let unitCode: string | undefined;
      if (ua?.[0]) {
        const { data: u } = await admin.from("units").select("code").eq("id", ua[0].unit_id).maybeSingle();
        unitCode = u?.code;
      }
      const password = generatePassword(prof.full_name, unitCode);
      const { error } = await admin.auth.admin.updateUserById(prof.id, { password });
      if (error) return json({ error: `No se pudo cambiar la contraseña: ${error.message}` }, 400);
      return json({ user_id: prof.id, full_name: prof.full_name, login_name: loginNameOf(prof.full_name, prof.username), password });
    }

    // ----------------------------------------------------------------- set_active
    if (body.action === "set_active") {
      if (body.user_id === userData.user.id) return json({ error: "No puede desactivar su propia cuenta." }, 400);
      const active = body.active === true;
      const { error: pErr } = await admin.from("user_profiles").update({ is_active: active }).eq("id", body.user_id);
      if (pErr) return json({ error: pErr.message }, 400);
      // Además se bloquea el inicio de sesión (o se levanta el bloqueo)
      const { error: bErr } = await admin.auth.admin.updateUserById(body.user_id, { ban_duration: active ? "none" : "876000h" });
      if (bErr) return json({ error: bErr.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "Acción desconocida." }, 400);
  } catch (e) {
    return json({ error: `Error interno: ${(e as Error).message}` }, 500);
  }
});
