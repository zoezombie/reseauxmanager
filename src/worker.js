import { ensureSchema, kvGet, kvSet } from './db.js';
import { isAuthed, login, logout, sameOrigin } from './auth.js';
import { json, err } from './util.js';
import { mediaStart, mediaPart, mediaComplete, mediaAbort, mediaServe, storageUsed, storageLimit } from './media.js';
import { igStart, igCallback, igConfigured, igRedirect } from './instagram.js';
import { vapidPublicKey, notifyAll } from './push.js';
import { adapt, aiEnabled } from './ai.js';
import { tick } from './tick.js';
import { ACCOUNTS } from '../public/accounts.js';

const ID = /^[A-Za-z0-9_-]{4,48}$/;

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      await ensureSchema(env);
      if (path.startsWith('/m/')) return mediaServe(req, env, decodeURIComponent(path.slice(3)));
      if (!sameOrigin(req)) return err('Origine refusée.', 403);
      if (path === '/api/login' && req.method === 'POST') return login(req, env);
      if (path === '/api/logout' && req.method === 'POST') return logout();

      const authed = await isAuthed(req, env);
      if (path === '/api/me') return me(env, url, authed);
      if (!authed) {
        return path.startsWith('/api/') ? err('Connexion requise.', 401) : Response.redirect(new URL('/', url).toString(), 302);
      }
      if (path === '/auth/instagram/start') return igStart(env, url);
      if (path === '/auth/instagram/callback') return igCallback(env, url);

      // Posts
      if (path === '/api/posts' && req.method === 'GET') return listPosts(env);
      let m = path.match(/^\/api\/posts\/([^/]+)$/);
      if (m && req.method === 'PUT') return savePost(req, env, m[1]);
      if (m && req.method === 'DELETE') return deletePost(env, m[1]);
      m = path.match(/^\/api\/posts\/([^/]+)\/targets\/([^/]+)$/);
      if (m && req.method === 'POST') return targetAction(req, env, m[1], m[2]);

      // Médias
      if (path === '/api/media/start' && req.method === 'POST') return mediaStart(req, env);
      if (path === '/api/media/part' && req.method === 'PUT') return mediaPart(req, env, url);
      if (path === '/api/media/complete' && req.method === 'POST') return mediaComplete(req, env);
      if (path === '/api/media/abort' && req.method === 'POST') return mediaAbort(req, env, url);

      // Notifications
      if (path === '/api/push/subscribe' && req.method === 'POST') return subscribe(req, env);
      if (path === '/api/push/unsubscribe' && req.method === 'POST') return unsubscribe(req, env);
      if (path === '/api/push/test' && req.method === 'POST') {
        const n = await notifyAll(env, { title: 'Plateau', body: 'Les notifications fonctionnent sur cet appareil.', url: '/#comptes', tag: 'test' });
        return json({ sent: n });
      }

      // Connexions aux réseaux
      m = path.match(/^\/api\/connections\/([^/]+)$/);
      if (m && req.method === 'DELETE') {
        await env.DB.prepare('DELETE FROM connections WHERE account = ?').bind(m[1]).run();
        return json({ ok: true });
      }

      if (path === '/api/adapt' && req.method === 'POST') return adapt(req, env);
      if (path === '/api/run' && req.method === 'POST') {
        await tick(env);
        return json({ ok: true });
      }
      return err('Introuvable.', 404);
    } catch (e) {
      console.log('error', e && (e.stack || e.message || e));
      return err('Erreur serveur : ' + ((e && e.message) || e), 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(tick(env).catch((e) => console.log('tick error', e && (e.stack || e.message))));
  },
};

async function me(env, url, authed) {
  const base = { authed, passwordSet: !!env.APP_PASSWORD };
  if (!authed) return json(base);
  if ((await kvGet(env, 'origin')) !== url.origin) await kvSet(env, 'origin', url.origin);
  const { results } = await env.DB.prepare('SELECT account, platform, username, expires FROM connections').all();
  const subs = await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subs').first();
  return json({
    ...base,
    igConfigured: igConfigured(env),
    igRedirect: igRedirect(url),
    aiEnabled: aiEnabled(env),
    vapidKey: await vapidPublicKey(env),
    pushDevices: subs ? subs.n : 0,
    storage: { bytes: (await storageUsed(env)).bytes || 0, limit: storageLimit(env) },
    connections: Object.fromEntries(results.map((c) => [c.account, { platform: c.platform, username: c.username, expires: c.expires }])),
  });
}

async function listPosts(env) {
  const { results: posts } = await env.DB.prepare('SELECT id, data FROM posts').all();
  const { results: targets } = await env.DB.prepare('SELECT post_id, account, state, permalink, error FROM targets').all();
  const by = {};
  for (const t of targets) (by[t.post_id] = by[t.post_id] || {})[t.account] = { s: t.state, link: t.permalink, e: t.error };
  return json(posts.map((p) => ({ ...JSON.parse(p.data), id: p.id, ts: by[p.id] || {} })));
}

