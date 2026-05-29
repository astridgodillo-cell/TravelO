const q = (s) => encodeURIComponent(s || '');

// Nettoie une "location" potentiellement bavarde générée par Claude :
//   "Vérone - puis route vers Bologne" → "Vérone"
//   "Route vers Florence via Apennins"  → "Florence"
//   "Calvi (matin) + Saint-Florent"     → "Calvi"
//   "Bastia → Macinaggio"               → "Bastia"
// Garde uniquement la première portion exploitable par Google Maps.
function cleanLocation(loc) {
  if (!loc) return '';
  let s = String(loc).trim();
  // Retire un préfixe descriptif (route vers, trajet vers, etc.)
  s = s.replace(
    /^(route|trajet|direction)\s+(vers|de|à)\s+/i,
    ''
  );
  // Coupe à la première séparation : tirets, flèches, parenthèses, "puis", "via"
  const cut = s.search(/(\s+[-—–→»]\s+|\s+(puis|via|vers|et|\+)\s+|\s*\(|,\s*\d)/i);
  if (cut > 0) s = s.slice(0, cut);
  return s.trim();
}

export { cleanLocation };

// Libellé "générique" qui ne désigne aucun lieu géolocalisable seul (Booking
// l'accroche alors à n'importe quelle ville qui en possède un → ex. "Centre
// historique" tout seul renvoie vers Florence).
const GENERIC_ONLY =
  /^(le\s+|la\s+|l'\s*)?(centre[-\s]?ville|centre\s+historique|centro\s+historico|vieux\s+centre|vieille\s+ville|old\s+town|historic\s+cent(?:er|re)|city\s+cent(?:er|re)|downtown|hyper[-\s]?centre)$/i;

// Vrai = coordonnées brutes "lat, long" (Booking ne les comprend pas en texte).
function isCoords(s) {
  return /^-?\d{1,3}\.\d+\s*[,;]\s*-?\d{1,3}\.\d+$/.test(String(s || '').trim());
}

// Vrai = phrase descriptive plutôt qu'un nom de lieu. Ces libellés (souvent
// dans coordinates_hint : "Proche de la gare routière, accès facile aux
// restaurants.") ne doivent JAMAIS partir vers Booking, qui les géolocalise
// n'importe où.
function isDescriptive(s) {
  const w = String(s || '').trim();
  if (!w) return true;
  if (/[.!?]$/.test(w)) return true; // finit par une ponctuation de phrase
  if ((w.match(/\s+/g) || []).length >= 3) return true; // 4 mots ou plus
  return /\b(proche|pr[èe]s|acc[èe]s|gare|a[ée]roport|plage|vue|minutes?|[àa]\s*pied|commerces?|restaurants?|transports?|m[ée]tro|navette|quartier)\b/i.test(
    w
  );
}

// Mot générique ISOLÉ (après nettoyage) qui ne désigne aucune commune.
const BARE_GENERIC =
  /^(centre|centro|center|downtown|historique|vieux|vieille|old|quartier|ville|zone|secteur)$/i;

// Retire un qualificatif générique de centre-ville en fin de chaîne
// ("Cascais centre" → "Cascais").
function stripGenericTail(s) {
  return String(s || '')
    .replace(
      /[\s,-]+(centre[-\s]?ville|centre|centro|center|downtown|vieille\s+ville|old\s+town|city\s+cent(?:er|re)|historique)\s*$/i,
      ''
    )
    .trim();
}

// Découpe un libellé en "jetons de lieu" exploitables : coupe sur , / • · — | ,
// puis jette coordonnées, phrases descriptives et libellés génériques.
function placeTokens(str) {
  let s = String(str || '').replace(/\([^)]*\)/g, ' ').trim();
  if (!s) return [];
  return s
    .split(/\s*[,/•·—|]\s*/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !isCoords(t))
    .filter((t) => !isDescriptive(t))
    .map((t) => stripGenericTail(t))
    .filter((t) => t && !GENERIC_ONLY.test(t) && !BARE_GENERIC.test(t));
}

// Détermine la VILLE (commune) de recherche Booking la plus fiable. C'est le
// seul niveau que Booking géolocalise correctement : un quartier seul ("Ribeira",
// "Baixa") peut exister dans un autre pays et renvoyer Booking au mauvais endroit
// (ex. "Ribeira" → Galice au lieu de Porto), et une phrase descriptive l'envoie
// n'importe où. On prend donc le DERNIER jeton de lieu propre de la zone
// conseillée (souvent la ville : "Baixa, Lisbonne" → Lisbonne ;
// "Kalambaka, centre-ville" → Kalambaka), sinon on retombe sur le lieu du jour.
function pickBookingCity(area, dayLocation) {
  const aTokens = placeTokens(area);
  if (aTokens.length) return aTokens[aTokens.length - 1];
  const dTokens = placeTokens(dayLocation);
  if (dTokens.length) return dTokens[dTokens.length - 1];
  return cleanLocation(dayLocation) || '';
}

export { pickBookingCity, placeTokens };

export function googleMapsSearch(query) {
  return `https://www.google.com/maps/search/?api=1&query=${q(cleanLocation(query) || query)}`;
}

export function googleMapsDirections(from, to) {
  const safeFrom = q(cleanLocation(from)).replace(/%20/g, '+');
  const safeTo = q(cleanLocation(to)).replace(/%20/g, '+');
  return `https://www.google.com/maps/dir/${safeFrom}/${safeTo}/`;
}

export function park4nightSearch(location) {
  return `https://park4night.com/fr/search?text=${q(cleanLocation(location) || location)}`;
}

// Si configuré (VITE_BOOKING_AFFILIATE_ID), chaque lien Booking inclut
// l'AID partenaire → commission ~4% du prix de la nuit reversée à TravelO.
// Inscription : https://partner.booking.com/fr/programme-daffiliation
const BOOKING_AFFILIATE_ID = import.meta.env?.VITE_BOOKING_AFFILIATE_ID || '';
const BOOKING_LABEL = 'travelo-itinerary';

// Vrai = URL pointant vers une vraie fiche d'établissement Booking.com (et non
// une recherche). On ouvrira l'hôtel EXACT au lieu d'une recherche.
function isBookingHotelUrl(url) {
  return (
    typeof url === 'string' &&
    /^https?:\/\/(www\.)?booking\.com\/hotel\//i.test(url.trim())
  );
}

// Ajoute l'AID partenaire (commission) à une URL Booking existante.
function withBookingAffiliate(url) {
  if (!BOOKING_AFFILIATE_ID) return url;
  try {
    const u = new URL(url);
    u.searchParams.set('aid', BOOKING_AFFILIATE_ID);
    u.searchParams.set('label', BOOKING_LABEL);
    return u.toString();
  } catch {
    return url;
  }
}

// Booking exige checkout > checkin. Si on a juste la date du jour, on ajoute
// +1 jour pour le checkout (1 nuit par défaut).
function addOneDay(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// childrenAges : tableau d'âges (ex: [8, 5]). Booking exige un paramètre
// "age" par enfant pour proposer les bonnes chambres familiales et les
// bons tarifs. On accepte aussi un nombre (rétrocompat) → ages inconnus.
//
// options (tous optionnels) :
//   rooms       : nombre de chambres (no_rooms)
//   stars       : '3' | '4' | '5'  → filtre classe (nflt class)
//   reviewScore : '6' | '7' | '8' | '9' → note mini des voyageurs (nflt review_score)
//   priceMin    : prix mini /nuit en EUR (filtre nflt price)
//   priceMax    : prix maxi /nuit en EUR
//   amenities   : ['breakfast','free_cancellation','parking','pool'] → filtres nflt
export function bookingSearch(
  location,
  checkin,
  checkout,
  adults = 2,
  childrenAges = [],
  options = {}
) {
  const ages = Array.isArray(childrenAges)
    ? childrenAges.map((a) => Number(a)).filter((a) => Number.isFinite(a) && a >= 0)
    : [];
  const childrenCount = Array.isArray(childrenAges)
    ? ages.length
    : Number(childrenAges) || 0;
  const safeCheckout =
    checkout && checkout !== checkin ? checkout : addOneDay(checkin);
  const params = new URLSearchParams({
    ss: location || '',
    checkin: checkin || '',
    checkout: safeCheckout,
    group_adults: String(Math.max(1, Number(adults) || 1)),
    group_children: String(childrenCount),
    selected_currency: 'EUR',
    lang: 'fr',
    no_rooms: String(Math.max(1, Number(options.rooms) || 1)),
  });
  // Un paramètre "age" par enfant (Booking le requiert pour les familles)
  for (const age of ages) {
    params.append('age', String(age));
  }
  // Filtres Booking (paramètre nflt, segments séparés par ';').
  // Format : nflt=price=EUR-min-max-1;class=4;mealplan=1;fc=2;...
  const nflt = [];
  const pMin = Math.max(0, Math.round(Number(options.priceMin) || 0));
  const pMax = Math.max(0, Math.round(Number(options.priceMax) || 0));
  if (pMax > 0 && pMax >= pMin) {
    nflt.push(`price=EUR-${pMin}-${pMax}-1`);
  }
  if (options.stars && ['3', '4', '5'].includes(String(options.stars))) {
    nflt.push(`class=${options.stars}`);
  }
  // Note minimale des voyageurs. Booking attend la note × 10 :
  // 9+ → 90, 8+ → 80, 7+ → 70, 6+ → 60 (paramètre nflt review_score).
  const reviewScore = String(options.reviewScore || '');
  if (['6', '7', '8', '9'].includes(reviewScore)) {
    nflt.push(`review_score=${Number(reviewScore) * 10}`);
  }
  const amenities = Array.isArray(options.amenities) ? options.amenities : [];
  // IDs de facilités Booking les plus stables :
  if (amenities.includes('breakfast')) nflt.push('mealplan=1');
  if (amenities.includes('free_cancellation')) nflt.push('fc=2');
  if (amenities.includes('parking')) nflt.push('hotelfacility=2');
  if (amenities.includes('pool')) nflt.push('hotelfacility=433');
  if (nflt.length > 0) {
    params.set('nflt', nflt.join(';'));
  }
  if (BOOKING_AFFILIATE_ID) {
    params.set('aid', BOOKING_AFFILIATE_ID);
    params.set('label', BOOKING_LABEL);
  }
  return `https://www.booking.com/searchresults.fr.html?${params.toString()}`;
}

export function directFerriesSearch(from, to, date) {
  const params = new URLSearchParams({
    from: from || '',
    to: to || '',
    departure_date: date || '',
  });
  return `https://www.directferries.fr/?${params.toString()}`;
}

// IDs d'affiliation optionnels. Si configurés (via .env VITE_*),
// les liens incluent automatiquement le tracking pour toucher la commission.
const GYG_PARTNER_ID = import.meta.env?.VITE_GYG_PARTNER_ID || '';
const TIQETS_PARTNER_ID = import.meta.env?.VITE_TIQETS_PARTNER_ID || '';

// Heuristique : détermine si une activité a des chances d'être réservable
// en ligne sur GetYourGuide / Tiqets / Viator. Évite d'afficher des liens
// vers des recherches vides (qui font "pas sérieux").
const TICKETED_KEYWORDS = [
  // Patrimoine / musées
  'musée', 'musee', 'château', 'chateau', 'cathédrale', 'cathedrale',
  'basilique', 'palais', 'monument', 'forteresse', 'site archéologique',
  'sites archéologiques', 'archéo', 'patrimoine',
  // Parcs et attractions
  "parc d'attraction", 'parc national', 'zoo', 'aquarium', 'safari',
  'planétarium', 'planetarium',
  // Tours et visites
  'visite guidée', 'visite guidee', 'tour guidé', 'tour guide',
  'guidé', 'guide local', 'excursion', 'croisière', 'croisiere',
  // Sports / nautique payants
  'kayak', 'paddle', 'plongée', 'plongee', 'snorkel', 'voile',
  'parapente', 'canyoning', 'escalade', 'via ferrata', 'spéléo', 'speleo',
  'rafting', 'jet ski', 'quad',
  // Ateliers et expériences
  'cours', 'atelier', 'dégustation', 'degustation', 'œnologie', 'oenologie',
  'masterclass', 'initiation',
  // Spectacle / bien-être payant
  'spectacle', 'concert', 'théâtre', 'theatre', 'opéra', 'opera',
  'spa', 'thermes', 'thalasso', 'sauna', 'hammam',
  // Mots explicites
  'billet', 'entrée', 'entree', 'ticket', 'réservation', 'reservation',
];

const FREE_KEYWORDS = [
  'balade', 'flânerie', 'flanerie', 'flâner', 'flaner', 'promenade',
  'marché local', 'marché libre', 'flâner sur le marché',
  'plage', 'baignade', 'pique-nique', 'pique nique', 'piquenique',
  'point de vue', 'panorama', 'belvédère', 'belvedere', 'mirador',
  'apéro', 'apero', 'détente', 'detente', 'repos', 'farniente',
  'coucher de soleil', 'lever de soleil', 'sunset',
  'temps libre', 'shopping libre',
];

export function isLikelyBookable(activity) {
  if (!activity) return false;
  // Si le modèle a explicitement marqué l'activité, on respecte
  if (typeof activity.bookable === 'boolean') return activity.bookable;

  const price = Number(activity.price_per_person_eur) || 0;
  const text = `${activity.title || ''} ${activity.description || ''}`.toLowerCase();

  // Mot-clé "free" présent → on cache
  if (FREE_KEYWORDS.some((k) => text.includes(k))) return false;

  // Prix > 0 → réservable
  if (price > 0) return true;

  // Mot-clé "ticketed" présent → réservable
  if (TICKETED_KEYWORDS.some((k) => text.includes(k))) return true;

  // Par défaut, dans le doute, on n'affiche pas le bouton (mieux vaut
  // sous-proposer que sur-proposer).
  return false;
}

export function getYourGuideSearch(activityTitle, location) {
  const query = [activityTitle, cleanLocation(location)]
    .filter(Boolean)
    .join(' ');
  const params = new URLSearchParams({ q: query });
  if (GYG_PARTNER_ID) params.set('partner_id', GYG_PARTNER_ID);
  return `https://www.getyourguide.com/s/?${params.toString()}`;
}

export function tiqetsSearch(activityTitle, location) {
  const query = [activityTitle, cleanLocation(location)]
    .filter(Boolean)
    .join(' ');
  const url = `https://www.tiqets.com/en/search?q=${q(query)}`;
  return TIQETS_PARTNER_ID
    ? `${url}&partner=${TIQETS_PARTNER_ID}`
    : url;
}

export function viatorSearch(activityTitle, location) {
  const query = [activityTitle, cleanLocation(location)]
    .filter(Boolean)
    .join(' ');
  return `https://www.viator.com/searchResults/all?text=${q(query)}`;
}

export function theForkSearch(restaurantName, city) {
  const params = new URLSearchParams();
  if (city) params.set('cityName', cleanLocation(city));
  if (restaurantName) params.set('searchText', restaurantName);
  return `https://www.thefork.fr/search?${params.toString()}`;
}

export function googleMapsMultiStop(stops) {
  if (!stops?.length) return null;
  const cleaned = stops
    .map(cleanLocation)
    .filter(Boolean)
    .filter((loc, i, arr) => loc !== arr[i - 1]); // dédoublonne arrêts consécutifs
  if (!cleaned.length) return null;
  const parts = cleaned
    .map((s) => encodeURIComponent(s).replace(/%20/g, '+'))
    .join('/');
  return `https://www.google.com/maps/dir/${parts}`;
}

export function viaMichelin(from, to) {
  return `https://www.viamichelin.fr/itineraires?dep=${q(from)}&arr=${q(to)}`;
}

// Toutes les clés sont stockées SANS accents pour faire du matching
// robuste avec normalizeAccents() ci-dessous.
const KNOWN_ACCOMMODATION_TYPES = {
  hotel: 'booking',
  resort: 'booking',
  'boutique-hotel': 'booking',
  airbnb: 'booking',
  auberge: 'booking',
  'chambre d hotes': 'booking',
  gite: 'booking',
  camping: 'park4night',
  'camping municipal': 'park4night',
  'aire de camping-car': 'park4night',
  'aire de camping-car publique': 'park4night',
  'aire de camping-car privee': 'park4night',
  'france passion': 'park4night',
  bivouac: 'park4night',
  'parking gratuit': 'park4night',
};

// Retire les accents et l'apostrophe pour que "Hôtel" matche "hotel",
// "Chambre d'hôtes" matche "chambre d hotes", etc.
function normalizeAccents(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’']/g, ' ');
}

export function bestAccommodationLink(accommodation, ctx = {}) {
  if (!accommodation) return null;
  const type = normalizeAccents(accommodation.type);
  const matchKey = Object.keys(KNOWN_ACCOMMODATION_TYPES).find((k) =>
    type.includes(k)
  );
  const provider = matchKey ? KNOWN_ACCOMMODATION_TYPES[matchKey] : 'google';
  const cityName = cleanLocation(ctx.location) || '';
  // Zone conseillée (quartier proche des excursions) — sert de recherche
  // Booking pour afficher une LISTE d'hôtels réels dispos dans la bonne zone,
  // au lieu de chercher un hôtel inventé par son nom. On ne cherche par nom
  // QUE si l'utilisateur a confirmé un vrai hôtel (réservation importée).
  const area = (accommodation.area || '').trim();
  const hint = (accommodation.coordinates_hint || '').trim();
  // Zone conseillée affichée dans la carte (même priorité que l'affichage :
  // area, puis indice de coordonnées). Cette zone peut désigner une AUTRE
  // ville que le lieu du jour (ex : on dort à Cascais alors que la journée se
  // passe à Sintra). On cherche donc cette zone TELLE QUELLE sur Booking et on
  // n'y ajoute PAS le lieu du jour, sinon Booking chercherait au mauvais
  // endroit (« Sintra » au lieu de « Cascais center »).
  const zone = area || hint;
  const userConfirmed = !!accommodation._user_edited && !!accommodation.name;
  // Pour Booking : on cherche par VILLE (le seul niveau géolocalisé de façon
  // fiable ; un quartier ou une phrase descriptive renvoie Booking n'importe où).
  //  1) si l'IA a fourni un champ dédié "booking_city" (format "Ville, Pays"),
  //     on l'utilise tel quel — c'est le plus fiable ;
  //  2) sinon on déduit la ville depuis la zone conseillée (area), JAMAIS depuis
  //     coordinates_hint qui est souvent une phrase ("Proche de la gare…").
  // Pour Google Maps : on garde la zone brute (les coordonnées y marchent bien).
  const bookingCity = (accommodation.booking_city || '').trim();
  const bookingZone =
    bookingCity || pickBookingCity(area, ctx.location) || cityName;
  const zoneQuery = zone || cityName;
  const bookingQuery = userConfirmed
    ? `${accommodation.name}${cityName ? ', ' + cityName : ''}`
    : bookingZone;
  const fallbackText = userConfirmed
    ? `${accommodation.name} ${accommodation.coordinates_hint || cityName}`.trim()
    : zoneQuery;

  // Critères Booking issus des préférences utilisateur (transmis via ctx).
  const bookingOptions = {
    rooms: ctx.rooms,
    stars: ctx.stars,
    reviewScore: ctx.reviewScore,
    priceMin: ctx.priceMin,
    priceMax: ctx.priceMax,
    amenities: ctx.amenities,
  };

  if (provider === 'park4night') {
    return {
      provider: 'Park4Night',
      url: park4nightSearch(cityName || fallbackText),
    };
  }
  if (provider === 'booking') {
    // Hôtel confirmé par l'utilisateur (capture ou saisie) :
    //  - si on a l'URL exacte de la fiche Booking → on l'ouvre directement ;
    //  - sinon on cherche par NOM (sans les filtres gamme/prix/note, sinon
    //    l'hôtel exact pourrait être masqué) → il ressort en tête.
    if (userConfirmed && isBookingHotelUrl(accommodation.booking_url)) {
      return {
        provider: 'Booking',
        url: withBookingAffiliate(accommodation.booking_url.trim()),
      };
    }
    return {
      provider: 'Booking',
      url: bookingSearch(
        bookingQuery,
        ctx.checkin,
        ctx.checkout,
        ctx.adults,
        // Préfère les âges détaillés ; retombe sur le compte si non fournis
        ctx.childrenAges != null ? ctx.childrenAges : ctx.children,
        userConfirmed ? {} : bookingOptions
      ),
    };
  }
  return {
    provider: 'Google Maps',
    url: googleMapsSearch(fallbackText),
  };
}
