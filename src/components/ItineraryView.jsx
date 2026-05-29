import { useEffect, useMemo, useState } from 'react';
import { listPackingLists } from '../lib/supabase';
import { costEur } from '../lib/ai';
import {
  updateTripPrice,
  updateFlightField,
  updateActivityPricePerPerson,
  updateAccommodationPrice,
  updateMealsBudget,
  promoteAccommodationAlternative,
  removeAccommodationAlternative,
  clearMoment,
  recomputeBudgetFromDays,
  withRecomputedDayTotals,
  getAdults,
  getChildrenAges,
  replaceAccommodation,
  copyAccommodationFromPreviousDay,
  clearAccommodation,
} from '../lib/itineraryEdits';
import { useDayLayout } from '../hooks/useDayLayout';
import EditableValue from './EditableValue';
import RouteMap from './RouteMap';
import DayMiniMap from './DayMiniMap';
import RegenerateDayModal from './RegenerateDayModal';
import ModifyDayModal from './ModifyDayModal';
import EditActivityModal from './EditActivityModal';
import DayPhotos from './DayPhotos';
import DaySpecialties from './DaySpecialties';
import ItineraryTable from './ItineraryTable';
import Icon from './Icon';
import { fetchHotelRating, checkActivityBookable } from '../lib/photos';
import {
  bestAccommodationLink,
  googleMapsDirections,
  googleMapsSearch,
  googleMapsMultiStop,
  directFerriesSearch,
  park4nightSearch,
  getYourGuideSearch,
  tiqetsSearch,
  isLikelyBookable,
} from '../lib/externalLinks';
import { buildSkyscannerUrl, extractIataSync } from '../lib/flightSearchLinks';

const TABS = [
  { id: 'planning', label: 'Planning' },
  { id: 'table', label: 'Tableau' },
  { id: 'map', label: 'Carte' },
  { id: 'budget', label: 'Budget' },
  { id: 'notes', label: 'Pratique' },
  { id: 'activities', label: 'Activités' },
];

// Vrai = "activité" qui est en fait un TRAJET de vol (ex : "Vol Marseille →
// Athènes") que l'IA range parfois dans les activités. À exclure des listes
// d'activités (pas réservable comme une excursion). On ne touche pas aux
// vraies activités aériennes (montgolfière, parapente…) : on exige le mot
// "vol" + une flèche/emoji de trajet.
function isFlightLegActivity(a) {
  const t = `${a?.title || ''}`;
  return /\bvol\b|✈|\bflight\b/i.test(t) && /→|🛫|🛬|->/.test(t);
}

const VAN_TRIP_TYPES = new Set([
  'roadtrip-van',
  'roadtrip-camping-car',
]);

const formatEur = (n) =>
  typeof n === 'number'
    ? n.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €'
    : '—';

const formatEurOrFree = (n) => (n === 0 ? 'Gratuit' : formatEur(n));

// Affiche un prix d'hôtel :
//  - si l'utilisateur a saisi le vrai prix (userEdited) → valeur exacte
//  - sinon → fourchette ±30 % autour de l'estimation (ex: 100 → "70–130")
// Renvoie SANS le suffixe "€" (ajouté à part par le composant appelant).
function formatPriceRange(value, userEdited) {
  const v = Number(value) || 0;
  if (v === 0) return 'Gratuit';
  if (userEdited) return v.toLocaleString('fr-FR', { maximumFractionDigits: 0 });
  const low = Math.round((v * 0.7) / 5) * 5;
  const high = Math.round((v * 1.3) / 5) * 5;
  return `${low.toLocaleString('fr-FR')}–${high.toLocaleString('fr-FR')}`;
}

// Préfixe "≈ " pour les estimations calculées par l'IA (hôtels, repas,
// trajets routiers, budget total). À ne PAS utiliser pour les prix
// scrappés en direct (vols Aviasales, etc.) qui eux sont réels.
const formatEurEstimate = (n) =>
  typeof n === 'number' ? '≈ ' + formatEur(n) : formatEur(n);

function formatAiCost(eur) {
  if (typeof eur !== 'number' || !isFinite(eur)) return '—';
  if (eur < 0.005) return '< 0,01 €';
  if (eur < 1) {
    return eur.toLocaleString('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 3,
      minimumFractionDigits: 2,
    });
  }
  return eur.toLocaleString('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 2,
  });
}

