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
export function bookingSearch(location, checkin, checkout, adults = 2, childrenAges = []) {
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
    no_rooms: '1',
  });
  // Un paramètre "age" par enfant (Booking le requiert pour les familles)
  for (const age of ages) {
    params.append('age', String(age));
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
  // Le nom complet de l'hôtel + ville = atterrissage direct sur la fiche
  // hôtel ~80% du temps (Booking matche par nom). Sans le nom, on retombe
  // sur une liste générique de la ville, ce qui fait perdre la conversion.
  const cityName = cleanLocation(ctx.location) || '';
  const bookingQuery = accommodation.name
    ? `${accommodation.name}${cityName ? ', ' + cityName : ''}`
    : cityName;
  const fallbackText = accommodation.name
    ? `${accommodation.name} ${accommodation.coordinates_hint || cityName}`.trim()
    : cityName;

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
        ctx.childrenAges != null ? ctx.childrenAges : ctx.children
      ),
    };
  }
  return {
    provider: 'Google Maps',
    url: googleMapsSearch(fallbackText),
  };
}
