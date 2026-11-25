// Instagram via la connexion unifiée de Meta (« Unified login »), seule méthode offerte aux apps Meta créées depuis fin 2026.
// Facebook Login for Business + une configuration (config_id) -> un jeton « system user » qui n'expire pas,
// valable pour tous les comptes Instagram partagés pendant la connexion. Appels sur graph.facebook.com.
import { randomId, timingSafeEqual, b64u, unb64u, enc, dec, hmac, json, err } from './util.js';
import { sign } from './auth.js';
import { kvGet, kvSet } from './db.js';
import { ACCOUNTS } from '../public/accounts.js';

const ver = (env) => env.META_GRAPH_VERSION || 'v25.0';
const GRAPH = (env) => env.IG_GRAPH_BASE || 'https://graph.facebook.com'; // remplaçable pour les tests
const DIALOG = (env) => env.IG_DIALOG_BASE || 'https://www.facebook.com';
const G = (env) => `${GRAPH(env)}/${ver(env)}`;
const NEVER = Date.UTC(2100, 0, 1);
export const igConfigured = (env) => !!(env.META_APP_ID && env.META_APP_SECRET && env.META_CONFIG_ID);
export const igRedirect = (url) => new URL('/auth/instagram/callback', url).toString();
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');

async function igFetch(url, init) {
  const res = await fetch(url, init);
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok || data.error) {
    const e = data.error || {};
    const ex = new Error(e.error_user_msg || e.message || `Erreur Meta (${res.status})`);
    ex.code = e.code;
    throw ex;
  }
  return data;
}

// Comptes Instagram partagés lors de la dernière connexion (sans le jeton).
export async function igAssets(env) {
  try { return JSON.parse((await kvGet(env, 'ig_assets')) || '[]'); } catch { return []; }
}

export async function igStart(env, url) {
  if (!igConfigured(env)) return Response.redirect(new URL('/#comptes', url).toString(), 302);
  const payload = Date.now() + '.' + randomId(8);
  const state = payload + '.' + (await sign(env, 'ig.' + payload));
  const q = new URLSearchParams({
    client_id: env.META_APP_ID,
    config_id: env.META_CONFIG_ID,
    redirect_uri: igRedirect(url),
    response_type: 'code',
    state,
  });
  return Response.redirect(`${DIALOG(env)}/${ver(env)}/dialog/oauth?${q}`, 302);
}

async function listAssigned(env, token) {
  const t = encodeURIComponent(token);
  let rows;
  try {
    rows = (await igFetch(`${G(env)}/me/assigned_instagram_accounts?fields=id,username,name&limit=100&access_token=${t}`)).data || [];
  } catch (e) {
    rows = (await igFetch(`${G(env)}/me/assigned_instagram_accounts?limit=100&access_token=${t}`)).data || [];
  }
  const out = [];
  for (const r of rows.slice(0, 50)) {
    let username = r.username, name = r.name;
    if (!username) {
      try {
        const d = await igFetch(`${G(env)}/${r.id}?fields=username,name&access_token=${t}`);
        username = d.username; name = d.name;
      } catch {}
    }
    out.push({ id: String(r.id), username: username || '', name: name || '' });
  }
  return out;
}

