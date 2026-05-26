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
