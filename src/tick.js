// Tâche planifiée, lancée chaque minute par Cloudflare.
// 1) posts arrivés à l'heure : Instagram connecté -> publication auto ; sinon -> rappel sur l'iPhone
// 2) vidéos Instagram en traitement -> publication quand elles sont prêtes
// 3) entretien : renouvellement des jetons Instagram, ménage des médias orphelins
import { ACCOUNTS, PLAT, captionFor } from '../public/accounts.js';
import { igCreate, igStatus, igPublish, igRefreshTokens } from './instagram.js';
import { notifyAll } from './push.js';
import { ensureSchema, kvGet, kvSet } from './db.js';

const MAX_OPS = 12; // reste sous la limite de 50 sous-requêtes par exécution (offre gratuite)

async function setTarget(env, postId, account, fields) {
  const cols = Object.keys(fields);
  const sql = `UPDATE targets SET ${cols.map((c) => c + ' = ?').join(', ')}, updated = ? WHERE post_id = ? AND account = ?`;
  await env.DB.prepare(sql).bind(...cols.map((c) => fields[c]), Date.now(), postId, account).run();
}

const label = (account) => {
  const a = ACCOUNTS[account];
  return a ? `${PLAT[a.p].n} · ${a.n}` : account;
};

export async function tick(env) {
  await ensureSchema(env);
  const now = Date.now();
  const origin = await kvGet(env, 'origin');
  const { results: connRows } = await env.DB.prepare('SELECT * FROM connections').all();
  const conns = Object.fromEntries(connRows.map((c) => [c.account, c]));
  let ops = 0;
  const reminders = new Map();
  const failures = [];
  const published = [];

  // 1) Ce qui arrive à l'heure
  const { results: due } = await env.DB.prepare(
    "SELECT t.post_id, t.account, p.data FROM targets t JOIN posts p ON p.id = t.post_id " +
    "WHERE p.status = 'sched' AND p.at IS NOT NULL AND p.at <= ? AND t.state = 'pending' ORDER BY p.at LIMIT 25"
  ).bind(now).all();

  for (const r of due) {
    const post = JSON.parse(r.data);
    const acc = ACCOUNTS[r.account];
    const conn = conns[r.account];
    if (acc && acc.p === 'ig' && conn) {
      if (!post.media || !post.media.key) {
        await setTarget(env, r.post_id, r.account, { state: 'error', error: 'Instagram exige une image ou une vidéo.' });
        failures.push({ post, account: r.account, error: 'Instagram exige une image ou une vidéo.' });
        continue;
      }
      if (!origin) {
        await setTarget(env, r.post_id, r.account, { state: 'error', error: 'Adresse de l’app inconnue : ouvre l’app une fois puis réessaie.' });
        continue;
      }
      if (ops >= MAX_OPS) continue; // on reprendra à la minute suivante
      ops++;
      try {
        const container = await igCreate(env, conn, {
          caption: captionFor(post, 'ig'),
          mediaUrl: origin + '/m/' + post.media.key,
          isVideo: /^video\//.test(post.media.type || ''),
        });
        await setTarget(env, r.post_id, r.account, { state: 'processing', container, error: null, tries: 0 });
      } catch (e) {
        await setTarget(env, r.post_id, r.account, { state: 'error', error: e.message });
        failures.push({ post, account: r.account, error: e.message });
      }
    } else {
      await setTarget(env, r.post_id, r.account, { state: 'reminded' });
      if (!reminders.has(r.post_id)) reminders.set(r.post_id, { post, names: [] });
      reminders.get(r.post_id).names.push(label(r.account));
    }
  }

  // 2) Vidéos en cours de traitement chez Instagram
  const { results: proc } = await env.DB.prepare(
    "SELECT t.post_id, t.account, t.container, t.tries, t.updated, p.data FROM targets t JOIN posts p ON p.id = t.post_id WHERE t.state = 'processing' LIMIT 10"
  ).all();
  for (const r of proc) {
    if (ops >= MAX_OPS) break;
    const post = JSON.parse(r.data);
    const conn = conns[r.account];
    if (!conn) {
      await setTarget(env, r.post_id, r.account, { state: 'error', error: 'Compte Instagram déconnecté.' });
      continue;
    }
    ops++;
    try {
      const st = await igStatus(env, conn, r.container);
      if (st.code === 'FINISHED') {
        ops += 2;
        const out = await igPublish(env, conn, r.container);
        await setTarget(env, r.post_id, r.account, { state: 'published', media_id: out.id, permalink: out.permalink, error: null });
        published.push({ post, account: r.account });
      } else if (st.code === 'PUBLISHED') {
        await setTarget(env, r.post_id, r.account, { state: 'published', error: null });
      } else if (st.code === 'ERROR' || st.code === 'EXPIRED') {
        const msg = 'Instagram n’a pas pu traiter le média' + (st.detail ? ' : ' + st.detail : '.');
        await setTarget(env, r.post_id, r.account, { state: 'error', error: msg });
        failures.push({ post, account: r.account, error: msg });
      } else if ((r.tries || 0) >= 30) {
        const msg = 'Instagram met trop de temps à traiter la vidéo.';
        await setTarget(env, r.post_id, r.account, { state: 'error', error: msg });
        failures.push({ post, account: r.account, error: msg });
      } else {
        await env.DB.prepare('UPDATE targets SET tries = tries + 1 WHERE post_id = ? AND account = ?').bind(r.post_id, r.account).run();
      }
    } catch (e) {
      await setTarget(env, r.post_id, r.account, { state: 'error', error: e.message });
      failures.push({ post, account: r.account, error: e.message });
    }
  }

  // Notifications
  for (const { post, names } of reminders.values()) {
    await notifyAll(env, { title: 'À publier : ' + (post.title || 'Sans titre'), body: names.join('\n'), url: '/#a-publier', tag: 'r-' + post.id });
  }
  for (const f of failures) {
    await notifyAll(env, { title: 'Échec : ' + (f.post.title || 'Sans titre'), body: label(f.account) + ' — ' + f.error, url: '/#a-publier', tag: 'e-' + f.post.id });
  }
  for (const p of published) {
    await notifyAll(env, { title: 'Publié : ' + (p.post.title || 'Sans titre'), body: label(p.account), url: '/#a-publier', tag: 'p-' + p.post.id + p.account });
  }

  // 3) Entretien, au plus toutes les 6 heures
  const last = Number((await kvGet(env, 'maintenance')) || 0);
  if (now - last > 6 * 3600e3) {
    await kvSet(env, 'maintenance', String(now));
    await igRefreshTokens(env, 3);
    await cleanupMedia(env);
    await purgeOldMedia(env);
    await measureStorage(env);
  }
}

