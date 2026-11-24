// Instagram API avec connexion Instagram (Business Login for Instagram).
// Accès standard : suffisant pour des comptes que tu possèdes ou gères, ajoutés à l'app Meta.
import { randomId, timingSafeEqual, b64u, unb64u, enc, dec, hmac, json } from './util.js';
import { sign } from './auth.js';
import { ACCOUNTS } from '../public/accounts.js';

const ver = (env) => env.IG_API_VERSION || 'v24.0';
const GRAPH = (env) => env.IG_GRAPH_BASE || 'https://graph.instagram.com'; // remplaçable pour les tests
const OAUTH = (env) => env.IG_OAUTH_BASE || 'https://api.instagram.com';
const G = (env) => `${GRAPH(env)}/${ver(env)}`;
export const igConfigured = (env) => !!(env.IG_APP_ID && env.IG_APP_SECRET);
export const igRedirect = (url) => new URL('/auth/instagram/callback', url).toString();

async function igFetch(url, init) {
  const res = await fetch(url, init);
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok || data.error) {
    const e = data.error || {};
    const msg = e.error_user_msg || e.message || data.error_message || `Erreur Instagram (${res.status})`;
    const ex = new Error(msg);
    ex.code = e.code;
    throw ex;
  }
  return data;
}

export async function igStart(env, url) {
  const account = url.searchParams.get('account');
  if (!ACCOUNTS[account] || ACCOUNTS[account].p !== 'ig') return new Response('Compte inconnu', { status: 400 });
  if (!igConfigured(env)) return Response.redirect(new URL('/#comptes', url).toString(), 302);
  const payload = account + '.' + Date.now() + '.' + randomId(8);
  const state = payload + '.' + (await sign(env, 'ig.' + payload));
  const q = new URLSearchParams({
    client_id: env.IG_APP_ID,
    redirect_uri: igRedirect(url),
    response_type: 'code',
    scope: 'instagram_business_basic,instagram_business_content_publish',
    state,
    force_reauth: 'true',
  });
  return Response.redirect('https://www.instagram.com/oauth/authorize?' + q, 302);
}

