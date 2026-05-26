// Fonctions pures d'édition d'un itinéraire — utilisées pour l'édition
// manuelle inline (l'utilisateur clique sur un prix, tape la vraie valeur).
//
// Chaque fonction renvoie un NOUVEL itinéraire (immutable) avec le champ
// modifié + recalcul automatique des totaux du jour et du budget global.
//
// Pas d'effet de bord : pas d'appel API, juste de la transformation JSON.

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function getPax(itinerary) {
  const adults = itinerary?.summary?.travellers?.adults ?? 2;
  const children = itinerary?.summary?.travellers?.children_ages?.length ?? 0;
  return Math.max(1, adults + children);
}

/**
 * Recalcule le budget_summary à partir des VRAIES données jour par jour.
 * Source de vérité unique : on n'utilise plus les valeurs potentiellement
 * fausses de l'IA dans itinerary.budget_summary. Tout vient des jours.
 *
 *   trips_eur          = Σ day.trips[].estimated_cost_eur
 *   accommodation_eur  = Σ day.accommodation.price_eur
 *   meals_eur          = Σ day.meals.daily_family_budget_eur
 *   activities_eur     = Σ day.activities[].family_total_eur
 *   service_stops_eur  = Σ day.service_stops[].cost_eur
 *   grand_total_eur    = somme de tous les buckets ci-dessus
 *   per_person_eur     = grand_total / pax
 *
 * Renvoie l'objet budget_summary corrigé (ne mute pas l'itinéraire).
 */
export function recomputeBudgetFromDays(itinerary) {
  const days = Array.isArray(itinerary?.days) ? itinerary.days : [];
  const original = itinerary?.budget_summary || {};
  let trips_eur = 0;
  let accommodation_eur = 0;
  let meals_eur = 0;
  let activities_eur = 0;
  let service_stops_eur = 0;
  for (const d of days) {
    if (Array.isArray(d.trips)) {
      for (const t of d.trips) trips_eur += Number(t.estimated_cost_eur) || 0;
    }
    if (d.accommodation) {
      accommodation_eur += Number(d.accommodation.price_eur) || 0;
    }
    if (d.meals) {
      meals_eur += Number(d.meals.daily_family_budget_eur) || 0;
    }
    if (Array.isArray(d.activities)) {
      for (const a of d.activities)
        activities_eur += Number(a.family_total_eur) || 0;
    }
    if (Array.isArray(d.service_stops)) {
      for (const s of d.service_stops)
        service_stops_eur += Number(s.cost_eur) || 0;
    }
  }
  const grand_total_eur =
    trips_eur + accommodation_eur + meals_eur + activities_eur + service_stops_eur;
  const pax = getPax(itinerary);
  const per_person_eur = Math.round(grand_total_eur / pax);
  return {
    // On garde tout ce que l'IA avait posé (clés comme fuel_eur, tolls_eur,
    // ferries_eur, etc. utilisées dans la section "Détail trajets routiers")
    ...original,
    trips_eur: Math.round(trips_eur),
    accommodation_eur: Math.round(accommodation_eur),
    meals_eur: Math.round(meals_eur),
    activities_eur: Math.round(activities_eur),
    service_stops_eur: Math.round(service_stops_eur),
    grand_total_eur: Math.round(grand_total_eur),
    per_person_eur,
  };
}

/**
 * Applique un delta au day_total et au budget_summary :
 *   - day.day_total_eur += delta
 *   - budget_summary[bucket]_eur += delta  (ex: 'trips' → trips_eur)
 *   - budget_summary.grand_total_eur += delta
 *   - budget_summary.per_person_eur recalculé
 */
function applyDelta(itinerary, dayIndex, bucket, delta) {
  if (delta === 0) return;
  const day = itinerary.days?.[dayIndex];
  if (day) {
    day.day_total_eur = (Number(day.day_total_eur) || 0) + delta;
  }
  if (!itinerary.budget_summary) itinerary.budget_summary = {};
  const key = `${bucket}_eur`;
  itinerary.budget_summary[key] =
    (Number(itinerary.budget_summary[key]) || 0) + delta;
  itinerary.budget_summary.grand_total_eur =
    (Number(itinerary.budget_summary.grand_total_eur) || 0) + delta;
  const pax = getPax(itinerary);
  if (pax > 0) {
    itinerary.budget_summary.per_person_eur = Math.round(
      itinerary.budget_summary.grand_total_eur / pax
    );
  }
}

