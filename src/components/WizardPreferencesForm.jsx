import { useEffect, useMemo, useRef, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import { fr } from 'date-fns/locale';
import 'react-day-picker/dist/style.css';
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
  NIGHT_STAY_OPTIONS,
  COOKING_OPTIONS,
  suggestStayPrefs,
} from '../lib/preferenceOptions';
import { CAR_RENTAL_POSSIBLE_TRIP_TYPES } from '../lib/preferenceOptions';
import { DEFAULTS, computeTotalDays } from './PreferencesForm';
import Icon from './Icon';
import {
  FLIGHT_SEARCH_PROVIDERS,
  getProvider,
  resolveIata,
  buildSkyscannerExploreUrl,
} from '../lib/flightSearchLinks';
import { findGatewaysForCountry, formatGateway } from '../lib/airportCities';
import { extractFlightFromImage } from '../lib/ai';
import PlaceDiscovery from './PlaceDiscovery';
import EditableValue from './EditableValue';
import ExtractionLoader from './ExtractionLoader';

// --- Helpers dates ---
function toIsoDate(d) {
  if (!d) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function fromIsoDate(iso) {
  if (!iso) return undefined;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

function formatFrDate(iso) {
  const d = fromIsoDate(iso);
  if (!d) return '—';
  return d.toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

// --- Helpers --------------------------------------------------------------

const AIR_TYPES = new Set(['avion-voiture', 'avion-citybreak']);
const TRAIN_TYPES = new Set(['train-international', 'circuit-train']);

// Garde-fou : si l'IA renvoie une date YYYY-MM-DD aberrante (1970,
// 2024 dans un voyage 2026, etc.), on la remplace par la date prévue
// par l'utilisateur tout en gardant l'heure extraite.
function sanitizeLegDate(leg, expectedYYYYMMDD) {
  if (!leg || !expectedYYYYMMDD) return leg;
  function fix(iso) {
    if (!iso || typeof iso !== 'string') {
      return `${expectedYYYYMMDD}T00:00:00`;
    }
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})(:\d{2})?$/);
    if (!m) return `${expectedYYYYMMDD}T00:00:00`;
    const year = Number(m[1]);
    // Plage raisonnable pour un voyage : entre l'an dernier et 5 ans dans le futur
    const thisYear = new Date().getFullYear();
    if (year < thisYear - 1 || year > thisYear + 5) {
      const time = m[4];
      const sec = m[5] || ':00';
      return `${expectedYYYYMMDD}T${time}${sec}`;
    }
    return iso;
  }
  return {
    ...leg,
    departure_at: fix(leg.departure_at),
    arrival_at: fix(leg.arrival_at),
  };
}

// Helpers d'affichage pour le récap des vols confirmés
function formatLegDateTime(iso) {
  if (!iso || iso.length < 16) return '—';
  const date = iso.substring(0, 10);
  const time = iso.substring(11, 16);
  const d = fromIsoDate(date);
  if (!d) return `${date} · ${time}`;
  const dayLabel = d.toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  return `${dayLabel} · ${time}`;
}

// --- Sous-composants UI ---------------------------------------------------

function StepHeader({ title, subtitle, icon }) {
  return (
    <div className="text-center mb-6">
      {icon && (
        <div className="mx-auto mb-3 inline-grid place-items-center h-14 w-14 rounded-2xl bg-brand-600 text-white shadow-glow">
          <Icon name={icon} className="h-7 w-7" />
        </div>
      )}
      <h2 className="text-2xl sm:text-3xl font-bold text-slate-900">{title}</h2>
      {subtitle && (
        <p className="mt-2 text-sm text-slate-600 max-w-xl mx-auto">{subtitle}</p>
      )}
    </div>
  );
}