async function savePost(req, env, id) {
  if (!ID.test(id)) return err('Identifiant invalide.');
  const p = await req.json().catch(() => null);
  if (!p || typeof p !== 'object') return err('Post invalide.');
  const targets = [...new Set(Array.isArray(p.targets) ? p.targets : [])].filter((t) => ACCOUNTS[t]);
  const status = p.status === 'draft' ? 'draft' : 'sched';
  const at = Number.isFinite(p.at) ? Math.round(p.at) : null;
  const clean = {
    id,
    title: String(p.title || '').slice(0, 200),
    targets,
    base: String(p.base || '').slice(0, 10000),
    tags: String(p.tags || '').slice(0, 2000),
    cap: p.cap && typeof p.cap === 'object' ? p.cap : {},
    when: typeof p.when === 'string' ? p.when.slice(0, 16) : '',
    at,
    status,
    media: p.media && p.media.key ? { key: String(p.media.key), name: String(p.media.name || '').slice(0, 200), type: String(p.media.type || ''), size: Number(p.media.size) || 0 } : null,
    upd: Date.now(),
  };
  const old = await env.DB.prepare('SELECT at FROM posts WHERE id = ?').bind(id).first();
  const now = Date.now();
  const stmts = [
    env.DB.prepare('INSERT INTO posts (id, data, at, status, updated) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, at = excluded.at, status = excluded.status, updated = excluded.updated')
      .bind(id, JSON.stringify(clean), at, status, now),
  ];
  const { results: existing } = await env.DB.prepare('SELECT account, state FROM targets WHERE post_id = ?').bind(id).all();
  const have = new Set(existing.map((e) => e.account));
  for (const t of targets) {
    if (!have.has(t)) stmts.push(env.DB.prepare("INSERT INTO targets (post_id, account, state, updated) VALUES (?, ?, 'pending', ?)").bind(id, t, now));
  }
  for (const e of existing) {
    if (!targets.includes(e.account) && ['pending', 'reminded', 'error'].includes(e.state)) {
      stmts.push(env.DB.prepare('DELETE FROM targets WHERE post_id = ? AND account = ?').bind(id, e.account));
    }
  }
  // Post reprogrammé plus tard : les rappels déjà envoyés repartent à zéro.
  if (old && old.at !== at && at && at > now) {
    stmts.push(env.DB.prepare("UPDATE targets SET state = 'pending', error = NULL WHERE post_id = ? AND state IN ('reminded', 'error')").bind(id));
  }
  await env.DB.batch(stmts);
  return json({ ok: true });
}

async function deletePost(env, id) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(id),
    env.DB.prepare('DELETE FROM targets WHERE post_id = ?').bind(id),
  ]);
  return json({ ok: true });
}

async function targetAction(req, env, id, account) {
  const { action } = await req.json().catch(() => ({}));
  const t = await env.DB.prepare('SELECT state FROM targets WHERE post_id = ? AND account = ?').bind(id, account).first();
  if (!t) return err('Introuvable.', 404);
  const post = await env.DB.prepare('SELECT at FROM posts WHERE id = ?').bind(id).first();
  const now = Date.now();
  let state = null;
  if (action === 'done' && t.state !== 'published') state = 'done';
  if (action === 'undo' && t.state === 'done') state = post && post.at && post.at <= now ? 'reminded' : 'pending';
  if (action === 'retry' && t.state === 'error') state = 'pending';
  if (!state) return json({ ok: true, unchanged: true });
  await env.DB.prepare('UPDATE targets SET state = ?, error = NULL, container = CASE WHEN ? = \'pending\' THEN NULL ELSE container END, tries = 0, updated = ? WHERE post_id = ? AND account = ?')
    .bind(state, state, now, id, account).run();
  return json({ ok: true, state });
}

async function subscribe(req, env) {
  const { subscription } = await req.json().catch(() => ({}));
  if (!subscription || !/^https:\/\//.test(subscription.endpoint || '') || !subscription.keys || !subscription.keys.p256dh || !subscription.keys.auth) {
    return err('Abonnement invalide.');
  }
  await env.DB.prepare('INSERT INTO push_subs (endpoint, sub, created) VALUES (?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET sub = excluded.sub')
    .bind(subscription.endpoint, JSON.stringify({ endpoint: subscription.endpoint, keys: subscription.keys }), Date.now()).run();
  return json({ ok: true });
}

async function unsubscribe(req, env) {
  const { endpoint } = await req.json().catch(() => ({}));
  if (endpoint) await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(endpoint).run();
  return json({ ok: true });
}