/**
 * Applique une extraction de vol (capture Google Flights) à TOUS les trips
 * "Avion" matchant de l'itinéraire :
 *   - Trip avec origin_iata / destination_iata correspondant à `outbound`
 *     → patche avec airline, flight_number, departure_at, arrival_at, prix
 *   - Trip correspondant à `return` (= inverse) → patche idem
 *
 * Matching de robustesse :
 *  1. trip._flight.origin_iata + destination_iata (les codes IATA déjà
 *     posés par Duffel / Travelpayouts lors de la génération)
 *  2. fallback texte : trip.from / trip.to (case insensitive includes)
 *     contre les codes IATA + noms de ville devinés.
 *
 * Recalcule le budget : ancien total des Avion remplacés - nouveau total.
 *
 *   extracted = { is_round_trip, total_price_eur, outbound, return, ... }
 */
export function applyExtractedFlightsToItinerary(itinerary, extracted) {
  if (!extracted?.outbound) return itinerary;
  const next = deepClone(itinerary);
  if (!Array.isArray(next.days)) return next;

  const outbound = extracted.outbound;
  const returnLeg = extracted.return || null;
  const isRoundTrip = !!returnLeg;
  const totalPriceEur = Math.max(0, Math.round(Number(extracted.total_price_eur) || 0));
  const outboundCost = isRoundTrip ? Math.round(totalPriceEur / 2) : totalPriceEur;
  const returnCost = isRoundTrip ? totalPriceEur - outboundCost : 0;

  function tripMatchesLeg(trip, leg) {
    if (!leg?.origin_iata || !leg?.destination_iata) return false;
    const tripOrigin = trip._flight?.origin_iata || '';
    const tripDest = trip._flight?.destination_iata || '';
    if (
      tripOrigin.toUpperCase() === leg.origin_iata.toUpperCase() &&
      tripDest.toUpperCase() === leg.destination_iata.toUpperCase()
    ) {
      return true;
    }
    // Fallback texte : trip.from / to contient l'IATA ou un mot reconnu
    const fromText = String(trip.from || '').toLowerCase();
    const toText = String(trip.to || '').toLowerCase();
    return (
      (fromText.includes(leg.origin_iata.toLowerCase()) ||
        fromText.includes(leg.origin_iata.toUpperCase())) &&
      (toText.includes(leg.destination_iata.toLowerCase()) ||
        toText.includes(leg.destination_iata.toUpperCase()))
    );
  }

  function patchTripWithLeg(trip, leg, cost) {
    const oldCost = Number(trip.estimated_cost_eur) || 0;
    trip.estimated_cost_eur = cost;
    trip.cost_note = `Vol corrigé manuellement via une capture (${
      leg.airline_code || leg.airline || ''
    }${leg.flight_number || ''})`;
    trip._user_edited = true;
    trip._flight = {
      ...(trip._flight || {}),
      airline: leg.airline_code || leg.airline || trip._flight?.airline || '',
      flight_number: leg.flight_number || trip._flight?.flight_number || null,
      departure_at: leg.departure_at || trip._flight?.departure_at || null,
      arrival_at: leg.arrival_at || trip._flight?.arrival_at || null,
      origin_iata: leg.origin_iata || trip._flight?.origin_iata || null,
      destination_iata: leg.destination_iata || trip._flight?.destination_iata || null,
      // On garde le deeplink existant (si Duffel/Travelpayouts en avait posé un)
      // OU on en pose un nouveau Google Flights basé sur les IATA extraits.
      deeplink: trip._flight?.deeplink || buildSimpleGoogleFlightsLink(leg),
      source: trip._flight?.source || 'user-imported',
    };
    return cost - oldCost; // delta
  }

  let totalDelta = 0;
  for (let di = 0; di < next.days.length; di++) {
    const day = next.days[di];
    if (!Array.isArray(day.trips)) continue;
    for (const t of day.trips) {
      if (!/avion|vol|flight|plane/i.test(t.mode || '')) continue;
      if (tripMatchesLeg(t, outbound)) {
        const delta = patchTripWithLeg(t, outbound, outboundCost);
        day.day_total_eur = (day.day_total_eur || 0) + delta;
        totalDelta += delta;
      } else if (returnLeg && tripMatchesLeg(t, returnLeg)) {
        const delta = patchTripWithLeg(t, returnLeg, returnCost);
        day.day_total_eur = (day.day_total_eur || 0) + delta;
        totalDelta += delta;
      }
    }
  }

  if (totalDelta !== 0 && next.budget_summary) {
    next.budget_summary.trips_eur =
      (next.budget_summary.trips_eur || 0) + totalDelta;
    next.budget_summary.grand_total_eur =
      (next.budget_summary.grand_total_eur || 0) + totalDelta;
    const pax = getPax(next);
    if (pax > 0) {
      next.budget_summary.per_person_eur = Math.round(
        next.budget_summary.grand_total_eur / pax
      );
    }
  }

  return next;
}