function ProgressBar({ current, total }) {
  const pct = Math.round(((current + 1) / total) * 100);
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
        <span>
          Étape <strong className="text-slate-900">{current + 1}</strong> sur{' '}
          {total}
        </span>
        <span>{pct} %</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-brand-500 to-brand-700 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function NavButtons({ canBack, canNext, isLast, onBack, onNext, loading }) {
  return (
    <div className="mt-8 flex flex-col-reverse sm:flex-row gap-3 sm:justify-between">
      <button
        type="button"
        onClick={onBack}
        disabled={!canBack}
        className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        ← Précédent
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={!canNext || loading}
        className="rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2.5 text-sm font-semibold transition-colors shadow-pop"
      >
        {isLast
          ? loading
            ? 'Génération…'
            : '✨ Générer mon itinéraire'
          : 'Suivant →'}
      </button>
    </div>
  );
}

// --- Étapes ---------------------------------------------------------------

function StepDestination({ values, update }) {
  // Détecte si la saisie correspond à un grand pays multi-aéroports.
  // Si oui, on propose des vignettes pour aider l'utilisateur à choisir
  // une ville-aéroport d'entrée précise.
  const gateways = useMemo(
    () => findGatewaysForCountry(values.destinations),
    [values.destinations]
  );

  function pickGatewayCity(city) {
    update('arrivalGateway', `${city.name} (${city.iata})`);
  }
  function pickReturnGatewayCity(city) {
    update('departureGateway', `${city.name} (${city.iata})`);
  }

  const pickedGateway = (values.arrivalGateway || '').trim();
  const pickedReturnGateway = (values.departureGateway || '').trim();

  // Mode "ville de fin différente" : on dérive depuis l'existence d'un
  // departureGateway non vide. La case à cocher l'active/le désactive.
  const [returnDifferent, setReturnDifferent] = useState(
    pickedReturnGateway.length > 0
  );
  function toggleReturnDifferent(checked) {
    setReturnDifferent(checked);
    if (!checked) update('departureGateway', '');
  }

  return (
    <div>
      <StepHeader
        icon="map"
        title="Où veux-tu aller ?"
        subtitle="Une ville, un pays, une région — peu importe. Notre IA s'adapte à toutes les destinations du monde."
      />
      <input
        autoFocus
        className="input text-lg py-3"
        placeholder="Ex : New York, Japon, Côte amalfitaine…"
        value={values.destinations}
        onChange={(e) => update('destinations', e.target.value)}
      />

      {gateways && (
        <div className="mt-5 rounded-2xl border-2 border-brand-200 bg-brand-50/40 p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">🛬</span>
            <h3 className="text-sm font-semibold text-slate-900">
              Par quelle ville d'arrivée veux-tu démarrer ?
            </h3>
          </div>
          <p className="text-xs text-slate-600 mb-3">
            Ce pays a plusieurs grands aéroports. Choisis une porte d'entrée —
            tu pourras toujours visiter d'autres villes ensuite dans ton
            itinéraire.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {gateways.cities.map((city) => {
              const label = `${city.name} (${city.iata})`;
              const active = pickedGateway === label;
              return (
                <button
                  key={city.iata}
                  type="button"
                  onClick={() => pickGatewayCity(city)}
                  className={`text-left rounded-xl border p-3 transition-all ${
                    active
                      ? 'border-brand-600 bg-white ring-2 ring-brand-500 shadow-pop'
                      : 'border-slate-200 bg-white hover:border-brand-400 hover:shadow-md'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-base">📍</span>
                    <span
                      className={`text-sm font-semibold ${
                        active ? 'text-brand-700' : 'text-slate-900'
                      }`}
                    >
                      {city.name}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-500 font-mono">
                    {city.iata}
                  </div>
                  <div className="mt-1 text-xs text-slate-600 leading-snug">
                    {city.note}
                  </div>
                </button>
              );
            })}
          </div>
          {pickedGateway && (
            <p className="mt-2 text-xs text-emerald-700 font-medium">
              ✓ Ville d'arrivée : <strong>{pickedGateway}</strong>
            </p>
          )}
        </div>
      )}

      {/* Ville de fin d'itinéraire — open-jaw si différente */}
      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={returnDifferent}
            onChange={(e) => toggleReturnDifferent(e.target.checked)}
            className="mt-0.5 h-5 w-5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          <div className="text-sm flex-1">
            <div className="font-medium text-slate-900">
              🛫 Ma ville de fin d'itinéraire est différente
            </div>
            <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
              Coche si tu repars d'une autre ville que celle où tu atterris
              (ex : arrivée à Bogotá → traversée → départ depuis Carthagène).
              Sinon, on suppose un aller-retour par la même ville.
            </p>
          </div>
        </label>

        {returnDifferent && (
          <div className="mt-3 space-y-2">
            <input
              className="input"
              placeholder={
                values.destinations
                  ? `Ex pour ${values.destinations} : Carthagène, Medellín…`
                  : 'Ex : Carthagène (CTG), Medellín (MDE)…'
              }
              value={values.departureGateway || ''}
              onChange={(e) => update('departureGateway', e.target.value)}
            />
            {gateways && (
              <div>
                <p className="text-xs text-slate-500 mb-1.5">
                  Suggestions pour {values.destinations} :
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {gateways.cities.map((city) => {
                    const label = `${city.name} (${city.iata})`;
                    const active = pickedReturnGateway === label;
                    return (
                      <button
                        key={city.iata}
                        type="button"
                        onClick={() => pickReturnGatewayCity(city)}
                        className={`text-left rounded-full border px-3 py-1.5 text-xs transition-all ${
                          active
                            ? 'bg-brand-600 text-white border-brand-600'
                            : 'bg-white border-slate-300 text-slate-700 hover:border-brand-400'
                        }`}
                      >
                        {city.name} <span className="opacity-60">({city.iata})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {pickedReturnGateway && (
              <p className="mt-1 text-xs text-emerald-700 font-medium">
                ✓ Ville de fin / vol retour : <strong>{pickedReturnGateway}</strong>
              </p>
            )}
          </div>
        )}
      </div>

      <div className="mt-6">
        <label className="label">D'où pars-tu ?</label>
        <input
          className="input"
          placeholder="Ex : Lyon, France"
          value={values.departureLocation}
          onChange={(e) => update('departureLocation', e.target.value)}
        />
      </div>
      <div className="mt-4">
        <label className="label">
          Lieu d'arrivée final{' '}
          <span className="text-slate-400 font-normal">
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
  );
}

function StepDates({ values, update }) {
  const totalDays = computeTotalDays(values.startDate, values.endDate);
  const selected = {
    from: fromIsoDate(values.startDate),
    to: fromIsoDate(values.endDate),
  };
  const [flightCheck, setFlightCheck] = useState('idle'); // 'idle' | 'loading' | 'error'

  function handleSelect(range) {
    // range peut être undefined (reset) ou {from, to?}
    update('startDate', toIsoDate(range?.from));
    update('endDate', toIsoDate(range?.to));
  }

  // Bloque les dates passées
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const canCheckFlights = !!values.departureLocation && !!values.destinations;

  // Ouvre Skyscanner sur la route choisie SANS dates → calendrier des prix par
  // jour (pour repérer les dates les moins chères). Origine/destination/
  // voyageurs sont pré-remplis (saisis aux étapes précédentes).
  async function checkCheapestFlights() {
    if (!canCheckFlights || flightCheck === 'loading') return;
    setFlightCheck('loading');
    try {
      const childrenAges = Array.isArray(values.childrenAges)
        ? values.childrenAges.filter((a) => Number(a) >= 2)
        : [];
      const [origin, dest] = await Promise.all([
        resolveIata(values.departureLocation),
        resolveIata(values.destinations),
      ]);
      let url = null;
      if (origin?.code && !origin.country && dest?.code && !dest.country) {
        url = buildSkyscannerExploreUrl({
          originIata: origin.code,
          destIata: dest.code,
          adults: values.adults,
          childrenAges,
        });
      }
      // Repli : si on n'a pas pu résoudre les aéroports, on ouvre Google Flights.
      window.open(
        url || 'https://www.google.com/travel/flights?hl=fr&curr=EUR&gl=FR',
        '_blank',
        'noopener'
      );
      setFlightCheck('idle');
    } catch {
      window.open(
        'https://www.google.com/travel/flights?hl=fr&curr=EUR&gl=FR',
        '_blank',
        'noopener'
      );
      setFlightCheck('idle');
    }
  }

  return (
    <div>
      <StepHeader
        icon="calendar"
        title="Quand veux-tu partir ?"
        subtitle="Clique sur ta date de départ, puis sur ta date de retour. Les jours entre les deux seront sélectionnés."
      />

      {canCheckFlights && (
        <div className="mb-5 rounded-2xl border-2 border-sky-200 bg-sky-50 p-4 text-center">
          <p className="text-sm text-slate-700 mb-2">
            Pas encore décidé des dates ? Regarde les jours les moins chers pour{' '}
            <strong>
              {values.departureLocation} → {values.destinations}
            </strong>
            .
          </p>
          <button
            type="button"
            onClick={checkCheapestFlights}
            disabled={flightCheck === 'loading'}
            className="inline-flex items-center gap-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white px-5 py-2.5 text-sm font-semibold shadow-pop transition-colors"
          >
            {flightCheck === 'loading'
              ? 'Ouverture…'
              : '🔎 Trouver les dates les moins chères'}
          </button>
          <p className="text-[11px] text-slate-500 mt-2">
            Ça ouvre Skyscanner (calendrier des prix) dans un nouvel onglet —
            ton départ, ta destination et le nombre de voyageurs sont déjà
            remplis. Reviens ensuite choisir tes dates ici.
          </p>
        </div>
      )}

      <div className="flex justify-center">
        <div className="rdp-wizard rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <DayPicker
            mode="range"
            locale={fr}
            selected={selected.from ? selected : undefined}
            onSelect={handleSelect}
            numberOfMonths={typeof window !== 'undefined' && window.innerWidth >= 768 ? 2 : 1}
            disabled={{ before: today }}
            weekStartsOn={1}
            showOutsideDays={false}
          />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-center">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
            Départ
          </div>
          <div className="text-sm font-medium text-slate-900 mt-1">
            {formatFrDate(values.startDate)}
          </div>
        </div>
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-center">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
            Retour
          </div>
          <div className="text-sm font-medium text-slate-900 mt-1">
            {formatFrDate(values.endDate)}
          </div>
        </div>
        <div
          className={`rounded-xl border p-3 text-center ${
            totalDays > 0
              ? 'bg-brand-50 border-brand-200'
              : 'bg-slate-50 border-slate-200'
          }`}
        >
          <div
            className={`text-[10px] uppercase tracking-wide font-semibold ${
              totalDays > 0 ? 'text-brand-600' : 'text-slate-500'
            }`}
          >
            Durée
          </div>
          <div
            className={`text-sm font-bold mt-1 ${
              totalDays > 0 ? 'text-brand-700' : 'text-slate-900'
            }`}
          >
            {totalDays > 0
              ? `${totalDays} ${totalDays > 1 ? 'jours' : 'jour'}`
              : '—'}
          </div>
        </div>
      </div>
    </div>
  );
}

function StepTravelers({ values, update }) {
  const setChildAge = (idx, age) => {
    const arr = [...(values.childrenAges || [])];
    arr[idx] = Number(age) || 0;
    update('childrenAges', arr);
  };
  const addChild = () =>
    update('childrenAges', [...(values.childrenAges || []), 8]);
  const removeChild = (idx) => {
    const arr = (values.childrenAges || []).filter((_, i) => i !== idx);
    update('childrenAges', arr);
  };

  return (
    <div>
      <StepHeader
        icon="users"
        title="Qui voyage ?"
        subtitle="Précise le nombre d'adultes et d'enfants (avec leurs âges). Ça nous aide à adapter activités, hébergements et budget."
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="label">Nombre d'adultes</label>
          <input
            type="number"
            min="1"
            className="input"
            value={values.adults}
            onChange={(e) =>
              update('adults', Math.max(1, Number(e.target.value) || 1))
            }
          />
        </div>
        <div>
          <label className="label">Enfants</label>
          {(values.childrenAges || []).length === 0 ? (
            <p className="text-sm text-slate-400 italic">Aucun enfant.</p>
          ) : (
            <div className="space-y-2">
              {values.childrenAges.map((age, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    max="17"
                    className="input flex-1"
                    placeholder="Âge"
                    value={age}
                    onChange={(e) => setChildAge(i, e.target.value)}
                  />
                  <span className="text-xs text-slate-500">ans</span>
                  <button
                    type="button"
                    onClick={() => removeChild(i)}
                    className="text-red-500 hover:text-red-700 text-xs"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={addChild}
            className="mt-2 text-sm text-brand-700 hover:underline"
          >
            + Ajouter un enfant
          </button>
        </div>
      </div>
    </div>
  );
}

function StepTripType({ values, update }) {
  const showLicenseQuestion = CAR_RENTAL_POSSIBLE_TRIP_TYPES.has(values.tripType);
  // L'étape vol s'affiche automatiquement pour les types "avion-*".
  // Pour les autres (itinérant, road-trip, train…), l'utilisateur peut
  // forcer son apparition s'il commence/finit son voyage en avion.
  const isAutoAir = AIR_TYPES.has(values.tripType);
  return (
    <div>
      <StepHeader
        icon="compass"
        title="Comment voyages-tu ?"
        subtitle="Choisis le mode principal de transport. On adaptera ensuite les étapes suivantes."
      />
      {/* Question vol — placée EN HAUT, avant les types de voyage. Pour les
          types avion-*, le vol est implicite (petit bandeau d'info). Pour les
          autres, 2 gros boutons "Comment rejoins-tu ta destination ?". */}
      {isAutoAir ? (
        <div className="mb-6 rounded-xl border-2 border-sky-200 bg-sky-50 p-4 text-sm text-sky-900 flex items-center gap-2">
          <span className="text-lg">✈️</span>
          <span>
            <strong>Ce voyage inclut un vol.</strong> Tu pourras chercher,
            saisir ou laisser l'IA proposer tes vols à l'étape suivante.
          </span>
        </div>
      ) : (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-slate-900 mb-1 flex items-center gap-1.5">
            <span>✈️</span> Comment rejoins-tu ta destination ?
          </h3>
          <p className="text-xs text-slate-500 mb-3">
            Indispensable pour savoir s'il faut t'aider à organiser un vol.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => update('includesFlight', true)}
              className={`text-left rounded-xl border-2 p-4 transition-all ${
                values.includesFlight === true
                  ? 'border-sky-600 bg-sky-50 ring-2 ring-sky-500 shadow-pop'
                  : 'border-slate-200 bg-white hover:border-sky-400'
              }`}
            >
              <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                <span>✈️</span> En avion
              </div>
              <div className="text-xs text-slate-600 mt-1 leading-snug">
                Aller et/ou retour en avion (puis tour en voiture, train…
                sur place). Tu organiseras tes vols à l'étape suivante.
              </div>
            </button>
            <button
              type="button"
              onClick={() => update('includesFlight', false)}
              className={`text-left rounded-xl border-2 p-4 transition-all ${
                values.includesFlight === false
                  ? 'border-brand-600 bg-brand-50 ring-2 ring-brand-500 shadow-pop'
                  : 'border-slate-200 bg-white hover:border-brand-400'
              }`}
            >
              <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                <span>🚗</span> Par mes propres moyens
              </div>
              <div className="text-xs text-slate-600 mt-1 leading-snug">
                Voiture, train, bus, déjà sur place… aucun vol à organiser.
              </div>
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {TRIP_TYPES.map((t) => {
          const active = values.tripType === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => update('tripType', t.id)}
              className={`flex items-center gap-3 rounded-xl border p-4 text-left transition-all ${
                active
                  ? 'border-brand-600 bg-brand-50 ring-2 ring-brand-500 shadow-glow'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-md'
              }`}
            >
              <span
                className={`inline-grid place-items-center h-10 w-10 rounded-xl shrink-0 ${
                  active ? 'bg-brand-600 text-white' : 'bg-slate-900 text-white'
                }`}
              >
                <Icon name={t.icon} className="h-5 w-5" />
              </span>
              <span
                className={`font-medium ${
                  active ? 'text-brand-700' : 'text-slate-900'
                }`}
              >
                {t.label}
              </span>
            </button>
          );
        })}
      </div>

      {showLicenseQuestion && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={values.hasDrivingLicense !== false}
              onChange={(e) => update('hasDrivingLicense', e.target.checked)}
              className="mt-0.5 h-5 w-5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            <div className="text-sm">
              <div className="font-medium text-slate-900">
                J'ai (ou nous avons) le permis de conduire
              </div>
              <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                Coché : l'IA pourra proposer une location de voiture comme
                option de transport. Décoché : on se limitera aux transports
                en commun, taxi, vélo, marche et excursions organisées.
              </p>
            </div>
          </label>
        </div>
      )}
    </div>
  );
}

// Mode d'affichage de l'étape "Tes vols". Trois états :
//   - 'search'  : flux principal (chercher sur Skyscanner puis partager capture)
//   - 'manual'  : saisie manuelle (utilisateur a déjà les billets)
//   - 'later'   : skip — on génère sans vol confirmé
function StepFlight({ values, update, updateManualFlight, updateConfirmedFlight }) {
  const initialMode = () => {
    if (values.confirmedFlight?.outbound?.origin_iata) return 'search';
    if (
      values.manualFlight?.outboundPriceEur ||
      values.arrivalTime ||
      values.departureTime
    ) return 'manual';
    return 'search';
  };
  const [mode, setMode] = useState(initialMode);

  // Provider de recherche externe choisi par l'utilisateur (Skyscanner par défaut)
  const [providerId, setProviderId] = useState('skyscanner');
  const provider = getProvider(providerId);

  // Résolution IATA pour ouvrir la recherche externe avec dates pré-remplies
  const [resolveStatus, setResolveStatus] = useState('idle');
  const [resolveError, setResolveError] = useState(null);

  // Capture extraction (peut être multi-captures pour les open-jaw réservés
  // en 2 vols one-way séparés)
  const [uploadPhase, setUploadPhase] = useState('idle'); // 'idle' | 'extracting' | 'error'
  const [uploadError, setUploadError] = useState(null);
  const fileRef = useRef(null);
  const fileRef2 = useRef(null);
  const fileRef3 = useRef(null); // mode manuel : import par capture

  // Transport implicite = avion-intl (transmis au backend pour J1 + buffer retour)
  useEffect(() => {
    if (!values.scheduledTransport) {
      update('scheduledTransport', 'avion-intl');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const arrivalCity = values.arrivalGateway || values.destinations;
  const returnCity = values.departureGateway || ''; // si vide → même que arrival
  const isOpenJaw =
    !!returnCity &&
    returnCity.trim().toLowerCase() !== arrivalCity.trim().toLowerCase();
  const hasMinimumForSearch =
    !!values.departureLocation && !!arrivalCity && !!values.startDate;

  // Ouvre la recherche externe pour une jambe spécifique.
  //   direction = 'roundtrip' (même aéroport, aller+retour dans une URL)
  //             | 'outbound'  (aller-simple origine → arrivée, à startDate)
  //             | 'return'    (aller-simple retour → origine, à endDate)
  async function openFlightSearch(direction) {
    if (!hasMinimumForSearch) return;
    setResolveStatus('loading');
    setResolveError(null);
    try {
      const adults = Math.max(1, Number(values.adults) || 1);
      const childrenAges = Array.isArray(values.childrenAges)
        ? values.childrenAges.filter((a) => Number(a) >= 2)
        : [];
      const infantsAges = Array.isArray(values.childrenAges)
        ? values.childrenAges.filter((a) => Number(a) >= 0 && Number(a) < 2)
        : [];

      // Résolution IATA — toujours origine + arrivée ; retour si direction='return'
      const lookups = [
        resolveIata(values.departureLocation),
        resolveIata(arrivalCity),
      ];
      if (direction === 'return' && isOpenJaw) {
        lookups.push(resolveIata(returnCity));
      }
      const [origin, dest, returnDest] = await Promise.all(lookups);

      if (!origin || !dest) {
        setResolveStatus('error');
        setResolveError(
          'Impossible de trouver les codes aéroport. Vérifie l\'orthographe des villes.'
        );
        return;
      }
      if (dest.country) {
        setResolveStatus('need_city');
        setResolveError(
          `"${dest.name}" est un pays. Précise une ville d'arrivée précise (ex: Oslo, Bergen, Tromsø…).`
        );
        return;
      }
      if (origin.country) {
        setResolveStatus('error');
        setResolveError(
          `"${origin.name}" est un pays. Précise ta ville de départ exacte.`
        );
        return;
      }
      if (direction === 'return' && isOpenJaw && (!returnDest || returnDest.country)) {
        setResolveStatus('need_city');
        setResolveError(
          `Impossible de trouver l'aéroport de retour ("${returnCity}"). Précise une ville (ex: Carthagène, Medellín…).`
        );
        return;
      }

      let url;
      if (direction === 'outbound') {
        // Aller-simple : origine → arrivée à startDate
        url = provider.buildUrl({
          originIata: origin.code,
          destIata: dest.code,
          departDate: values.startDate,
          returnDate: null,
          adults,
          childrenAges,
          infantsAges,
        });
      } else if (direction === 'return') {
        // Aller-simple retour : (returnCity ou arrivalCity) → origine à endDate
        const retOrigin = isOpenJaw && returnDest ? returnDest.code : dest.code;
        url = provider.buildUrl({
          originIata: retOrigin,
          destIata: origin.code,
          departDate: values.endDate,
          returnDate: null,
          adults,
          childrenAges,
          infantsAges,
        });
      } else {
        // roundtrip : aller-retour avec même aéroport
        url = provider.buildUrl({
          originIata: origin.code,
          destIata: dest.code,
          departDate: values.startDate,
          returnDate: values.endDate || null,
          adults,
          childrenAges,
          infantsAges,
        });
      }
      window.open(url, '_blank', 'noopener,noreferrer');
      setResolveStatus('idle');
    } catch (e) {
      console.error(e);
      setResolveStatus('error');
      setResolveError('Une erreur est survenue. Réessaie.');
    }
  }


  async function handleCaptureFile(file) {
    if (!file) return;
    setUploadError(null);
    if (!/^image\//.test(file.type)) {
      setUploadError('Le fichier doit être une image (PNG, JPG, WebP).');
      return;
    }
    const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
    if (file.size > MAX_IMAGE_BYTES) {
      setUploadError(
        `L'image dépasse 8 Mo. Compresse-la ou prends une capture plus petite.`
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const rawUrl = reader.result;
      setUploadPhase('extracting');
      try {
        const compressed = await compressImageDataUrl(rawUrl);
        // Si on a déjà un aller enregistré et pas de retour, on indique à l'IA
        // que cette capture est le retour (utile quand les dates ne sont pas
        // visibles : elle saura quoi mettre à la place).
        const existingForCtx = values.confirmedFlight;
        const legHint =
          existingForCtx?.outbound?.origin_iata && !existingForCtx.return
            ? 'return'
            : '';
        const flight = await extractFlightFromImage(compressed, {
          adults: Number(values.adults) || 1,
          children: Array.isArray(values.childrenAges)
            ? values.childrenAges.length
            : 0,
          origin_hint: values.departureLocation,
          destination_hint: arrivalCity,
          expected_outbound_date: values.startDate || '',
          expected_return_date: values.endDate || '',
          leg_hint: legHint,
        });
        if (!flight?.outbound?.origin_iata) {
          setUploadError(
            flight?.extraction_note ||
              "L'IA n'a pas réussi à lire ta capture. Vérifie qu'elle montre bien un vol (Skyscanner, Google Flights, Kayak…)."
          );
          setUploadPhase('idle');
          return;
        }
        const existing = values.confirmedFlight;
        const newCapture = {
          dataUrl: compressed,
          total_price_eur: Number(flight.total_price_eur) || 0,
        };
        // Fusion intelligente avec une éventuelle capture précédente
        let merged;
        const newOut = { ...flight.outbound };
        const newRet = flight.return ? { ...flight.return } : null;
        if (
          existing?.outbound?.origin_iata &&
          !existing.return &&
          !newRet
        ) {
          // Cas typique : 1re capture = aller seul, 2e capture = retour seul
          // (2 vols réservés séparément). On détermine la chronologie pour
          // savoir laquelle est aller / retour.
          const existingDate = existing.outbound.departure_at || '';
          const newDate = newOut.departure_at || '';
          let outbound, returnLeg;
          if (newDate && existingDate && newDate < existingDate) {
            outbound = newOut;
            returnLeg = existing.outbound;
          } else {
            outbound = existing.outbound;
            returnLeg = newOut;
          }
          merged = {
            is_round_trip: true,
            passengers_total: existing.passengers_total || flight.passengers_total || 1,
            total_price_eur:
              (Number(existing.total_price_eur) || 0) + newCapture.total_price_eur,
            currency_detected: existing.currency_detected || flight.currency_detected || 'EUR',
            outbound,
            return: returnLeg,
            extraction_note: '',
            _captures: [
              ...(existing._captures || [{ dataUrl: null, total_price_eur: existing.total_price_eur || 0 }]),
              newCapture,
            ],
          };
        } else {
          // Cas standard : 1re capture (ou utilisateur corrige avec une
          // capture plus complète qui remplace tout).
          merged = {
            is_round_trip: !!flight.is_round_trip,
            passengers_total: flight.passengers_total || 1,
            total_price_eur: newCapture.total_price_eur,
            currency_detected: flight.currency_detected || 'EUR',
            outbound: newOut,
            return: newRet,
            extraction_note: flight.extraction_note || '',
            _captures: [newCapture],
          };
        }
        // Garde-fou dates : si l'IA a inventé des dates aberrantes
        // (1970, 2024 dans un voyage 2026…), on les remplace par les
        // dates prévues par l'utilisateur en gardant les heures.
        if (values.startDate && merged.outbound) {
          merged.outbound = sanitizeLegDate(merged.outbound, values.startDate);
        }
        if (values.endDate && merged.return) {
          merged.return = sanitizeLegDate(merged.return, values.endDate);
        }
        updateConfirmedFlight(merged);
        setUploadPhase('idle');
      } catch (e) {
        console.error('[wizard extract-flight]', e);
        setUploadError(e?.message || "Extraction échouée. Réessaie ou change d'image.");
        setUploadPhase('idle');
      }
    };
    reader.onerror = () => setUploadError('Impossible de lire ce fichier.');
    reader.readAsDataURL(file);
  }

  function onDrop(e) {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) handleCaptureFile(file);
  }

  // Ctrl+V pour coller une capture (modes "Chercher" ET "J'ai mes billets")
  useEffect(() => {
    if (mode !== 'search' && mode !== 'manual') return;
    if (uploadPhase === 'extracting') return;
    function onPaste(e) {
      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            handleCaptureFile(file);
            return;
          }
        }
      }
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, uploadPhase]);

  function clearConfirmedFlight() {
    updateConfirmedFlight(null);
    setUploadPhase('idle');
    setUploadError(null);
  }

  // Correction manuelle du prix total du vol confirmé (souvent la valeur qui
  // diverge entre deux lectures de la capture). On marque _price_user_edited
  // pour ne pas l'écraser si une 2e capture est ajoutée ensuite.
  function setConfirmedPrice(eur) {
    const current = values.confirmedFlight;
    if (!current) return;
    updateConfirmedFlight({
      ...current,
      total_price_eur: Math.max(0, Math.round(Number(eur) || 0)),
      _price_user_edited: true,
    });
  }

  const confirmed = values.confirmedFlight;

  return (
    <div>
      <StepHeader
        icon="plane"
        title="Tes vols"
        subtitle="On t'aide à trouver tes vols, puis l'IA construit ton voyage autour des vraies heures d'arrivée et de départ."
      />

      {/* Résumé compact des aéroports choisis à l'étape destination.
          Avec un champ inline pour corriger l'arrivée si besoin (utile
          quand destinations=pays sans vignette cliquée). */}
      <div className="mb-5 rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2">
        <div>
          <label className="label text-xs">
            🛬 Aéroport / ville d'arrivée
          </label>
          <input
            className="input"
            placeholder={
              values.destinations
                ? `Ex pour ${values.destinations} : Oslo, Bergen, Tromsø…`
                : 'Ex : Oslo, JFK, Lisbonne…'
            }
            value={values.arrivalGateway || ''}
            onChange={(e) => {
              update('arrivalGateway', e.target.value);
              if (resolveStatus !== 'idle') setResolveStatus('idle');
            }}
          />
        </div>
        {isOpenJaw && (
          <div className="text-xs text-slate-700 bg-white border border-slate-200 rounded-lg p-2">
            🛫 <strong>Vol retour depuis :</strong> {returnCity}{' '}
            <span className="text-slate-400">
              (modifiable à l'étape « Où veux-tu aller »)
            </span>
          </div>
        )}
      </div>

      {/* Onglets de mode */}
      <div className="mb-5 flex flex-wrap gap-2">
        <ModeTab active={mode === 'search'} onClick={() => setMode('search')}>
          🔍 Chercher mes vols
        </ModeTab>
        <ModeTab active={mode === 'manual'} onClick={() => setMode('manual')}>
          ✏️ J'ai déjà mes billets
        </ModeTab>
        <ModeTab active={mode === 'later'} onClick={() => setMode('later')}>
          🤖 Laisse l'IA proposer
        </ModeTab>
      </div>

      {/* Mode SEARCH : bloc de recherche (toujours visible, même après upload) */}
      {mode === 'search' && (
        <div className="space-y-5">
          <div className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-sky-50 p-5">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xl">1️⃣</span>
              <h3 className="font-bold text-slate-900">
                {isOpenJaw && providerId !== 'google'
                  ? `Ouvre ${provider.label} (2 recherches : aller + retour)`
                  : `Ouvre ${provider.label} dans un nouvel onglet`}
              </h3>
            </div>
            <p className="text-sm text-slate-600 mb-3">
              {providerId === 'google' ? (
                <>
                  Google Flights ne supporte plus le pré-remplissage par
                  adresse Web. La page d'accueil va s'ouvrir : tu devras
                  recopier tes critères (voir ci-dessous).
                </>
              ) : isOpenJaw ? (
                <>
                  Comme tu pars d'une ville et rentres d'une autre, on fait{' '}
                  <strong>2 recherches séparées</strong>. Choisis ton vol pour
                  chacune, fais une capture de chaque, puis dépose-les ci-
                  dessous (les prix s'additionnent).
                </>
              ) : (
                <>
                  Tes dates, ton départ et ta destination seront déjà remplis.
                  Tu n'as plus qu'à cliquer "Rechercher" et choisir ton vol.
                </>
              )}
            </p>
            {providerId === 'google' && hasMinimumForSearch && (
              <div className="mb-3 rounded-xl bg-white border-2 border-blue-300 p-3 text-xs space-y-1.5">
                <div className="font-bold text-slate-900 mb-1">
                  📋 À recopier dans Google Flights :
                </div>
                <div>
                  <span className="text-slate-500">Depuis : </span>
                  <span className="font-mono font-semibold text-slate-900">
                    {values.departureLocation}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Vers : </span>
                  <span className="font-mono font-semibold text-slate-900">
                    {arrivalCity}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Aller : </span>
                  <span className="font-mono font-semibold text-slate-900">
                    {values.startDate}
                  </span>
                  {values.endDate && (
                    <>
                      <span className="text-slate-500"> · Retour : </span>
                      <span className="font-mono font-semibold text-slate-900">
                        {values.endDate}
                      </span>
                    </>
                  )}
                </div>
                {isOpenJaw && (
                  <div>
                    <span className="text-slate-500">Type : </span>
                    <span className="font-semibold text-slate-900">
                      Multi-destinations (retour depuis {returnCity})
                    </span>
                  </div>
                )}
                <div>
                  <span className="text-slate-500">Voyageurs : </span>
                  <span className="font-semibold text-slate-900">
                    {values.adults} adulte{Number(values.adults) > 1 ? 's' : ''}
                    {Array.isArray(values.childrenAges) && values.childrenAges.length > 0
                      ? ` + ${values.childrenAges.length} enfant${values.childrenAges.length > 1 ? 's' : ''} (${values.childrenAges.join(', ')} ans)`
                      : ''}
                  </span>
                </div>
              </div>
            )}
            {hasMinimumForSearch ? (
              isOpenJaw && providerId !== 'google' ? (
                // Open-jaw avec Skyscanner / Aviasales : 2 boutons explicites
                // pour faire 2 recherches one-way distinctes
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    onClick={() => openFlightSearch('outbound')}
                    disabled={resolveStatus === 'loading'}
                    className={`flex-1 inline-flex items-center justify-center gap-2 rounded-xl ${provider.btnClass} disabled:opacity-60 text-white px-4 py-3 text-sm font-semibold shadow-pop transition-colors`}
                  >
                    🛫 Aller ({values.departureLocation} → {arrivalCity}) →
                  </button>
                  <button
                    type="button"
                    onClick={() => openFlightSearch('return')}
                    disabled={resolveStatus === 'loading'}
                    className={`flex-1 inline-flex items-center justify-center gap-2 rounded-xl ${provider.btnClass} disabled:opacity-60 text-white px-4 py-3 text-sm font-semibold shadow-pop transition-colors`}
                  >
                    🛬 Retour ({returnCity} → {values.departureLocation}) →
                  </button>
                </div>
              ) : (
                // Aller-retour classique OU Google Flights (un seul bouton)
                <button
                  type="button"
                  onClick={() => openFlightSearch('roundtrip')}
                  disabled={resolveStatus === 'loading'}
                  className={`inline-flex items-center gap-2 rounded-xl ${provider.btnClass} disabled:opacity-60 text-white px-6 py-3 text-base font-semibold shadow-pop transition-colors`}
                >
                  {resolveStatus === 'loading'
                    ? 'Préparation…'
                    : providerId === 'google'
                      ? `Ouvrir ${provider.label} →`
                      : `🔍 Chercher mes vols sur ${provider.label} →`}
                </button>
              )
            ) : (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                ⚠️ Renseigne d'abord <strong>ville de départ</strong>,{' '}
                <strong>destination</strong> et <strong>dates</strong> aux étapes
                précédentes pour activer la recherche.
              </p>
            )}
            {resolveError && (
              <div
                className={`mt-3 text-xs rounded-lg p-3 ${
                  resolveStatus === 'need_city'
                    ? 'bg-amber-100 text-amber-900 border border-amber-300'
                    : 'bg-red-100 text-red-800 border border-red-300'
                }`}
              >
                {resolveError}
              </div>
            )}

            {/* Changement de provider — discret */}
            <div className="mt-3 text-xs text-slate-500">
              <span>Préfères-tu : </span>
              {FLIGHT_SEARCH_PROVIDERS.filter((p) => p.id !== providerId).map(
                (p, i) => (
                  <span key={p.id}>
                    {i > 0 && <span> · </span>}
                    <button
                      type="button"
                      onClick={() => setProviderId(p.id)}
                      className="underline hover:text-slate-700"
                    >
                      {p.label}
                    </button>
                  </span>
                )
              )}
            </div>
          </div>

          {/* Zone d'upload initiale — seulement quand on n'a aucun vol enregistré.
              Une fois un vol confirmé, ConfirmedFlightCard prend le relais avec
              sa propre zone "ajouter une autre capture". */}
          {!confirmed && (
            <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-5">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">2️⃣</span>
                <h3 className="font-bold text-slate-900">
                  Une fois ton vol choisi, partage ta capture ici
                </h3>
              </div>
              <p className="text-sm text-slate-600 mb-3">
                Fais une capture d'écran de la fiche du vol que tu as
                sélectionné, puis dépose-la ici. Notre IA lira automatiquement
                les horaires, le prix et tout le reste.
              </p>

              {uploadPhase === 'extracting' ? (
                <div className="bg-slate-50 rounded-xl">
                  <ExtractionLoader
                    accent="sky"
                    title="L'IA lit ta capture de vol…"
                    subtitle="Compagnie, horaires, aéroports, escales, prix…"
                  />
                </div>
              ) : (
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={onDrop}
                  onClick={() => fileRef.current?.click()}
                  className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 p-6 text-center cursor-pointer transition-colors"
                >
                  <div className="text-3xl mb-1">📸</div>
                  <p className="text-sm font-medium text-slate-800">
                    Glisse ta capture, clique ici ou colle avec{' '}
                    <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                      Ctrl
                    </kbd>
                    <span className="mx-0.5 text-slate-400">+</span>
                    <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                      V
                    </kbd>
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    PNG / JPG / WebP — 8 Mo max
                  </p>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => handleCaptureFile(e.target.files?.[0])}
                  />
                </div>
              )}

              {uploadError && (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {uploadError}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Mode SEARCH avec confirmation = on a un vol confirmé */}
      {mode === 'search' && confirmed && (
        <ConfirmedFlightCard
          confirmed={confirmed}
          onClear={clearConfirmedFlight}
          onSetPrice={setConfirmedPrice}
          onPickFile={() => fileRef2.current?.click()}
          onDropFile={onDrop}
          uploadPhase={uploadPhase}
          uploadError={uploadError}
        >
          <input
            ref={fileRef2}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleCaptureFile(e.target.files?.[0])}
          />
        </ConfirmedFlightCard>
      )}

      {/* Mode MANUAL : import par capture OU saisie à la main */}
      {mode === 'manual' && confirmed && (
        <ConfirmedFlightCard
          confirmed={confirmed}
          onClear={clearConfirmedFlight}
          onSetPrice={setConfirmedPrice}
          onPickFile={() => fileRef2.current?.click()}
          onDropFile={onDrop}
          uploadPhase={uploadPhase}
          uploadError={uploadError}
        >
          <input
            ref={fileRef2}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleCaptureFile(e.target.files?.[0])}
          />
        </ConfirmedFlightCard>
      )}
      {mode === 'manual' && !confirmed && (
        <div className="space-y-5">
          {/* Import par capture — l'IA lit les infos automatiquement */}
          <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-5">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xl">📸</span>
              <h3 className="font-bold text-slate-900">
                Colle une capture de tes billets — l'IA lit tout
              </h3>
            </div>
            <p className="text-sm text-slate-600 mb-3">
              Capture d'écran de ta confirmation (e-mail, appli compagnie,
              Skyscanner, Google Flights…). L'IA en extrait compagnie, horaires,
              aéroports et prix. Tu pourras corriger ensuite.
            </p>

            {uploadPhase === 'extracting' ? (
              <div className="bg-slate-50 rounded-xl">
                <ExtractionLoader
                  accent="sky"
                  title="L'IA lit ta capture de vol…"
                  subtitle="Compagnie, horaires, aéroports, escales, prix…"
                />
              </div>
            ) : (
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDrop}
                onClick={() => fileRef3.current?.click()}
                className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 p-6 text-center cursor-pointer transition-colors"
              >
                <div className="text-3xl mb-1">📸</div>
                <p className="text-sm font-medium text-slate-800">
                  Glisse ta capture, clique ici ou colle avec{' '}
                  <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                    Ctrl
                  </kbd>
                  <span className="mx-0.5 text-slate-400">+</span>
                  <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                    V
                  </kbd>
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  PNG / JPG / WebP — 8 Mo max
                </p>
                <input
                  ref={fileRef3}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleCaptureFile(e.target.files?.[0])}
                />
              </div>
            )}

            {uploadError && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {uploadError}
              </div>
            )}
          </div>

          {/* Séparateur */}
          <div className="flex items-center gap-3 text-xs font-medium text-slate-400">
            <div className="h-px flex-1 bg-slate-200" />
            ou saisis tes vols à la main
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <ManualFlightForm
            values={values}
            update={update}
            updateManualFlight={updateManualFlight}
          />
        </div>
      )}

      {/* Mode LATER : l'IA propose un vol probable */}
      {mode === 'later' && (
        <div className="rounded-xl bg-indigo-50 border border-indigo-200 p-5">
          <h3 className="font-semibold text-indigo-900">
            🤖 L'IA propose un vol probable
          </h3>
          <p className="text-sm text-indigo-800 mt-2">
            Tu n'as pas encore réservé ? Pas de souci. L'IA va proposer un{' '}
            <strong>vol plausible</strong> (compagnie, horaires types) avec une{' '}
            <strong>fourchette de prix estimée</strong> pour cadrer ton budget.
            L'itinéraire sera construit avec :
          </p>
          <ul className="mt-3 space-y-1.5 text-sm text-indigo-800 list-disc list-inside">
            <li>
              Une <strong>journée d'arrivée légère</strong> (check-in, balade,
              dîner — valable quelle que soit l'heure réelle du vol)
            </li>
            <li>
              Un <strong>dernier jour court et flexible</strong> (check-out,
              temps libre, transfert)
            </li>
            <li>
              Les <strong>jours du milieu détaillés</strong> comme d'habitude
            </li>
          </ul>
          <p className="text-xs text-indigo-700 mt-3">
            💡 Quand tu auras réservé pour de vrai, tu pourras chercher tes vols
            sur Skyscanner et importer ta capture pour remplacer l'estimation
            par les vraies heures et le vrai prix.
          </p>
        </div>
      )}
    </div>
  );
}

function ModeTab({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-medium border transition-all ${
        active
          ? 'bg-brand-600 text-white border-brand-600 shadow-glow'
          : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
      }`}
    >
      {children}
    </button>
  );
}

function ConfirmedFlightCard({
  confirmed,
  onClear,
  onSetPrice,
  onPickFile,
  onDropFile,
  uploadPhase,
  uploadError,
  children,
}) {
  const out = confirmed.outbound || {};
  const ret = confirmed.return || null;
  const pax = confirmed.passengers_total || 1;
  const total = Math.round(Number(confirmed.total_price_eur) || 0);
  const perPerson = pax > 0 ? Math.round(total / pax) : total;
  const airlineLabel = [out.airline_code, out.flight_number]
    .filter(Boolean)
    .join(' ');
  const captures = Array.isArray(confirmed._captures)
    ? confirmed._captures
    : [];
  const needsReturn = !ret;

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border-2 border-emerald-300 bg-gradient-to-br from-emerald-50 to-green-50 p-5 shadow-pop">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-emerald-700 font-bold">
              ✓ Vol bien enregistré
              {captures.length > 1 && (
                <span className="ml-1.5 normal-case font-normal text-slate-500">
                  ({captures.length} captures)
                </span>
              )}
            </div>
            <h3 className="text-lg font-bold text-slate-900 mt-0.5">
              {airlineLabel || 'Ton vol'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-slate-500 hover:text-red-600 hover:underline"
          >
            🗑 Recommencer
          </button>
        </div>

        <FlightLegRow
          label="✈️ Aller"
          origin={out.origin_iata}
          dest={out.destination_iata}
          departure={out.departure_at}
          arrival={out.arrival_at}
          stops={out.stops}
        />
        {ret && (
          <FlightLegRow
            label="🔄 Retour"
            origin={ret.origin_iata}
            dest={ret.destination_iata}
            departure={ret.departure_at}
            arrival={ret.arrival_at}
            stops={ret.stops}
          />
        )}

        <div className="mt-3 pt-3 border-t border-emerald-200 flex items-center justify-between text-sm">
          <div className="text-slate-700">
            👥 <strong>{pax}</strong> voyageur{pax > 1 ? 's' : ''}
          </div>
          <div className="text-right">
            {typeof onSetPrice === 'function' ? (
              <EditableValue
                value={total}
                type="number"
                min={0}
                step={10}
                suffix="€"
                format={(v) => `${Math.round(Number(v) || 0)} €`}
                label="Corriger le prix total du vol (souvent ce qui diffère d'une lecture à l'autre)"
                className="text-xl font-bold text-slate-900"
                onSave={async (v) => onSetPrice(v)}
              />
            ) : (
              <div className="text-xl font-bold text-slate-900">{total} €</div>
            )}
            <div className="text-xs text-slate-500">
              soit {perPerson} € / personne
              {typeof onSetPrice === 'function' && (
                <span className="block text-[11px] text-emerald-700">
                  ✏️ clique sur le prix pour le corriger
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {confirmed.currency_detected &&
        confirmed.currency_detected !== 'EUR' && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            ⚠️ Prix lu en {confirmed.currency_detected} puis converti. Vérifie
            le taux du jour si l'écart te paraît gros.
          </p>
        )}

      {/* Zone d'ajout d'une 2e+ capture (ex : aller et retour réservés
          séparément en 2 vols one-way distincts). Vraie zone de
          glisser-déposer avec support clic + Ctrl+V (le handler de paste
          est branché au document, donc fonctionne partout dans la page). */}
      <div
        className={`rounded-xl border-2 ${
          needsReturn
            ? 'border-amber-300 bg-amber-50'
            : 'border-slate-200 bg-slate-50'
        } p-3`}
      >
        <div className="flex items-center gap-2 mb-2">
          <div className="text-lg">{needsReturn ? '➕' : '📸'}</div>
          <div className="text-sm font-semibold text-slate-900">
            {needsReturn
              ? 'Ajouter le vol retour'
              : 'Ajouter une capture supplémentaire'}
          </div>
        </div>
        <p className="text-xs text-slate-600 mb-3 leading-relaxed">
          {needsReturn
            ? 'Tu as enregistré l\'aller. Si ton retour est un vol séparé (réservé à part), partage sa capture ici — les prix seront additionnés automatiquement.'
            : 'Si tu as plusieurs vols réservés séparément, ajoute leur capture une par une.'}
        </p>
        {uploadPhase === 'extracting' ? (
          <div className="bg-white rounded-lg border border-slate-200">
            <ExtractionLoader
              accent="sky"
              title="L'IA lit ta capture de vol…"
              subtitle="Compagnie, horaires, aéroports, escales, prix…"
            />
          </div>
        ) : (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDropFile}
            onClick={onPickFile}
            className={`rounded-lg border-2 border-dashed ${
              needsReturn
                ? 'border-amber-400 bg-white hover:bg-amber-50'
                : 'border-slate-300 bg-white hover:bg-slate-50'
            } p-4 text-center cursor-pointer transition-colors`}
          >
            <div className="text-2xl mb-1">📸</div>
            <p className="text-sm font-medium text-slate-800">
              Glisse ta capture, clique ici ou colle avec{' '}
              <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                Ctrl
              </kbd>
              <span className="mx-0.5 text-slate-400">+</span>
              <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                V
              </kbd>
            </p>
            <p className="text-xs text-slate-500 mt-1">
              PNG / JPG / WebP — 8 Mo max
            </p>
          </div>
        )}
        {uploadError && (
          <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {uploadError}
          </div>
        )}
        {children}
      </div>

      <p className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
        🎯 L'IA va caler le <strong>jour d'arrivée</strong> à partir de l'heure
        à laquelle tu atterris, et garder une marge avant ton{' '}
        <strong>vol retour</strong>. Aucune activité ne sera prévue pendant que
        tu es en l'air.
      </p>

      {captures.length > 0 && captures.some((c) => c.dataUrl) && (
        <details className="rounded-lg border border-slate-200 bg-slate-50">
          <summary className="cursor-pointer list-none px-3 py-2 text-xs text-slate-600 select-none">
            📷 Voir les {captures.length} capture{captures.length > 1 ? 's' : ''} utilisée{captures.length > 1 ? 's' : ''}
          </summary>
          <div className="p-3 pt-0 grid grid-cols-1 gap-2">
            {captures.map((c, i) =>
              c.dataUrl ? (
                <img
                  key={i}
                  src={c.dataUrl}
                  alt={`Capture ${i + 1}`}
                  className="max-h-64 mx-auto rounded object-contain"
                />
              ) : null
            )}
          </div>
        </details>
      )}
    </div>
  );
}

function FlightLegRow({ label, origin, dest, departure, arrival, stops }) {
  const stopsLabel =
    stops === 0
      ? 'direct'
      : stops === 1
        ? '1 escale'
        : stops > 1
          ? `${stops} escales`
          : '';
  return (
    <div className="rounded-xl bg-white border border-emerald-200 p-3 mb-2 last:mb-0">
      <div className="text-[10px] uppercase tracking-wide text-emerald-700 font-semibold mb-1.5">
        {label}
      </div>
      <div className="flex items-center gap-3">
        <div className="flex-1 text-center">
          <div className="text-base font-bold text-slate-900">{origin || '—'}</div>
          <div className="text-xs text-slate-600">{formatLegDateTime(departure)}</div>
        </div>
        <div className="text-center text-slate-400 text-xs">
          <div>→</div>
          {stopsLabel && (
            <div className="mt-1 text-[10px] uppercase">{stopsLabel}</div>
          )}
        </div>
        <div className="flex-1 text-center">
          <div className="text-base font-bold text-slate-900">{dest || '—'}</div>
          <div className="text-xs text-slate-600">{formatLegDateTime(arrival)}</div>
        </div>
      </div>
    </div>
  );
}

function ManualFlightForm({ values, update, updateManualFlight }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4">
        <h3 className="font-semibold text-emerald-900">
          ✏️ J'ai mes horaires de vol
        </h3>
        <p className="text-xs text-emerald-800 mt-1">
          Tout est optionnel — mais plus tu renseignes, plus précis sera
          l'itinéraire.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="label">Compagnie aérienne</label>
          <input
            className="input"
            placeholder="Ex : Air France, Lufthansa…"
            value={values.manualFlight?.airline || ''}
            onChange={(e) => updateManualFlight('airline', e.target.value)}
          />
        </div>
        <div>
          <label className="label">Numéro de vol</label>
          <input
            className="input"
            placeholder="Ex : AF038"
            value={values.manualFlight?.flightNumber || ''}
            onChange={(e) => updateManualFlight('flightNumber', e.target.value)}
          />
        </div>
      </div>
      <div className="rounded-lg bg-brand-50 border border-brand-200 p-4">
        <label className="label">
          💶 Prix par personne — vol aller-retour complet (€)
        </label>
        <input
          type="number"
          min="0"
          className="input"
          placeholder="Ex : 320 (le prix affiché sur le comparateur)"
          value={values.manualFlight?.outboundPriceEur || ''}
          onChange={(e) => {
            updateManualFlight('outboundPriceEur', e.target.value);
            updateManualFlight('returnPriceEur', '');
          }}
        />
        <p className="text-xs text-slate-500 mt-2">
          Le prix tel qu'affiché sur le comparateur (aller + retour par
          personne). Le total famille sera calculé automatiquement.
        </p>
      </div>
      <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          ✈️ Vol aller
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="label">Aéroport d'arrivée</label>
            <input
              className="input"
              placeholder="Ex : JFK, CDG…"
              value={values.arrivalGateway}
              onChange={(e) => update('arrivalGateway', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Heure d'arrivée</label>
            <input
              type="time"
              className="input"
              value={values.arrivalTime}
              onChange={(e) => update('arrivalTime', e.target.value)}
            />
          </div>
        </div>
      </div>
      <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          ✈️ Vol retour
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="label">Aéroport de départ</label>
            <input
              className="input"
              placeholder="Identique à l'arrivée"
              value={values.departureGateway}
              onChange={(e) => update('departureGateway', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Heure de départ</label>
            <input
              type="time"
              className="input"
              value={values.departureTime}
              onChange={(e) => update('departureTime', e.target.value)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// Compression locale d'une image avant envoi à DeepSeek Vision.
// Évite de saturer l'Edge Function avec des PNG de 5 Mo.
async function compressImageDataUrl(rawUrl, { maxDim = 1400, quality = 0.85 } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('Impossible de charger cette image.'));
    img.src = rawUrl;
  });
}

function StepVehicle({ values, updateVehicle, pickVehicleType }) {
  return (
    <div>
      <StepHeader
        icon="car"
        title="Quel véhicule ?"
        subtitle="Sert à estimer carburant, péages, et adapter les hébergements (aires CC, France Passion…)."
      />
      <div className="flex flex-wrap gap-2 mb-6">
        {VEHICLE_TYPES.map((vt) => {
          const active = values.vehicle.type === vt.id;
          return (
            <button
              key={vt.id}
              type="button"
              onClick={() => pickVehicleType(vt.id)}
              className={`rounded-full px-4 py-2 text-sm font-medium border transition-all ${
                active
                  ? 'bg-brand-600 text-white border-brand-600 shadow-glow'
                  : 'bg-white border-slate-200 hover:border-slate-300'
              }`}
            >
              {vt.label}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="label">Hauteur (m)</label>
          <input
            type="number"
            step="0.1"
            className="input"
            placeholder="Ex : 2.8"
            value={values.vehicle.height}
            onChange={(e) => updateVehicle('height', e.target.value)}
          />
        </div>
        <div>
          <label className="label">Longueur (m)</label>
          <input
            type="number"
            step="0.1"
            className="input"
            placeholder="Ex : 6.5"
            value={values.vehicle.length}
            onChange={(e) => updateVehicle('length', e.target.value)}
          />
        </div>
        <div>
          <label className="label">Carburant</label>
          <select
            className="input"
            value={values.vehicle.fuel}
            onChange={(e) => updateVehicle('fuel', e.target.value)}
          >
            <option value="essence">Essence</option>
            <option value="diesel">Diesel</option>
            <option value="electrique">Électrique</option>
            <option value="hybride">Hybride</option>
          </select>
        </div>
        <div>
          <label className="label">Consommation (L/100km)</label>
          <input
            type="number"
            step="0.1"
            className="input"
            placeholder="Ex : 8"
            value={values.vehicle.consumption}
            onChange={(e) => updateVehicle('consumption', e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}

function StepComposition({ values, onPick }) {
  const mode = values.compositionMode || 'ai';
  const OPTIONS = [
    {
      id: 'ai',
      icon: 'sparkles',
      title: 'Laisse faire l\'IA',
      desc: 'Tu donnes juste tes envies, et l\'IA compose tout l\'itinéraire de A à Z.',
    },
    {
      id: 'choose',
      icon: 'compass',
      title: 'Je choisis mes lieux',
      desc: 'On te propose une sélection de villes et de lieux. Tu coches ce qui te plaît, l\'IA bâtit le voyage autour.',
    },
  ];
  return (
    <div>
      <StepHeader
        icon="route"
        title="Comment veux-tu composer ton voyage ?"
        subtitle="Deux façons de faire : tout déléguer à l'IA, ou choisir toi-même les lieux à visiter."
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {OPTIONS.map((o) => {
          const active = mode === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onPick(o.id)}
              className={`text-left rounded-2xl border-2 p-5 transition-all ${
                active
                  ? 'border-brand-600 bg-brand-50 ring-2 ring-brand-500 shadow-glow'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-md'
              }`}
            >
              <div className="inline-grid place-items-center h-12 w-12 rounded-xl bg-brand-600 text-white mb-3">
                <Icon name={o.icon} className="h-6 w-6" />
              </div>
              <div className="font-semibold text-slate-900">{o.title}</div>
              <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                {o.desc}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StepInterests({ values, toggle }) {
  const noneSelected = values.interests.length === 0;
  return (
    <div>
      <StepHeader
        icon="sparkles"
        title="Qu'est-ce que tu aimes ?"
        subtitle="Choisis ce qui te fait envie — ou laisse vide si tu es ouvert à tout."
      />
      <div className="flex flex-wrap gap-2">
        {INTERESTS.map((i) => {
          const active = values.interests.includes(i);
          return (
            <button
              key={i}
              type="button"
              onClick={() => toggle('interests', i)}
              className={`rounded-full px-4 py-2 text-sm font-medium border transition-all capitalize ${
                active
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white border-slate-200 hover:border-slate-300'
              }`}
            >
              {i}
            </button>
          );
        })}
      </div>
      <div
        className={`mt-5 rounded-xl border p-4 text-sm ${
          noneSelected
            ? 'border-brand-200 bg-brand-50 text-brand-800'
            : 'border-slate-200 bg-slate-50 text-slate-600'
        }`}
      >
        {noneSelected ? (
          <>
            👍 <strong>Rien de coché = ouvert à tout.</strong> On te
            proposera un mélange équilibré : culture, nature, gastronomie,
            détente… Tu pourras affiner après coup.
          </>
        ) : (
          <>
            ✓ {values.interests.length} centre
            {values.interests.length > 1 ? 's' : ''} d'intérêt sélectionné
            {values.interests.length > 1 ? 's' : ''}. L'itinéraire sera
            orienté en priorité là-dessus.
          </>
        )}
      </div>
    </div>
  );
}

function StepStyle({ values, update, toggle }) {
  return (
    <div>
      <StepHeader
        icon="settings"
        title="Budget & hébergement"
        subtitle="Ton niveau de budget et tes préférences d'hébergement."
      />

      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600 mb-3">
        Niveau de budget
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-6">
        {BUDGET_LEVELS.map((b) => {
          const active = values.budget === b.id;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => update('budget', b.id)}
              className={`rounded-xl border p-3 text-sm font-medium transition-all ${
                active
                  ? 'border-brand-600 bg-brand-50 ring-2 ring-brand-500 text-brand-700'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              {b.label}
            </button>
          );
        })}
      </div>

      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600 mb-3">
        Type d'hébergement préféré
      </h3>
      <div className="flex flex-wrap gap-2 mb-6">
        {NIGHT_STAY_OPTIONS.map((o) => {
          const active = values.nightStayPreferences.includes(o);
          return (
            <button
              key={o}
              type="button"
              onClick={() => toggle('nightStayPreferences', o)}
              className={`rounded-full px-3 py-1.5 text-sm border transition-all ${
                active
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white border-slate-200 hover:border-slate-300'
              }`}
            >
              {o}
            </button>
          );
        })}
      </div>

      {/* Critères de recherche Booking — appliqués à TOUTES les nuits */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-base">🛎️</span>
          <h3 className="text-sm font-semibold text-slate-900">
            Tes critères de réservation
          </h3>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          On les utilisera pour pré-remplir ta recherche Booking, à chaque
          nuit du voyage (tu ne les ressaisis qu'une fois).
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Nombre de chambres</label>
            <input
              type="number"
              min="1"
              max="9"
              className="input"
              value={values.rooms || 1}
              onChange={(e) =>
                update('rooms', Math.max(1, Number(e.target.value) || 1))
              }
            />
          </div>
          <div>
            <label className="label">Gamme (étoiles)</label>
            <select
              className="input"
              value={values.hotelStars || ''}
              onChange={(e) => update('hotelStars', e.target.value)}
            >
              <option value="">Peu importe</option>
              <option value="3">3 étoiles et +</option>
              <option value="4">4 étoiles et +</option>
              <option value="5">5 étoiles</option>
            </select>
          </div>
          <div>
            <label className="label">Note minimale des voyageurs</label>
            <select
              className="input"
              value={values.hotelReviewScore || ''}
              onChange={(e) => update('hotelReviewScore', e.target.value)}
            >
              <option value="">Peu importe</option>
              <option value="9">Exceptionnel : 9+</option>
              <option value="8">Très bien : 8+</option>
              <option value="7">Bien : 7+</option>
              <option value="6">Agréable : 6+</option>
            </select>
          </div>
        </div>
        <p className="text-xs text-slate-400 mt-2">
          Tu peux choisir l'un, l'autre, les deux… ou aucun. On applique tes
          choix directement dans la recherche Booking.
        </p>
      </div>
    </div>
  );
}

function StepPersonalization({ values, update, toggle }) {
  return (
    <div>
      <StepHeader
        icon="settings"
        title="Personnalisation"
        subtitle="Quelques détails pour parfaire l'itinéraire (tout est optionnel)."
      />

      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600 mb-3">
        Activités spécifiques souhaitées
      </h3>
      <div className="flex flex-wrap gap-2 mb-6">
        {SPECIFIC_ACTIVITIES.map((a) => {
          const active = values.specificActivities.includes(a.id);
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => toggle('specificActivities', a.id)}
              className={`rounded-full px-3 py-1.5 text-sm border transition-all ${
                active
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white border-slate-200 hover:border-slate-300'
              }`}
            >
              {a.label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div>
          <label className="label">Lieux à inclure absolument</label>
          <textarea
            className="input min-h-[80px]"
            placeholder="Ex : Times Square, Central Park, Statue de la Liberté…"
            value={values.mustInclude}
            onChange={(e) => update('mustInclude', e.target.value)}
          />
        </div>
        <div>
          <label className="label">Lieux à éviter</label>
          <textarea
            className="input min-h-[80px]"
            placeholder="Ex : quartiers très touristiques, restaurants chers…"
            value={values.toAvoid}
            onChange={(e) => update('toAvoid', e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className="label">Jours off / repos</label>
        <input
          type="number"
          min="0"
          className="input md:w-32"
          value={values.offDays}
          onChange={(e) =>
            update('offDays', Math.max(0, Number(e.target.value) || 0))
          }
        />
        <p className="text-xs text-slate-500 mt-1">
          🛋️ Journée légère sans gros trajet ni excursion lourde, juste du repos.
        </p>
      </div>
    </div>
  );
}

function StepRecap({ values }) {
  const totalDays = computeTotalDays(values.startDate, values.endDate);
  const pax =
    (Number(values.adults) || 0) +
    (Array.isArray(values.childrenAges) ? values.childrenAges.length : 0);
  const tripTypeLabel =
    TRIP_TYPES.find((t) => t.id === values.tripType)?.label || values.tripType;
  return (
    <div>
      <StepHeader
        icon="sparkles"
        title="Tout est prêt !"
        subtitle="Vérifie le récap, puis lance la génération de ton itinéraire sur mesure."
      />
      <div className="rounded-2xl bg-gradient-to-br from-brand-50 to-amber-50 border border-brand-200 p-6">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <RecapRow label="🗺️ Destination" value={values.destinations} />
          <RecapRow
            label="📅 Dates"
            value={
              values.startDate && values.endDate
                ? `${values.startDate} → ${values.endDate} (${totalDays} j)`
                : '—'
            }
          />
          <RecapRow label="🚏 Départ" value={values.departureLocation} />
          <RecapRow
            label="🏁 Retour"
            value={values.returnLocation || values.departureLocation}
          />
          <RecapRow
            label="👥 Voyageurs"
            value={`${values.adults} adulte(s)${
              values.childrenAges?.length
                ? ` + ${values.childrenAges.length} enfant(s) (${values.childrenAges.join(', ')} ans)`
                : ''
            } — ${pax} pers.`}
          />
          <RecapRow label="🎯 Type" value={tripTypeLabel} />
          <RecapRow
            label="💰 Budget"
            value={
              BUDGET_LEVELS.find((b) => b.id === values.budget)?.label ||
              values.budget
            }
          />
          <RecapRow
            label="🎨 Intérêts"
            value={
              values.interests.length > 0
                ? values.interests.join(', ')
                : 'Ouvert à tout'
            }
          />
          {AIR_TYPES.has(values.tripType) && (
            <>
              {values.confirmedFlight?.outbound?.origin_iata ? (
                <>
                  <RecapRow
                    label="✈️ Vol confirmé (capture)"
                    value={(() => {
                      const out = values.confirmedFlight.outbound;
                      const airline = [out.airline_code, out.flight_number]
                        .filter(Boolean)
                        .join(' ');
                      return `${airline || '—'} · ${out.origin_iata} → ${out.destination_iata}`;
                    })()}
                  />
                  <RecapRow
                    label="⏰ Horaires"
                    value={(() => {
                      const out = values.confirmedFlight.outbound;
                      const ret = values.confirmedFlight.return;
                      const dep = (out.departure_at || '').substring(11, 16);
                      const arr = (out.arrival_at || '').substring(11, 16);
                      let s = `Aller ${dep}→${arr}`;
                      if (ret) {
                        const rd = (ret.departure_at || '').substring(11, 16);
                        const ra = (ret.arrival_at || '').substring(11, 16);
                        s += ` · Retour ${rd}→${ra}`;
                      }
                      return s;
                    })()}
                  />
                  <RecapRow
                    label="💶 Prix vol (total famille)"
                    value={`${Math.round(Number(values.confirmedFlight.total_price_eur) || 0)} €`}
                  />
                </>
              ) : (
                <>
                  <RecapRow
                    label="✈️ Compagnie"
                    value={values.manualFlight?.airline || 'À déterminer'}
                  />
                  <RecapRow
                    label="⏰ Horaires vol"
                    value={
                      values.arrivalTime || values.departureTime
                        ? `Arrivée ${values.arrivalTime || '?'} · Départ ${values.departureTime || '?'}`
                        : 'Non précisés (J1/J_final en mode léger)'
                    }
                  />
                </>
              )}
            </>
          )}
        </dl>
      </div>
    </div>
  );
}

function RecapRow({ label, value }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900 mt-0.5">{value || '—'}</dd>
    </div>
  );
}

// --- Composant principal --------------------------------------------------

export default function WizardPreferencesForm({
  onSubmit,
  loading,
  initialValues,
  onSwitchToFullForm,
}) {
  const [values, setValues] = useState(() =>
    initialValues ? { ...DEFAULTS, ...initialValues } : DEFAULTS
  );
  const [currentStep, setCurrentStep] = useState(0);
  // État de l'écran "Je choisis mes lieux" (porté ici pour survivre quand on
  // change d'étape du wizard).
  const [discover, setDiscover] = useState(null);

  useEffect(() => {
    if (initialValues) {
      setValues((v) => ({ ...DEFAULTS, ...v, ...initialValues }));
    }
  }, [initialValues]);

  // Choix du mode de composition (étape "Comment composer ton voyage ?").
  function pickComposition(modeId) {
    if (modeId === 'ai') {
      // On repart sur une page blanche : l'IA décide tout.
      setValues((v) => ({
        ...v,
        compositionMode: 'ai',
        mustInclude: '',
        _selectedPlaces: [],
      }));
      setDiscover((dd) =>
        dd ? { ...dd, selectedCities: [], selectedPlaces: [] } : dd
      );
    } else {
      setValues((v) => ({ ...v, compositionMode: 'choose' }));
    }
  }

  const tripType = normalizeTripType(values.tripType);
  // L'étape "Tes vols" apparaît si :
  //   - le type est explicitement avion-* (avion-voiture, avion-citybreak), OU
  //   - l'utilisateur a coché "Ce voyage inclut un vol" à l'étape précédente
  const isAir = AIR_TYPES.has(tripType) || values.includesFlight === true;
  const isRoadtrip = ROAD_TRIP_TYPES.has(tripType);
  const isMotorized = MOTORIZED_TRIP_TYPES.has(tripType);

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
  function updateConfirmedFlight(flightOrNull) {
    setValues((v) => ({ ...v, confirmedFlight: flightOrNull }));
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
    }));
  }

  // Construit dynamiquement les étapes selon le type de voyage.
  // Ordre : Où → Qui → Quand → Comment → [Vol] → [Véhicule] → Intérêts →
  //         Budget → Personnalisation → Récap
  // (Les dates viennent APRÈS destination + voyageurs pour que le bouton
  //  "trouver les dates les moins chères" soit pré-rempli.)
  const steps = useMemo(() => {
    const base = [
      {
        id: 'destination',
        canNext: () => Boolean(values.destinations && values.departureLocation),
        render: () => <StepDestination values={values} update={update} />,
      },
      {
        id: 'travelers',
        canNext: () => Number(values.adults) >= 1,
        render: () => <StepTravelers values={values} update={update} />,
      },
      {
        id: 'dates',
        canNext: () =>
          Boolean(values.startDate && values.endDate) &&
          computeTotalDays(values.startDate, values.endDate) > 0,
        render: () => <StepDates values={values} update={update} />,
      },
      {
        id: 'tripType',
        canNext: () => Boolean(values.tripType),
        render: () => <StepTripType values={values} update={update} />,
      },
    ];
    if (isAir) {
      base.push({
        id: 'flight',
        canNext: () => true, // toutes les sous-options sont valides
        render: () => (
          <StepFlight
            values={values}
            update={update}
            updateManualFlight={updateManualFlight}
            updateConfirmedFlight={updateConfirmedFlight}
          />
        ),
      });
    }
    if (isMotorized && !isAir) {
      base.push({
        id: 'vehicle',
        canNext: () => true,
        render: () => (
          <StepVehicle
            values={values}
            updateVehicle={updateVehicle}
            pickVehicleType={pickVehicleType}
          />
        ),
      });
    }
    base.push({
      id: 'composition',
      canNext: () => true,
      render: () => (
        <StepComposition values={values} onPick={pickComposition} />
      ),
    });
    if (values.compositionMode === 'choose') {
      const discoverProps = {
        destination: values.destinations,
        startDate: values.startDate,
        endDate: values.endDate,
        tripType: values.tripType,
        adults: values.adults,
        childrenAges: values.childrenAges,
        state: discover,
        onState: setDiscover,
        onSelectionChange: (mustInclude, selectedPlaces) => {
          setValues((v) => ({ ...v, mustInclude, _selectedPlaces: selectedPlaces }));
        },
      };
      // Étape 1 : villes / régions. On exige au moins une étape choisie.
      base.push({
        id: 'discover-cities',
        canNext: () => (discover?.selectedCities?.length || 0) > 0,
        render: () => <PlaceDiscovery phase="cities" {...discoverProps} />,
      });
      // Étape 2 : activités associées aux villes choisies (optionnel).
      base.push({
        id: 'discover-activities',
        canNext: () => true,
        render: () => <PlaceDiscovery phase="activities" {...discoverProps} />,
      });
    }
    base.push(
      {
        id: 'interests',
        // Optionnel : rien coché = ouvert à tout → on peut toujours continuer
        canNext: () => true,
        render: () => <StepInterests values={values} toggle={toggle} />,
      },
      {
        id: 'style',
        canNext: () => Boolean(values.budget),
        render: () => (
          <StepStyle values={values} update={update} toggle={toggle} />
        ),
      },
      {
        id: 'personalization',
        canNext: () => true,
        render: () => (
          <StepPersonalization
            values={values}
            update={update}
            toggle={toggle}
          />
        ),
      },
      {
        id: 'recap',
        canNext: () => true,
        render: () => <StepRecap values={values} />,
      }
    );
    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, isAir, isMotorized, discover]);

  // Si l'utilisateur change de tripType et qu'on était au-delà de l'étape vol,
  // on s'assure que currentStep reste valide.
  useEffect(() => {
    if (currentStep >= steps.length) {
      setCurrentStep(Math.max(0, steps.length - 1));
    }
  }, [steps.length, currentStep]);

  const step = steps[currentStep];
  const isLast = currentStep === steps.length - 1;
  const canNext = step?.canNext?.() ?? true;

  function next() {
    if (isLast) {
      const payload = {
        ...values,
        returnLocation: values.returnLocation || values.departureLocation,
      };
      if (!isMotorized) payload.vehicle = null;
      // Si on est sur un voyage avion, on force scheduledTransport pour que
      // le backend déclenche le mode "horaires" approprié.
      if (isAir && !payload.scheduledTransport) {
        payload.scheduledTransport = 'avion-intl';
      }
      // Si l'utilisateur a partagé une capture (confirmedFlight), on dérive
      // automatiquement arrivalTime, departureTime, gateways et manualFlight
      // pour que le backend utilise les vraies heures sans rien savoir du
      // nouveau format.
      // Nettoie les valeurs de gateway "espace seule" utilisées comme marqueur UI
      const arrivalGwTrimmed = (payload.arrivalGateway || '').trim();
      const departureGwTrimmed = (payload.departureGateway || '').trim();
      payload.arrivalGateway = arrivalGwTrimmed;
      payload.departureGateway = departureGwTrimmed;

      const cf = values.confirmedFlight;
      if (cf?.outbound?.arrival_at) {
        const out = cf.outbound;
        const ret = cf.return || null;
        const pax = Math.max(1, Number(cf.passengers_total) || 1);
        const pricePerPerson = Math.round(
          (Number(cf.total_price_eur) || 0) / pax
        );
        payload.scheduledTransport = 'avion-intl';
        payload.hasFixedSchedule = true;
        payload.arrivalTime = (out.arrival_at || '').substring(11, 16);
        // Préfère la valeur déjà saisie (vignette ville-aéroport cliquée),
        // sinon construit "Nom de ville (IATA)" depuis le code extrait.
        payload.arrivalGateway =
          payload.arrivalGateway || formatGateway(out.destination_iata);
        if (ret?.departure_at) {
          payload.departureTime = (ret.departure_at || '').substring(11, 16);
          payload.departureGateway =
            payload.departureGateway || formatGateway(ret.origin_iata);
        }
        payload.manualFlight = {
          airline: out.airline_code || payload.manualFlight?.airline || '',
          flightNumber:
            out.flight_number || payload.manualFlight?.flightNumber || '',
          outboundPriceEur: pricePerPerson > 0
            ? String(pricePerPerson)
            : payload.manualFlight?.outboundPriceEur || '',
          returnPriceEur: '',
        };
        // Le confirmedFlight reste dans le payload (déjà inclus via ...values)
        // pour que le backend puisse construire un bloc "vols confirmés"
        // explicite dans le prompt.
      } else if (values.arrivalTime || values.departureTime) {
        // Saisie manuelle : on active hasFixedSchedule
        payload.hasFixedSchedule = true;
      }
      onSubmit(payload);
      return;
    }
    setCurrentStep((c) => Math.min(steps.length - 1, c + 1));
  }
  function back() {
    setCurrentStep((c) => Math.max(0, c - 1));
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xl font-semibold text-slate-900">
          Composons ton voyage
        </h2>
        {onSwitchToFullForm && (
          <button
            type="button"
            onClick={onSwitchToFullForm}
            className="text-xs text-slate-500 hover:text-brand-700 hover:underline"
          >
            Voir tout d'un coup →
          </button>
        )}
      </div>

      <ProgressBar current={currentStep} total={steps.length} />

      <div className="min-h-[360px]">{step?.render?.()}</div>

      <NavButtons
        canBack={currentStep > 0}
        canNext={canNext}
        isLast={isLast}
        onBack={back}
        onNext={next}
        loading={loading}
      />
    </div>
  );
}
