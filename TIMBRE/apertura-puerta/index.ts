Eany).process?.env?.[k] ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ---------- utilidades de cifrado ----------
const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
async function hmac(secret: string, msg: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(msg))).toUpperCase();
}
function iguales(a: string, b: string) {             // comparación en tiempo constante
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const azar = () => hex(crypto.getRandomValues(new Uint8Array(16)).buffer);

// ---------- base de datos (REST de Supabase con la clave de servicio) ----------
function dbHeaders() {
  const k = env("PUERTA_DB_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
  const h: Record<string, string> = { apikey: k, "Content-Type": "application/json" };
  if (!k.startsWith("sb_")) h.Authorization = "Bearer " + k;   // las claves viejas (JWT) también van como Bearer
  return h;
}
async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(`${env("SUPABASE_URL")}/rest/v1/${path}`, { ...init, headers: { ...dbHeaders(), ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`DB ${r.status}: ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
const q = encodeURIComponent;
const registrar = (edificio: string, unidad: string | null, ok: boolean, motivo: string) =>
  db("puertas_log", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ edificio, unidad, ok, motivo }) }).catch(() => {});

// ---------- Tuya ----------
let tokenCache: { token: string; vence: number } | null = null;

async function tuyaFetch(method: string, path: string, body: unknown, conToken: boolean) {
  const cid = env("TUYA_CLIENT_ID"), secret = env("TUYA_SECRET");
  const endpoint = (env("TUYA_ENDPOINT") || "https://openapi.tuyaus.com").replace(/\/+$/, "");
  const t = Date.now().toString();
  const cuerpo = body === undefined ? "" : JSON.stringify(body);
  const stringToSign = [method, await sha256(cuerpo), "", path].join("\n");
  const token = conToken ? await tuyaToken() : "";
  const sign = await hmac(secret, cid + token + t + stringToSign);
  const headers: Record<string, string> = { client_id: cid, sign, t, sign_method: "HMAC-SHA256", "Content-Type": "application/json" };
  if (token) headers.access_token = token;
  const r = await fetch(endpoint + path, { method, headers, body: cuerpo || undefined });
  const j = await r.json().catch(() => ({}));
  if (!j.success) throw new Error(`Tuya: ${j.msg || "error " + r.status} (${j.code ?? "?"})`);
  return j.result;
}
async function tuyaToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.vence) return tokenCache.token;
  const res = await tuyaFetch("GET", "/v1.0/token?grant_type=1", undefined, false);
  tokenCache = { token: res.access_token, vence: Date.now() + (Number(res.expire_time || 3600) - 120) * 1000 };
  return tokenCache.token;
}
async function accionarRele(device_id: string, codigo: string, pulso_ms: number) {
  const path = `/v1.0/iot-03/devices/${q(device_id)}/commands`;
  const mandar = (value: boolean) => tuyaFetch("POST", path, { commands: [{ code: codigo, value }] }, true);
  try { await mandar(true); }
  catch (e) {                                   // token vencido: se pide uno nuevo y se reintenta una vez
    if (/token/i.test(String(e))) { tokenCache = null; await mandar(true); } else throw e;
  }
  if (pulso_ms > 0) { await new Promise(r => setTimeout(r, Math.min(pulso_ms, 10000))); await mandar(false); }
}

// ---------- PINs y límites ----------
const hashPin = (sal: string, edificio: string, unidad: string, pin: string) => sha256(`${sal}|${edificio}|${unidad}|${pin}`);
const valido = (s: unknown, max = 120) => typeof s === "string" && s.trim().length > 0 && s.length <= max;

async function fallosRecientes(edificio: string, unidad?: string) {
  const desde = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const filtro = `edificio=eq.${q(edificio)}${unidad ? `&unidad=eq.${q(unidad)}` : ""}&ok=is.false&created_at=gte.${q(desde)}`;
  const filas = await db(`puertas_log?select=id&${filtro}&limit=50`);
  return (filas || []).length;
}

// ---------- manejador ----------
export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Usá POST." });
  let b: any; try { b = await req.json(); } catch { return json(400, { error: "Pedido inválido." }); }
  const { accion, edificio } = b || {};
  if (!valido(edificio)) return json(400, { error: "Falta el edificio." });

  try {
    // ----- abrir (vecino con PIN) -----
    if (accion === "abrir") {
      const { unidad, pin } = b;
      if (!valido(unidad) || typeof pin !== "string" || !/^\d{4,8}$/.test(pin)) return json(400, { error: "Escribí tu PIN de 4 a 8 números." });
      if (await fallosRecientes(edificio, unidad) >= 5 || await fallosRecientes(edificio) >= 20)
        return json(429, { error: "Demasiados intentos. Esperá 15 minutos y probá de nuevo." });

      const [fila] = await db(`puertas_pins?select=sal,pin_hash&edificio=eq.${q(edificio)}&unidad=eq.${q(unidad)}`) || [];
      if (!fila) { await registrar(edificio, unidad, false, "sin PIN"); return json(403, { error: "Este departamento no tiene PIN de apertura. Pedíselo a la administración." }); }
      if (!iguales(await hashPin(fila.sal, edificio, unidad, pin), fila.pin_hash)) {
        await registrar(edificio, unidad, false, "PIN incorrecto");
        return json(401, { error: "PIN incorrecto." });
      }
      const [eq] = await db(`puertas?select=device_id,codigo,pulso_ms&edificio=eq.${q(edificio)}`) || [];
      if (!eq) return json(409, { error: "Este edificio todavía no tiene la apertura configurada." });
      await accionarRele(eq.device_id, eq.codigo, eq.pulso_ms);
      await registrar(edificio, unidad, true, "abrió");
      return json(200, { ok: true });
    }

    // ----- acciones de administración -----
    const adminKey = env("PUERTA_ADMIN_KEY");
    if (!adminKey || typeof b.admin !== "string" || !iguales(await sha256(b.admin), await sha256(adminKey))) {
      if (String(accion).startsWith("admin_")) { await registrar(edificio, null, false, "clave admin incorrecta"); return json(401, { error: "Clave de administrador incorrecta." }); }
      return json(400, { error: "Acción desconocida." });
    }

    if (accion === "admin_estado") {
      const [eq] = await db(`puertas?select=device_id,codigo,pulso_ms&edificio=eq.${q(edificio)}`) || [];
      const pins = await db(`puertas_pins?select=unidad&edificio=eq.${q(edificio)}`) || [];
      const log = await db(`puertas_log?select=unidad,ok,motivo,created_at&edificio=eq.${q(edificio)}&order=created_at.desc&limit=15`) || [];
      return json(200, { equipo: eq || null, conPin: pins.map((p: any) => p.unidad), registro: log });
    }
    if (accion === "admin_equipo") {
      if (!valido(b.device_id, 80)) return json(400, { error: "Falta el Device ID del relé." });
      const fila = { edificio, device_id: b.device_id.trim(), codigo: (b.codigo || "switch_1").trim(),
                     pulso_ms: Math.max(0, Math.min(10000, Number(b.pulso_ms ?? 1000) | 0)), updated_at: new Date().toISOString() };
      await db("puertas?on_conflict=edificio", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(fila) });
      return json(200, { ok: true });
    }
    if (accion === "admin_pin") {
      if (!valido(b.unidad)) return json(400, { error: "Falta el departamento." });
      if (b.pin === "" || b.pin == null) {
        await db(`puertas_pins?edificio=eq.${q(edificio)}&unidad=eq.${q(b.unidad)}`, { method: "DELETE" });
        return json(200, { ok: true, borrado: true });
      }
      if (!/^\d{4,8}$/.test(String(b.pin))) return json(400, { error: "El PIN tiene que tener de 4 a 8 números." });
      const sal = azar();
      const fila = { edificio, unidad: b.unidad, sal, pin_hash: await hashPin(sal, edificio, b.unidad, String(b.pin)), updated_at: new Date().toISOString() };
      await db("puertas_pins?on_conflict=edificio,unidad", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(fila) });
      return json(200, { ok: true });
    }
    if (accion === "admin_probar") {
      const [eq] = await db(`puertas?select=device_id,codigo,pulso_ms&edificio=eq.${q(edificio)}`) || [];
      if (!eq) return json(409, { error: "Primero guardá el equipo." });
      await accionarRele(eq.device_id, eq.codigo, eq.pulso_ms);
      await registrar(edificio, "Administración", true, "prueba");
      return json(200, { ok: true });
    }
    return json(400, { error: "Acción desconocida." });
  } catch (e) {
    console.error(e);
    const msg = String((e as Error).message || e);
    return json(502, { error: msg.startsWith("Tuya") ? "El relé no respondió: " + msg : "Error del servidor. Probá de nuevo." });
  }
}

if ((globalThis as any).Deno?.serve) (globalThis as any).Deno.serve(handler);