function buildSimpleGoogleFlightsLink(leg) {
  if (!leg?.origin_iata || !leg?.destination_iata || !leg?.departure_at) {
    return null;
  }
  const date = leg.departure_at.substring(0, 10);
  const q = `Flights from ${leg.origin_iata} to ${leg.destination_iata} on ${date} one-way for 1 adult`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}&curr=EUR&hl=fr`;
}

/**
 * Modifie le prix total famille d'un trip (vol, voiture, ferry, etc.).
 * Recalcule day_total_eur + budget_summary.trips_eur + grand_total + per_person.
 */
export function updateTripPrice(itinerary, dayIndex, tripIndex, newPriceEur) {
  const next = deepClone(itinerary);
  const trip = next.days?.[dayIndex]?.trips?.[tripIndex];
  if (!trip) return next;
  const oldCost = Number(trip.estimated_cost_eur) || 0;
  const newCost = Math.max(0, Math.round(Number(newPriceEur) || 0));
  trip.estimated_cost_eur = newCost;
  trip._user_edited = true;
  trip.cost_note = `Prix corrigé manuellement par l'utilisateur`;
  applyDelta(next, dayIndex, 'trips', newCost - oldCost);
  return next;
}

/**
 * Modifie un champ texte d'un trip "Vol" (compagnie, n° de vol, heures
 * de départ et d'arrivée). N'affecte pas les totaux.
 *
 *   field ∈ 'airline' | 'flight_number' | 'departure_at' | 'arrival_at'
 */
export function updateFlightField(
  itinerary,
  dayIndex,
  tripIndex,
  field,
  value
) {
  const next = deepClone(itinerary);
  const trip = next.days?.[dayIndex]?.trips?.[tripIndex];
  if (!trip) return next;
  if (!trip._flight) trip._flight = {};
  trip._flight[field] = value || null;
  trip._user_edited = true;
  return next;
}

/**
 * Modifie le prix PAR PERSONNE d'une activité.
 * Met à jour aussi family_total_eur (× pax) et recalcule les totaux.
 */
export function updateActivityPricePerPerson(
  itinerary,
  dayIndex,
  activityIndex,
  newPricePerPersonEur
) {
  const next = deepClone(itinerary);
  const activity = next.days?.[dayIndex]?.activities?.[activityIndex];
  if (!activity) return next;
  const pax = getPax(next);
  const oldFamily = Number(activity.family_total_eur) || 0;
  const newPerPax = Math.max(0, Math.round(Number(newPricePerPersonEur) || 0));
  const newFamily = newPerPax * pax;
  activity.price_per_person_eur = newPerPax;
  activity.family_total_eur = newFamily;
  activity._user_edited = true;
  applyDelta(next, dayIndex, 'activities', newFamily - oldFamily);
  return next;
}

/**
 * Modifie le titre d'une activité (ex : l'utilisateur précise "Visite guidée
 * de la Cathédrale, 11h" au lieu du libellé générique).
 */
export function updateActivityTitle(
  itinerary,
  dayIndex,
  activityIndex,
  newTitle
) {
  const next = deepClone(itinerary);
  const activity = next.days?.[dayIndex]?.activities?.[activityIndex];
  if (!activity) return next;
  activity.title = newTitle;
  activity._user_edited = true;
  return next;
}

/**
 * Modifie le prix de l'hébergement pour CETTE nuit.
 * Recalcule day_total_eur + budget_summary.accommodation_eur.
 */
export function updateAccommodationPrice(itinerary, dayIndex, newPriceEur) {
  const next = deepClone(itinerary);
  const day = next.days?.[dayIndex];
  if (!day?.accommodation) return next;
  const oldPrice = Number(day.accommodation.price_eur) || 0;
  const newPrice = Math.max(0, Math.round(Number(newPriceEur) || 0));
  day.accommodation.price_eur = newPrice;
  day.accommodation._user_edited = true;
  applyDelta(next, dayIndex, 'accommodation', newPrice - oldPrice);
  return next;
}

/**
 * Modifie le nom de l'hébergement (ex : "Hôtel Barcelona Center" → "Hostal
 * Operaramblas" que l'utilisateur a réservé en vrai).
 */
