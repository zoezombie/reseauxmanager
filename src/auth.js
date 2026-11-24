import { enc, b64u, hmac, randomId, timingSafeEqual, json, err } from './util.js';
import { kvOnce, kvGet, kvSet } from './db.js';
import { totpRequired, checkAndConsume } from './totp.js';

const COOKIE = 'plateau_s';
const ONE_YEAR = 365 * 24 * 3600;

async function sessionKey(env) {
  const secret = await kvOnce(env, 'session_secret', () => randomId(32));
  // Changer APP_PASSWORD, ou activer/désactiver la double authentification, déconnecte tous les appareils.
  const epoch = (await kvGet(env, 'session_epoch')) || '0';
  return hmac(enc.encode(secret), enc.encode('pw:' + (env.APP_PASSWORD || '') + ':e' + epoch));
}

// Déconnecte tous les appareils, puis renvoie un cookie valide pour l'appareil courant.
export async function rotateSessions(env) {
  const epoch = Number((await kvGet(env, 'session_epoch')) || 0) + 1;
  await kvSet(env, 'session_epoch', String(epoch));
  return sessionCookie(env);
}

async function sessionCookie(env) {
  const exp = Math.floor(Date.now() / 1000) + ONE_YEAR;
  const value = exp + '.' + (await sign(env, 'session.' + exp));
  return `${COOKIE}=${value}; Path=/; Max-Age=${ONE_YEAR}; HttpOnly; Secure; SameSite=Lax`;
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
  const fail = () => kvSet(env, 'login_fail', JSON.stringify({ n: now - lock.t < 15 * 60e3 ? lock.n + 1 : 1, t: now }));
  const ok = timingSafeEqual(await sign(env, 'pw.' + pw), await sign(env, 'pw.' + env.APP_PASSWORD));
  if (!ok) {
    await fail();
    return err('Mot de passe incorrect.', 401);
  }
  // Deuxième étape : le code à 6 chiffres, si la double authentification est active.
  const tf = await totpRequired(env);
  if (tf) {
    const code = String(body.code || '').replace(/\D/g, '');
    if (!code) return json({ error: 'Entre le code à 6 chiffres de ton app d’authentification.', need2fa: true }, 401);
    if (!(await checkAndConsume(env, tf.secret, code))) {
      await fail();
      return json({ error: 'Code incorrect ou déjà utilisé. Attends le suivant et réessaie.', need2fa: true }, 401);
    }
  }
  await kvSet(env, 'login_fail', '{"n":0,"t":0}');
  return json({ ok: true }, 200, { 'set-cookie': await sessionCookie(env) });
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
