import { json, err, randomId } from './util.js';
import { kvGet, kvSet } from './db.js';

// Plafond volontaire, sous les 10 Go gratuits de R2 : au-delà, l'app refuse les nouveaux envois.
export const storageLimit = (env) => Number(env.MEDIA_LIMIT_GB || 9) * 1024 ** 3;
export async function storageUsed(env) {
  try { return JSON.parse((await kvGet(env, 'storage')) || '{}'); } catch { return {}; }
}

// Envoi en plusieurs morceaux : contourne la limite de 100 Mo par requête de Cloudflare.
const EXT = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export async function mediaStart(req, env) {
  const { name = '', type = '', size = 0 } = await req.json().catch(() => ({}));
  if (!/^(video|image)\//.test(type)) return err('Seules les vidéos et les images sont acceptées.');
  if (size > 4 * 1024 ** 3) return err('Fichier trop lourd (4 Go maximum).');
  const used = (await storageUsed(env)).bytes || 0;
  const limit = storageLimit(env);
  if (used + size > limit) {
    const go = (n) => (n / 1024 ** 3).toFixed(1).replace('.', ',');
    return err(`Stockage presque plein (${go(used)} Go sur ${go(limit)} Go) : l’app bloque l’envoi pour rester dans la partie gratuite. Les médias publiés depuis plus de 30 jours sont supprimés automatiquement ; tu peux aussi supprimer d’anciens posts.`, 507);
  }
  const ext = EXT[type] || (name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5);
  const key = randomId(24) + '.' + ext;
  const up = await env.MEDIA.createMultipartUpload(key, {
    httpMetadata: { contentType: type },
    customMetadata: { name: String(name).slice(0, 200) },
  });
  return json({ key, uploadId: up.uploadId });
}

export async function mediaPart(req, env, url) {
  const key = url.searchParams.get('key');
  const uploadId = url.searchParams.get('uploadId');
  const n = Number(url.searchParams.get('n'));
  if (!key || !uploadId || !(n >= 1 && n <= 10000)) return err('Paramètres manquants.');
  const up = env.MEDIA.resumeMultipartUpload(key, uploadId);
  const part = await up.uploadPart(n, req.body);
  return json({ partNumber: part.partNumber, etag: part.etag });
}

export async function mediaComplete(req, env) {
  const { key, uploadId, parts } = await req.json().catch(() => ({}));
  if (!key || !uploadId || !Array.isArray(parts) || !parts.length) return err('Paramètres manquants.');
  const up = env.MEDIA.resumeMultipartUpload(key, uploadId);
  const obj = await up.complete(parts.map((p) => ({ partNumber: Number(p.partNumber), etag: String(p.etag) })));
  const st = await storageUsed(env);
  await kvSet(env, 'storage', JSON.stringify({ bytes: (st.bytes || 0) + obj.size, count: (st.count || 0) + 1, at: st.at || Date.now() }));
  return json({ key, size: obj.size });
}

export async function mediaAbort(req, env, url) {
  const key = url.searchParams.get('key');
  const uploadId = url.searchParams.get('uploadId');
  if (key && uploadId) {
    try { await env.MEDIA.resumeMultipartUpload(key, uploadId).abort(); } catch {}
  }
  return json({ ok: true });
}

// Lecture publique (Instagram doit pouvoir récupérer le fichier) ; la clé aléatoire fait office de secret.
// Gère les requêtes partielles (Range), indispensables pour lire une vidéo sur iPhone.
export async function mediaServe(req, env, key) {
  if (!/^[A-Za-z0-9_-]{20,}\.[a-z0-9]{1,5}$/.test(key)) return new Response('Introuvable', { status: 404 });
  const range = req.headers.get('range');
  let obj;
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    if (m) {
      const head = await env.MEDIA.head(key);
      if (!head) return new Response('Introuvable', { status: 404 });
      const size = head.size;
      let start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]);
      let end = m[1] !== '' && m[2] !== '' ? Math.min(Number(m[2]), size - 1) : size - 1;
      if (start >= size || start > end) {
        return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
      }
      obj = await env.MEDIA.get(key, { range: { offset: start, length: end - start + 1 } });
      if (!obj) return new Response('Introuvable', { status: 404 });
      const h = baseHeaders(obj);
      h.set('content-range', `bytes ${start}-${end}/${size}`);
      h.set('content-length', String(end - start + 1));
      return new Response(req.method === 'HEAD' ? null : obj.body, { status: 206, headers: h });
    }
  }
  obj = await env.MEDIA.get(key);
  if (!obj) return new Response('Introuvable', { status: 404 });
  const h = baseHeaders(obj);
  h.set('content-length', String(obj.size));
  return new Response(req.method === 'HEAD' ? null : obj.body, { headers: h });
}

function baseHeaders(obj) {
  const h = new Headers();
  obj.writeHttpMetadata(h);
  h.set('accept-ranges', 'bytes');
  h.set('etag', obj.httpEtag);
  h.set('cache-control', 'private, max-age=86400');
  return h;
}

export async function mediaDelete(env, key) {
  if (key && /^[A-Za-z0-9_-]{20,}\.[a-z0-9]{1,5}$/.test(key)) {
    try { await env.MEDIA.delete(key); } catch {}
  }
}
