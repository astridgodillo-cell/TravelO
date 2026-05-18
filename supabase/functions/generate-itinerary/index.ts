// Supabase Edge Function — generate-itinerary
// Appelle l'API Claude (Anthropic) côté serveur et renvoie un itinéraire JSON
// strictement structuré. La clé ANTHROPIC_API_KEY n'est jamais exposée au client.
//
// Secret requis :
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// (ou via le dashboard Supabase → Project Settings → Edge Functions → Secrets)
//
// Déploiement :
//   supabase functions deploy generate-itinerary --no-verify-jwt
// (mettre --no-verify-jwt si vous voulez autoriser la génération sans login)

// deno-lint-ignore-file no-explicit-any
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = Deno.env.get('ANTHROPIC_MODEL') || 'claude-sonnet-4-20250514';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SYSTEM_PROMPT = `Tu es l'expert voyage TravelO, un agent de tour-opérateur francophone, méticuleux et passionné. Tu rédiges des itinéraires ultra-détaillés, comme un programme vendu par une grande agence.

Règles strictes :
- Rédige TOUJOURS en français, ton chaleureux et professionnel.
- Tiens compte des dates fournies pour calibrer la météo (saison réaliste pour la destination).
- Adapte le rythme au type de voyage : un séjour fixe a peu de trajets, un road trip en a beaucoup.
- Adapte les hébergements et les repas au niveau de budget choisi (économique → camping/auberge ; haut de gamme → boutique-hôtels et restaurants étoilés).
- Prix toujours en euros (€), réalistes pour le pays et la saison.
- N'invente pas d'établissements de luxe absurdement célèbres si on peut éviter — privilégie des adresses crédibles.
- Pour chaque jour, structure en Matin / Midi / Après-midi / Soir.
- Décris les excursions de façon immersive et commerciale ("vous emprunterez le sentier...", "votre guide local vous racontera...").
- Réponds UNIQUEMENT avec un JSON valide qui respecte EXACTEMENT le schéma demandé. Pas de texte avant ni après. Pas de bloc markdown \`\`\`json.`;

function buildUserPrompt(p: any): string {
  const childrenDesc =
    Array.isArray(p.childrenAges) && p.childrenAges.length
      ? `${p.childrenAges.length} enfant(s) (âges : ${p.childrenAges.join(', ')} ans)`
      : '0 enfant';

  return `Voici les préférences du voyageur. Génère l'itinéraire complet.

Destination(s) : ${p.destinations}
Période : du ${p.startDate} au ${p.endDate}
Départ : ${p.departureLocation}
Retour : ${p.returnLocation || p.departureLocation}
Participants : ${p.adults} adulte(s), ${childrenDesc}
Type de voyage : ${p.tripType}
Centres d'intérêt : ${(p.interests || []).join(', ')}
Niveau de budget : ${p.budget}
Lieux IMPÉRATIFS à inclure : ${p.mustInclude || '(aucun)'}
Lieux ou choses à éviter : ${p.toAvoid || '(aucun)'}

Tu dois renvoyer un JSON STRICT avec exactement cette structure :

{
  "summary": {
    "destinations": string,
    "start_date": "YYYY-MM-DD",
    "end_date": "YYYY-MM-DD",
    "duration_days": number,
    "departure_location": string,
    "return_location": string,
    "travellers": { "adults": number, "children_ages": number[] },
    "trip_type": string,
    "interests": string[],
    "budget_level": string,
    "headline": string  // accroche d'agence en 1 phrase
  },
  "days": [
    {
      "label": "J1",
      "date": "YYYY-MM-DD",
      "weekday": "lundi",
      "location": "Ville / région du jour",
      "weather": { "temperature_c": number, "emoji": string, "description": string },
      "morning": { "title": string, "description": string },
      "noon":    { "title": string, "description": string },
      "afternoon": { "title": string, "description": string },
      "evening": { "title": string, "description": string },
      "accommodation": { "name": string, "type": string, "price_eur": number, "note": string },
      "trips": [
        {
          "from": string,
          "to": string,
          "distance_km": number,
          "duration": string,
          "mode": string,
          "estimated_cost_eur": number,
          "cost_note": string  // ex. "carburant + péage" ou "billets train"
        }
      ],
      "activities": [
        {
          "title": string,
          "schedule": string,
          "duration": string,
          "description": string,            // courte phrase de présentation
          "immersive_description": string,  // 3-5 phrases style vendeur de voyage
          "price_per_person_eur": number,
          "family_total_eur": number
        }
      ],
      "meals": {
        "daily_family_budget_eur": number,
        "note": string  // ex. "trattoria midi + restaurant de poisson soir"
      },
      "day_total_eur": number
    }
  ],
  "budget_summary": {
    "trips_eur": number,
    "accommodation_eur": number,
    "meals_eur": number,
    "activities_eur": number,
    "grand_total_eur": number,
    "per_person_eur": number,
    "currency": "EUR"
  },
  "notes": {
    "visa_and_documents": string,
    "climate_and_packing": string,
    "useful_apps": string[],
    "practical_tips": string[]
  }
}

Contraintes :
- duration_days doit correspondre au nombre exact de jours entre start_date et end_date inclus.
- days doit contenir EXACTEMENT duration_days entrées.
- Tous les nombres en euros doivent être réalistes (pas de 0 ni de 9999).
- day_total_eur = somme des trips + accommodation + activities + meals du jour.
- grand_total_eur = somme des day_total_eur.
- per_person_eur = grand_total_eur / (adults + children).
- emoji météo cohérent : ☀️ 🌤️ ⛅ 🌧️ ❄️ 🌫️ 🌩️
- Si une journée n'a pas de trajet (séjour fixe), trips peut être [].`;
}

async function callClaude(userPrompt: string) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Anthropic ${res.status} : ${txt}`);
  }
  const data = await res.json();
  const text = data?.content?.[0]?.text;
  if (!text) throw new Error('Réponse Claude vide.');
  return { text, usage: data?.usage };
}

function extractJson(text: string): any {
  // Claude renvoie du JSON pur, mais on tolère un éventuel bloc markdown.
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate);
  } catch (_) {
    // Tentative : retrouver le premier { jusqu'au dernier } équilibré
    const first = candidate.indexOf('{');
    const last = candidate.lastIndexOf('}');
    if (first !== -1 && last > first) {
      return JSON.parse(candidate.slice(first, last + 1));
    }
    throw new Error('Impossible de parser le JSON renvoyé par Claude.');
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    });
  }

  if (!ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({
        error:
          'Le secret ANTHROPIC_API_KEY n\'est pas configuré dans la fonction.',
      }),
      {
        status: 500,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      }
    );
  }

  try {
    const body = await req.json();
    const preferences = body?.preferences;
    if (!preferences || !preferences.destinations || !preferences.startDate) {
      return new Response(
        JSON.stringify({ error: 'preferences invalides' }),
        {
          status: 400,
          headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
        }
      );
    }

    const userPrompt = buildUserPrompt(preferences);
    const { text, usage } = await callClaude(userPrompt);
    const itinerary = extractJson(text);

    return new Response(
      JSON.stringify({ itinerary, usage, model: MODEL }),
      {
        status: 200,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message || String(err) }),
      {
        status: 500,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      }
    );
  }
});
