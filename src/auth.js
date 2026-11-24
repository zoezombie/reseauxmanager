import { enc, b64u, hmac, randomId, timingSafeEqual, json, err } from './util.js';
import { kvOnce, kvGet, kvSet } from './db.js';

const COOKIE = 'plateau_s';
const ONE_YEAR = 365 * 24 * 3600;

async function sessionKey(env) {
  const secret = await kvOnce(env, 'session_secret', () => randomId(32));
  // Changer APP_PASSWORD déconnecte tous les appareils.
  return hmac(enc.encode(secret), enc.encode('pw:' + (env.APP_PASSWORD || '')));
}

export async function sign(env, text) {
  return b64u(await hmac(await sessionKey(env), enc.encode(text)));
}

export async function isAuthed(req, env) {
  if (!env.APP_PASSWORD) return false;
  const c = req.headers.get('cookie') || '';
  const m = c.match(/(?:^|;\s*)plateau_s=([^;]+)/);
  if (!m) return false;
  const [exp, sig] = m[1].split('.');
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return timingSafeEqual(sig, await sign(env, 'session.' + exp));
}

export async function login(req, env) {
  if (!env.APP_PASSWORD) return err('Mot de passe pas encore configuré : ajoute le secret APP_PASSWORD dans Cloudflare.', 503);
  const now = Date.now();
  const lock = JSON.parse((await kvGet(env, 'login_fail')) || '{"n":0,"t":0}');
  if (lock.n >= 8 && now - lock.t < 15 * 60e3) return err('Trop d’essais. Réessaie dans 15 minutes.', 429);
  let body = {};
  try { body = await req.json(); } catch {}
  const pw = String(body.password || '');
  const ok = timingSafeEqual(await sign(env, 'pw.' + pw), await sign(env, 'pw.' + env.APP_PASSWORD));
  if (!ok) {
    await kvSet(env, 'login_fail', JSON.stringify({ n: now - lock.t < 15 * 60e3 ? lock.n + 1 : 1, t: now }));
    return err('Mot de passe incorrect.', 401);
  }
  await kvSet(env, 'login_fail', '{"n":0,"t":0}');
  const exp = Math.floor(now / 1000) + ONE_YEAR;
  const value = exp + '.' + (await sign(env, 'session.' + exp));
  return json({ ok: true }, 200, {
    'set-cookie': `${COOKIE}=${value}; Path=/; Max-Age=${ONE_YEAR}; HttpOnly; Secure; SameSite=Lax`,
  });
}

export function logout() {
  return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` });
}

// Les requêtes qui modifient quelque chose doivent venir de l'app elle-même.
export function sameOrigin(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  const o = req.headers.get('origin');
  return !o || o === new URL(req.url).origin;
}
