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
