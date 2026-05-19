import { useState } from 'react';
import TemplatePicker from './TemplatePicker';

const TRIP_TYPES = [
  { id: 'itinerant', label: 'Itinérant' },
  { id: 'roadtrip-voiture', label: 'Road trip voiture' },
  { id: 'roadtrip-van', label: 'Road trip van' },
  { id: 'roadtrip-camping-car', label: 'Road trip camping-car' },
  { id: 'circuit-train', label: 'Circuit train' },
  { id: 'sejour-fixe', label: 'Séjour fixe' },
];

const ROAD_TRIP_TYPES = new Set([
  'roadtrip-voiture',
  'roadtrip-van',
  'roadtrip-camping-car',
]);

const INTERESTS = [
  'nature',
  'culture',
  'gastronomie',
  'plage',
  'sport',
  'randonnée',
  'modernité',
  'hors des sentiers battus',
];

const SPECIFIC_ACTIVITIES = [
  // Outdoor / nautique
  { id: 'velo-route', label: '🚴 Vélo / VTT' },
  { id: 'kayak', label: '🛶 Kayak / canoë' },
  { id: 'paddle', label: '🏄 Paddle (SUP)' },
  { id: 'surf', label: '🏄‍♂️ Surf' },
  { id: 'plongee', label: '🤿 Plongée sous-marine' },
  { id: 'snorkeling', label: '🐠 Snorkeling' },
  { id: 'voile', label: '⛵ Voile / bateau' },
  { id: 'peche', label: '🎣 Pêche' },
  // Montagne / nature
  { id: 'randonnee', label: '🥾 Randonnée' },
  { id: 'escalade', label: '🧗 Escalade / via ferrata' },
  { id: 'canyoning', label: '💦 Canyoning' },
  { id: 'parapente', label: '🪂 Parapente' },
  { id: 'observation-faune', label: '🦌 Observation faune' },
  { id: 'astronomie', label: '🌌 Astronomie' },
  // Culture / patrimoine
  { id: 'musees', label: '🏛️ Musées' },
  { id: 'monuments', label: '🏰 Châteaux / monuments' },
  { id: 'grottes', label: '🕳️ Grottes / spéléo' },
  { id: 'parcs-nationaux', label: '🌲 Parcs nationaux' },
  { id: 'sites-archeo', label: '⛏️ Sites archéologiques' },
  { id: 'street-art', label: '🎨 Street art' },
  // Gastro & local
  { id: 'marches', label: '🛍️ Marchés locaux' },
  { id: 'degustation', label: '🍷 Œnologie / dégustation' },
  { id: 'cours-cuisine', label: '👨‍🍳 Cours de cuisine' },
  { id: 'restaurants-etoiles', label: '⭐ Restaurants étoilés' },
  // Bien-être / loisirs
  { id: 'thermes', label: '♨️ Thermes / spa' },
  { id: 'yoga', label: '🧘 Yoga / méditation' },
  { id: 'vie-nocturne', label: '🌃 Vie nocturne' },
  { id: 'shopping', label: '🛒 Shopping' },
  // Avec enfants
  { id: 'parcs-attractions', label: '🎢 Parcs d\'attractions' },
  { id: 'zoos-aquariums', label: '🦓 Zoos / aquariums' },
];

const BUDGET_LEVELS = [
  { id: 'economique', label: 'Économique' },
  { id: 'moyen', label: 'Moyen' },
  { id: 'confort', label: 'Confort' },
  { id: 'haut-de-gamme', label: 'Haut de gamme' },
];

const VEHICLE_TYPES = [
  { id: 'van-amenage', label: 'Van aménagé', height: 2.1, length: 5.4, consumption: 8.5, fuel: 'diesel' },
  { id: 'fourgon-amenage', label: 'Fourgon aménagé', height: 2.6, length: 6.0, consumption: 10, fuel: 'diesel' },
  { id: 'cc-capucine', label: 'Camping-car capucine', height: 3.0, length: 6.5, consumption: 12, fuel: 'diesel' },
  { id: 'cc-profile', label: 'Camping-car profilé', height: 2.8, length: 7.0, consumption: 11, fuel: 'diesel' },
  { id: 'cc-integral', label: 'Camping-car intégral', height: 3.1, length: 7.5, consumption: 13, fuel: 'diesel' },
  { id: 'voiture', label: 'Voiture / SUV', height: 1.6, length: 4.5, consumption: 6.5, fuel: 'essence' },
  { id: 'voiture-tente', label: 'Voiture + tente', height: 1.6, length: 4.5, consumption: 6.5, fuel: 'essence' },
];

