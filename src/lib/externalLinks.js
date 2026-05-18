const q = (s) => encodeURIComponent(s || '');

export function googleMapsSearch(query) {
  return `https://www.google.com/maps/search/?api=1&query=${q(query)}`;
}

export function googleMapsDirections(from, to) {
  // Format path : /maps/dir/<from>/<to> — plus fiable que ?api=1 pour
  // imposer les deux points (le format api=1 est parfois interprété comme
  // "directions vers X depuis ma position" par l'app mobile Google Maps).
  const safeFrom = q(from).replace(/%20/g, '+');
  const safeTo = q(to).replace(/%20/g, '+');
  return `https://www.google.com/maps/dir/${safeFrom}/${safeTo}/`;
}

export function park4nightSearch(location) {
  return `https://park4night.com/fr/search?text=${q(location)}`;
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
  // Crée un itinéraire Google Maps multi-arrêts.
  // Format: https://www.google.com/maps/dir/A/B/C/D
  if (!stops?.length) return null;
  const parts = stops
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