export async function igCallback(env, url) {
  const back = (msg) => Response.redirect(new URL('/?ig=' + encodeURIComponent(msg) + '#comptes', url).toString(), 302);
  const state = url.searchParams.get('state') || '';
  const parts = state.split('.');
  if (parts.length !== 4) return back('Lien de connexion invalide.');
  const payload = parts.slice(0, 3).join('.');
  if (!timingSafeEqual(parts[3], await sign(env, 'ig.' + payload))) return back('Lien de connexion invalide.');
  const [account, ts] = parts;
  if (Date.now() - Number(ts) > 30 * 60e3) return back('Lien de connexion expiré, recommence.');
  if (url.searchParams.get('error')) return back('Connexion annulée.');
  const code = (url.searchParams.get('code') || '').replace(/#_$/, '');
  try {
    const form = new URLSearchParams({
      client_id: env.IG_APP_ID,
      client_secret: env.IG_APP_SECRET,
      grant_type: 'authorization_code',
      redirect_uri: igRedirect(url),
      code,
    });
    const short = await igFetch(`${OAUTH(env)}/oauth/access_token`, { method: 'POST', body: form });
    const shortToken = short.access_token || (short.data && short.data[0] && short.data[0].access_token);
    const long = await igFetch(`${GRAPH(env)}/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(env.IG_APP_SECRET)}&access_token=${encodeURIComponent(shortToken)}`);
    const me = await igFetch(`${G(env)}/me?fields=user_id,username&access_token=${encodeURIComponent(long.access_token)}`);
    const now = Date.now();
    await env.DB.prepare(
      'INSERT INTO connections (account, platform, ext_id, username, token, expires, updated) VALUES (?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(account) DO UPDATE SET ext_id = excluded.ext_id, username = excluded.username, token = excluded.token, expires = excluded.expires, updated = excluded.updated'
    ).bind(account, 'ig', String(me.user_id || me.id), me.username || '', long.access_token, now + (long.expires_in || 5184000) * 1000, now).run();
    return back('ok:' + (me.username || ''));
  } catch (e) {
    return back('Instagram a refusé la connexion : ' + e.message);
  }
}

export async function igRefreshTokens(env, limit = 3) {
  const weekAgo = Date.now() - 7 * 864e5;
  const { results } = await env.DB.prepare(
    "SELECT account, token FROM connections WHERE platform = 'ig' AND updated < ? AND expires > ? LIMIT ?"
  ).bind(weekAgo, Date.now(), limit).all();
  for (const c of results) {
    try {
      const r = await igFetch(`${GRAPH(env)}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(c.token)}`);
      const now = Date.now();
      await env.DB.prepare('UPDATE connections SET token = ?, expires = ?, updated = ? WHERE account = ?')
        .bind(r.access_token, now + (r.expires_in || 5184000) * 1000, now, c.account).run();
    } catch (e) {
      console.log('refresh failed', c.account, e.message);
    }
  }
}

// Étape 1 : créer le conteneur (Instagram télécharge le média depuis notre URL publique).
export async function igCreate(env, conn, { caption, mediaUrl, isVideo }) {
  const body = new URLSearchParams({ access_token: conn.token, caption: caption || '' });
  if (isVideo) {
    body.set('media_type', 'REELS');
    body.set('video_url', mediaUrl);
  } else {
    body.set('image_url', mediaUrl);
  }
  const r = await igFetch(`${G(env)}/${conn.ext_id}/media`, { method: 'POST', body });
  return r.id;
}

// Étape 2 : vérifier le traitement (vidéos surtout).
export async function igStatus(env, conn, container) {
  const r = await igFetch(`${G(env)}/${container}?fields=status_code,status&access_token=${encodeURIComponent(conn.token)}`);
  return { code: r.status_code, detail: r.status };
}

// Étape 3 : publier.
export async function igPublish(env, conn, container) {
  const r = await igFetch(`${G(env)}/${conn.ext_id}/media_publish`, {
    method: 'POST',
    body: new URLSearchParams({ access_token: conn.token, creation_id: container }),
  });
  let permalink = null;
  try {
    const m = await igFetch(`${G(env)}/${r.id}?fields=permalink&access_token=${encodeURIComponent(conn.token)}`);
    permalink = m.permalink || null;
  } catch {}
  return { id: r.id, permalink };
}

// Adresses appelées par Meta (sans connexion à Plateau) : retrait de l'app par un compte, et demande de suppression des données.
async function readSignedRequest(env, req) {
  const form = await req.formData().catch(() => null);
  const sr = form && form.get('signed_request');
  if (!sr || !env.IG_APP_SECRET) return null;
  const [sig, payload] = String(sr).split('.');
  if (!sig || !payload) return null;
  const expected = b64u(await hmac(enc.encode(env.IG_APP_SECRET), enc.encode(payload)));
  if (!timingSafeEqual(sig, expected)) return null;
  try { return JSON.parse(dec.decode(unb64u(payload))); } catch { return null; }
}

export async function igDeauthorize(env, req) {
  const data = await readSignedRequest(env, req);
  if (data && data.user_id) await env.DB.prepare("DELETE FROM connections WHERE platform = 'ig' AND ext_id = ?").bind(String(data.user_id)).run();
  return json({ ok: true });
}

export async function igDataDeletion(env, req, url) {
  const data = await readSignedRequest(env, req);
  if (data && data.user_id) await env.DB.prepare("DELETE FROM connections WHERE platform = 'ig' AND ext_id = ?").bind(String(data.user_id)).run();
  const code = randomId(9);
  return json({ url: new URL('/', url).toString(), confirmation_code: code });
}