// Les vidéos ne servent qu'à publier : 30 jours après la date prévue, une fois tout publié
// (ou 60 jours après dans tous les cas), le fichier est supprimé. Le post reste dans l'historique.
async function purgeOldMedia(env, days = 30) {
  const now = Date.now();
  const { results } = await env.DB.prepare(
    "SELECT id, data FROM posts WHERE status = 'sched' AND at IS NOT NULL AND at < ? AND instr(data, '\"key\"') > 0 LIMIT 40"
  ).bind(now - days * 864e5).all();
  for (const r of results) {
    const p = JSON.parse(r.data);
    if (!p.media || !p.media.key) continue;
    const { results: ts } = await env.DB.prepare('SELECT state FROM targets WHERE post_id = ?').bind(r.id).all();
    const allDone = ts.length > 0 && ts.every((t) => t.state === 'done' || t.state === 'published');
    if (!allDone && p.at > now - 2 * days * 864e5) continue;
    await env.MEDIA.delete(p.media.key);
    p.media = { purged: true, name: p.media.name, type: p.media.type, size: p.media.size };
    await env.DB.prepare('UPDATE posts SET data = ? WHERE id = ?').bind(JSON.stringify(p), r.id).run();
  }
}

// Mesure exacte de l'espace occupé (sert au plafond et à l'affichage dans « Comptes »).
export async function measureStorage(env) {
  let bytes = 0, count = 0, cursor;
  for (let i = 0; i < 10; i++) {
    const l = await env.MEDIA.list({ limit: 1000, cursor });
    for (const o of l.objects) { bytes += o.size; count++; }
    if (!l.truncated) break;
    cursor = l.cursor;
  }
  await kvSet(env, 'storage', JSON.stringify({ bytes, count, at: Date.now() }));
}

// Supprime les fichiers qui ne servent plus à aucun post (après 2 jours, pour laisser le temps d'annuler).
async function cleanupMedia(env) {
  const listed = await env.MEDIA.list({ limit: 200 });
  const old = listed.objects.filter((o) => Date.now() - new Date(o.uploaded).getTime() > 2 * 864e5);
  for (const o of old.slice(0, 20)) {
    const used = await env.DB.prepare('SELECT 1 FROM posts WHERE instr(data, ?) > 0 LIMIT 1').bind(o.key).first();
    if (!used) await env.MEDIA.delete(o.key);
  }
}
