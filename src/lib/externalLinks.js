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

export function bookingSearch(location, checkin, checkout, adults = 2, children = 0) {
  const params = new URLSearchParams({
    ss: location || '',
    checkin: checkin || '',
    checkout: checkout || '',
    group_adults: String(adults),
    group_children: String(children),
  });
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

const KNOWN_ACCOMMODATION_TYPES = {
  hotel: 'booking',
  resort: 'booking',
  'boutique-hôtel': 'booking',
  airbnb: 'booking',
  auberge: 'booking',
  camping: 'park4night',
  'camping municipal': 'park4night',
  'aire de camping-car': 'park4night',
  'aire de camping-car publique': 'park4night',
  'aire de camping-car privée': 'park4night',
  'france passion': 'park4night',
  bivouac: 'park4night',
  'parking gratuit': 'park4night',
};

export function bestAccommodationLink(accommodation, ctx = {}) {
  if (!accommodation) return null;
  const type = (accommodation.type || '').toLowerCase();
  const matchKey = Object.keys(KNOWN_ACCOMMODATION_TYPES).find((k) =>
    type.includes(k)
  );
  const provider = matchKey ? KNOWN_ACCOMMODATION_TYPES[matchKey] : 'google';
  const searchText = accommodation.name
    ? `${accommodation.name} ${accommodation.coordinates_hint || ''}`.trim()
    : ctx.location || '';

  if (provider === 'park4night') {
    return {
      provider: 'Park4Night',
      url: park4nightSearch(ctx.location || searchText),
    };
  }
  if (provider === 'booking') {
    return {
      provider: 'Booking',
      url: bookingSearch(
        ctx.location || searchText,
        ctx.checkin,
        ctx.checkout,
        ctx.adults,
        ctx.children
      ),
    };
  }
  return {
    provider: 'Google Maps',
    url: googleMapsSearch(searchText),
  };
}