export default function ItineraryView({
  itinerary,
  onRegenerateDay,
  onReplanFromDay,
  onRegenerateActivity,
  onRemoveActivity,
  onFetchSpecialties,
  onUpdateItinerary,
  onSuggestMomentAlternatives,
  onImportHotelFromImage,
  onImportFlightFromImage,
  regenerating,
}) {
  const [tab, setTab] = useState('planning');
  const [regenTarget, setRegenTarget] = useState(null);
  const [modifyTarget, setModifyTarget] = useState(null);
  const [activityTarget, setActivityTarget] = useState(null);
  const [loadingSpecialtiesIdx, setLoadingSpecialtiesIdx] = useState(null);

  const allActivities = useMemo(() => {
    if (!itinerary?.days) return [];
    return itinerary.days.flatMap((d) =>
      (d.activities || [])
        .filter((a) => !isFlightLegActivity(a))
        .map((a) => ({
          ...a,
          day: d.label,
          date: d.date,
          location: a.location || d.location,
        }))
    );
  }, [itinerary]);

  const googleMapsUrl = useMemo(() => {
    if (!itinerary?.days?.length) return null;
    const stops = itinerary.days
      .map((d) => d.location)
      .filter(Boolean)
      .filter((loc, i, arr) => loc !== arr[i - 1]); // dédupe consécutifs
    return googleMapsMultiStop(stops);
  }, [itinerary]);

  if (!itinerary || typeof itinerary !== 'object') {
    console.warn('[ItineraryView] itinerary missing or invalid', itinerary);
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        L'itinéraire reçu est vide ou invalide. Réessaie ou contacte le
        support.
      </div>
    );
  }
  const {
    summary = {},
    notes = {},
    metadata = {},
  } = itinerary;
  // Source de vérité unique : on recalcule day_total_eur de chaque jour
  // ET le budget_summary global à partir des données brutes. Toutes les
  // valeurs (hero, tableau budget, partage, export) viennent d'ici → plus
  // de désynchronisation entre encart "Budget estimé" et "Grand total
  // estimé", ni entre détail du jour et total du jour.
  const days = useMemo(
    () => withRecomputedDayTotals(itinerary?.days),
    [itinerary]
  );
  const budget_summary = useMemo(
    () => recomputeBudgetFromDays(itinerary),
    [itinerary]
  );
  const adults = getAdults(summary);
  const childrenAges = getChildrenAges(summary);
  const children = childrenAges.length;
  const pax = Math.max(1, adults + children);
  // Liste de tous les vols de l'itinéraire (pour l'onglet "Vols").
  const flights = useMemo(() => {
    const out = [];
    (days || []).forEach((d, dayIndex) => {
      (d.trips || []).forEach((t, tripIndex) => {
        if (/avion|vol|flight|plane/i.test(t.mode || '')) {
          out.push({ dayIndex, tripIndex, trip: t, day: d });
        }
      });
    });
    return out;
  }, [days]);
  const hasFlights = flights.length > 0;
  const hasAccommodations = useMemo(
    () => (days || []).some((d) => d.accommodation),
    [days]
  );
  // Onglets : on insère "Vols" puis "Hôtels" après "Carte", chacun seulement
  // s'il y a quelque chose à montrer.
  const tabs = useMemo(() => {
    const out = [];
    for (const t of TABS) {
      out.push(t);
      if (t.id === 'map') {
        if (hasFlights) out.push({ id: 'flights', label: '✈️ Vols' });
        if (hasAccommodations) out.push({ id: 'hotels', label: '🏨 Hôtels' });
      }
    }
    return out;
  }, [hasFlights, hasAccommodations]);
  // Critères d'hébergement saisis dans le wizard → pré-remplissent Booking.
  // Fallback pour les anciens itinéraires sans ces critères.
  const accommodationPrefs = summary?.accommodation_prefs || {
    rooms: 1,
    stars: '',
    reviewScore: '',
    amenities: [],
  };
  const isVanTrip = VAN_TRIP_TYPES.has(summary?.trip_type);
  const aiCostEur = costEur(metadata?.total_cost_usd);

  async function handleSubmitRegen(instructions) {
    if (!regenTarget) return;
    await onRegenerateDay?.(regenTarget.index, instructions);
    setRegenTarget(null);
  }

  // Recalcul propre d'un jour dont le point de départ a changé après la
  // régénération du jour précédent (bouton "Mettre à jour ce jour").
  async function handleResyncDay(index) {
    const startFrom = itinerary?.days?.[index]?.trips?.[0]?.from;
    const instruction = startFrom
      ? `Le jour précédent a été modifié : cette journée démarre désormais de "${startFrom}". Recalcule-la pour qu'elle PARTE de "${startFrom}" — mets à jour le premier trajet (from = "${startFrom}", avec distance, durée et prix réalistes) et tout l'enchaînement. Conserve au maximum le reste du programme (activités, repas, hébergement du soir) tant que ça reste géographiquement cohérent.`
      : "Recalcule cette journée pour qu'elle parte de l'endroit où se termine le jour précédent (premier trajet, distance, durée et prix).";
    await onRegenerateDay?.(index, instruction);
  }

  // Ignore l'invitation à recalculer (l'utilisateur garde le jour tel quel).
  function handleDismissResync(index) {
    onUpdateItinerary?.((it) => {
      const next = JSON.parse(JSON.stringify(it));
      if (next.days?.[index]) delete next.days[index]._resync_needed;
      return next;
    });
  }

  async function handleSubmitModify({ instructions, cascade }) {
    if (!modifyTarget) return;
    if (cascade && onReplanFromDay) {
      await onReplanFromDay(modifyTarget.index, instructions);
    } else {
      await onRegenerateDay?.(modifyTarget.index, instructions);
    }
    setModifyTarget(null);
  }

  async function handleSubmitActivityEdit(instructions) {
    if (!activityTarget || !onRegenerateActivity) return;
    await onRegenerateActivity(
      activityTarget.dayIndex,
      activityTarget.activityIndex,
      instructions
    );
    setActivityTarget(null);
  }

  async function handleRemoveActivity(dayIndex, activityIndex) {
    if (!onRemoveActivity) return;
    if (!confirm('Supprimer cette activité ?')) return;
    await onRemoveActivity(dayIndex, activityIndex);
  }

  async function handleFetchSpecialties(dayIndex) {
    if (!onFetchSpecialties) return;
    setLoadingSpecialtiesIdx(dayIndex);
    try {
      await onFetchSpecialties(dayIndex);
    } finally {
      setLoadingSpecialtiesIdx(null);
    }
  }

  return (
    <div className="space-y-6">
      <header className="relative overflow-hidden rounded-2xl sm:rounded-3xl bg-hero-gradient text-white p-4 sm:p-6 lg:p-10 shadow-glow animate-fade-up print:bg-white print:text-slate-900 print:shadow-none">
        {/* Bulles décoratives */}
        <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full bg-white/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -left-10 w-72 h-72 rounded-full bg-sunset-400/30 blur-3xl pointer-events-none" />

        <div className="relative">
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-start sm:justify-between gap-3 sm:gap-4">
            <div className="sm:max-w-2xl min-w-0">
              <span className="inline-flex items-center gap-1.5 text-[10px] sm:text-xs uppercase tracking-widest text-white/80 mb-1.5 sm:mb-2 print:text-slate-500">
                <Icon name="sparkles" className="h-3.5 w-3.5" />
                Itinéraire sur mesure
              </span>
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold leading-tight break-words">
                {summary?.destinations}
              </h1>
              {summary?.headline && (
                <p className="text-white/90 mt-2 sm:mt-3 italic text-sm sm:text-base lg:text-lg print:text-slate-600">
                  "{summary.headline}"
                </p>
              )}
            </div>
            <div
              className="inline-flex sm:block items-baseline justify-between gap-3 text-left sm:text-right bg-white/15 backdrop-blur rounded-xl sm:rounded-2xl px-3 sm:px-4 py-2.5 sm:py-3 self-stretch sm:self-auto print:bg-slate-100"
              title="Estimation TravelO basée sur les prix moyens. Les prix réels (hébergements, transports) varient selon la saison et les disponibilités."
            >
              <div>
                <div className="text-[10px] uppercase tracking-widest text-white/80 print:text-slate-500">
                  Budget estimé
                </div>
                <div className="text-2xl sm:text-3xl font-bold tabular-nums">
                  {formatEurEstimate(budget_summary?.grand_total_eur)}
                </div>
              </div>
              <div className="text-xs text-white/80 print:text-slate-500 sm:mt-0">
                {formatEurEstimate(budget_summary?.per_person_eur)} / pers.
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <HeroChip icon="calendar" label={`${summary?.duration_days} jours`} />
            <HeroChip
              icon="users"
              label={`${adults} adulte(s)${children ? ` + ${children} enfant(s)` : ''}`}
            />
            <HeroChip icon="target" label={summary?.trip_type} />
            <HeroChip icon="diamond" label={summary?.budget_level} />
            {summary?.total_distance_km != null && (
              <HeroChip
                icon="road"
                label={`${summary.total_distance_km.toLocaleString('fr-FR')} km`}
              />
            )}
            {summary?.vehicle_summary && (
              <HeroChip icon="van" label={summary.vehicle_summary} />
            )}
          </div>

          <div className="mt-4 text-sm text-white/90 print:text-slate-500">
            <span>{summary?.start_date}</span>
            <span className="mx-2">→</span>
            <span>{summary?.end_date}</span>
            <span className="mx-3 opacity-50">·</span>
            <span>{summary?.departure_location}</span>
            <span className="mx-1">→</span>
            <span>{summary?.return_location}</span>
          </div>

          {googleMapsUrl && (
            <div className="mt-5 print:hidden">
              <a
                href={googleMapsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-white text-slate-900 px-4 py-2 text-sm font-semibold shadow hover:bg-slate-100 transition"
              >
                <Icon name="map" className="h-4 w-4" />
                Ouvrir tout l'itinéraire dans Google Maps
              </a>
            </div>
          )}

          {aiCostEur != null && (
            <div
              className="mt-4 inline-flex items-center gap-1.5 text-xs text-white/70 print:text-slate-500"
              title={`${metadata.call_count || 0} appels IA · ${(metadata.total_input_tokens || 0).toLocaleString('fr-FR')} tokens entrée + ${(metadata.total_output_tokens || 0).toLocaleString('fr-FR')} tokens sortie · modèle(s) : ${(metadata.models_used || []).join(', ') || '?'}`}
            >
              <Icon name="wallet" className="h-3.5 w-3.5" />
              Coût IA de génération : {formatAiCost(aiCostEur)}
              {metadata.call_count > 1 && (
                <span className="opacity-70 ml-1">
                  ({metadata.call_count} appels)
                </span>
              )}
            </div>
          )}
        </div>
      </header>

      <nav className="print:hidden -mx-4 sm:mx-0">
        <ul className="flex gap-1 border-b border-slate-200 overflow-x-auto scrollbar-hide px-4 sm:px-0 sm:flex-wrap">
          {tabs.map((t) => (
            <li key={t.id} className="shrink-0">
              <button
                onClick={() => setTab(t.id)}
                className={`px-3 sm:px-4 py-2 text-sm font-medium rounded-t-md border-b-2 transition-colors whitespace-nowrap ${
                  tab === t.id
                    ? 'border-brand-600 text-brand-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                {t.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="print:space-y-8">
        <div className={tab === 'planning' ? '' : 'hidden print:block'}>
          <Planning
            days={days}
            tripType={summary?.trip_type}
            adults={adults}
            childrenCount={children}
            childrenAges={childrenAges}
            accommodationPrefs={accommodationPrefs}
            isVanTrip={isVanTrip}
            onOpenRegen={(index, day) => setRegenTarget({ index, day })}
            onOpenModify={(index, day) => setModifyTarget({ index, day })}
            onEditActivity={(dayIndex, activityIndex, activity, dayLocation) =>
              setActivityTarget({
                dayIndex,
                activityIndex,
                activity,
                dayLocation,
              })
            }
            onRemoveActivity={handleRemoveActivity}
            onFetchSpecialties={
              onFetchSpecialties ? handleFetchSpecialties : null
            }
            loadingSpecialtiesIdx={loadingSpecialtiesIdx}
            canRegenerate={typeof onRegenerateDay === 'function'}
            canEditActivities={typeof onRegenerateActivity === 'function'}
            onUpdateItinerary={onUpdateItinerary}
            onSuggestMomentAlternatives={onSuggestMomentAlternatives}
            onImportHotelFromImage={onImportHotelFromImage}
            onImportFlightFromImage={onImportFlightFromImage}
            onResyncDay={handleResyncDay}
            onDismissResync={handleDismissResync}
            regenerating={regenerating}
          />
        </div>
        <div className={tab === 'table' ? '' : 'hidden'}>
          <ItineraryTable days={days} />
        </div>
        {/* Rendu conditionnel : sinon Leaflet pense que le conteneur fait 0px
            (parent hidden) et ne charge pas les tuiles correctement. */}
        {tab === 'map' && (
          <div>
            <RouteMap itinerary={itinerary} />
          </div>
        )}
        {hasFlights && (
          <div className={tab === 'flights' ? '' : 'hidden'}>
            <FlightsTab
              flights={flights}
              pax={pax}
              onImportFlightFromImage={onImportFlightFromImage}
            />
          </div>
        )}
        {hasAccommodations && (
          <div className={tab === 'hotels' ? '' : 'hidden'}>
            <HotelsTab
              days={days}
              adults={adults}
              childrenCount={children}
              childrenAges={childrenAges}
              accommodationPrefs={accommodationPrefs}
              isVanTrip={isVanTrip}
              onUpdateItinerary={onUpdateItinerary}
              onImportHotelFromImage={onImportHotelFromImage}
            />
          </div>
        )}
        <div className={tab === 'budget' ? '' : 'hidden print:block'}>
          <BudgetGlobal
            budget={budget_summary}
            days={days}
            metadata={metadata}
          />
        </div>
        <div className={tab === 'notes' ? '' : 'hidden print:block'}>
          <NotesConseils notes={notes} />
        </div>
        <div className={tab === 'activities' ? '' : 'hidden print:block'}>
          <FichesActivites activities={allActivities} />
        </div>
      </div>

      <RegenerateDayModal
        open={!!regenTarget}
        day={regenTarget?.day}
        onClose={() => setRegenTarget(null)}
        onSubmit={handleSubmitRegen}
        loading={regenerating}
      />
      <ModifyDayModal
        open={!!modifyTarget}
        day={modifyTarget?.day}
        isLastDay={
          modifyTarget && modifyTarget.index === (days?.length || 0) - 1
        }
        onClose={() => setModifyTarget(null)}
        onSubmit={handleSubmitModify}
        loading={regenerating}
      />
      <EditActivityModal
        open={!!activityTarget}
        activity={activityTarget?.activity}
        dayLocation={activityTarget?.dayLocation}
        onClose={() => setActivityTarget(null)}
        onSubmit={handleSubmitActivityEdit}
        loading={regenerating}
      />
    </div>
  );
}

function Planning({
  days,
  tripType,
  adults,
  childrenCount,
  childrenAges,
  accommodationPrefs,
  isVanTrip,
  onOpenRegen,
  onOpenModify,
  onEditActivity,
  onRemoveActivity,
  onFetchSpecialties,
  loadingSpecialtiesIdx,
  canRegenerate,
  canEditActivities,
  onUpdateItinerary,
  onSuggestMomentAlternatives,
  onImportHotelFromImage,
  onImportFlightFromImage,
  onResyncDay,
  onDismissResync,
  regenerating,
}) {
  // Tous les jours fermés par défaut : on voit la liste d'un coup d'œil
  // et on déplie au besoin.
  const [expandedDays, setExpandedDays] = useState(() => new Set());
  const [layout, setLayout] = useDayLayout();

  if (!days?.length) return null;

  const allExpanded = expandedDays.size === days.length;

  function toggleDay(i) {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function toggleAll() {
    if (allExpanded) setExpandedDays(new Set());
    else setExpandedDays(new Set(days.map((_, i) => i)));
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:block">
        <h2 className="text-xl font-semibold text-slate-900 print:break-before-page">
          Programme jour par jour
        </h2>
        <div className="flex items-center gap-3">
          <LayoutToggle value={layout} onChange={setLayout} />
          <button
            type="button"
            onClick={toggleAll}
            className="text-sm text-brand-700 hover:underline print:hidden"
          >
            {allExpanded ? '↑ Tout replier' : '↓ Tout déplier'}
          </button>
        </div>
      </div>
      {days.map((d, i) => (
        <DayCard
          key={`${d.label}-${i}`}
          day={d}
          dayIndex={i}
          allDays={days}
          tripType={tripType}
          expanded={expandedDays.has(i)}
          onToggleExpand={() => toggleDay(i)}
          adults={adults}
          childrenCount={childrenCount}
          childrenAges={childrenAges}
          accommodationPrefs={accommodationPrefs}
          isVanTrip={isVanTrip}
          layout={layout}
          onOpenRegen={onOpenRegen ? () => onOpenRegen(i, d) : null}
          onOpenModify={onOpenModify ? () => onOpenModify(i, d) : null}
          onEditActivity={onEditActivity}
          onRemoveActivity={onRemoveActivity}
          onFetchSpecialties={
            onFetchSpecialties ? () => onFetchSpecialties(i) : null
          }
          loadingSpecialties={loadingSpecialtiesIdx === i}
          canRegenerate={canRegenerate}
          canEditActivities={canEditActivities}
          onUpdateItinerary={onUpdateItinerary}
          onSuggestMomentAlternatives={onSuggestMomentAlternatives}
          onImportHotelFromImage={onImportHotelFromImage}
          onImportFlightFromImage={onImportFlightFromImage}
          onResyncDay={onResyncDay ? () => onResyncDay(i) : null}
          onDismissResync={onDismissResync ? () => onDismissResync(i) : null}
          regenerating={regenerating}
        />
      ))}
    </section>
  );
}

/**
 * Segmented control "Cartes / Timeline" — choix utilisateur du mode
 * d'affichage des journées (persisté dans localStorage).
 */
function LayoutToggle({ value, onChange }) {
  const options = [
    { id: 'cards', label: 'Cartes', icon: '🗂️' },
    { id: 'timeline', label: 'Timeline', icon: '🕒' },
  ];
  return (
    <div
      className="inline-flex rounded-full bg-slate-100 p-0.5 text-xs print:hidden"
      role="tablist"
      aria-label="Mode d'affichage des journées"
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium transition-colors ${
            value === o.id
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <span>{o.icon}</span>
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

// Extrait le nom de lieu présumé d'un titre de moment :
// dernier groupe de mots capitalisés à la fin (ex: "Marché de Toyosu" → "Toyosu",
// "vallée de Todoroki" → "Todoroki", "Crépuscule à Shibuya" → "Shibuya").
function extractLocationFromTitle(title) {
  if (!title || typeof title !== 'string') return null;
  // Cherche un mot capitalisé en fin de phrase (avec éventuels traits d'union
  // ou apostrophes), possiblement précédé d'autres mots capitalisés.
  const m = title.match(/([A-ZÀ-Ý][\wÀ-ÿ\-']*(?:[\s-][A-ZÀ-Ý][\wÀ-ÿ\-']*)*)\s*\.?\s*$/);
  return m?.[1] || null;
}

// Construit un titre de jour à partir des lieux extraits des moments,
// pour les itinéraires anciens qui n'ont pas de day_title.
function buildFallbackDayTitle(day) {
  const moments = [day.morning, day.noon, day.afternoon, day.evening];
  const locs = [];
  for (const m of moments) {
    const loc = extractLocationFromTitle(m?.title);
    if (
      loc &&
      loc.length < 30 &&
      // Évite de répéter la ville principale (qui est déjà dans le header)
      loc.toLowerCase() !== (day.location || '').toLowerCase() &&
      !locs.some((existing) => existing.toLowerCase() === loc.toLowerCase())
    ) {
      locs.push(loc);
    }
  }
  if (locs.length >= 2) {
    return `${day.location} : ${locs.slice(0, 3).join(', ')}`;
  }
  return day.morning?.title || null;
}

// Palette des catégories utilisée à la fois par le mode "cartes" (en-têtes
// + traits latéraux) et le mode "timeline" (pastilles). Définie une seule
// fois pour garantir la cohérence visuelle entre les deux.
const CATEGORY_STYLES = {
  moment: {
    label: 'Moment',
    icon: '🌤️',
    headerBg: 'bg-violet-100',
    headerText: 'text-violet-700',
    border: 'border-l-violet-400',
    tint: 'bg-violet-50/40',
    dot: 'bg-violet-500',
  },
  activity: {
    label: 'Activité',
    icon: '🏛️',
    headerBg: 'bg-amber-100',
    headerText: 'text-amber-800',
    border: 'border-l-amber-400',
    tint: 'bg-amber-50/40',
    dot: 'bg-amber-500',
  },
  trip: {
    label: 'Trajet',
    icon: '🚗',
    headerBg: 'bg-sky-100',
    headerText: 'text-sky-800',
    border: 'border-l-sky-400',
    tint: 'bg-sky-50/40',
    dot: 'bg-sky-500',
  },
  flight: {
    label: 'Vol',
    icon: '✈️',
    headerBg: 'bg-sky-100',
    headerText: 'text-sky-800',
    border: 'border-l-sky-500',
    tint: 'bg-sky-50/50',
    dot: 'bg-sky-600',
  },
  lodging: {
    label: 'Hébergement',
    icon: '🏨',
    headerBg: 'bg-indigo-100',
    headerText: 'text-indigo-800',
    border: 'border-l-indigo-400',
    tint: 'bg-indigo-50/40',
    dot: 'bg-indigo-500',
  },
  meal: {
    label: 'Repas',
    icon: '🍽️',
    headerBg: 'bg-orange-100',
    headerText: 'text-orange-800',
    border: 'border-l-orange-400',
    tint: 'bg-orange-50/40',
    dot: 'bg-orange-500',
  },
  service: {
    label: 'Aire / Étape',
    icon: '⛽',
    headerBg: 'bg-emerald-100',
    headerText: 'text-emerald-800',
    border: 'border-l-emerald-400',
    tint: 'bg-emerald-50/40',
    dot: 'bg-emerald-500',
  },
};

/**
 * En-tête de section "cartes" avec badge icône + titre + compteur. Donne
 * une identité visuelle nette à chaque catégorie pour éviter le mur de
 * texte.
 */
// Construit le lien Booking d'une nuit (mêmes critères que dans le planning :
// dates, voyageurs, gamme, note, fourchette de prix).
function computeAccomLink(
  day,
  { allDays, dayIndex, adults, childrenCount, childrenAges, accommodationPrefs }
) {
  const nextDayDate = Array.isArray(allDays)
    ? allDays[dayIndex + 1]?.date
    : null;
  const accomPrice = Number(day.accommodation?.price_eur) || 0;
  return bestAccommodationLink(day.accommodation, {
    location: day.location,
    checkin: day.date,
    checkout: nextDayDate || day.date,
    adults,
    children: childrenCount,
    childrenAges,
    rooms: accommodationPrefs?.rooms,
    stars: accommodationPrefs?.stars,
    reviewScore: accommodationPrefs?.reviewScore,
    amenities: accommodationPrefs?.amenities,
    priceMin: accomPrice > 0 ? Math.round(accomPrice * 0.65) : undefined,
    priceMax: accomPrice > 0 ? Math.round(accomPrice * 1.4) : undefined,
  });
}

// Onglet "Hôtels" : récapitulatif de tous les hébergements, nuit par nuit.
// On réutilise la carte hébergement complète (LodgingCard) → capture, saisie
// manuelle, prix éditable, "même hôtel que la veille" et lien Booking, le tout
// mettant à jour l'itinéraire et les budgets.
function HotelsTab({
  days,
  adults,
  childrenCount,
  childrenAges,
  accommodationPrefs,
  isVanTrip,
  onUpdateItinerary,
  onImportHotelFromImage,
}) {
  const nights = (days || [])
    .map((day, dayIndex) => ({ day, dayIndex }))
    .filter(({ day }) => day.accommodation);
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">
          Tes hébergements
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Tous tes hôtels, nuit par nuit. Mets-les à jour avec une capture
          (Booking, voucher PDF…) ou à la main — le budget se recalcule tout
          seul.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {nights.map(({ day, dayIndex }) => {
          const accomLink = computeAccomLink(day, {
            allDays: days,
            dayIndex,
            adults,
            childrenCount,
            childrenAges,
            accommodationPrefs,
          });
          return (
            <div key={dayIndex}>
              <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-1">
                {day.label} · {day.weekday} {day.date} — {day.location}
              </div>
              <LodgingCard
                day={day}
                dayIndex={dayIndex}
                isVanTrip={isVanTrip}
                accomLink={accomLink}
                isBookingCta={accomLink?.provider === 'Booking'}
                prevAccommodation={days?.[dayIndex - 1]?.accommodation}
                onUpdateItinerary={onUpdateItinerary}
                onImportHotelFromImage={onImportHotelFromImage}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Onglet "Vols" : récapitulatif de tous les vols de l'itinéraire, avec un
// bouton pour mettre à jour chacun (capture ou saisie manuelle). La mise à jour
// recalcule automatiquement le(s) jour(s) concerné(s) côté page itinéraire.
function FlightsTab({ flights, pax, onImportFlightFromImage }) {
  const hhmm = (iso) => {
    if (!iso || typeof iso !== 'string') return null;
    const m = iso.match(/T(\d{2}:\d{2})/);
    return m ? m[1] : null;
  };
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Tes vols</h2>
        <p className="text-sm text-slate-500 mt-1">
          Récapitulatif de tous les vols du voyage. Mets-les à jour avec une
          capture ou à la main — les journées concernées se recalculent
          automatiquement.
        </p>
      </div>

      <ul className="space-y-3">
        {flights.map(({ dayIndex, tripIndex, trip, day }) => {
          const f = trip._flight || {};
          const dep = hhmm(f.departure_at);
          const arr = hhmm(f.arrival_at);
          const total = Math.round(Number(trip.estimated_cost_eur) || 0);
          const perPerson = pax > 0 ? Math.round(total / pax) : total;
          const airline = [f.airline, f.flight_number]
            .filter(Boolean)
            .join(' ');
          const route =
            f.origin_iata && f.destination_iata
              ? `${f.origin_iata} → ${f.destination_iata}`
              : `${trip.from || '?'} → ${trip.to || '?'}`;
          return (
            <li
              key={`${dayIndex}-${tripIndex}`}
              className="rounded-xl border border-slate-200 border-l-4 border-l-sky-500 bg-sky-50/40 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-widest text-sky-700 font-bold">
                    ✈️ {day.label} · {day.weekday} {day.date}
                  </div>
                  <div className="text-lg font-bold text-slate-900 mt-0.5">
                    {route}
                  </div>
                  <div className="text-sm text-slate-600 mt-0.5">
                    {airline || 'Compagnie à préciser'}
                    {(dep || arr) && (
                      <span className="ml-2 text-slate-500">
                        {dep && <>🛫 {dep}</>}
                        {dep && arr && <span className="mx-1">·</span>}
                        {arr && <>🛬 {arr}</>}
                      </span>
                    )}
                  </div>
                  {!dep && !arr && (
                    <div className="text-xs text-amber-700 mt-1">
                      Heures non confirmées — mets le vol à jour pour caler la
                      journée.
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-lg font-bold text-slate-900 tabular-nums">
                    {total > 0 ? `${total.toLocaleString('fr-FR')} €` : '—'}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    total famille
                    {total > 0 && pax > 1 && (
                      <>
                        {' '}
                        · {perPerson.toLocaleString('fr-FR')} € / pers.
                      </>
                    )}
                  </div>
                </div>
              </div>

              {typeof onImportFlightFromImage === 'function' && (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() =>
                      onImportFlightFromImage(dayIndex, tripIndex, trip)
                    }
                    className="inline-flex items-center gap-1.5 rounded-full bg-sky-100 text-sky-800 hover:bg-sky-200 transition-colors px-3 py-1.5 text-xs font-medium"
                  >
                    📸 Mettre à jour ce vol (capture ou saisie)
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CategoryHeader({ category, title, count }) {
  const s = CATEGORY_STYLES[category];
  if (!s) return null;
  return (
    <div className="flex items-center gap-2 mb-2">
      <div
        className={`grid place-items-center h-8 w-8 rounded-lg ${s.headerBg} ${s.headerText} shrink-0`}
        aria-hidden="true"
      >
        <span className="text-sm">{s.icon}</span>
      </div>
      <h4 className="text-base font-semibold text-slate-900">{title}</h4>
      {count != null && count > 0 && (
        <span className="text-xs text-slate-400 tabular-nums">({count})</span>
      )}
    </div>
  );
}

function DayCard({
  day,
  dayIndex,
  allDays,
  tripType,
  expanded,
  onToggleExpand,
  adults,
  childrenCount,
  childrenAges,
  accommodationPrefs,
  isVanTrip,
  layout = 'cards',
  onOpenRegen,
  onOpenModify,
  onEditActivity,
  onRemoveActivity,
  onFetchSpecialties,
  loadingSpecialties,
  canRegenerate,
  canEditActivities,
  onUpdateItinerary,
  onSuggestMomentAlternatives,
  onImportHotelFromImage,
  onImportFlightFromImage,
  onResyncDay,
  onDismissResync,
  regenerating,
}) {
  // Détecte les jours d'arrivée/départ d'un voyage avion-* sans horaire
  // confirmé : on a une trip de mode "Avion" mais sans heure de départ
  // précise (_flight.departure_at vide). Le programme du jour a été
  // calé sur une heure inventée par l'IA — bandeau d'avertissement.
  const isAirTrip =
    tripType === 'avion-voiture' || tripType === 'avion-citybreak';
  const isFirstOrLastDay =
    dayIndex === 0 || (allDays && dayIndex === allDays.length - 1);
  const flightTrip = (day.trips || []).find((t) =>
    /avion|vol|flight|plane/i.test(t?.mode || '')
  );
  const flightLeg = dayIndex === 0 ? 'aller' : 'retour';
  const hasFlightTime = !!flightTrip?._flight?.departure_at;
  const showUnconfirmedScheduleWarning =
    isAirTrip && isFirstOrLastDay && flightTrip && !hasFlightTime;
  // Titre du jour :
  // 1. day_title (nouveau schéma) si présent
  // 2. Sinon, on tente de construire un titre à partir des lieux extraits
  //    des titres morning/noon/afternoon/evening (anciens itinéraires)
  // 3. Sinon fallback minimal sur morning.title puis location
  const dayTitle =
    day.day_title || buildFallbackDayTitle(day) || `Journée à ${day.location}`;

  // Si le même lieu apparaît sur plusieurs jours d'affilée, on décale
  // l'ordre des photos pour ne pas montrer la même photo au même moment
  // sur les jours consécutifs (évite la redondance visuelle).
  const sameLocationBefore = Array.isArray(allDays)
    ? allDays
        .slice(0, dayIndex)
        .filter(
          (d) =>
            (d?.location || '').toLowerCase().trim() ===
            (day.location || '').toLowerCase().trim()
        ).length
    : 0;
  const nextDayDate = Array.isArray(allDays)
    ? allDays[dayIndex + 1]?.date
    : null;
  // Fourchette de prix Booking autour de l'estimation de la nuit (±) pour
  // ne pas sur-filtrer : -35 % / +40 %.
  const accomPrice = Number(day.accommodation?.price_eur) || 0;
  const accomLink = bestAccommodationLink(day.accommodation, {
    location: day.location,
    checkin: day.date,
    checkout: nextDayDate || day.date,
    adults,
    children: childrenCount,
    childrenAges,
    rooms: accommodationPrefs?.rooms,
    stars: accommodationPrefs?.stars,
    reviewScore: accommodationPrefs?.reviewScore,
    amenities: accommodationPrefs?.amenities,
    priceMin: accomPrice > 0 ? Math.round(accomPrice * 0.65) : undefined,
    priceMax: accomPrice > 0 ? Math.round(accomPrice * 1.4) : undefined,
  });
  const isBookingCta = accomLink?.provider === 'Booking';

  return (
    <article className="card print:break-inside-avoid print:shadow-none print:border-slate-300 animate-fade-up">
      <header
        onClick={onToggleExpand}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleExpand?.();
          }
        }}
        aria-expanded={!!expanded}
        className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 cursor-pointer select-none -m-2 p-2 rounded-xl hover:bg-slate-50 transition-colors print:cursor-auto print:hover:bg-transparent"
      >
        <div className="flex items-start gap-3 sm:gap-4 min-w-0 flex-1 w-full">
          <div
            className={`shrink-0 grid place-items-center h-12 w-12 sm:h-14 sm:w-14 rounded-2xl text-white font-bold text-base sm:text-lg shadow-pop print:bg-slate-900 ${
              day.is_off_day
                ? 'bg-gradient-to-br from-emerald-500 to-teal-500'
                : 'bg-day-gradient'
            }`}
          >
            {day.is_off_day ? '🛋️' : day.label}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg sm:text-xl font-bold text-slate-900 leading-tight flex items-center flex-wrap gap-2">
              {day.location}
              {day.is_off_day && (
                <span className="chip bg-emerald-100 text-emerald-700 text-[10px]">
                  🛋️ Jour off
                </span>
              )}
            </h3>
            <p className="text-xs sm:text-sm text-slate-500 capitalize mt-0.5">
              {day.label} · {day.weekday} {day.date}
            </p>
            <p className="text-sm font-semibold text-slate-700 mt-1.5 leading-snug break-words">
              {dayTitle}
            </p>
            {day.weather && (
              <div className="text-xs text-slate-600 mt-1.5">
                <span className="text-base mr-1">{day.weather.emoji}</span>
                {day.weather.temperature_c}°C
                {day.weather.description && (
                  <span className="text-slate-400 ml-1">
                    · {day.weather.description}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between sm:justify-end gap-3 flex-wrap w-full sm:w-auto sm:flex-shrink-0 border-t border-slate-100 pt-3 sm:border-t-0 sm:pt-0">
          <div
            className="text-left sm:text-right"
            title="Estimation pour cette journée (hébergement, repas, trajets, activités). Les prix réels peuvent varier."
          >
            <div className="text-[10px] uppercase tracking-widest text-slate-400">
              Total estimé
            </div>
            <div className="text-lg sm:text-xl font-bold text-slate-900 tabular-nums">
              {formatEurEstimate(day.day_total_eur)}
            </div>
          </div>
          {canRegenerate && (
            <div
              className="flex gap-1.5 print:hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {onOpenModify && (
                <button
                  onClick={onOpenModify}
                  className="chip bg-brand-50 text-brand-700 hover:bg-brand-100"
                  title="Modifier cette journée"
                >
                  ✏️ Modifier
                </button>
              )}
              {onOpenRegen && (
                <button
                  onClick={onOpenRegen}
                  className="chip bg-slate-100 text-slate-600 hover:bg-slate-200"
                  title="Régénérer cette journée"
                >
                  ↻ Régénérer
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {day._resync_needed && (onResyncDay || onDismissResync) && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 print:hidden">
          <div className="flex items-start gap-2">
            <span className="text-base leading-none mt-0.5">🔄</span>
            <div className="flex-1">
              <div className="font-semibold">
                Le jour précédent a changé de destination
              </div>
              <p className="text-xs mt-1 text-amber-800 leading-relaxed">
                Cette journée repart maintenant de «{' '}
                {day.trips?.[0]?.from || day.location} », mais son premier
                trajet (distance et prix) n'a pas été recalculé. Mets-la à jour
                pour des chiffres justes, ou garde-la telle quelle.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {onResyncDay && (
                  <button
                    type="button"
                    onClick={onResyncDay}
                    disabled={regenerating}
                    className="chip bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-60"
                    title="Recalculer cette journée à partir du nouveau point de départ"
                  >
                    {regenerating ? '… Mise à jour' : '🔄 Mettre à jour ce jour'}
                  </button>
                )}
                {onDismissResync && (
                  <button
                    type="button"
                    onClick={onDismissResync}
                    disabled={regenerating}
                    className="chip bg-white text-amber-800 border border-amber-300 hover:bg-amber-100 disabled:opacity-60"
                    title="Garder la journée telle quelle"
                  >
                    Garder tel quel
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 grid lg:grid-cols-2 gap-3">
        <DayMiniMap
          coordinates={day.coordinates}
          label={day.label}
          location={day.location}
          allDays={allDays}
        />
        <DayPhotos
          location={day.location}
          max={5}
          aspect
          photoOffset={sameLocationBefore}
        />
      </div>

      {showUnconfirmedScheduleWarning && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <span className="text-base leading-none mt-0.5">⚠️</span>
            <div className="flex-1">
              <div className="font-semibold">
                Horaires de vol {flightLeg} non confirmés
              </div>
              <p className="text-xs mt-1 text-amber-800 leading-relaxed">
                Le programme de ce jour a été calé sur une heure de{' '}
                {flightLeg === 'aller' ? 'arrivée' : 'départ'} estimée.
                Quand vous aurez réservé votre vol, cliquez sur{' '}
                <strong>« Régénérer »</strong> en haut de la carte et indiquez
                l'heure réelle (ex : <em>« le vol arrive à 22h12 »</em>) pour
                obtenir un programme adapté.
                {flightTrip?._flight?.deeplink && (
                  <>
                    {' '}
                    Vous pouvez aussi cliquer sur le bouton{' '}
                    <strong>
                      {flightProviderName(flightTrip._flight.source)}
                    </strong>{' '}
                    dans la section Trajets ci-dessous pour voir les vrais horaires.
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 flex justify-center print:hidden">
        <button
          type="button"
          onClick={onToggleExpand}
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-sm font-medium text-slate-600 px-5 py-2 shadow-sm transition-colors"
        >
          <span
            className={`text-xs transition-transform ${expanded ? 'rotate-180' : ''}`}
            aria-hidden="true"
          >
            ⌄
          </span>
          {expanded ? 'Replier la journée' : 'Voir tous les détails'}
        </button>
      </div>

      {expanded && (
        <>
          {/* Bloc résumé 24h — toujours en tête : "où je dors, ce que je mange aujourd'hui" */}
          <div className="mt-4 grid md:grid-cols-2 gap-3 items-start">
            {day.accommodation && (
              <LodgingCard
                day={day}
                dayIndex={dayIndex}
                isVanTrip={isVanTrip}
                accomLink={accomLink}
                isBookingCta={isBookingCta}
                prevAccommodation={allDays?.[dayIndex - 1]?.accommodation}
                onUpdateItinerary={onUpdateItinerary}
                onImportHotelFromImage={onImportHotelFromImage}
              />
            )}
            {day.meals && (
              <MealsCard
                day={day}
                dayIndex={dayIndex}
                onUpdateItinerary={onUpdateItinerary}
              />
            )}
          </div>

          {layout === 'timeline' ? (
            <DayTimeline
              day={day}
              dayIndex={dayIndex}
              adults={adults}
              childrenCount={childrenCount}
              childrenAges={childrenAges}
              canEditActivities={canEditActivities}
              onEditActivity={onEditActivity}
              onRemoveActivity={onRemoveActivity}
              onUpdateItinerary={onUpdateItinerary}
              onSuggestMomentAlternatives={onSuggestMomentAlternatives}
              onImportFlightFromImage={onImportFlightFromImage}
            />
          ) : (
            <DayCardsContent
              day={day}
              dayIndex={dayIndex}
              adults={adults}
              childrenCount={childrenCount}
              childrenAges={childrenAges}
              canEditActivities={canEditActivities}
              onEditActivity={onEditActivity}
              onRemoveActivity={onRemoveActivity}
              onUpdateItinerary={onUpdateItinerary}
              onSuggestMomentAlternatives={onSuggestMomentAlternatives}
              onImportFlightFromImage={onImportFlightFromImage}
            />
          )}

          <DaySpecialties
            specialties={day.culinary_specialties}
            location={day.location}
            onFetch={onFetchSpecialties}
            loading={loadingSpecialties}
          />
        </>
      )}
    </article>
  );
}

/* -------------------------------------------------------------------------
 * Helpers extraits du DayCard pour partage entre les modes "Cartes" et
 * "Timeline". Chaque carte conserve un trait latéral coloré (CATEGORY_STYLES)
 * pour identifier sa catégorie d'un coup d'œil.
 * ------------------------------------------------------------------------- */

function LodgingCard({
  day,
  dayIndex,
  isVanTrip,
  accomLink,
  isBookingCta,
  prevAccommodation,
  onUpdateItinerary,
  onImportHotelFromImage,
}) {
  const s = CATEGORY_STYLES.lodging;
  const canEdit = typeof onUpdateItinerary === 'function';
  // Hôtel de la veille réellement renseigné (par capture, voucher ou saisie
  // manuelle) → on propose de le réutiliser tel quel pour cette nuit.
  const prevName = prevAccommodation?.name?.trim();
  const canCopyPrev =
    canEdit &&
    dayIndex > 0 &&
    !!prevAccommodation &&
    !!(prevAccommodation._user_edited || prevName);
  const userEdited = !!day.accommodation._user_edited;
  const [lightbox, setLightbox] = useState(null); // dataUrl ouverte ou null
  const [manualOpen, setManualOpen] = useState(false); // formulaire saisie manuelle
  return (
    <div className={`rounded-xl border border-slate-200 border-l-4 ${s.border} ${s.tint} p-3 text-sm`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`grid place-items-center h-7 w-7 rounded-md ${s.headerBg} ${s.headerText} text-sm`}>
          {s.icon}
        </span>
        <span className={`text-xs uppercase tracking-wide font-semibold ${s.headerText}`}>
          Hébergement / nuit
        </span>
        <div className="ml-auto flex items-center gap-2">
          {userEdited && (
            <span
              className="text-[10px] text-emerald-700 font-medium"
              title="Vous avez personnalisé ce bloc"
            >
              ✓ corrigé
            </span>
          )}
          {canEdit && (day.accommodation.name || userEdited) && (
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    'Supprimer cet hôtel pour cette nuit ? Le budget sera mis à jour. Tu pourras en remettre un quand tu veux.'
                  )
                ) {
                  onUpdateItinerary((it) => clearAccommodation(it, dayIndex));
                }
              }}
              title="Supprimer cet hôtel"
              className="grid place-items-center h-6 w-6 rounded-full text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors print:hidden"
              aria-label="Supprimer cet hôtel"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      {day.accommodation.user_photo && (
        <button
          type="button"
          onClick={() => setLightbox(day.accommodation.user_photo)}
          className="block w-full mb-2 overflow-hidden rounded-lg border border-slate-200 bg-white print:break-inside-avoid"
          title="Cliquer pour agrandir"
        >
          <img
            src={day.accommodation.user_photo}
            alt={`Capture de ${day.accommodation.name}`}
            className="w-full max-h-48 object-cover"
            loading="lazy"
          />
        </button>
      )}
      {userEdited && day.accommodation.name ? (
        // L'utilisateur a confirmé un vrai hôtel (réservation importée) →
        // on affiche son nom et sa note.
        <div className="font-medium text-slate-900">
          {day.accommodation.name}
          <HotelRating
            hotelName={day.accommodation.name}
            location={day.location}
          />
        </div>
      ) : (
        // Sinon : pas de nom inventé, on affiche la ZONE conseillée pour
        // dormir (proche des excursions du jour).
        <div className="font-medium text-slate-900 flex items-start gap-1.5">
          <span>🏘️</span>
          <span>
            Zone conseillée :{' '}
            <span className="text-brand-700">
              {day.accommodation.area ||
                day.accommodation.coordinates_hint ||
                day.location}
            </span>
            <span className="block text-xs font-normal text-slate-500 mt-0.5">
              proche de tes visites du jour — choisis ton hôtel sur Booking
            </span>
          </span>
        </div>
      )}
      <div className="text-slate-600 mt-1">
        {day.accommodation.type}
        {' — '}
        {canEdit ? (
          <EditableValue
            value={Number(day.accommodation.price_eur) || 0}
            type="number"
            min={0}
            step={5}
            suffix=" € / nuit"
            prefix={userEdited ? '' : '≈ '}
            label="Prix par nuit — cliquez pour saisir le vrai prix (celui de votre réservation)"
            format={(v) => formatPriceRange(v, userEdited)}
            onSave={(newPrice) =>
              onUpdateItinerary((it) =>
                updateAccommodationPrice(it, dayIndex, newPrice)
              )
            }
            className="font-medium text-slate-800"
          />
        ) : (
          <span className="font-medium text-slate-800">
            {day.accommodation.price_eur > 0
              ? `≈ ${formatPriceRange(day.accommodation.price_eur, userEdited)} / nuit`
              : formatEurOrFree(day.accommodation.price_eur)}
          </span>
        )}
      </div>
      {!userEdited && day.accommodation.price_eur > 0 && (
        <div className="text-[11px] text-slate-400 italic mt-0.5">
          Fourchette estimée — réserve sur Booking pour le vrai prix, puis
          saisis-le (clic sur le prix) ou importe ta confirmation.
        </div>
      )}
      {day.accommodation.coordinates_hint && (
        <div className="text-slate-500 italic mt-1">
          📍 {day.accommodation.coordinates_hint}
        </div>
      )}
      {day.accommodation.services?.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {day.accommodation.services.map((sv, i) => (
            <span
              key={i}
              className="inline-block rounded-full bg-white/70 px-2 py-0.5 text-xs text-slate-700"
            >
              {sv}
            </span>
          ))}
        </div>
      )}
      {isBookingCta && (
        <div className="mt-3">
          <a
            href={accomLink.url}
            target="_blank"
            rel="noopener noreferrer sponsored"
            className="group flex items-center justify-between gap-3 rounded-lg bg-[#003580] hover:bg-[#00224f] transition-colors px-4 py-3 text-white shadow-sm print:bg-white print:text-[#003580] print:border print:border-[#003580] print:shadow-none"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-white/15 text-base font-bold print:bg-[#003580] print:text-white">
                B.
              </span>
              <div className="min-w-0">
                <div className="font-semibold leading-tight">
                  Réserver sur Booking.com
                </div>
                <div className="text-[11px] text-white/80 leading-tight print:text-slate-600">
                  Disponibilités & prix en temps réel
                </div>
              </div>
            </div>
            <span className="shrink-0 text-sm font-medium group-hover:translate-x-0.5 transition-transform print:hidden">
              →
            </span>
          </a>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 print:hidden">
            <span className="inline-flex items-center gap-1">
              <span className="text-emerald-600">✓</span> Annulation gratuite sur la plupart des hôtels
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="text-emerald-600">✓</span> Meilleur prix garanti
            </span>
            <span
              className="inline-flex items-center gap-1"
              title="TravelO touche une petite commission de Booking — aucun coût supplémentaire pour vous."
            >
              <span className="text-emerald-600">✓</span> Même prix pour vous
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-[11px] print:hidden">
            <a
              href={googleMapsSearch(
                day.accommodation.name
                  ? `${day.accommodation.name} ${day.accommodation.coordinates_hint || day.location}`
                  : day.location
              )}
              target="_blank"
              rel="noreferrer"
              className="text-slate-400 hover:text-slate-600 hover:underline"
            >
              Voir sur Google Maps
            </a>
            {isVanTrip && (
              <a
                href={park4nightSearch(day.location)}
                target="_blank"
                rel="noreferrer"
                className="text-slate-400 hover:text-slate-600 hover:underline"
              >
                🚐 Park4Night
              </a>
            )}
          </div>
        </div>
      )}
      {!isBookingCta && (
        <div className="print:hidden mt-2 flex flex-wrap gap-3 text-xs">
          {accomLink && (
            <a
              href={accomLink.url}
              target="_blank"
              rel="noreferrer"
              className="text-brand-700 hover:underline"
            >
              🔗 Chercher sur {accomLink.provider}
            </a>
          )}
          {isVanTrip && accomLink?.provider !== 'Park4Night' && (
            <a
              href={park4nightSearch(day.location)}
              target="_blank"
              rel="noreferrer"
              className="text-emerald-700 hover:underline"
            >
              🚐 Park4Night ({day.location})
            </a>
          )}
        </div>
      )}
      {/* Section "Autres options" : la shortlist d'hôtels candidats */}
      {Array.isArray(day.accommodation_alternatives) &&
        day.accommodation_alternatives.length > 0 && (
          <div className="print:hidden mt-3 pt-3 border-t border-slate-100">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">
                Autres options ({day.accommodation_alternatives.length})
              </span>
              <span className="text-[10px] text-slate-400 italic">
                — n'entrent pas dans le budget tant qu'elles ne sont pas en priorité 1
              </span>
            </div>
            <ul className="space-y-2">
              {day.accommodation_alternatives.map((alt, i) => (
                <AlternativeAccommodationRow
                  key={i}
                  alt={alt}
                  rank={i + 2}
                  onPromote={() =>
                    canEdit
                      ? onUpdateItinerary((it) =>
                          promoteAccommodationAlternative(it, dayIndex, i)
                        )
                      : null
                  }
                  onRemove={() =>
                    canEdit
                      ? onUpdateItinerary((it) =>
                          removeAccommodationAlternative(it, dayIndex, i)
                        )
                      : null
                  }
                  onOpenPhoto={(url) => setLightbox(url)}
                  canEdit={canEdit}
                />
              ))}
            </ul>
          </div>
        )}

      {/* Lightbox : aperçu plein écran d'une capture cliquée */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 print:hidden"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal="true"
        >
          <img
            src={lightbox}
            alt="Capture en grand format"
            className="max-h-[92vh] max-w-[92vw] object-contain rounded-lg shadow-2xl"
          />
          <button
            type="button"
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 inline-flex items-center justify-center h-10 w-10 rounded-full bg-white/95 text-slate-800 hover:bg-white shadow-lg"
            aria-label="Fermer l'aperçu"
          >
            ✕
          </button>
        </div>
      )}

      {(typeof onImportHotelFromImage === 'function' || canCopyPrev) && (
        <div className="print:hidden mt-3 pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {typeof onImportHotelFromImage === 'function' && (
            <button
              type="button"
              onClick={() =>
                onImportHotelFromImage(
                  dayIndex,
                  day.accommodation?.name,
                  day.location
                )
              }
              className={`inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors px-4 py-2.5 text-sm font-semibold shadow-sm ${
                canCopyPrev ? '' : 'sm:col-span-2'
              }`}
              title="Renseigner l'hôtel réservé via une capture d'écran ou un voucher PDF (Booking, Airbnb…)"
            >
              📸 J'ai réservé — capture, PDF ou saisie
            </button>
          )}
          {canCopyPrev && (
            <button
              type="button"
              onClick={() =>
                onUpdateItinerary((it) =>
                  copyAccommodationFromPreviousDay(it, dayIndex)
                )
              }
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition-colors px-4 py-2.5 text-sm font-semibold shadow-sm"
              title={
                prevName
                  ? `Réutiliser « ${prevName} » (l'hôtel de la nuit précédente) pour cette nuit`
                  : "Réutiliser l'hôtel de la nuit précédente pour cette nuit"
              }
            >
              🏨 Même hôtel que la veille
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AlternativeAccommodationRow({
  alt,
  rank,
  onPromote,
  onRemove,
  onOpenPhoto,
  canEdit,
}) {
  return (
    <li className="rounded-lg border border-slate-200 bg-white p-2.5 text-xs">
      <div className="flex items-start gap-2.5">
        {alt.user_photo && (
          <button
            type="button"
            onClick={() => onOpenPhoto?.(alt.user_photo)}
            className="shrink-0 h-16 w-20 sm:h-20 sm:w-24 rounded-md overflow-hidden border border-slate-200 bg-slate-100"
            title="Cliquer pour agrandir"
          >
            <img
              src={alt.user_photo}
              alt={`Capture de ${alt.name}`}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          </button>
        )}
        <div className="min-w-0 flex-1 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="inline-flex items-center gap-1.5 text-[10px] text-slate-500 uppercase tracking-wide font-semibold mb-0.5">
              <span className="rounded bg-slate-100 px-1.5 py-0.5">Priorité {rank}</span>
              {alt.type && <span className="text-slate-400 normal-case">{alt.type}</span>}
            </div>
            <div className="font-medium text-slate-900">{alt.name}</div>
            {(alt.coordinates_hint || alt.address_hint) && (
              <div className="text-slate-500 italic mt-0.5">
                📍 {alt.coordinates_hint || alt.address_hint}
              </div>
            )}
            <div className="text-slate-600 mt-0.5">
              {alt.price_eur > 0
                ? `≈ ${alt.price_eur.toLocaleString('fr-FR')} € / nuit`
                : 'Gratuit'}
              {alt.rating && (
                <span className="text-slate-400 ml-2">
                  · {alt.rating}/10
                  {alt.rating_count && ` (${alt.rating_count} avis)`}
                </span>
              )}
            </div>
          </div>
          {canEdit && (
            <div className="flex flex-col sm:flex-row gap-1 shrink-0">
              <button
                type="button"
                onClick={onPromote}
                className="inline-flex items-center gap-1 rounded-md bg-brand-100 text-brand-800 hover:bg-brand-200 transition-colors px-2 py-1 text-[11px] font-medium"
                title="Mettre cet hôtel en priorité 1 (utilisé dans le budget)"
              >
                ★ Priorité 1
              </button>
              <button
                type="button"
                onClick={onRemove}
                className="inline-flex items-center gap-1 rounded-md bg-red-50 text-red-700 hover:bg-red-100 transition-colors px-2 py-1 text-[11px] font-medium"
                title="Supprimer cette option"
              >
                🗑️
              </button>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function MealsCard({ day, dayIndex, onUpdateItinerary }) {
  const s = CATEGORY_STYLES.meal;
  const canEdit = typeof onUpdateItinerary === 'function';
  const userEdited = !!day.meals._user_edited;
  return (
    <div className={`rounded-xl border border-slate-200 border-l-4 ${s.border} ${s.tint} p-3 text-sm`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`grid place-items-center h-7 w-7 rounded-md ${s.headerBg} ${s.headerText} text-sm`}>
          {s.icon}
        </span>
        <span className={`text-xs uppercase tracking-wide font-semibold ${s.headerText}`}>
          Repas (famille)
        </span>
        {userEdited && (
          <span
            className="ml-auto text-[10px] text-emerald-700 font-medium"
            title="Budget repas corrigé manuellement"
          >
            ✓ corrigé
          </span>
        )}
      </div>
      <div
        className="font-medium text-slate-900"
        title="Estimation TravelO du budget repas. Cliquez pour saisir le vrai budget."
      >
        {canEdit ? (
          <EditableValue
            value={Number(day.meals.daily_family_budget_eur) || 0}
            type="number"
            min={0}
            step={5}
            prefix={userEdited ? '' : '≈ '}
            suffix=" € / jour"
            label="Budget repas famille pour la journée — cliquez pour saisir le vrai montant"
            format={(v) => (v === 0 ? 'Gratuit' : v.toLocaleString('fr-FR'))}
            onSave={(newBudget) =>
              onUpdateItinerary((it) =>
                updateMealsBudget(it, dayIndex, newBudget)
              )
            }
          />
        ) : (
          `${formatEurEstimate(day.meals.daily_family_budget_eur)} / jour`
        )}
      </div>
      {day.meals.style && (
        <div className="text-xs text-slate-600 capitalize">{day.meals.style}</div>
      )}
      {day.meals.note && (
        <div className="text-slate-600 mt-1">{day.meals.note}</div>
      )}
    </div>
  );
}

function ActivityCard({
  activity: a,
  dayLocation,
  dayIndex,
  activityIndex,
  canEditActivities,
  onEditActivity,
  onRemoveActivity,
  onUpdateItinerary,
}) {
  const s = CATEGORY_STYLES.activity;
  const canEdit = typeof onUpdateItinerary === 'function';
  const userEdited = !!a._user_edited;
  return (
    <div className={`rounded-lg border border-slate-200 border-l-4 ${s.border} ${s.tint} p-3 text-sm`}>
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-start sm:justify-between gap-y-2 sm:gap-2">
        <div className="sm:flex-1 sm:min-w-0">
          <div className="font-medium text-slate-900 flex flex-wrap items-center gap-2">
            <span className="break-words">{a.title}</span>
            {userEdited && (
              <span
                className="text-[10px] text-emerald-700 font-medium"
                title="Activité corrigée manuellement"
              >
                ✓ corrigé
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500">
            {a.schedule}
            {a.duration ? ` · ${a.duration}` : ''}
          </div>
          {a.description && (
            <p className="text-slate-700 mt-1">{a.description}</p>
          )}
          {isLikelyBookable(a) && (
            <ActivityBookingCta activity={a} location={dayLocation} compact />
          )}
          <div className="print:hidden mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] items-center text-slate-500">
            {isLikelyBookable(a) && (
              <a
                href={tiqetsSearch(a.title, dayLocation)}
                target="_blank"
                rel="noreferrer"
                className="hover:text-slate-700 hover:underline"
              >
                🏛️ Tiqets
              </a>
            )}
            <a
              href={googleMapsSearch(`${a.title} ${dayLocation}`)}
              target="_blank"
              rel="noreferrer"
              className="hover:text-slate-700 hover:underline"
            >
              📍 Google Maps
            </a>
            {canEditActivities && (
              <>
                <button
                  onClick={() =>
                    onEditActivity?.(dayIndex, activityIndex, a, dayLocation)
                  }
                  className="hover:text-brand-700 hover:underline"
                >
                  ✏️ Modifier
                </button>
                <button
                  onClick={() => onRemoveActivity?.(dayIndex, activityIndex)}
                  className="hover:text-red-600 hover:underline"
                >
                  🗑️ Supprimer
                </button>
              </>
            )}
          </div>
        </div>
        <div
          className="text-left sm:text-right text-xs sm:shrink-0 border-t sm:border-t-0 border-slate-100 pt-2 sm:pt-0 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 sm:block"
          title={
            a.price_per_person_eur === 0
              ? 'Activité officielle gratuite. GetYourGuide propose des visites guidées payantes en supplément.'
              : 'Cliquez sur le prix pour saisir le vrai tarif (celui de GetYourGuide / du site officiel).'
          }
        >
          <div className="text-slate-500">
            {canEdit ? (
              <EditableValue
                value={Number(a.price_per_person_eur) || 0}
                type="number"
                min={0}
                step={1}
                prefix={a.price_per_person_eur > 0 && !userEdited ? 'à partir de ' : ''}
                suffix={a.price_per_person_eur > 0 || canEdit ? ' € / pers.' : ''}
                label="Prix par personne — cliquez pour saisir le vrai tarif"
                format={(v) => (v === 0 ? 'Gratuit' : v.toLocaleString('fr-FR'))}
                onSave={(newPrice) =>
                  onUpdateItinerary((it) =>
                    updateActivityPricePerPerson(
                      it,
                      dayIndex,
                      activityIndex,
                      newPrice
                    )
                  )
                }
              />
            ) : (
              <>
                {a.price_per_person_eur > 0 && 'à partir de '}
                {formatEurOrFree(a.price_per_person_eur)}
                {a.price_per_person_eur > 0 ? ' / pers.' : ''}
              </>
            )}
          </div>
          <div className="font-semibold text-slate-800">
            Famille :{' '}
            {a.family_total_eur > 0
              ? formatEurEstimate(a.family_total_eur)
              : formatEurOrFree(a.family_total_eur)}
          </div>
        </div>
      </div>
    </div>
  );
}

function ServiceStopCard({ stop: s }) {
  const sty = CATEGORY_STYLES.service;
  return (
    <div className={`flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-slate-200 border-l-4 ${sty.border} ${sty.tint} p-3 text-sm`}>
      <div>
        <span className="font-medium capitalize text-slate-900">{s.type}</span>
        <span className="text-slate-700 ml-2">{s.name}</span>
        {s.location && (
          <span className="text-slate-500 ml-1">— {s.location}</span>
        )}
      </div>
      <div className="font-semibold text-slate-900">
        {formatEurOrFree(s.estimated_cost_eur)}
      </div>
    </div>
  );
}

/**
 * Mode "Cartes par catégorie" : on garde l'ordre habituel mais chaque
 * section a maintenant un en-tête avec icône colorée + chaque item un
 * trait de couleur à gauche selon sa catégorie.
 */
function DayCardsContent({
  day,
  dayIndex,
  adults,
  childrenCount,
  childrenAges,
  canEditActivities,
  onEditActivity,
  onRemoveActivity,
  onUpdateItinerary,
  onSuggestMomentAlternatives,
  onImportFlightFromImage,
}) {
  const momentProps = {
    dayIndex,
    dayLocation: day.location,
    onUpdateItinerary,
    onSuggestMomentAlternatives,
  };
  return (
    <>
      <div className="mt-4">
        <CategoryHeader category="moment" title="Au fil de la journée" />
        <div className="grid md:grid-cols-2 gap-3">
          <Moment label="Matin" m={day.morning} momentKey="morning" {...momentProps} />
          <Moment label="Midi" m={day.noon} momentKey="noon" {...momentProps} />
          <Moment label="Après-midi" m={day.afternoon} momentKey="afternoon" {...momentProps} />
          <Moment label="Soir" m={day.evening} momentKey="evening" {...momentProps} />
        </div>
      </div>

      {(() => {
        // On masque les "activités" qui sont en fait des vols-trajets, tout en
        // gardant l'index d'origine pour l'édition/suppression.
        const acts = (day.activities || [])
          .map((a, i) => ({ a, i }))
          .filter(({ a }) => !isFlightLegActivity(a));
        if (acts.length === 0) return null;
        return (
          <div className="mt-4">
            <CategoryHeader
              category="activity"
              title="Activités & excursions"
              count={acts.length}
            />
            <ul className="space-y-2">
              {acts.map(({ a, i }) => (
                <li key={i}>
                  <ActivityCard
                    activity={a}
                    dayLocation={day.location}
                    dayIndex={dayIndex}
                    activityIndex={i}
                    canEditActivities={canEditActivities}
                    onEditActivity={onEditActivity}
                    onRemoveActivity={onRemoveActivity}
                    onUpdateItinerary={onUpdateItinerary}
                  />
                </li>
              ))}
            </ul>
          </div>
        );
      })()}

      {day.trips?.length > 0 && (
        <details className="mt-4 group">
          <summary className="cursor-pointer list-none select-none flex items-center justify-between gap-2 rounded-lg hover:bg-slate-50 -mx-2 px-2 py-1 transition-colors print:hover:bg-transparent">
            <div className="min-w-0 flex-1">
              <CategoryHeader
                category="trip"
                title="Trajets"
                count={day.trips.length}
              />
              <div className="text-xs text-slate-500 ml-10 -mt-1.5 truncate">
                {summarizeTrips(day.trips)}
              </div>
            </div>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-slate-400 shrink-0 transition-transform group-open:rotate-180 print:hidden"
              aria-hidden="true"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </summary>
          <ul className="space-y-2 text-sm mt-2">
            {day.trips.map((t, i) => (
              <TripRow
                key={i}
                trip={t}
                dayDate={day.date}
                dayIndex={dayIndex}
                tripIndex={i}
                adults={adults}
                childrenCount={childrenCount}
                childrenAges={childrenAges}
                onUpdateItinerary={onUpdateItinerary}
                onImportFlightFromImage={
                  onImportFlightFromImage
                    ? () => onImportFlightFromImage(dayIndex, i, t)
                    : null
                }
              />
            ))}
          </ul>
        </details>
      )}

      {day.service_stops?.length > 0 && (
        <div className="mt-4">
          <CategoryHeader
            category="service"
            title="Aires de service & courses"
            count={day.service_stops.length}
          />
          <ul className="space-y-2">
            {day.service_stops.map((s, i) => (
              <li key={i}>
                <ServiceStopCard stop={s} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------
 * Mode "Timeline chronologique"
 * ------------------------------------------------------------------------- */

// Heures par défaut quand un moment/activité/trajet n'a pas d'horaire
// extractible : permet de placer tout de même l'item à un endroit
// raisonnable de la journée.
const MOMENT_DEFAULT_TIME = {
  Matin: '08:00',
  Midi: '12:30',
  'Après-midi': '14:30',
  Soir: '19:30',
};

/**
 * Extrait "HH:MM" depuis une chaîne du type "10:30 - 11:30", "10h30",
 * "10h", "10:30 → 11:30"… Renvoie null si rien trouvé.
 */
function parseScheduleStart(schedule) {
  if (!schedule || typeof schedule !== 'string') return null;
  const m = schedule.match(/(\d{1,2})\s*[:hH]\s*(\d{2})?/);
  if (!m) return null;
  const hh = m[1].padStart(2, '0');
  const mm = (m[2] || '00').padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Construit la liste des évènements d'une journée pour affichage
 * chronologique. Chaque évènement a : { time, category, render }.
 */
function buildDayEvents(day) {
  const events = [];

  // 4 moments
  for (const [label, key] of [
    ['Matin', 'morning'],
    ['Midi', 'noon'],
    ['Après-midi', 'afternoon'],
    ['Soir', 'evening'],
  ]) {
    const m = day[key];
    if (!m || (!m.title && !m.description)) continue;
    events.push({
      time: MOMENT_DEFAULT_TIME[label],
      category: 'moment',
      type: 'moment',
      payload: { label, m, momentKey: key },
    });
  }

  // Trajets / vols
  (day.trips || []).forEach((t, idx) => {
    const isFlight = /avion|vol|flight|plane/i.test(t.mode || '');
    const flightTime =
      t._flight?.departure_at && typeof t._flight.departure_at === 'string'
        ? t._flight.departure_at.substring(11, 16)
        : null;
    // Fallback : vol aller en début de journée, retour en fin
    const fallback = isFlight ? '07:00' : '09:00';
    events.push({
      time: flightTime || fallback,
      category: isFlight ? 'flight' : 'trip',
      type: 'trip',
      payload: { trip: t, tripIndex: idx, dayDate: day.date },
    });
  });

  // Activités
  (day.activities || []).forEach((a, idx) => {
    events.push({
      time: parseScheduleStart(a.schedule) || '10:00',
      category: 'activity',
      type: 'activity',
      payload: { activity: a, activityIndex: idx, dayLocation: day.location },
    });
  });

  // Aires de service / courses (van) — répartis en fin de matinée
  (day.service_stops || []).forEach((s, idx) => {
    events.push({
      time: '11:00',
      category: 'service',
      type: 'service',
      payload: { stop: s, idx },
    });
  });

  // Tri stable par heure (HH:MM > comparaison lexicographique OK)
  events.sort((a, b) => a.time.localeCompare(b.time));
  return events;
}

function DayTimeline({
  day,
  dayIndex,
  adults,
  childrenCount,
  childrenAges,
  canEditActivities,
  onEditActivity,
  onRemoveActivity,
  onUpdateItinerary,
  onSuggestMomentAlternatives,
  onImportFlightFromImage,
}) {
  const events = useMemo(() => buildDayEvents(day), [day]);

  if (events.length === 0) {
    return (
      <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
        Aucun évènement détaillé pour cette journée.
      </div>
    );
  }

  return (
    <div className="mt-4">
      <CategoryHeader category="moment" title="Déroulé de la journée" />
      <ol className="relative ml-4 sm:ml-6 border-l-2 border-slate-200 space-y-4 py-2">
        {events.map((e, i) => (
          <TimelineRow
            key={i}
            event={e}
            day={day}
            dayIndex={dayIndex}
            adults={adults}
            childrenCount={childrenCount}
            childrenAges={childrenAges}
            canEditActivities={canEditActivities}
            onEditActivity={onEditActivity}
            onRemoveActivity={onRemoveActivity}
            onUpdateItinerary={onUpdateItinerary}
            onSuggestMomentAlternatives={onSuggestMomentAlternatives}
            onImportHotelFromImage={onImportHotelFromImage}
            onImportFlightFromImage={onImportFlightFromImage}
          />
        ))}
      </ol>
    </div>
  );
}

function TimelineRow({
  event,
  day,
  dayIndex,
  adults,
  childrenCount,
  childrenAges,
  canEditActivities,
  onEditActivity,
  onRemoveActivity,
  onUpdateItinerary,
  onSuggestMomentAlternatives,
  onImportFlightFromImage,
}) {
  const s = CATEGORY_STYLES[event.category] || CATEGORY_STYLES.moment;
  return (
    <li className="relative pl-6 sm:pl-8">
      {/* Pastille colorée sur le rail */}
      <span
        className={`absolute -left-[9px] top-1.5 grid place-items-center h-4 w-4 rounded-full ${s.dot} ring-4 ring-white shadow-sm`}
        aria-hidden="true"
      />
      {/* Bandeau horaire + icône catégorie */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-xs font-bold text-slate-900 tabular-nums">
          {event.time}
        </span>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${s.headerBg} ${s.headerText}`}
        >
          <span>{s.icon}</span>
          <span>{s.label}</span>
        </span>
      </div>
      {/* Contenu de l'évènement, réutilisant les cartes du mode "Cartes" */}
      {event.type === 'moment' && (
        <Moment
          label={event.payload.label}
          m={event.payload.m}
          momentKey={event.payload.momentKey}
          dayIndex={dayIndex}
          dayLocation={day.location}
          onUpdateItinerary={onUpdateItinerary}
          onSuggestMomentAlternatives={onSuggestMomentAlternatives}
        />
      )}
      {event.type === 'activity' && (
        <ActivityCard
          activity={event.payload.activity}
          dayLocation={event.payload.dayLocation}
          dayIndex={dayIndex}
          activityIndex={event.payload.activityIndex}
          canEditActivities={canEditActivities}
          onEditActivity={onEditActivity}
          onRemoveActivity={onRemoveActivity}
          onUpdateItinerary={onUpdateItinerary}
        />
      )}
      {event.type === 'trip' && (
        <ul className="space-y-2 text-sm">
          <TripRow
            trip={event.payload.trip}
            dayDate={event.payload.dayDate}
            dayIndex={dayIndex}
            tripIndex={event.payload.tripIndex}
            adults={adults}
            childrenCount={childrenCount}
            childrenAges={childrenAges}
            onUpdateItinerary={onUpdateItinerary}
            onImportFlightFromImage={
              onImportFlightFromImage
                ? () =>
                    onImportFlightFromImage(
                      dayIndex,
                      event.payload.tripIndex,
                      event.payload.trip
                    )
                : null
            }
          />
        </ul>
      )}
      {event.type === 'service' && (
        <ServiceStopCard stop={event.payload.stop} />
      )}
    </li>
  );
}

function flightProviderName(source) {
  if (typeof source !== 'string') return 'fournisseur partenaire';
  if (source.startsWith('duffel')) return 'Duffel';
  if (source.startsWith('travelpayouts')) return 'Aviasales';
  return 'fournisseur partenaire';
}

/**
 * Pour Duffel, le deeplink pointe vers Google Flights (Duffel est B2B,
 * pas de site consommateur). Pour Travelpayouts, vers Aviasales (où
 * l'utilisateur peut réserver directement). On adapte le libellé du bouton
 * en conséquence.
 */
function flightDeeplinkLabel(source) {
  if (typeof source !== 'string') return 'Comparer ce vol';
  if (source.startsWith('duffel')) return 'Comparer sur Google Flights';
  if (source.startsWith('travelpayouts')) return 'Voir & réserver sur Aviasales';
  return 'Voir & comparer ce vol';
}

function TripRow({
  trip,
  dayDate,
  dayIndex,
  tripIndex,
  adults,
  childrenCount,
  childrenAges,
  onUpdateItinerary,
  onImportFlightFromImage,
}) {
  const hasBreakdown =
    trip.fuel_cost_eur != null ||
    trip.toll_cost_eur != null ||
    trip.ferry_cost_eur != null;
  const modeLower = (trip.mode || '').toLowerCase();
  const isFerry = modeLower.includes('ferry');
  const isFlight =
    /avion|vol|flight|plane/.test(modeLower) || !!trip._flight;
  const flight = trip._flight || {};
  // Le prix vient-il vraiment d'un fournisseur (Aviasales / Duffel) ou
  // est-ce une invention de l'IA ? Si pas de source réelle, l'estimation
  // peut être 2-3x au-dessus de la réalité — on doit le signaler.
  const isFlightPriceReal =
    typeof flight.source === 'string' &&
    (flight.source.startsWith('travelpayouts') ||
      flight.source.startsWith('duffel'));
  const userEditedPrice = !!trip._user_edited;
  const isAiEstimatedFlight =
    isFlight && !isFlightPriceReal && !userEditedPrice;
  const providerLabel = flightProviderName(flight.source);
  const canEdit =
    typeof onUpdateItinerary === 'function' &&
    typeof dayIndex === 'number' &&
    typeof tripIndex === 'number';
  // "HH:MM" depuis "YYYY-MM-DDTHH:MM:SS"
  const flightTime =
    flight.departure_at && typeof flight.departure_at === 'string'
      ? flight.departure_at.substring(11, 16)
      : null;
  const arrivalTime =
    flight.arrival_at && typeof flight.arrival_at === 'string'
      ? flight.arrival_at.substring(11, 16)
      : null;

  function commitFlightField(field, value) {
    if (!canEdit) return Promise.resolve();
    // Pour departure_at / arrival_at on garde la date et on remplace HH:MM
    if (field === 'departure_at' || field === 'arrival_at') {
      const baseSource =
        field === 'departure_at'
          ? flight.departure_at
          : flight.arrival_at;
      const base =
        (baseSource && baseSource.substring(0, 10)) || dayDate || '';
      const composed = base && value ? `${base}T${value}:00` : null;
      return onUpdateItinerary((it) =>
        updateFlightField(it, dayIndex, tripIndex, field, composed)
      );
    }
    return onUpdateItinerary((it) =>
      updateFlightField(it, dayIndex, tripIndex, field, value)
    );
  }

  return (
    <li className="rounded-lg border border-slate-100 bg-white p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="font-medium">
            {trip.from} → {trip.to}
          </span>
          <span className="text-slate-500 ml-2">
            {trip.distance_km} km · {trip.duration} · {trip.mode}
          </span>
        </div>
        <div
          className="text-right"
          title={
            userEditedPrice
              ? 'Prix corrigé manuellement.'
              : isFlightPriceReal
                ? `Prix ${providerLabel} — peut varier en temps réel. Cliquez pour le corriger si le vrai prix est différent.`
                : isFlight
                  ? `Prix INVENTÉ par l'IA — cliquez pour saisir le vrai prix (de votre recherche / réservation).`
                  : 'Estimation TravelO. Cliquez pour saisir le vrai prix.'
          }
        >
          <div className="font-semibold">
            {canEdit ? (
              <EditableValue
                value={Number(trip.estimated_cost_eur) || 0}
                type="number"
                min={0}
                step={10}
                suffix=" €"
                prefix={isAiEstimatedFlight ? '≈ ' : ''}
                label="Prix total famille — cliquez pour saisir le vrai prix"
                format={(v) =>
                  v === 0
                    ? 'Gratuit'
                    : isAiEstimatedFlight
                      ? formatPriceRange(v, false)
                      : v.toLocaleString('fr-FR')
                }
                onSave={(newPrice) =>
                  onUpdateItinerary((it) =>
                    updateTripPrice(it, dayIndex, tripIndex, newPrice)
                  )
                }
              />
            ) : isAiEstimatedFlight ? (
              `≈ ${formatPriceRange(trip.estimated_cost_eur, false)} €`
            ) : (
              formatEurEstimate(trip.estimated_cost_eur)
            )}
          </div>
          {userEditedPrice && (
            <div className="text-[10px] text-emerald-700 font-medium">
              ✓ corrigé manuellement
            </div>
          )}
          {trip.cost_note && !userEditedPrice && (
            <div className="text-xs text-slate-400">{trip.cost_note}</div>
          )}
        </div>
      </div>
      {isFlight && (
        <div className="mt-2 text-xs text-slate-600 border-t border-slate-100 pt-2">
          <div className="flex items-center gap-1.5 text-slate-700 font-medium mb-1.5">
            <span>✈️</span>
            <span>Détails du vol</span>
            <span
              className="text-[10px] text-slate-400 italic font-normal ml-auto"
              title="Toutes les heures sont en heure locale de l'aéroport correspondant."
            >
              (heure locale)
            </span>
          </div>
          <div className="grid grid-cols-[auto_1fr] sm:grid-cols-[auto_1fr_auto_1fr] gap-x-3 gap-y-1 items-baseline">
            <span className="text-slate-500">Compagnie :</span>
            <span>
              {canEdit ? (
                <EditableValue
                  value={flight.airline && flight.airline !== 'N/A' ? flight.airline : ''}
                  type="text"
                  placeholder="Ex: AF, Iberia…"
                  label="Code IATA ou nom de compagnie (cliquer pour modifier)"
                  allowEmpty
                  onSave={(v) => commitFlightField('airline', v)}
                />
              ) : (
                flight.airline || '—'
              )}
            </span>
            <span className="text-slate-500">N° vol :</span>
            <span>
              {canEdit ? (
                <EditableValue
                  value={flight.flight_number || ''}
                  type="text"
                  placeholder="Ex: 1234"
                  label="Numéro de vol (cliquer pour modifier)"
                  allowEmpty
                  onSave={(v) => commitFlightField('flight_number', v)}
                />
              ) : (
                flight.flight_number || '—'
              )}
            </span>
            <span className="text-slate-500">Départ :</span>
            <span>
              {canEdit ? (
                <EditableValue
                  value={flightTime || ''}
                  type="time"
                  placeholder="HH:MM"
                  label="Heure de départ — heure locale du lieu de départ"
                  allowEmpty
                  onSave={(v) => commitFlightField('departure_at', v)}
                />
              ) : (
                flightTime || '—'
              )}
            </span>
            <span className="text-slate-500">Arrivée :</span>
            <span>
              {canEdit ? (
                <EditableValue
                  value={arrivalTime || ''}
                  type="time"
                  placeholder="HH:MM"
                  label="Heure d'arrivée — heure locale du lieu d'arrivée"
                  allowEmpty
                  onSave={(v) => commitFlightField('arrival_at', v)}
                />
              ) : (
                arrivalTime || '—'
              )}
            </span>
          </div>
        </div>
      )}
      {isAiEstimatedFlight && (
        <div className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 print:hidden">
          ⚠️ <strong>Vol probable estimé par l'IA</strong> — fourchette
          indicative, pas un vrai vol réservé. Cherche sur Skyscanner
          ci-dessous, puis saisis le vrai prix (clic à droite) ou importe ta
          capture pour le confirmer.
        </div>
      )}
      {hasBreakdown && (
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500 border-t border-slate-100 pt-2">
          {trip.fuel_cost_eur != null && trip.fuel_cost_eur > 0 && (
            <span>⛽ Carburant : {formatEur(trip.fuel_cost_eur)}</span>
          )}
          {trip.toll_cost_eur != null && trip.toll_cost_eur > 0 && (
            <span>🛣️ Péages : {formatEur(trip.toll_cost_eur)}</span>
          )}
          {trip.ferry_cost_eur != null && trip.ferry_cost_eur > 0 && (
            <span>⛴️ Ferry : {formatEur(trip.ferry_cost_eur)}</span>
          )}
        </div>
      )}
      <div className="print:hidden mt-2 flex flex-wrap gap-3 text-xs">
        {!isFlight && (
          <a
            href={googleMapsDirections(trip.from, trip.to)}
            target="_blank"
            rel="noreferrer"
            className="text-brand-700 hover:underline"
          >
            🗺️ Itinéraire Google Maps
          </a>
        )}
        {isFerry && (
          <a
            href={directFerriesSearch(trip.from, trip.to, dayDate)}
            target="_blank"
            rel="noreferrer"
            className="text-brand-700 hover:underline"
          >
            ⛴️ Comparer ferries
          </a>
        )}
        {isFlight && (() => {
          // Construit l'URL Skyscanner pré-remplie pour ce vol précis.
          // Skyscanner exige un code IATA à 3 lettres dans le chemin —
          // pas un nom de ville. On extrait depuis flight (cas idéal)
          // sinon depuis trip.from / trip.to ("Bogotá (BOG)" → "BOG").
          const ori =
            extractIataSync(flight.origin_iata) ||
            extractIataSync(trip.from);
          const dst =
            extractIataSync(flight.destination_iata) ||
            extractIataSync(trip.to);
          // Date du vol = dayDate (jour de l'itinéraire) sauf si flight
          // a une date explicite plus précise.
          const flightDate =
            (flight.departure_at &&
              typeof flight.departure_at === 'string' &&
              flight.departure_at.substring(0, 10)) ||
            dayDate ||
            '';
          // Si pas de code IATA détecté, on n'affiche pas le bouton
          // (l'URL ne marcherait pas sur Skyscanner).
          if (!ori || !dst || !flightDate) return null;
          // Split children par âge : ≥2 ans = enfants (childrenv2),
          // <2 ans = bébés sur les genoux (infantsv2). Skyscanner attend
          // les âges, pas un compte.
          const agesAll = Array.isArray(childrenAges) ? childrenAges : [];
          const childAges = agesAll.filter((a) => Number(a) >= 2);
          const infantAges = agesAll.filter(
            (a) => Number(a) >= 0 && Number(a) < 2
          );
          const url = buildSkyscannerUrl({
            originIata: ori,
            destIata: dst,
            departDate: flightDate,
            returnDate: null,
            adults: adults || 1,
            childrenAges: childAges,
            infantsAges: infantAges,
          });
          if (!url) return null;
          return (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1 text-xs font-semibold"
              title={`Ouvrir la recherche ${ori} → ${dst} du ${flightDate} sur Skyscanner pré-remplie`}
            >
              🔍 Chercher sur Skyscanner
            </a>
          );
        })()}
        {isFlight && flight.deeplink && (
          <a
            href={flight.deeplink}
            target="_blank"
            rel="noopener noreferrer sponsored"
            className={
              isAiEstimatedFlight
                ? 'inline-flex items-center gap-1 rounded-md bg-amber-600 text-white px-3 py-1.5 hover:bg-amber-700 transition-colors font-semibold'
                : 'inline-flex items-center gap-1 rounded-md bg-brand-600 text-white px-2 py-1 hover:bg-brand-700 transition-colors'
            }
          >
            ✈️{' '}
            {isAiEstimatedFlight
              ? `Vérifier sur ${providerLabel}`
              : flightDeeplinkLabel(flight.source)}
          </a>
        )}
        {isFlight && typeof onImportFlightFromImage === 'function' && (
          <button
            type="button"
            onClick={() => onImportFlightFromImage()}
            className="inline-flex items-center gap-1 rounded-md bg-sky-100 text-sky-800 hover:bg-sky-200 transition-colors px-2 py-1 text-xs"
            title="Mettre à jour les infos du vol via une capture Skyscanner / Google Flights"
          >
            📸 MAJ via capture
          </button>
        )}
      </div>
      {trip.road_warning && (
        <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          ⚠️ {trip.road_warning}
        </div>
      )}
    </li>
  );
}

function Moment({
  label,
  m,
  dayIndex,
  momentKey,
  dayLocation,
  onUpdateItinerary,
  onSuggestMomentAlternatives,
}) {
  if (!m) return null;
  const canSuggest =
    typeof onSuggestMomentAlternatives === 'function' &&
    typeof dayIndex === 'number' &&
    !!momentKey;
  const canEdit =
    typeof onUpdateItinerary === 'function' &&
    typeof dayIndex === 'number' &&
    !!momentKey;
  const userEdited = !!m._user_edited;
  const userCleared = !!m._user_cleared;
  const hasDetail = !!m.description || canSuggest || canEdit;

  function markAsFree() {
    if (!canEdit) return;
    if (
      !confirm(
        `Marquer "${label}" comme libre / repos ?\n\nLe texte actuel sera effacé. Vous pourrez ensuite cliquer sur "Proposer d'autres options" pour le remplir avec une nouvelle activité.`
      )
    ) {
      return;
    }
    onUpdateItinerary((it) => clearMoment(it, dayIndex, momentKey));
  }

  // Si aucune description et pas de boutons d'action, on garde l'affichage plat
  if (!hasDetail) {
    return (
      <div className="rounded-lg border border-slate-100 p-3 bg-white">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-brand-700 font-semibold">
            {label}
          </span>
          {userEdited && !userCleared && (
            <span className="text-[10px] text-emerald-700 font-medium">
              ✓ corrigé
            </span>
          )}
        </div>
        <div className="text-slate-800 font-medium mt-1">
          {m.title || '(à compléter)'}
        </div>
      </div>
    );
  }

  // En mode "libre / repos", on affiche un visuel discret
  const titleClass = userCleared
    ? 'text-slate-500 font-medium italic mt-1'
    : 'text-slate-800 font-medium mt-1';

  return (
    <details className="group rounded-lg border border-slate-100 bg-white open:bg-slate-50/50 transition-colors print:open">
      <summary className="cursor-pointer list-none p-3 flex items-start justify-between gap-2 hover:bg-slate-50 rounded-lg select-none">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs uppercase tracking-wide text-brand-700 font-semibold">
              {label}
            </span>
            {userCleared && (
              <span
                className="inline-flex items-center gap-1 text-[10px] text-slate-600 font-medium rounded-full bg-slate-100 px-2 py-0.5"
                title="Créneau marqué comme libre par vous"
              >
                🛌 Libre
              </span>
            )}
            {userEdited && !userCleared && (
              <span className="text-[10px] text-emerald-700 font-medium">
                ✓ corrigé
              </span>
            )}
          </div>
          <div className={titleClass}>
            {userCleared ? '🛌 Libre / Repos' : m.title || '(à compléter)'}
          </div>
        </div>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-slate-400 mt-1 shrink-0 transition-transform group-open:rotate-180 print:hidden"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </summary>
      <div className="px-3 pb-3 text-sm text-slate-600 leading-relaxed space-y-2">
        {userCleared ? (
          <p className="italic text-slate-500">
            Aucune activité prévue sur ce créneau — temps libre / repos. Vous
            pouvez le remplir à tout moment en cliquant sur "Proposer d'autres
            options" ci-dessous.
          </p>
        ) : (
          m.description && <p>{m.description}</p>
        )}
        <div className="pt-2 border-t border-slate-100 flex flex-wrap gap-2 print:hidden">
          {canSuggest && (
            <button
              type="button"
              onClick={() =>
                onSuggestMomentAlternatives(dayIndex, momentKey, label, m, dayLocation)
              }
              className="text-xs inline-flex items-center gap-1 rounded-full bg-violet-100 text-violet-800 px-3 py-1 hover:bg-violet-200 transition-colors"
              title="Voir d'autres options cohérentes avec le reste de la journée"
            >
              💡 {userCleared ? 'Proposer une activité' : "Proposer d'autres options"}
            </button>
          )}
          {canEdit && !userCleared && (
            <button
              type="button"
              onClick={markAsFree}
              className="text-xs inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-700 px-3 py-1 hover:bg-slate-200 transition-colors"
              title="Effacer ce créneau et le marquer comme libre / repos"
            >
              🛌 Marquer libre
            </button>
          )}
        </div>
      </div>
    </details>
  );
}

const TRANSPORT_ICONS = {
  Avion: '✈️',
  Train: '🚄',
  Voiture: '🚗',
  Van: '🚐',
  'Camping-car': '🚍',
  Ferry: '🛳️',
  Bus: '🚌',
  'Transports en commun': '🚇',
  Taxi: '🚕',
  Vélo: '🚴',
  Marche: '🚶',
  Croisière: '🛳️',
  Autre: '🧭',
};

/**
 * Résumé en une ligne des trajets du jour, affiché dans le <summary>
 * quand la section "Trajets" est repliée — permet de savoir d'un coup
 * d'œil ce qui est caché sans avoir à déplier.
 *
 * Exemples :
 *   - 1 trip Avion :  "✈️ Marseille → Pékin"
 *   - 2 trips       :  "✈️ Marseille → Pékin · 🚕 PEK → Hôtel"
 *   - 4+            :  "✈️ Marseille → Pékin + 3 autres trajets"
 */
function summarizeTrips(trips) {
  if (!Array.isArray(trips) || trips.length === 0) return '';
  const fmt = (t) => {
    const cat = categorizeMode(t.mode);
    const icon = TRANSPORT_ICONS[cat] || '🧭';
    const from = (t.from || '').toString().slice(0, 18);
    const to = (t.to || '').toString().slice(0, 18);
    return from && to ? `${icon} ${from} → ${to}` : `${icon} ${t.mode || 'Trajet'}`;
  };
  if (trips.length === 1) return fmt(trips[0]);
  if (trips.length === 2) return `${fmt(trips[0])} · ${fmt(trips[1])}`;
  return `${fmt(trips[0])} + ${trips.length - 1} autres trajets`;
}

function categorizeMode(mode) {
  const m = (mode || '').toLowerCase();
  if (m.includes('avion') || m.includes('vol') || m.includes('flight') || m.includes('plane'))
    return 'Avion';
  if (
    m.includes('train') ||
    m.includes('tgv') ||
    m.includes('shinkansen') ||
    m.includes('ice') ||
    m.includes('eurostar') ||
    m.includes('intercité') ||
    m.includes('ter')
  )
    return 'Train';
  if (m.includes('ferry') || m.includes('bateau') || m.includes('boat'))
    return 'Ferry';
  if (m.includes('croisière') || m.includes('croisiere') || m.includes('cruise'))
    return 'Croisière';
  if (m.includes('camping-car') || m.includes('camping car') || m.includes('cc'))
    return 'Camping-car';
  if (m.includes('van') || m.includes('fourgon')) return 'Van';
  if (
    m.includes('voiture') ||
    m.includes('location') ||
    m.includes('rental') ||
    m.includes('car')
  )
    return 'Voiture';
  if (m.includes('taxi') || m.includes('uber') || m.includes('vtc'))
    return 'Taxi';
  if (
    m.includes('métro') ||
    m.includes('metro') ||
    m.includes('tram') ||
    m.includes('transports') ||
    m.includes('public') ||
    m.includes('local')
  )
    return 'Transports en commun';
  if (m.includes('bus') || m.includes('autobus') || m.includes('autocar'))
    return 'Bus';
  if (m.includes('vélo') || m.includes('velo') || m.includes('bike'))
    return 'Vélo';
  if (m.includes('marche') || m.includes('pied') || m.includes('walk'))
    return 'Marche';
  return 'Autre';
}

function BudgetGlobal({ budget, days, metadata }) {
  if (!budget) return null;
  const aiEur = costEur(metadata?.total_cost_usd);

  // Liste complète des trajets pour le détail dépliable de "Trajets (total)"
  const allTrips = useMemo(() => {
    const list = [];
    (days || []).forEach((d, dayIdx) => {
      (d.trips || []).forEach((t) => {
        list.push({
          dayLabel: d.label || `J${dayIdx + 1}`,
          dayDate: d.date || '',
          from: t.from || '',
          to: t.to || '',
          mode: t.mode || '—',
          cost: Number(t.estimated_cost_eur) || 0,
        });
      });
    });
    return list;
  }, [days]);
  const [tripsExpanded, setTripsExpanded] = useState(false);

  // budget est déjà recalculé en amont via recomputeBudgetFromDays() →
  // on peut lire directement ses champs comme sources de vérité.
  const tripsTotal = Number(budget.trips_eur) || 0;
  const grandTotal = Number(budget.grand_total_eur) || 0;
  const perPerson = Number(budget.per_person_eur) || 0;

  // Agrégation des trajets par mode de transport (avion/train/voiture/…)
  const modeBreakdown = useMemo(() => {
    const totals = {};
    for (const d of days || []) {
      for (const t of d.trips || []) {
        const cat = categorizeMode(t.mode);
        totals[cat] = (totals[cat] || 0) + (t.estimated_cost_eur || 0);
      }
    }
    return Object.entries(totals)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);
  }, [days]);

  // Sous-détail pour les trajets routiers (carburant / péages / ferries)
  const tripsBreakdown = [
    budget.fuel_eur && ['Carburant', budget.fuel_eur],
    budget.tolls_eur && ['Péages', budget.tolls_eur],
    budget.ferries_eur && ['Ferries', budget.ferries_eur],
  ].filter(Boolean);

  // Lignes du tableau principal — on traite "Trajets (total)" à part
  // pour le rendre cliquable / dépliable.
  const otherRows = [
    ['Hébergements', budget.accommodation_eur],
    ['Repas', budget.meals_eur],
    ['Excursions & activités', budget.activities_eur],
    budget.service_stops_eur > 0 && [
      'Aires de service & courses',
      budget.service_stops_eur,
    ],
  ].filter(Boolean);

  return (
    <section className="card">
      <h2 className="text-xl font-semibold text-slate-900">
        Récapitulatif budget global
      </h2>
      <p className="mt-2 text-xs italic text-slate-500">
        Tous les montants sont des estimations TravelO. Les prix réels
        (hébergements, transports, repas) varient selon la saison et les
        disponibilités — vérifiez auprès de chaque prestataire avant de réserver.
      </p>
      <table className="mt-4 w-full text-sm">
        <tbody>
          {/* Trajets (total) — ligne cliquable qui déplie le détail */}
          <tr
            onClick={() => allTrips.length > 0 && setTripsExpanded((v) => !v)}
            className={`border-b border-slate-100 ${
              allTrips.length > 0
                ? 'cursor-pointer hover:bg-slate-50 select-none'
                : ''
            }`}
            title={
              allTrips.length > 0
                ? tripsExpanded
                  ? 'Replier le détail des trajets'
                  : 'Afficher le détail de chaque trajet'
                : undefined
            }
          >
            <td className="py-2 text-slate-600 flex items-center gap-1.5">
              <span>Trajets (total)</span>
              {allTrips.length > 0 && (
                <span
                  className={`text-xs text-slate-400 transition-transform inline-block ${
                    tripsExpanded ? 'rotate-180' : ''
                  }`}
                  aria-hidden="true"
                >
                  ▾
                </span>
              )}
              {allTrips.length > 0 && !tripsExpanded && (
                <span className="text-[10px] text-slate-400">
                  ({allTrips.length})
                </span>
              )}
            </td>
            <td className="py-2 text-right font-medium">
              {formatEurEstimate(tripsTotal)}
            </td>
          </tr>

          {/* Sous-lignes : un trajet par ligne, indentées */}
          {tripsExpanded &&
            allTrips.map((t, i) => (
              <tr
                key={`trip-${i}`}
                className="border-b border-slate-100 last:border-0 bg-slate-50/50"
              >
                <td className="py-1.5 pl-6 text-xs text-slate-600">
                  <span className="mr-1.5">
                    {TRANSPORT_ICONS[categorizeMode(t.mode)] || '🧭'}
                  </span>
                  <span className="font-medium text-slate-700">
                    {t.dayLabel}
                  </span>
                  <span className="text-slate-400 mx-1.5">·</span>
                  <span>
                    {t.from} → {t.to}
                  </span>
                  <span className="text-slate-400 ml-1.5">({t.mode})</span>
                </td>
                <td className="py-1.5 text-right text-xs tabular-nums text-slate-700">
                  {t.cost > 0 ? formatEur(t.cost) : 'Gratuit'}
                </td>
              </tr>
            ))}

          {otherRows.map(([label, value]) => (
            <tr
              key={label}
              className="border-b border-slate-100 last:border-0"
            >
              <td className="py-2 text-slate-600">{label}</td>
              <td className="py-2 text-right font-medium">
                {formatEurEstimate(value)}
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-slate-200">
            <td className="py-3 font-semibold text-slate-900">Grand total estimé</td>
            <td className="py-3 text-right text-lg font-bold text-brand-700">
              {formatEurEstimate(grandTotal)}
            </td>
          </tr>
          <tr>
            <td className="py-1 text-sm text-slate-500">Par personne</td>
            <td className="py-1 text-right text-slate-700">
              {formatEurEstimate(perPerson)}
            </td>
          </tr>
        </tbody>
      </table>

      {modeBreakdown.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-2">
            Détail par mode de transport
          </h3>
          <table className="w-full text-sm">
            <tbody>
              {modeBreakdown.map(([label, value]) => (
                <tr key={label} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 text-slate-700">
                    <span className="mr-2">
                      {TRANSPORT_ICONS[label] || '🧭'}
                    </span>
                    {label}
                  </td>
                  <td className="py-2 text-right font-medium tabular-nums">
                    {formatEur(value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tripsBreakdown.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-2">
            Détail trajets routiers
          </h3>
          <table className="w-full text-sm">
            <tbody>
              {tripsBreakdown.map(([label, value]) => (
                <tr key={label} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 text-slate-600">{label}</td>
                  <td className="py-2 text-right font-medium">
                    {formatEur(value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {aiEur != null && (
        <div className="mt-6 rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-semibold text-slate-700">
              💸 Coût IA de génération
            </h3>
            <span className="font-bold text-slate-900 tabular-nums">
              {formatAiCost(aiEur)}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Coût total des appels à l'IA (génération + modifications). Compris
            dans votre crédit Anthropic / Google AI Studio, pas dans le budget
            de voyage ci-dessus.
          </p>
          <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <Stat label="Appels IA" value={metadata?.call_count || 0} />
            <Stat
              label="Tokens entrée"
              value={(metadata?.total_input_tokens || 0).toLocaleString('fr-FR')}
            />
            <Stat
              label="Tokens sortie"
              value={(metadata?.total_output_tokens || 0).toLocaleString('fr-FR')}
            />
            <Stat
              label="Modèle"
              value={(metadata?.models_used || []).join(' + ') || '—'}
            />
          </dl>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-slate-400">
        {label}
      </dt>
      <dd className="font-medium text-slate-700 truncate" title={String(value)}>
        {value}
      </dd>
    </div>
  );
}

function NotesConseils({ notes }) {
  if (!notes) return null;
  const phrases = notes.local_phrases;
  const packing = notes.packing_list;

  return (
    <div className="space-y-6">
      <PackingList packing={packing || {}} />
      {phrases?.phrases?.length > 0 && (
        <LocalPhrases data={phrases} />
      )}

      <section className="card space-y-5">
        <h2 className="text-xl font-semibold text-slate-900">Notes & Conseils</h2>

        {notes.visa_and_documents && (
          <NoteBlock title="Visa & documents">
            {notes.visa_and_documents}
          </NoteBlock>
        )}
        {notes.climate_and_packing && (
          <NoteBlock title="Climat & bagages">
            {notes.climate_and_packing}
          </NoteBlock>
        )}
        {notes.useful_apps?.length > 0 && (
          <NoteBlock title="Applications utiles">
            <ul className="list-disc list-inside text-slate-700">
              {notes.useful_apps.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </NoteBlock>
        )}
        {notes.road_trip_tips?.length > 0 && (
          <NoteBlock title="Conseils spécifiques road trip">
            <ul className="list-disc list-inside text-slate-700">
              {notes.road_trip_tips.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </NoteBlock>
        )}
        {notes.practical_tips?.length > 0 && (
          <NoteBlock title="Conseils pratiques">
            <ul className="list-disc list-inside text-slate-700">
              {notes.practical_tips.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </NoteBlock>
        )}
      </section>
    </div>
  );
}

function PackingList({ packing }) {
  const [personalLists, setPersonalLists] = useState([]);
  const [attachedIds, setAttachedIds] = useState(new Set());

  useEffect(() => {
    let active = true;
    listPackingLists().then(({ data }) => {
      if (active) setPersonalLists(data || []);
    });
    return () => {
      active = false;
    };
  }, []);

  function toggleAttach(id) {
    setAttachedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const categories = [
    { key: 'essentials', label: 'Essentiels' },
    { key: 'clothing', label: 'Vêtements' },
    { key: 'tech_and_papers', label: 'Tech & Papiers' },
    { key: 'vehicle_specific', label: 'Véhicule' },
    { key: 'activities_specific', label: 'Activités' },
  ].filter((c) => packing[c.key]?.length > 0);

  if (!categories.length && personalLists.length === 0) return null;

  const attachedLists = personalLists.filter((l) => attachedIds.has(l.id));

  return (
    <section className="card">
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <h2 className="text-xl font-semibold text-slate-900">
          🎒 Liste de packing
        </h2>
        <button
          onClick={() => window.print()}
          className="text-xs text-brand-700 hover:underline print:hidden"
        >
          🖨️ Imprimer
        </button>
      </div>

      {personalLists.length > 0 && (
        <div className="print:hidden mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="text-sm font-medium text-slate-700 mb-2">
            Ajouter une de mes listes perso :
          </div>
          <div className="flex flex-wrap gap-2">
            {personalLists.map((l) => {
              const active = attachedIds.has(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => toggleAttach(l.id)}
                  className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                    active
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {active ? '✓ ' : '+ '}
                  {l.name}
                  <span className="ml-1 opacity-60">({l.items.length})</span>
                </button>
              );
            })}
          </div>
          <div className="mt-2 text-[11px] text-slate-500">
            Gérer mes listes dans{' '}
            <a href="/mes-listes" className="text-brand-700 hover:underline">
              Mes listes
            </a>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {categories.map((c) => (
          <div key={c.key}>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-2">
              {c.label}
            </h3>
            <ul className="space-y-1.5 text-sm">
              {packing[c.key].map((item, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-slate-700"
                >
                  <input type="checkbox" className="mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {attachedLists.map((l) => (
          <div key={l.id} className="md:col-span-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-emerald-700 mb-2">
              👤 {l.name}
            </h3>
            <ul className="space-y-1.5 text-sm grid sm:grid-cols-2 gap-x-4">
              {l.items.map((item, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-slate-700"
                >
                  <input type="checkbox" className="mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function LocalPhrases({ data }) {
  return (
    <section className="card">
      <h2 className="text-xl font-semibold text-slate-900">
        🗣️ Phrases utiles en {data.language}
      </h2>
      {data.phonetic_hint && (
        <p className="text-xs text-slate-500 mt-1">{data.phonetic_hint}</p>
      )}
      <ul className="mt-4 divide-y divide-slate-100">
        {data.phrases.map((p, i) => (
          <li key={i} className="py-2 grid sm:grid-cols-3 gap-2 text-sm">
            <div className="text-slate-600">{p.fr}</div>
            <div className="font-medium text-slate-900">{p.local}</div>
            <div className="text-slate-500 italic">{p.pronunciation}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FichesActivites({ activities }) {
  if (!activities?.length)
    return (
      <section className="card text-slate-500">
        Aucune activité détaillée n'a été générée.
      </section>
    );
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold text-slate-900">
        Fiches détaillées des activités
      </h2>
      {activities.map((a, i) => (
        <article key={i} className="card print:break-inside-avoid">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-lg font-semibold text-slate-900">{a.title}</h3>
            <span className="text-xs text-slate-400">
              {a.day} · {a.date}
            </span>
          </div>
          <div className="mt-1 text-sm text-slate-500">
            {a.schedule}
            {a.duration ? ` · ${a.duration}` : ''}
          </div>
          <p className="mt-3 text-slate-700 leading-relaxed">
            {a.immersive_description || a.description}
          </p>
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <span
              className="text-slate-500"
              title="Estimation TravelO. Le prix réel sur GetYourGuide peut varier."
            >
              à partir de {formatEurEstimate(a.price_per_person_eur)} / personne
            </span>
            <span className="font-semibold text-slate-800">
              Total famille : {formatEurEstimate(a.family_total_eur)}
            </span>
          </div>
          {isLikelyBookable(a) && (
            <ActivityBookingCta activity={a} location={a.location} />
          )}
        </article>
      ))}
    </section>
  );
}

function NoteBlock({ title, children }) {
  return (
    <div>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h3>
      <div className="mt-1 text-slate-700 leading-relaxed">{children}</div>
    </div>
  );
}

function HeroChip({ icon, label }) {
  if (!label) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 backdrop-blur px-3 py-1.5 text-sm font-medium text-white print:bg-slate-100 print:text-slate-700 capitalize">
      {icon && (
        <Icon name={icon} className="h-3.5 w-3.5 opacity-90" strokeWidth={2} />
      )}
      <span>{label}</span>
    </span>
  );
}

function Info({ label, value }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="font-medium text-slate-800 capitalize">
        {value || '—'}
      </div>
    </div>
  );
}

// CTA prominent pour la réservation d'une activité via GetYourGuide.
// Style identique au CTA Booking mais aux couleurs GYG (orange #FF5533).
// Optionnel : props compact=true pour une version réduite (Planning),
// par défaut version complète avec badges (FichesActivites).
//
// Vérification dispo : appelle checkActivityBookable() au montage
// pour confirmer que GYG a bien des résultats. Si la réponse est
// négative, le composant se cache. Tant que la réponse est inconnue
// (loading ou erreur), on affiche le bouton (heuristique = mieux
// vaut afficher qu'un faux négatif).
function ActivityBookingCta({ activity, location, compact = false }) {
  const url = getYourGuideSearch(activity.title, location);
  const [verified, setVerified] = useState(undefined);
  const isFree = activity.price_per_person_eur === 0;

  useEffect(() => {
    let active = true;
    checkActivityBookable(activity.title, location).then((res) => {
      if (active) setVerified(res);
    });
    return () => {
      active = false;
    };
  }, [activity.title, location]);

  // Si la vérification a explicitement répondu "non disponible", cacher.
  // verified === undefined (en cours) ou null (erreur) → on affiche.
  if (verified === false) return null;

  const ctaTitle = isFree
    ? 'Visites guidées sur GetYourGuide'
    : 'Réserver sur GetYourGuide';
  const ctaSubtitle = isFree
    ? 'Visites guidées payantes en supplément (option)'
    : 'Confirmation immédiate · Annulation gratuite';

  return (
    <div className={compact ? 'mt-2' : 'mt-4'}>
      {isFree && (
        <p className="mb-1 text-[11px] italic text-slate-500 print:hidden">
          ℹ️ L'activité ci-dessus est gratuite. GetYourGuide propose des
          visites guidées avec guide francophone, coupe-files et options
          spéciales (payantes).
        </p>
      )}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer sponsored"
        className="group flex items-center justify-between gap-3 rounded-lg bg-[#FF5533] hover:bg-[#E04420] transition-colors px-4 py-3 text-white shadow-sm print:bg-white print:text-[#FF5533] print:border print:border-[#FF5533] print:shadow-none"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-white/15 text-base font-bold print:bg-[#FF5533] print:text-white">
            🎫
          </span>
          <div className="min-w-0">
            <div className="font-semibold leading-tight">{ctaTitle}</div>
            <div className="text-[11px] text-white/80 leading-tight print:text-slate-600">
              {ctaSubtitle}
            </div>
          </div>
        </div>
        <span className="shrink-0 text-sm font-medium group-hover:translate-x-0.5 transition-transform print:hidden">
          →
        </span>
      </a>
      {!compact && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 print:hidden">
          <span className="inline-flex items-center gap-1">
            <span className="text-emerald-600">✓</span> Annulation gratuite
            jusqu'à 24h avant
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="text-emerald-600">✓</span> Avis vérifiés des
            voyageurs
          </span>
          <span
            className="inline-flex items-center gap-1"
            title="TravelO touche une petite commission de GetYourGuide — aucun coût supplémentaire pour vous."
          >
            <span className="text-emerald-600">✓</span> Même prix pour vous
          </span>
        </div>
      )}
    </div>
  );
}

// Affiche la vraie note Google de l'hôtel à côté de son nom.
// Lazy fetch via Edge Function + cache sessionStorage 24h.
// État compact : "8,2/10 · 3 371 avis" — laisse vide si inconnu.
function HotelRating({ hotelName, location }) {
  const [data, setData] = useState(undefined); // undefined = loading, null = no data
  useEffect(() => {
    let active = true;
    if (!hotelName) {
      setData(null);
      return;
    }
    fetchHotelRating(hotelName, location).then((res) => {
      if (!active) return;
      setData(res?.rating ? res : null);
    });
    return () => {
      active = false;
    };
  }, [hotelName, location]);

  if (data === undefined) {
    return (
      <span className="ml-2 inline-block h-4 w-20 align-middle rounded bg-slate-100 animate-pulse" />
    );
  }
  if (!data || !data.rating) return null;

  const ratingOn10 = (data.rating * 2).toFixed(1).replace('.', ',');
  return (
    <span
      className="ml-2 inline-flex items-center gap-1 align-middle text-xs"
      title={`Note Google : ${data.rating}/5 (${data.userRatingCount} avis)`}
    >
      <span className="inline-flex items-center rounded bg-[#003580] text-white px-1.5 py-0.5 font-semibold">
        {ratingOn10}
      </span>
      <span className="text-slate-500">
        · {data.userRatingCount.toLocaleString('fr-FR')} avis
      </span>
    </span>
  );
}

function Block({ title, children }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
      <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">
        {title}
      </div>
      <div className="text-slate-700">{children}</div>
    </div>
  );
}