const FUEL_TYPES = ['diesel', 'essence', 'GPL', 'électrique', 'hybride'];

const NIGHT_STAY_OPTIONS = [
  'Hôtel',
  'Camping classique',
  'Camping municipal',
  'Aire de camping-car publique',
  'Aire de camping-car privée',
  'France Passion / accueil chez l\'habitant',
  'Parking gratuit',
  'Bivouac (où autorisé)',
];

const COOKING_OPTIONS = [
  { id: 'vehicle', label: 'Je cuisine dans le véhicule' },
  { id: 'restaurants', label: 'Restaurants uniquement' },
  { id: 'mix', label: 'Mix cuisine + restos' },
];

const DEFAULTS = {
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
  nightStayPreferences: ['Hôtel'],
  cooking: 'restaurants',
  needsServicePoints: false,
  okWithFerry: true,
};

function computeTotalDays(start, end) {
  if (!start || !end) return 0;
  const s = new Date(start);
  const e = new Date(end);
  if (isNaN(s) || isNaN(e) || e < s) return 0;
  return Math.round((e - s) / 86400000) + 1;
}

export default function PreferencesForm({ onSubmit, loading }) {
  const [values, setValues] = useState(DEFAULTS);
  const isRoadTrip = ROAD_TRIP_TYPES.has(values.tripType);
  const isMotorized = isRoadTrip; // any road trip uses a vehicle
  const totalDays = computeTotalDays(values.startDate, values.endDate);
  const maxOffDays = Math.max(0, totalDays - 2); // au moins 1 jour de voyage à l'aller et 1 au retour

  function update(field, value) {
    setValues((v) => ({ ...v, [field]: value }));
  }

  function updateVehicle(field, value) {
    setValues((v) => ({ ...v, vehicle: { ...v.vehicle, [field]: value } }));
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
          Remplissez les champs ci-dessous — Claude rédige ensuite votre
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
                className={`rounded-full border px-4 py-2 text-sm transition-colors ${
                  active
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
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
            repos. Idéal pour souffler au milieu d'un long voyage. Claude les
            répartit équilibrement dans l'itinéraire.
          </div>
        </div>
      </Section>

      {isMotorized && (
        <Section title="Véhicule">
          <p className="text-xs text-slate-500 -mt-2">
            Ces informations servent à estimer les coûts de carburant et de
            péage (classe du véhicule), et à proposer des hébergements adaptés
            (aires CC, France Passion, bivouac…).
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
                      className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
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
          Cochez tout ce qui vous tente. Claude essaiera d'intégrer ces activités
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
                className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
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
          Cochez tout ce qui vous convient — Claude alternera selon les étapes.
        </p>
        <div className="flex flex-wrap gap-2">
          {NIGHT_STAY_OPTIONS.map((opt) => {
            const active = values.nightStayPreferences.includes(opt);
            return (
              <button
                key={opt}
                type="button"
                onClick={() => toggle('nightStayPreferences', opt)}
                className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
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

      {isMotorized && (
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

function suggestStayPrefs(vehicleId) {
  if (vehicleId.startsWith('cc-')) {
    return [
      'Aire de camping-car publique',
      'Aire de camping-car privée',
      'France Passion / accueil chez l\'habitant',
      'Camping classique',
    ];
  }
  if (vehicleId === 'van-amenage' || vehicleId === 'fourgon-amenage') {
    return [
      'Aire de camping-car publique',
      'Parking gratuit',
      'Bivouac (où autorisé)',
      'France Passion / accueil chez l\'habitant',
    ];
  }
  if (vehicleId === 'voiture-tente') {
    return ['Camping classique', 'Camping municipal'];
  }
  return ['Hôtel'];
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
