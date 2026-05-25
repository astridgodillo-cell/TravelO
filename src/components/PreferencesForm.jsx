import { useEffect, useState } from 'react';
import TemplatePicker from './TemplatePicker';
import Icon from './Icon';
import {
  TRIP_TYPES,
  MOTORIZED_TRIP_TYPES,
  ROAD_TRIP_TYPES,
  SCHEDULED_TRIP_TYPES,
  normalizeTripType,
  INTERESTS,
  SPECIFIC_ACTIVITIES,
  BUDGET_LEVELS,
  VEHICLE_TYPES,
  FUEL_TYPES,
  NIGHT_STAY_OPTIONS,
  COOKING_OPTIONS,
  suggestStayPrefs,
} from '../lib/preferenceOptions';

export const DEFAULTS = {
  destinations: '',
  startDate: '',
  endDate: '',
  departureLocation: '',
  returnLocation: '',
  adults: 2,
  childrenAges: [],
  tripType: 'itinerant',
  interests: ['culture', 'gastronomie'],
  specificActivities: [],
  budget: 'moyen',
  offDays: 0,
  mustInclude: '',
  toAvoid: '',
  vehicle: {
    type: '',
    height: '',
    length: '',
    fuel: 'diesel',
    consumption: '',
  },
  // Permis de conduire — si false, l'IA ne propose AUCUNE location voiture
  // ni scooter, uniquement transports en commun, taxi, vélo, marche,
  // excursions organisées. Coche par défaut car la majorité des adultes
  // ont le permis ; on le décoche seulement si l'utilisateur le précise.
  hasDrivingLicense: true,
  nightStayPreferences: ['Hôtel'],
  cooking: 'restaurants',
  needsServicePoints: false,
  okWithFerry: true,
  // Horaires & points d'entrée/sortie (avion, train international, croisière…)
  // Quand l'utilisateur arrive en transport longue distance, l'IA cale J1 avec
  // l'heure d'arrivée + installation, et le jour final avec la marge avant
  // l'heure de départ.
  hasFixedSchedule: false,        // forcer l'affichage de la section
  arrivalGateway: '',             // ex : "Aéroport Suvarnabhumi (Bangkok)"
  arrivalTime: '',                // "HH:MM" — heure locale d'arrivée à destination J1
  departureGateway: '',           // ex : "Gare de Madrid Atocha" (vide = identique à arrivalGateway)
  departureTime: '',              // "HH:MM" — heure du transport retour
  scheduledTransport: '',         // 'avion-intl' | 'avion-domestique' | 'train' | 'ferry' | 'croisiere' | ''
  // Vol déjà réservé : si renseigné, écrase l'estimation Travelpayouts.
  // Prix par personne (le backend multiplie par adults + enfants).
  manualFlight: {
    airline: '',
    flightNumber: '',
    outboundPriceEur: '',
    returnPriceEur: '',
  },
};

// Marge conseillée avant l'heure de départ (utilisée pour info dans l'UI ; le
// calage exact est laissé à l'IA selon le contexte).
const DEPARTURE_BUFFER_HINT = {
  'avion-intl': '~3 h à l\'aéroport',
  'avion-domestique': '~1 h 30 à l\'aéroport',
  train: '~30-45 min en gare',
  ferry: '~1 h au port',
  croisiere: '~2 h avant embarquement',
};

export function computeTotalDays(start, end) {
  if (!start || !end) return 0;
  const s = new Date(start);
  const e = new Date(end);
  if (isNaN(s) || isNaN(e) || e < s) return 0;
  return Math.round((e - s) / 86400000) + 1;
}