export function updateAccommodationName(itinerary, dayIndex, newName) {
  const next = deepClone(itinerary);
  const day = next.days?.[dayIndex];
  if (!day?.accommodation) return next;
  day.accommodation.name = newName;
  day.accommodation._user_edited = true;
  return next;
}

/**
 * Remplace COMPLÈTEMENT l'hébergement du jour par une nouvelle structure
 * (utilisé quand l'utilisateur importe un hôtel depuis une capture d'écran
 * Booking, ou choisit explicitement un autre lieu). Recalcule le budget
 * accommodation_eur en appliquant le delta de prix.
 *
 *   newAccommodation : {
 *     name, type, price_eur, services?, rating?, address_hint?, ...
 *   }
 */
export function replaceAccommodation(itinerary, dayIndex, newAccommodation) {
  const next = deepClone(itinerary);
  const day = next.days?.[dayIndex];
  if (!day) return next;
  const oldPrice = Number(day.accommodation?.price_eur) || 0;
  const newPrice = Math.max(0, Math.round(Number(newAccommodation.price_eur) || 0));
  day.accommodation = {
    ...newAccommodation,
    price_eur: newPrice,
    _user_edited: true,
  };
  applyDelta(next, dayIndex, 'accommodation', newPrice - oldPrice);
  return next;
}

/**
 * Ajoute un hôtel comme ALTERNATIVE au choix actuel (ne change pas la
 * priorité 1 ni le budget). Utile pour empiler plusieurs candidats trouvés
 * sur Booking et trancher plus tard.
 *
 * Les alternatives sont stockées dans day.accommodation_alternatives (un
 * tableau qui n'existe pas par défaut). day.accommodation reste la priorité 1.
 */
export function addAccommodationAlternative(itinerary, dayIndex, newAccommodation) {
  const next = deepClone(itinerary);
  const day = next.days?.[dayIndex];
  if (!day) return next;
  // Si aucun hôtel n'est encore défini comme priorité 1, le nouveau le devient
  // directement (cas peu probable mais cohérent).
  if (!day.accommodation || !day.accommodation.name) {
    return replaceAccommodation(next, dayIndex, newAccommodation);
  }
  if (!Array.isArray(day.accommodation_alternatives)) {
    day.accommodation_alternatives = [];
  }
  day.accommodation_alternatives.push({
    ...newAccommodation,
    price_eur: Math.max(0, Math.round(Number(newAccommodation.price_eur) || 0)),
    _user_edited: true,
  });
  return next;
}

/**
 * Promeut une alternative en priorité 1 : l'hôtel actuel descend en
 * alternative, et l'alternative choisie devient l'actif (utilisé pour le
 * budget et l'affichage principal). Recalcule le budget en conséquence.
 */
export function promoteAccommodationAlternative(itinerary, dayIndex, altIndex) {
  const next = deepClone(itinerary);
  const day = next.days?.[dayIndex];
  if (!day) return next;
  const alts = Array.isArray(day.accommodation_alternatives)
    ? day.accommodation_alternatives
    : [];
  if (altIndex < 0 || altIndex >= alts.length) return next;
  const newPrimary = alts[altIndex];
  const oldPrimary = day.accommodation;
  // Retire l'alternative qu'on promeut
  alts.splice(altIndex, 1);
  // L'ancien priorité 1 part en tête des alternatives (toujours accessible)
  if (oldPrimary && oldPrimary.name) {
    alts.unshift(oldPrimary);
  }
  day.accommodation_alternatives = alts;
  day.accommodation = newPrimary;
  // Recalcul budget : delta = nouveau prix - ancien prix
  const oldPrice = Number(oldPrimary?.price_eur) || 0;
  const newPrice = Number(newPrimary?.price_eur) || 0;
  applyDelta(next, dayIndex, 'accommodation', newPrice - oldPrice);
  return next;
}

/**
 * Supprime une alternative (sans toucher la priorité 1). Pas d'impact
 * budget. Utilisé pour nettoyer la shortlist quand l'utilisateur a tranché.
 */
export function removeAccommodationAlternative(itinerary, dayIndex, altIndex) {
  const next = deepClone(itinerary);
  const day = next.days?.[dayIndex];
  if (!day || !Array.isArray(day.accommodation_alternatives)) return next;
  if (altIndex < 0 || altIndex >= day.accommodation_alternatives.length) return next;
  day.accommodation_alternatives.splice(altIndex, 1);
  return next;
}

/**
 * Modifie le titre d'un moment (matin / midi / aprem / soir) de la journée.
 *   momentKey ∈ 'morning' | 'noon' | 'afternoon' | 'evening'
 */