export async function igCallback(env, url) {
  const back = (msg) => Response.redirect(new URL('/?ig=' + encodeURIComponent(msg) + '#comptes', url).toString(), 302);
  const parts = (url.searchParams.get('state') || '').split('.');
  if (parts.length !== 3) return back('Lien de connexion invalide.');
  const payload = parts[0] + '.' + parts[1];
  if (!timingSafeEqual(parts[2], await sign(env, 'ig.' + payload))) return back('Lien de connexion invalide.');
  if (Date.now() - Number(parts[0]) > 30 * 60e3) return back('Lien de connexion expiré, recommence.');
  if (url.searchParams.get('error')) return back('Connexion annulée.');
  try {
    const q = new URLSearchParams({
      client_id: env.META_APP_ID,
      client_secret: env.META_APP_SECRET,
      redirect_uri: igRedirect(url),
      code: url.searchParams.get('code') || '',
    });
    const tok = await igFetch(`${G(env)}/oauth/access_token?${q}`);
    const token = tok.access_token;
    const assets = await listAssigned(env, token);
    if (!assets.length) {
      return back('Meta n’a partagé aucun compte Instagram. Recommence et coche tes comptes dans la fenêtre de Meta ; s’ils n’y figurent pas, ajoute-les à ton portefeuille business. Si ça persiste, ajoute la permission business_management à la configuration.');
    }
    await kvSet(env, 'ig_token', token);
    await kvSet(env, 'ig_assets', JSON.stringify(assets));
    const now = Date.now();
    // Le nouveau jeton remplace l'ancien pour les comptes déjà reliés.
    const ids = assets.map((a) => a.id);
    const { results: existing } = await env.DB.prepare("SELECT account, ext_id FROM connections WHERE platform = 'ig'").all();
    for (const c of existing) {
      if (ids.includes(c.ext_id)) await env.DB.prepare('UPDATE connections SET token = ?, expires = ?, updated = ? WHERE account = ?').bind(token, NEVER, now, c.account).run();
    }
    // Association automatique quand le nom correspond (ex. « FABLES official » <-> @fables.official).
    const used = new Set(existing.filter((c) => ids.includes(c.ext_id)).map((c) => c.ext_id));
    const linked = new Set(existing.filter((c) => ids.includes(c.ext_id)).map((c) => c.account));
    let auto = 0;
    for (const acc of Object.values(ACCOUNTS)) {
      if (acc.p !== 'ig' || linked.has(acc.id)) continue;
      const hits = assets.filter((a) => !used.has(a.id) && (norm(a.username) === norm(acc.n) || norm(a.name) === norm(acc.n)));
      if (hits.length !== 1) continue;
      await upsert(env, acc.id, hits[0], token);
      used.add(hits[0].id);
      auto++;
    }
    return back(`ok:${assets.length}:${auto}`);
  } catch (e) {
    return back('Meta a refusé la connexion : ' + e.message);
  }
}

async function upsert(env, account, asset, token) {
  await env.DB.prepare(
    'INSERT INTO connections (account, platform, ext_id, username, token, expires, updated) VALUES (?, ?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(account) DO UPDATE SET ext_id = excluded.ext_id, username = excluded.username, token = excluded.token, expires = excluded.expires, updated = excluded.updated'
  ).bind(account, 'ig', asset.id, asset.username || asset.name || '', token, NEVER, Date.now()).run();
}

// Relier à la main un compte Plateau à un compte Instagram partagé (ou le délier).
export async function igAssign(req, env, account) {
  if (!ACCOUNTS[account] || ACCOUNTS[account].p !== 'ig') return err('Compte inconnu.');
  const { ext_id } = await req.json().catch(() => ({}));
  if (!ext_id) {
    await env.DB.prepare('DELETE FROM connections WHERE account = ?').bind(account).run();
    return json({ ok: true });
  }
  const asset = (await igAssets(env)).find((a) => a.id === String(ext_id));
  const token = await kvGet(env, 'ig_token');
  if (!asset || !token) return err('Ce compte Instagram n’a pas été partagé : reconnecte tes comptes Instagram.');
  const dup = await env.DB.prepare("SELECT account FROM connections WHERE platform = 'ig' AND ext_id = ? AND account != ?").bind(asset.id, account).first();
  if (dup) return err('Ce compte Instagram est déjà relié à un autre compte de Plateau.');
  await upsert(env, account, asset, token);
  return json({ ok: true, username: asset.username || asset.name });
}

// Étape 1 : créer le conteneur (Meta télécharge le média depuis notre adresse publique).
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

// Adresses appelées par Meta (sans connexion à Plateau) : retrait de l'app, et demande de suppression des données.
async function readSignedRequest(env, req) {
  const form = await req.formData().catch(() => null);
  const sr = form && form.get('signed_request');
  if (!sr || !env.META_APP_SECRET) return null;
  const [sig, payload] = String(sr).split('.');
  if (!sig || !payload) return null;
  const expected = b64u(await hmac(enc.encode(env.META_APP_SECRET), enc.encode(payload)));
  if (!timingSafeEqual(sig, expected)) return null;
  try { return JSON.parse(dec.decode(unb64u(payload))); } catch { return null; }
}

async function forgetAll(env) {
  await env.DB.prepare("DELETE FROM connections WHERE platform = 'ig'").run();
  await env.DB.prepare("DELETE FROM kv WHERE k IN ('ig_token', 'ig_assets')").run();
}

export async function igDeauthorize(env, req) {
  if (await readSignedRequest(env, req)) await forgetAll(env);
  return json({ ok: true });
}

export async function igDataDeletion(env, req, url) {
  if (await readSignedRequest(env, req)) await forgetAll(env);
  return json({ url: new URL('/', url).toString(), confirmation_code: randomId(9) });
}