export default function PreferencesForm({ onSubmit, loading, initialValues }) {
  const [values, setValues] = useState(() =>
    initialValues ? { ...DEFAULTS, ...initialValues } : DEFAULTS
  );

  // Réinitialise quand initialValues change (ex : l'utilisateur clique
  // "Préremplir depuis mon profil" après le montage du formulaire).
  useEffect(() => {
    if (initialValues) setValues((v) => ({ ...DEFAULTS, ...v, ...initialValues }));
  }, [initialValues]);
  // Normalise les ids legacy (roadtrip-camping-car → roadtrip-van) au cas
  // où on charge un template historique.
  const tripType = normalizeTripType(values.tripType);
  // Road trip "classique" : van/CC/voiture perso → besoin des options
  // aires de service, ferry, cuisine, etc.
  const isRoadTrip = ROAD_TRIP_TYPES.has(tripType);
  // Tout type avec véhicule (road trip OU avion+voiture de location)
  // → besoin de la section "Véhicule"
  const isMotorized = MOTORIZED_TRIP_TYPES.has(tripType);
  const isRental = tripType === 'avion-voiture';
  // Trip avec horaire impératif (avion, train intl, croisière) → section
  // "Horaires d'arrivée et de départ" dépliée par défaut. L'utilisateur peut
  // aussi forcer son affichage manuellement (ferry, vol charter non listé…).
  const showSchedule =
    SCHEDULED_TRIP_TYPES.has(tripType) || values.hasFixedSchedule;
  // Pré-remplissage du select transport si on connaît le type de trip
  const defaultScheduledTransport =
    tripType === 'avion-voiture' || tripType === 'avion-citybreak'
      ? 'avion-intl'
      : tripType === 'train-international'
        ? 'train'
        : tripType === 'croisiere'
          ? 'croisiere'
          : '';
  const effectiveTransport = values.scheduledTransport || defaultScheduledTransport;
  const isAirTransport = effectiveTransport === 'avion-intl' || effectiveTransport === 'avion-domestique';
  const totalDays = computeTotalDays(values.startDate, values.endDate);
  const maxOffDays = Math.max(0, totalDays - 2); // au moins 1 jour de voyage à l'aller et 1 au retour

  function update(field, value) {
    setValues((v) => ({ ...v, [field]: value }));
  }

  function updateVehicle(field, value) {
    setValues((v) => ({ ...v, vehicle: { ...v.vehicle, [field]: value } }));
  }

  function updateManualFlight(field, value) {
    setValues((v) => ({
      ...v,
      manualFlight: { ...(v.manualFlight || {}), [field]: value },
    }));
  }

  function toggle(field, value) {
    setValues((v) => ({
      ...v,
      [field]: v[field].includes(value)
        ? v[field].filter((x) => x !== value)
        : [...v[field], value],
    }));
  }

  function pickVehicleType(typeId) {
    const preset = VEHICLE_TYPES.find((t) => t.id === typeId);
    if (!preset) return;
    setValues((v) => ({
      ...v,
      vehicle: {
        type: preset.id,
        height: v.vehicle.height || preset.height,
        length: v.vehicle.length || preset.length,
        fuel: preset.fuel,
        consumption: v.vehicle.consumption || preset.consumption,
      },
      nightStayPreferences:
        v.nightStayPreferences.length && v.nightStayPreferences[0] !== 'Hôtel'
          ? v.nightStayPreferences
          : suggestStayPrefs(preset.id),
      cooking:
        preset.id.includes('van') ||
        preset.id.includes('cc-') ||
        preset.id.includes('fourgon')
          ? 'mix'
          : v.cooking,
      needsServicePoints:
        preset.id.includes('van') ||
        preset.id.includes('cc-') ||
        preset.id.includes('fourgon'),
    }));
  }

  function addChild() {
    setValues((v) => ({ ...v, childrenAges: [...v.childrenAges, 5] }));
  }

  function updateChildAge(index, age) {
    setValues((v) => ({
      ...v,
      childrenAges: v.childrenAges.map((a, i) =>
        i === index ? Number(age) : a
      ),
    }));
  }

  function removeChild(index) {
    setValues((v) => ({
      ...v,
      childrenAges: v.childrenAges.filter((_, i) => i !== index),
    }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    // Garde-fou : impossible de soumettre si la date de fin est antérieure au départ
    if (
      values.startDate &&
      values.endDate &&
      values.endDate < values.startDate
    ) {
      alert(
        'La date de fin ne peut pas être antérieure à la date de début. Veuillez corriger.'
      );
      return;
    }
    const payload = {
      ...values,
      returnLocation: values.returnLocation || values.departureLocation,
    };
    // Strip vehicle data if not a road trip
    if (!isMotorized) payload.vehicle = null;
    onSubmit(payload);
  }

  function loadTemplate(prefs) {
    if (!prefs) return;
    setValues({ ...DEFAULTS, ...prefs });
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">
          Planifions votre voyage
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Remplissez les champs ci-dessous — nous rédigeons ensuite votre
          itinéraire jour-par-jour comme un tour-opérateur.
        </p>
      </div>

      <TemplatePicker currentPreferences={values} onLoad={loadTemplate} />

      <Section title="Destination & itinéraire">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="label">Destination(s) ou région</label>
            <input
              required
              className="input"
              placeholder="Ex : Côte ouest de la Corse, ou Tour du Mont-Blanc"
              value={values.destinations}
              onChange={(e) => update('destinations', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Date de début</label>
            <input
              required
              type="date"
              className="input"
              value={values.startDate}
              onChange={(e) => {
                const newStart = e.target.value;
                setValues((v) => ({
                  ...v,
                  startDate: newStart,
                  // Si la date de fin devient antérieure, on la remet à la date de début
                  endDate:
                    v.endDate && newStart && v.endDate < newStart
                      ? newStart
                      : v.endDate,
                }));
              }}
            />
          </div>
          <div>
            <label className="label">Date de fin</label>
            <input
              required
              type="date"
              className="input"
              min={values.startDate || undefined}
              value={values.endDate}
              onChange={(e) => update('endDate', e.target.value)}
            />
            {values.startDate &&
              values.endDate &&
              values.endDate < values.startDate && (
                <p className="text-xs text-red-600 mt-1">
                  La date de fin doit être après la date de début.
                </p>
              )}
          </div>
          <div>
            <label className="label">Lieu de départ</label>
            <input
              required
              className="input"
              placeholder="Ex : Lyon, France"
              value={values.departureLocation}
              onChange={(e) => update('departureLocation', e.target.value)}
            />
          </div>
          <div>
            <label className="label">
              Lieu d'arrivée final
              <span className="text-slate-400 font-normal">
                {' '}
                (vide = identique au départ, aller-retour)
              </span>
            </label>
            <input
              className="input"
              placeholder="Identique au départ"
              value={values.returnLocation}
              onChange={(e) => update('returnLocation', e.target.value)}
            />
          </div>
        </div>
      </Section>

      <Section title="Type de voyage">
        <div className="flex flex-wrap gap-2">
          {TRIP_TYPES.map((t) => {
            const active = values.tripType === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => update('tripType', t.id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm transition-colors ${
                  active
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                {t.icon && <Icon name={t.icon} className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
                {t.label}
              </button>
            );
          })}
        </div>
      </Section>

      <Section
        title={
          isAirTransport && showSchedule
            ? '✈️ Mon vol'
            : "Horaires d'arrivée et de départ"
        }
      >
        {!SCHEDULED_TRIP_TYPES.has(tripType) && (
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={values.hasFixedSchedule}
              onChange={(e) => update('hasFixedSchedule', e.target.checked)}
            />
            J'ai des horaires d'arrivée et de départ contraints (vol, train,
            ferry, croisière…)
          </label>
        )}
        {showSchedule && (
          <>
            <p className="text-xs text-slate-500 -mt-2">
              {isAirTransport
                ? "Tout est optionnel — plus vous renseignez, plus l'estimation est précise. Sinon, on récupère automatiquement compagnie, prix et horaires via notre fournisseur de vols (Aviasales ou Duffel). L'IA cale la journée d'arrivée avec le temps d'installation et le dernier jour avec la marge avant l'aéroport (~3 h)."
                : `Renseignez ces horaires si vous arrivez en train longue distance / croisière / ferry. L'IA calera la journée d'arrivée avec le temps d'installation, et le dernier jour avec la marge nécessaire avant le départ (${
                    DEPARTURE_BUFFER_HINT[effectiveTransport] ||
                    'marge adaptée au type de transport'
                  }).`}
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="label">Type de transport contraint</label>
                <select
                  className="input"
                  value={effectiveTransport}
                  onChange={(e) => update('scheduledTransport', e.target.value)}
                >
                  <option value="">— Sélectionnez —</option>
                  <option value="avion-intl">Vol international</option>
                  <option value="avion-domestique">Vol domestique</option>
                  <option value="train">Train (TGV, Eurostar…)</option>
                  <option value="ferry">Ferry / bateau</option>
                  <option value="croisiere">Croisière</option>
                </select>
              </div>

              {isAirTransport && (
                <>
                  <div>
                    <label className="label">Compagnie aérienne</label>
                    <input
                      className="input"
                      placeholder="Ex : Air France, Lufthansa…"
                      value={values.manualFlight?.airline || ''}
                      onChange={(e) =>
                        updateManualFlight('airline', e.target.value)
                      }
                    />
                  </div>
                  <div>
                    <label className="label">Numéro de vol</label>
                    <input
                      className="input"
                      placeholder="Ex : AF038"
                      value={values.manualFlight?.flightNumber || ''}
                      onChange={(e) =>
                        updateManualFlight('flightNumber', e.target.value)
                      }
                    />
                  </div>
                </>
              )}
            </div>

            {/* Bloc ALLER */}
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-600 mb-3">
                {isAirTransport ? '✈️ Vol aller' : 'Arrivée'}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="label">
                    {isAirTransport ? 'Aéroport d\'arrivée' : 'Aéroport / gare / port d\'arrivée'}
                    <span className="text-slate-400 font-normal">
                      {' '}
                      (optionnel)
                    </span>
                  </label>
                  <input
                    className="input"
                    placeholder={
                      isAirTransport
                        ? 'Ex : JFK, CDG, LIS…'
                        : 'Ex : Aéroport Suvarnabhumi (Bangkok)'
                    }
                    value={values.arrivalGateway}
                    onChange={(e) => update('arrivalGateway', e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">Heure d'arrivée (J1)</label>
                  <input
                    type="time"
                    className="input"
                    value={values.arrivalTime}
                    onChange={(e) => update('arrivalTime', e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Bloc RETOUR */}
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-600 mb-3">
                {isAirTransport ? '✈️ Vol retour' : 'Départ'}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="label">
                    {isAirTransport ? 'Aéroport de départ' : 'Aéroport / gare / port'}
                    <span className="text-slate-400 font-normal">
                      {' '}
                      (vide = identique à l'arrivée)
                    </span>
                  </label>
                  <input
                    className="input"
                    placeholder="Identique à l'arrivée"
                    value={values.departureGateway}
                    onChange={(e) => update('departureGateway', e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">Heure de départ (dernier jour)</label>
                  <input
                    type="time"
                    className="input"
                    value={values.departureTime}
                    onChange={(e) => update('departureTime', e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Prix unique aller-retour par personne (vol uniquement) */}
            {isAirTransport && (
              <div className="rounded-lg bg-brand-50 border border-brand-200 p-3">
                <label className="label">
                  💶 Prix par personne — vol aller-retour complet (€)
                  <span className="text-slate-400 font-normal"> (optionnel)</span>
                </label>
                <input
                  type="number"
                  min="0"
                  className="input"
                  placeholder="Ex : 320 (le prix affiché sur le comparateur de vols)"
                  value={values.manualFlight?.outboundPriceEur || ''}
                  onChange={(e) => {
                    updateManualFlight('outboundPriceEur', e.target.value);
                    updateManualFlight('returnPriceEur', '');
                  }}
                />
                <p className="text-xs text-slate-500 mt-1.5">
                  C'est le prix tel qu'affiché sur les comparateurs (aller +
                  retour, pour une personne). Le total famille est calculé
                  automatiquement.
                </p>
              </div>
            )}
          </>
        )}
      </Section>

      <Section title="Rythme du voyage">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="label">Jours off / repos</label>
            <input
              type="number"
              min="0"
              max={maxOffDays}
              className="input"
              value={values.offDays}
              onChange={(e) => {
                const n = Math.max(
                  0,
                  Math.min(maxOffDays, Number(e.target.value) || 0)
                );
                update('offDays', n);
              }}
            />
            <p className="text-xs text-slate-500 mt-1">
              {totalDays > 0
                ? `Sur ${totalDays} jours au total. Max conseillé : ${maxOffDays}.`
                : 'Renseignez d\'abord les dates pour calibrer.'}
            </p>
          </div>
          <div className="sm:col-span-2 text-xs text-slate-500 self-end pb-2">
            🛋️ Une journée off = pas de gros trajet (on reste au même endroit
            que la veille), activités très light ou optionnelles, surtout du
            repos. Idéal pour souffler au milieu d'un long voyage. Nous les
            répartissons équilibrement dans l'itinéraire.
          </div>
        </div>
      </Section>

      {isMotorized && (
        <Section title={isRental ? 'Voiture de location' : 'Véhicule'}>
          <p className="text-xs text-slate-500 -mt-2">
            {isRental
              ? 'Sélectionnez la catégorie de voiture envisagée pour la location sur place. Sert à estimer carburant, péages et coût de la location (~40-70 €/jour selon catégorie).'
              : 'Ces informations servent à estimer les coûts de carburant et de péage (classe du véhicule), et à proposer des hébergements adaptés (aires CC, France Passion, bivouac…).'}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="label">Type de véhicule</label>
              <div className="flex flex-wrap gap-2">
                {VEHICLE_TYPES.map((vt) => {
                  const active = values.vehicle.type === vt.id;
                  return (
                    <button
                      key={vt.id}
                      type="button"
                      onClick={() => pickVehicleType(vt.id)}
                      className={`rounded-full border px-2.5 py-1 sm:px-3 sm:py-1.5 text-[11px] sm:text-sm transition-colors ${
                        active
                          ? 'border-brand-600 bg-brand-600 text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {vt.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="label">Hauteur (m)</label>
              <input
                type="number"
                step="0.1"
                className="input"
                placeholder="2.6"
                value={values.vehicle.height}
                onChange={(e) =>
                  updateVehicle('height', Number(e.target.value))
                }
              />
            </div>
            <div>
              <label className="label">Longueur (m)</label>
              <input
                type="number"
                step="0.1"
                className="input"
                placeholder="6.0"
                value={values.vehicle.length}
                onChange={(e) =>
                  updateVehicle('length', Number(e.target.value))
                }
              />
            </div>
            <div>
              <label className="label">Carburant</label>
              <select
                className="input"
                value={values.vehicle.fuel}
                onChange={(e) => updateVehicle('fuel', e.target.value)}
              >
                {FUEL_TYPES.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Consommation (L/100 km)</label>
              <input
                type="number"
                step="0.5"
                className="input"
                placeholder="10"
                value={values.vehicle.consumption}
                onChange={(e) =>
                  updateVehicle('consumption', Number(e.target.value))
                }
              />
            </div>
          </div>
        </Section>
      )}

      <Section title="Participants">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Nombre d'adultes</label>
            <input
              required
              type="number"
              min="1"
              className="input"
              value={values.adults}
              onChange={(e) => update('adults', Number(e.target.value))}
            />
          </div>
          <div>
            <label className="label">Enfants (avec âges)</label>
            <div className="space-y-2">
              {values.childrenAges.length === 0 && (
                <p className="text-sm text-slate-400">Aucun enfant</p>
              )}
              {values.childrenAges.map((age, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    max="17"
                    className="input flex-1"
                    value={age}
                    onChange={(e) => updateChildAge(i, e.target.value)}
                  />
                  <span className="text-sm text-slate-500">ans</span>
                  <button
                    type="button"
                    onClick={() => removeChild(i)}
                    className="text-sm text-red-600 hover:underline"
                  >
                    Retirer
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addChild}
                className="btn-secondary"
              >
                + Ajouter un enfant
              </button>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Centres d'intérêt">
        <div className="flex flex-wrap gap-2">
          {INTERESTS.map((i) => {
            const active = values.interests.includes(i);
            return (
              <button
                key={i}
                type="button"
                onClick={() => toggle('interests', i)}
                className={`rounded-full border px-4 py-2 text-sm transition-colors capitalize ${
                  active
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                {i}
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Activités spécifiques">
        <p className="text-xs text-slate-500 -mt-2">
          Cochez tout ce qui vous tente. Nous essaierons d'intégrer ces activités
          quand le lieu et la saison s'y prêtent.
        </p>
        <div className="flex flex-wrap gap-2">
          {SPECIFIC_ACTIVITIES.map((a) => {
            const active = values.specificActivities.includes(a.id);
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => toggle('specificActivities', a.id)}
                className={`rounded-full border px-2.5 py-1 sm:px-3 sm:py-1.5 text-[11px] sm:text-sm transition-colors ${
                  active
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                {a.label}
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Hébergement nocturne souhaité">
        <p className="text-xs text-slate-500 -mt-2">
          Cochez tout ce qui vous convient — nous alternerons selon les étapes.
        </p>
        <div className="flex flex-wrap gap-2">
          {NIGHT_STAY_OPTIONS.map((opt) => {
            const active = values.nightStayPreferences.includes(opt);
            return (
              <button
                key={opt}
                type="button"
                onClick={() => toggle('nightStayPreferences', opt)}
                className={`rounded-full border px-2.5 py-1 sm:px-3 sm:py-1.5 text-[11px] sm:text-sm transition-colors ${
                  active
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                {opt}
              </button>
            );
          })}
        </div>
      </Section>

      {isRoadTrip && (
        <Section title="Vie pratique en voyage">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Repas</label>
              <div className="space-y-2">
                {COOKING_OPTIONS.map((opt) => (
                  <label
                    key={opt.id}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="cooking"
                      checked={values.cooking === opt.id}
                      onChange={() => update('cooking', opt.id)}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={values.needsServicePoints}
                  onChange={(e) =>
                    update('needsServicePoints', e.target.checked)
                  }
                />
                Prévoir aires de service (vidange / eau / électricité)
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={values.okWithFerry}
                  onChange={(e) => update('okWithFerry', e.target.checked)}
                />
                Je suis OK avec des traversées en ferry
              </label>
            </div>
          </div>
        </Section>
      )}

      <Section title="Budget">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {BUDGET_LEVELS.map((b) => {
            const active = values.budget === b.id;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => update('budget', b.id)}
                className={`rounded-lg border px-3 py-3 text-sm transition-colors ${
                  active
                    ? 'border-brand-600 bg-brand-50 text-brand-700 ring-1 ring-brand-600'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                {b.label}
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Étapes & préférences spécifiques">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">
              Étapes ou lieux IMPÉRATIFS à inclure
            </label>
            <textarea
              rows="3"
              className="input"
              placeholder="Ex : Pointe du Raz, dîner crêperie à Locronan, plage de Tahiti"
              value={values.mustInclude}
              onChange={(e) => update('mustInclude', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Lieux ou choses à éviter</label>
            <textarea
              rows="3"
              className="input"
              placeholder="Ex : autoroutes payantes longues, foules touristiques"
              value={values.toAvoid}
              onChange={(e) => update('toAvoid', e.target.value)}
            />
          </div>
        </div>
      </Section>

      <div className="flex justify-end pt-2 border-t border-slate-100">
        <button
          type="submit"
          disabled={loading}
          className="btn-primary text-base px-6 py-3"
        >
          {loading ? 'Génération en cours…' : 'Générer mon itinéraire'}
        </button>
      </div>
    </form>
  );
}

function Section({ title, children }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h3>
      {children}
    </section>
  );
}
