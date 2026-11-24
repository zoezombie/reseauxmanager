// Notifications Web Push (RFC 8291 + VAPID RFC 8292), sans dépendance.
// Les clés VAPID sont générées au premier usage et gardées dans la base.
import { enc, b64u, unb64u, concat, hmac } from './util.js';
import { kvOnce, kvGet } from './db.js';

async function vapidKeys(env) {
  const raw = await kvOnce(env, 'vapid', async () => {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
    const pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey));
    return JSON.stringify({ jwk, pub });
  });
  return JSON.parse(raw);
}

export async function vapidPublicKey(env) {
  return (await vapidKeys(env)).pub;
}

async function vapidHeader(env, endpoint) {
  const { jwk, pub } = await vapidKeys(env);
  const o = await kvGet(env, 'origin');
  const origin = o && o.startsWith('https://') ? o : null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT || origin || 'mailto:plateau@example.com',
  })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + claims));
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${pub}`;
}

async function hkdf(salt, ikm, info, len) {
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, len);
}

// Chiffrement aes128gcm du contenu de la notification.
export async function encryptPayload(sub, payloadBytes) {
  const uaPublic = unb64u(sub.keys.p256dh);
  const authSecret = unb64u(sub.keys.auth);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(payloadBytes, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

export async function sendPush(env, sub, message) {
  const body = await encryptPayload(sub, enc.encode(JSON.stringify(message)));
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      authorization: await vapidHeader(env, sub.endpoint),
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: '86400',
      urgency: 'high',
    },
    body,
  });
  return res.status;
}

// Envoie à tous les appareils abonnés ; retire ceux qui ont expiré.
export async function notifyAll(env, message) {
  const { results } = await env.DB.prepare('SELECT endpoint, sub FROM push_subs').all();
  let sent = 0;
  for (const r of results) {
    try {
      const status = await sendPush(env, JSON.parse(r.sub), message);
      if (status === 404 || status === 410) await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(r.endpoint).run();
      else if (status < 300) sent++;
    } catch (e) {
      console.log('push error', e && e.message);
    }
  }
  return sent;
}
