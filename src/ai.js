// « Adapter avec Claude » : optionnel, actif seulement si le secret ANTHROPIC_API_KEY existe.
import { json, err } from './util.js';
import { BRANDS, ACCOUNTS } from '../public/accounts.js';

export const aiEnabled = (env) => !!env.ANTHROPIC_API_KEY;

export async function adapt(req, env) {
  if (!aiEnabled(env)) return err('Adaptation par Claude non configurée.', 503);
  const b = await req.json().catch(() => ({}));
  const plats = (Array.isArray(b.platforms) ? b.platforms : []).filter((p) => ['ig', 'tt', 'yt', 'li'].includes(p));
  if (!plats.length || !String(b.base || '').trim()) return err('Il faut une légende de base et au moins un réseau.');
  const brands = [...new Set((b.targets || []).map((t) => ACCOUNTS[t] && ACCOUNTS[t].b).filter(Boolean))]
    .map((id) => BRANDS.find((x) => x.id === id).n).join(', ');
  const prompt = `Tu adaptes une légende de réseaux sociaux pour plusieurs plateformes.
Marque(s) : ${brands || '(non précisée)'}
Sujet (titre interne) : ${String(b.title || '(aucun)').slice(0, 200)}
Légende de base :
"""
${String(b.base).slice(0, 4000)}
"""
Hashtags proposés : ${String(b.tags || '(aucun)').slice(0, 500)}
Plateformes à produire : ${plats.join(', ')}

Règles : garde la langue et le ton de la légende de base. N’invente aucun fait, date, lieu, lien ni promesse. Suis les usages de chaque réseau :
- ig (Instagram) : accroche forte en première ligne, 2 200 caractères maximum, 3 à 8 hashtags à la fin.
- tt (TikTok) : court et direct, environ 150 caractères, 3 à 5 hashtags.
- yt (YouTube Shorts) : "t" est un titre de 100 caractères maximum ; "d" une description de 2 à 4 phrases suivie de hashtags.
- li (LinkedIn, page d’entreprise) : ton professionnel, 2 à 4 courts paragraphes, 3 hashtags maximum.
Réponds uniquement avec un objet JSON contenant seulement les clés demandées, de la forme {"ig":"…","tt":"…","yt":{"t":"…","d":"…"},"li":"…"}.`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': env.AI_API_VERSION || '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: env.AI_MODEL || 'claude-haiku-5-5', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return err('Claude n’a pas répondu : ' + ((data.error && data.error.message) || res.status), 502);
  const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return err('Réponse de Claude illisible.', 502);
  try {
    return json(JSON.parse(m[0]));
  } catch {
    return err('Réponse de Claude illisible.', 502);
  }
}