export function updateMomentTitle(itinerary, dayIndex, momentKey, newTitle) {
  const next = deepClone(itinerary);
  const day = next.days?.[dayIndex];
  if (!day) return next;
  if (!day[momentKey]) day[momentKey] = {};
  day[momentKey].title = newTitle;
  day[momentKey]._user_edited = true;
  return next;
}

/**
 * Modifie la description d'un moment (matin / midi / aprem / soir).
 */
export function updateMomentDescription(
  itinerary,
  dayIndex,
  momentKey,
  newDescription
) {
  const next = deepClone(itinerary);
  const day = next.days?.[dayIndex];
  if (!day) return next;
  if (!day[momentKey]) day[momentKey] = {};
  day[momentKey].description = newDescription;
  day[momentKey]._user_edited = true;
  return next;
}

// Fenêtres horaires des 4 moments de la journée. Utilisé pour décider
// quelles activités appartiennent à quel créneau (basé sur leur "schedule").
const MOMENT_TIME_RANGES = {
  morning: { start: '00:00', end: '11:59' },
  noon: { start: '12:00', end: '13:59' },
  afternoon: { start: '14:00', end: '18:59' },
  evening: { start: '19:00', end: '23:59' },
};

function parseScheduleStart(schedule) {
  if (!schedule || typeof schedule !== 'string') return null;
  const m = schedule.match(/(\d{1,2})\s*[:hH]\s*(\d{2})?/);
  if (!m) return null;
  const hh = String(m[1]).padStart(2, '0');
  const mm = (m[2] || '00').padStart(2, '0');
  return `${hh}:${mm}`;
}

function activityIsInMoment(activity, momentKey) {
  const range = MOMENT_TIME_RANGES[momentKey];
  if (!range) return false;
  const start = parseScheduleStart(activity?.schedule);
  if (!start) return false;
  return start >= range.start && start <= range.end;
}

/**
 * Vide un moment de la journée : marque le créneau comme LIBRE / REPOS.
 * Supprime AUSSI les activités/excursions qui tombent dans ce créneau
 * horaire (sinon on se retrouve avec un matin "libre" mais une activité
 * "Visite de la basilique 09h-10h" toujours listée plus bas — incohérent).
 *
 * Recalcule budget_summary.activities_eur et day_total_eur en soustrayant
 * le total famille des activités retirées.
 */
export function clearMoment(itinerary, dayIndex, momentKey) {
  const next = deepClone(itinerary);
  const day = next.days?.[dayIndex];
  if (!day) return next;

  // 1) Vide le moment textuel
  day[momentKey] = {
    title: 'Libre / Repos',
    description: '',
    _user_cleared: true,
    _user_edited: true,
  };

  // 2) Retire les activités qui appartenaient à ce créneau horaire
  if (Array.isArray(day.activities) && day.activities.length > 0) {
    const removed = day.activities.filter((a) => activityIsInMoment(a, momentKey));
    if (removed.length > 0) {
      day.activities = day.activities.filter((a) => !activityIsInMoment(a, momentKey));
      // 3) Recalibrage budget : delta négatif sur "activities"
      const removedTotal = removed.reduce(
        (sum, a) => sum + (Number(a.family_total_eur) || 0),
        0
      );
      if (removedTotal !== 0) {
        applyDelta(next, dayIndex, 'activities', -removedTotal);
      }
    }
  }

  return next;
}

/**
 * Remplace un moment complet (utilisé par "Proposer d'autres options" :
 * l'utilisateur choisit une alternative renvoyée par l'IA).
 */
export function replaceMoment(itinerary, dayIndex, momentKey, alternative) {
  const next = deepClone(itinerary);
  const day = next.days?.[dayIndex];
  if (!day) return next;
  day[momentKey] = {
    title: alternative.title || '',
    description: alternative.description || '',
    _user_edited: true,
  };
  return next;
}

/**
 * Modifie le budget repas du jour (total famille pour la journée).
 * Recalcule day_total_eur + budget_summary.meals_eur.
 */
export function updateMealsBudget(itinerary, dayIndex, newDailyFamilyEur) {
  const next = deepClone(itinerary);
  const day = next.days?.[dayIndex];
  if (!day?.meals) return next;
  const oldBudget = Number(day.meals.daily_family_budget_eur) || 0;
  const newBudget = Math.max(0, Math.round(Number(newDailyFamilyEur) || 0));
  day.meals.daily_family_budget_eur = newBudget;
  day.meals._user_edited = true;
  applyDelta(next, dayIndex, 'meals', newBudget - oldBudget);
  return next;
}
