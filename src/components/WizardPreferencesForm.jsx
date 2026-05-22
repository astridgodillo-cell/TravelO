import { useEffect, useMemo, useState } from 'react';
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
import { DEFAULTS, computeTotalDays } from './PreferencesForm';
import Icon from './Icon';

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

// Résolution ville → code IATA via l'autocomplete Travelpayouts (public,
// pas de token requis). On préfère "city" à "airport" pour avoir le code
// "metropolitan" qui regroupe tous les aéroports de la ville.
async function resolveIata(query) {
  if (!query || !query.trim()) return null;
  try {
    const url = `https://autocomplete.travelpayouts.com/places2?term=${encodeURIComponent(
      query
    )}&locale=fr&types[]=city&types[]=airport&types[]=country`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) return null;
    // Si premier résultat est un PAYS, on retourne un signal pour demander
    // à l'utilisateur de choisir une ville précise.
    if (arr[0].type === 'country') {
      return { country: true, name: arr[0].name, code: arr[0].code };
    }
    const city = arr.find((p) => p.type === 'city');
    const pick = city || arr[0];
    return { code: pick.code, name: pick.name, type: pick.type };
  } catch (e) {
    console.warn('[wizard] resolveIata failed', e);
    return null;
  }
}

// Construit le deeplink Aviasales au format natif : /search/{ORI}{DD}{MM}{DST}{DD2}{MM2}{pax}
// → pré-remplit nativement origine, destination ET dates dans l'UI Aviasales.
function buildAviasalesNativeUrl({
  originIata,
  destIata,
  departDate,
  returnDate,
  adults,
  childrenCount,
}) {
  const dd1 = departDate.substring(8, 10);
  const mm1 = departDate.substring(5, 7);
  let segment = `${originIata}${dd1}${mm1}${destIata}`;
  if (returnDate) {
    const dd2 = returnDate.substring(8, 10);
    const mm2 = returnDate.substring(5, 7);
    segment += `${dd2}${mm2}`;
  }
  const pax = `${Math.max(1, adults)}${childrenCount > 0 ? childrenCount : ''}`;
  return `https://www.aviasales.com/search/${segment}${pax}?currency=eur&locale=fr`;
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

  function handleSelect(range) {
    // range peut être undefined (reset) ou {from, to?}
    update('startDate', toIsoDate(range?.from));
    update('endDate', toIsoDate(range?.to));
  }

  // Bloque les dates passées
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div>
      <StepHeader
        icon="calendar"
        title="Quand veux-tu partir ?"
        subtitle="Clique sur ta date de départ, puis sur ta date de retour. Les jours entre les deux seront sélectionnés."
      />

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
  return (
    <div>
      <StepHeader
        icon="compass"
        title="Comment voyages-tu ?"
        subtitle="Choisis le mode principal de transport. On adaptera ensuite les étapes suivantes."
      />
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
                className={`inline-grid place-items-center h-10 w-10 rounded-xl ${
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
    </div>
  );
}

function StepFlight({ values, update, updateManualFlight }) {
  const [path, setPath] = useState(() => {
    if (
      values.manualFlight?.outboundPriceEur ||
      values.manualFlight?.returnPriceEur
    )
      return 'known';
    if (values.arrivalTime || values.departureTime) return 'known';
    return null;
  });
  // État de résolution IATA pour ouvrir Aviasales avec dates pré-remplies
  const [resolveStatus, setResolveStatus] = useState('idle'); // 'idle' | 'loading' | 'need_city' | 'error'
  const [resolveError, setResolveError] = useState(null);

  // Le bloc "type de transport" est implicite (avion-intl ou domestique).
  // On l'initialise une fois pour qu'il soit transmis au backend.
  useEffect(() => {
    if (!values.scheduledTransport) {
      update('scheduledTransport', 'avion-intl');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Ville d'atterrissage précise = arrivalGateway (existant) ou destinations
  const arrivalCity = values.arrivalGateway || values.destinations;
  const hasMinimumForSearch =
    !!values.departureLocation && !!arrivalCity && !!values.startDate;

  async function openAviasalesSearch() {
    if (!hasMinimumForSearch) return;
    setResolveStatus('loading');
    setResolveError(null);
    try {
      const isRoundTrip =
        !values.returnLocation ||
        values.returnLocation === values.departureLocation;
      const adults = Math.max(1, Number(values.adults) || 1);
      const childrenCount = Array.isArray(values.childrenAges)
        ? values.childrenAges.length
        : 0;
      const [origin, dest] = await Promise.all([
        resolveIata(values.departureLocation),
        resolveIata(arrivalCity),
      ]);
      if (!origin || !dest) {
        setResolveStatus('error');
        setResolveError(
          'Impossible de trouver les codes aéroport. Vérifie l\'orthographe des villes.'
        );
        return;
      }
      // Si la destination est en fait un pays → on demande à l'utilisateur
      // de préciser une ville d'atterrissage.
      if (dest.country) {
        setResolveStatus('need_city');
        setResolveError(
          `"${dest.name}" est un pays. Précise une ville d'arrivée précise (ex: Oslo, Bergen, Tromsø…) dans le champ ci-dessous.`
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
      const url = buildAviasalesNativeUrl({
        originIata: origin.code,
        destIata: dest.code,
        departDate: values.startDate,
        returnDate: isRoundTrip ? values.endDate : null,
        adults,
        childrenCount,
      });
      window.open(url, '_blank', 'noopener,noreferrer');
      setResolveStatus('idle');
    } catch (e) {
      console.error(e);
      setResolveStatus('error');
      setResolveError('Une erreur est survenue. Réessaie.');
    }
  }

  return (
    <div>
      <StepHeader
        icon="plane"
        title="Ton vol"
        subtitle="3 options selon ta situation. Tu peux changer d'avis plus tard."
      />

      {/* Champ "Ville d'arrivée précise" — utile quand destinations = pays */}
      <div className="mb-6 rounded-xl bg-slate-50 border border-slate-200 p-4">
        <label className="label">
          Aéroport / ville d'arrivée exacte
          <span className="text-slate-400 font-normal">
            {' '}
            (essentiel si tu as saisi un pays)
          </span>
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
        <p className="text-xs text-slate-500 mt-1">
          Sert à la recherche de vol et au calage de l'itinéraire. Si vide, on
          utilise "{values.destinations || '(destination)'}" — ça peut être
          ambigu pour un pays.
        </p>
      </div>

      {!path && (
        <div className="grid grid-cols-1 gap-3">
          <PathCard
            icon="✈️"
            title="J'ai déjà mes horaires de vol"
            description="Tu as réservé, ou tu connais l'heure exacte d'arrivée/départ. On cale ton itinéraire au minute près."
            onClick={() => setPath('known')}
            tone="green"
          />
          <PathCard
            icon="🔍"
            title="Je veux d'abord chercher mon vol"
            description="On t'ouvre Aviasales avec tes dates pré-remplies. Tu reviens ici pour saisir tes horaires une fois ton vol choisi."
            onClick={() => setPath('search')}
            tone="blue"
            disabled={!hasMinimumForSearch}
          />
          <PathCard
            icon="⏳"
            title="Je verrai plus tard"
            description="On génère l'itinéraire avec J1 et dernier jour volontairement légers. Tu pourras les régénérer une fois ton vol réservé."
            onClick={() => setPath('later')}
            tone="amber"
          />
        </div>
      )}

      {path === 'known' && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setPath(null)}
            className="text-sm text-slate-500 hover:underline"
          >
            ← Changer de mode
          </button>
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4">
            <h3 className="font-semibold text-emerald-900">
              ✈️ J'ai mes horaires
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
          </div>
          {/* Prix unique aller-retour par personne — comme sur Aviasales/Skyscanner */}
          <div className="rounded-lg bg-brand-50 border border-brand-200 p-4">
            <label className="label">
              💶 Prix par personne — vol aller-retour complet (€)
            </label>
            <input
              type="number"
              min="0"
              className="input"
              placeholder="Ex : 320 (le prix affiché sur Aviasales/Skyscanner)"
              value={values.manualFlight?.outboundPriceEur || ''}
              onChange={(e) => {
                updateManualFlight('outboundPriceEur', e.target.value);
                // On stocke uniquement dans outbound : c'est le prix aller-retour
                // total par personne. Le backend fait outbound × pax.
                updateManualFlight('returnPriceEur', '');
              }}
            />
            <p className="text-xs text-slate-500 mt-2">
              C'est le prix tel qu'il apparaît sur les comparateurs : aller +
              retour cumulés, pour une personne. Le total famille sera calculé
              automatiquement (× nombre de voyageurs).
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
                  onChange={(e) =>
                    update('departureGateway', e.target.value)
                  }
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
      )}

      {path === 'search' && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setPath(null)}
            className="text-sm text-slate-500 hover:underline"
          >
            ← Changer de mode
          </button>
          <div className="rounded-xl bg-sky-50 border border-sky-200 p-5 text-center">
            <h3 className="font-semibold text-sky-900">
              🔍 Recherche ton vol sur Aviasales
            </h3>
            <p className="text-sm text-sky-800 mt-2">
              On pré-remplit tes dates, ton origine et ta destination. Choisis
              ton vol,{' '}
              <strong>note l'heure d'arrivée et de départ</strong>, puis reviens
              ici pour les saisir.
            </p>
            {hasMinimumForSearch ? (
              <button
                type="button"
                onClick={openAviasalesSearch}
                disabled={resolveStatus === 'loading'}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white px-5 py-2.5 font-medium transition-colors"
              >
                {resolveStatus === 'loading'
                  ? 'Préparation…'
                  : 'Ouvrir Aviasales dans un nouvel onglet →'}
              </button>
            ) : (
              <p className="mt-4 text-xs text-sky-700">
                Renseigne d'abord destination + dates pour activer la
                recherche.
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
          </div>
          <p className="text-center text-sm text-slate-600">
            Une fois ton vol trouvé :
          </p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <button
              type="button"
              onClick={() => setPath('known')}
              className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 text-sm font-medium transition-colors"
            >
              ✓ J'ai mes horaires, je les saisis
            </button>
            <button
              type="button"
              onClick={() => setPath('later')}
              className="rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 px-5 py-2.5 text-sm font-medium transition-colors"
            >
              Finalement, je verrai plus tard
            </button>
          </div>
        </div>
      )}

      {path === 'later' && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setPath(null)}
            className="text-sm text-slate-500 hover:underline"
          >
            ← Changer de mode
          </button>
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-5">
            <h3 className="font-semibold text-amber-900">
              ⏳ On verra plus tard
            </h3>
            <p className="text-sm text-amber-800 mt-2">
              Pas de souci. On va générer ton itinéraire avec :
            </p>
            <ul className="mt-3 space-y-1.5 text-sm text-amber-800 list-disc list-inside">
              <li>
                Une <strong>journée d'arrivée légère</strong> (check-in,
                balade, dîner — valable quelle que soit l'heure du vol)
              </li>
              <li>
                Un <strong>dernier jour court et flexible</strong> (check-out,
                temps libre, transfert)
              </li>
              <li>
                Les <strong>jours du milieu détaillés et riches</strong> comme
                d'habitude
              </li>
              <li>
                Un <strong>bandeau d'avertissement</strong> sur J1 et J_final
                que tu pourras "Régénérer" une fois ton vol réservé
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function PathCard({ icon, title, description, onClick, tone, disabled }) {
  const tones = {
    green:
      'border-emerald-200 hover:border-emerald-500 hover:bg-emerald-50 hover:ring-emerald-500',
    blue: 'border-sky-200 hover:border-sky-500 hover:bg-sky-50 hover:ring-sky-500',
    amber:
      'border-amber-200 hover:border-amber-500 hover:bg-amber-50 hover:ring-amber-500',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`text-left rounded-xl border-2 bg-white p-5 transition-all hover:shadow-md hover:ring-2 ${
        tones[tone]
      } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <div className="flex items-start gap-3">
        <div className="text-3xl shrink-0">{icon}</div>
        <div>
          <h3 className="font-semibold text-slate-900">{title}</h3>
          <p className="text-sm text-slate-600 mt-1 leading-relaxed">
            {description}
          </p>
        </div>
      </div>
    </button>
  );
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

function StepStyle({ values, update, toggle }) {
  return (
    <div>
      <StepHeader
        icon="sparkles"
        title="Ton style de voyage"
        subtitle="Sélectionne tes centres d'intérêt, ton niveau de budget et tes préférences d'hébergement."
      />

      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600 mb-3">
        Centres d'intérêt
      </h3>
      <div className="flex flex-wrap gap-2 mb-6">
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
      <div className="flex flex-wrap gap-2">
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
            value={values.interests.join(', ') || '—'}
          />
          {AIR_TYPES.has(values.tripType) && (
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

  useEffect(() => {
    if (initialValues) {
      setValues((v) => ({ ...DEFAULTS, ...v, ...initialValues }));
    }
  }, [initialValues]);

  const tripType = normalizeTripType(values.tripType);
  const isAir = AIR_TYPES.has(tripType);
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

  // Construit dynamiquement les étapes selon le type de voyage
  const steps = useMemo(() => {
    const base = [
      {
        id: 'destination',
        canNext: () => Boolean(values.destinations && values.departureLocation),
        render: () => <StepDestination values={values} update={update} />,
      },
      {
        id: 'dates',
        canNext: () =>
          Boolean(values.startDate && values.endDate) &&
          computeTotalDays(values.startDate, values.endDate) > 0,
        render: () => <StepDates values={values} update={update} />,
      },
      {
        id: 'travelers',
        canNext: () => Number(values.adults) >= 1,
        render: () => <StepTravelers values={values} update={update} />,
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
    base.push(
      {
        id: 'style',
        canNext: () =>
          values.interests.length > 0 && Boolean(values.budget),
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
  }, [values, isAir, isMotorized]);

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
      // Active hasFixedSchedule si l'utilisateur a saisi des horaires
      if (values.arrivalTime || values.departureTime) {
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
