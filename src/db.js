// Schéma créé automatiquement au premier appel : aucune migration à lancer à la main.
const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)',
  'CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, data TEXT NOT NULL, at INTEGER, status TEXT, updated INTEGER)',
  "CREATE TABLE IF NOT EXISTS targets (post_id TEXT NOT NULL, account TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', container TEXT, media_id TEXT, permalink TEXT, error TEXT, tries INTEGER NOT NULL DEFAULT 0, updated INTEGER, PRIMARY KEY (post_id, account))",
  'CREATE TABLE IF NOT EXISTS connections (account TEXT PRIMARY KEY, platform TEXT NOT NULL, ext_id TEXT, username TEXT, token TEXT, expires INTEGER, updated INTEGER)',
  'CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, sub TEXT NOT NULL, created INTEGER)',
  'CREATE INDEX IF NOT EXISTS idx_targets_state ON targets (state)',
  'CREATE INDEX IF NOT EXISTS idx_posts_at ON posts (at)',
];

let ready = null;
export function ensureSchema(env) {
  if (!ready) {
    ready = env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s))).catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

export async function kvGet(env, k) {
  const r = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first();
  return r ? r.v : null;
}

export async function kvSet(env, k, v) {
  await env.DB.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(k, v).run();
}

// Valeur secrète générée une seule fois puis conservée (clé de session, clés VAPID…).
export async function kvOnce(env, k, make) {
  const cur = await kvGet(env, k);
  if (cur) return cur;
  const v = await make();
  await env.DB.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO NOTHING').bind(k, v).run();
  return (await kvGet(env, k)) || v;
}

export async function kvDel(env, k) {
  await env.DB.prepare('DELETE FROM kv WHERE k = ?').bind(k).run();
}
