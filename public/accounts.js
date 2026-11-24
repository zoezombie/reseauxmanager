// Marques et comptes : la seule liste à modifier pour ajouter ou retirer un compte.
// Utilisée à la fois par l'interface et par le serveur.
// Format d'un compte : [réseau, nom affiché]. Réseaux : ig, tt, yt, li.

export const PLAT = {
  ig: { n: 'Instagram', c: '#c8246c', lim: 2200, open: 'https://www.instagram.com/', auto: true },
  tt: { n: 'TikTok', c: '#111014', lim: 4000, open: 'https://www.tiktok.com/', auto: false },
  yt: { n: 'YouTube', c: '#d4161a', lim: 5000, tlim: 100, open: 'https://studio.youtube.com/', auto: false },
  li: { n: 'LinkedIn', c: '#0a62bd', lim: 3000, open: 'https://www.linkedin.com/', auto: false },
};

export const ORDER = ['ig', 'tt', 'yt', 'li'];

export const BRANDS = [
  { id: 'maurine', n: 'Maurine prod', ini: 'MP', c: '#e8492a', a: [['ig', 'Maurine prod'], ['yt', 'Maurine prod']] },
  { id: 'hoplite', n: 'Hoplite Studio', ini: 'HS', c: '#2f56f5', a: [['yt', 'Hoplite Studio'], ['tt', 'Hoplite Studio'], ['tt', 'Hoplite Lab'], ['ig', 'Hoplite Studio'], ['ig', 'Hoplite Lab'], ['li', 'Hoplite Studio']] },
  { id: 'ccmtl', n: 'Créative Connect MTL', ini: 'CC', c: '#008f73', a: [['li', 'Créative Connect MTL'], ['ig', 'Créative Connect MTL']] },
  { id: 'zoe', n: 'Zoé Zombie', ini: 'ZZ', c: '#7a3cf0', a: [['ig', 'Zoé Zombie'], ['tt', 'Zoé Zombie'], ['yt', 'Zoé Zombie']] },
  { id: 'szoe', n: 'Studio Zoé Zombie', ini: 'SZ', c: '#c81a68', a: [['ig', 'Studio Zoé Zombie'], ['tt', 'Studio Zoé Zombie'], ['yt', 'Studio Zoé Zombie']] },
  { id: 'fables', n: 'FABLES official', ini: 'FA', c: '#f0a800', a: [['ig', 'FABLES official'], ['tt', 'FABLES official'], ['yt', 'FABLES official']] },
  { id: 'archy', n: 'Archy', ini: 'AR', c: '#00809c', a: [['ig', 'Archy'], ['tt', 'Archy'], ['yt', 'Archy']] },
  { id: 'perso', n: 'Comptes perso', ini: 'P', c: '#5f5a66', a: [['ig', 'maurine_drawing'], ['ig', 'bob_sully_happy_doggy'], ['ig', 'party_kidy']] },
];

export const accountId = (brandId, p, name) =>
  brandId + '-' + p + '-' + name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '');

export const ACCOUNTS = {};
for (const b of BRANDS) {
  b.acc = b.a.map(([p, n]) => {
    const o = { id: accountId(b.id, p, n), p, n, b: b.id };
    ACCOUNTS[o.id] = o;
    return o;
  });
}

// Légende finale d'un post pour un réseau : version modifiée si elle existe, sinon base + hashtags.
export const baseText = (p) => (p.base || '').trim() + ((p.tags || '').trim() ? '\n\n' + p.tags.trim() : '');
export function captionFor(p, pl) {
  const c = p.cap || {};
  if (pl === 'yt') {
    const y = c.yt || {};
    return { t: y.t != null ? y.t : (p.title || ''), d: y.d != null ? y.d : baseText(p) };
  }
  return c[pl] != null ? c[pl] : baseText(p);
}
