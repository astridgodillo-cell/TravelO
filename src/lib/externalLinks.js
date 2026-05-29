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

// Transforme une "zone conseillée" descriptive (générée par l'IA) en une
// destination que le moteur de recherche de Booking sait géolocaliser. Booking
// échoue souvent sur les libellés bavards ou en français et retombe alors sur
// une mauvaise ville. On le ramène donc au nom de lieu reconnaissable.
//   "Cascais centre"               → "Cascais"
//   "Ribeira / Centre historique"  → "Ribeira"
//   "Stare Miasto (vieille ville)" → "Stare Miasto"
//   "Ribeira, Porto"               → "Ribeira, Porto" (forme idéale, gardée)
//   "Centre historique"            → "" (générique seul : inexploitable)
//   "38.696, -9.421"               → "" (coordonnées : inexploitables en texte)
function bookingDestination(zone) {
  let s = String(zone || '').trim();
  if (!s) return '';
  // Coordonnées brutes (lat, long) → Booking ne les comprend pas dans "ss".
  if (/^-?\d{1,3}\.\d+\s*[,;]\s*-?\d{1,3}\.\d+$/.test(s)) return '';
  // Retire un complément entre parenthèses : "(vieille ville)"
  s = s.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  // Coupe aux séparateurs de listes ("/", "•", "·", "—", "|") : on garde le
  // 1er segment, en général le quartier/ville précis ("Ribeira / Centre
  // historique" → "Ribeira").
  s = s.split(/\s*[/•·—|]\s*/)[0].trim();
  // Retire un qualificatif générique de centre-ville en fin de chaîne, qui
  // embrouille le géocodeur de Booking ("Cascais centre" → "Cascais").
  s = s
    .replace(
      /[\s,-]+(centre[-\s]?ville|centre|centro|center|downtown|vieille\s+ville|old\s+town|city\s+cent(?:er|re))\s*$/i,
      ''
    )
    .trim();
  // S'il ne reste qu'un libellé générique → inexploitable seul.
  if (!s || GENERIC_ONLY.test(s)) return '';
  return s;
}

// Choisit, parmi plusieurs libellés possibles (indice de ville, zone), la
// meilleure destination Booking. Préfère une forme "Quartier, Ville" (avec
// virgule), que Booking géolocalise le plus fiablement.
function pickBookingDestination(candidates, fallback) {
  const cleaned = candidates.map(bookingDestination).filter(Boolean);
  const withCity = cleaned.find((c) => c.includes(','));
  return withCity || cleaned[0] || fallback;
}

export { bookingDestination, pickBookingDestination };

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
  // Pour Booking : on choisit le libellé le plus géolocalisable parmi l'indice
  // de lieu (souvent "Quartier, Ville") et la zone conseillée (souvent
  // descriptive). Sinon Booking retombe sur la ville du jour, voire une autre
  // ville qui partage un nom de quartier générique. Pour Google Maps : on garde
  // la zone brute (les coordonnées y fonctionnent très bien).
  const bookingZone = pickBookingDestination([hint, area], cityName);
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
    return {
      provider: 'Booking',
      url: bookingSearch(
        bookingQuery,
        ctx.checkin,
        ctx.checkout,
        ctx.adults,
        // Préfère les âges détaillés ; retombe sur le compte si non fournis
        ctx.childrenAges != null ? ctx.childrenAges : ctx.children,
        bookingOptions
      ),
    };
  }
  return {
    provider: 'Google Maps',
    url: googleMapsSearch(fallbackText),
  };
}
