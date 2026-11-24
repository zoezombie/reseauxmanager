// Double authentification : codes à 6 chiffres qui changent toutes les 30 secondes (TOTP, RFC 6238).
// Compatible avec l'app Mots de passe d'Apple, Google Authenticator, Microsoft Authenticator, 1Password…
import { kvGet, kvSet, kvDel } from './db.js';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function b32encode(bytes) {
  let bits = 0, val = 0, out = '';
  for (const b of bytes) {
    val = ((val << 8) | b) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += B32[(val >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}

export function b32decode(str) {
  const s = String(str).toUpperCase().replace(/[\s=]/g, '');
  let bits = 0, val = 0;
  const out = [];
  for (const c of s) {
    const i = B32.indexOf(c);
    if (i < 0) throw new Error('clé invalide');
    val = ((val << 5) | i) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((val >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export async function hotp(keyBytes, counter) {
  const buf = new ArrayBuffer(8);
  const v = new DataView(buf);
  v.setUint32(0, Math.floor(counter / 2 ** 32));
  v.setUint32(4, counter >>> 0);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf));
  const o = h[19] & 15;
  const n = (((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6;
  return String(n).padStart(6, '0');
}

// Renvoie le pas de temps reconnu (pour bloquer la réutilisation d'un code), ou null.
// Tolère 30 secondes d'écart d'horloge dans chaque sens.
export async function verifyCode(secret, code, now = Date.now()) {
  const c = String(code || '').replace(/\D/g, '');
  if (c.length !== 6) return null;
  const key = b32decode(secret);
  const step = Math.floor(now / 30000);
  for (const d of [0, -1, 1]) {
    if ((await hotp(key, step + d)) === c) return step + d;
  }
  return null;
}

export function newSecret() {
  return b32encode(crypto.getRandomValues(new Uint8Array(20)));
}

export function otpauthUri(secret) {
  return `otpauth://totp/Plateau?secret=${secret}&issuer=Plateau&algorithm=SHA1&digits=6&period=30`;
}

// État enregistré : { secret, at } quand la double authentification est active.
export async function totpConfig(env) {
  try {
    const raw = await kvGet(env, 'totp');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Active = configurée et pas suspendue par le secret de secours DISABLE_2FA.
export async function totpRequired(env) {
  if (env.DISABLE_2FA) return null;
  return totpConfig(env);
}

// Vérifie un code et empêche qu'il resserve.
export async function checkAndConsume(env, secret, code) {
  const step = await verifyCode(secret, code);
  if (step === null) return false;
  const last = Number((await kvGet(env, 'totp_last')) || 0);
  if (step <= last) return false;
  await kvSet(env, 'totp_last', String(step));
  return true;
}

export async function clearTotp(env) {
  await kvDel(env, 'totp');
  await kvDel(env, 'totp_pending');
}
