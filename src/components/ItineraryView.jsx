import { useEffect, useMemo, useState } from 'react';
import { listPackingLists } from '../lib/supabase';
import { costEur } from '../lib/ai';
import RouteMap from './RouteMap';
import DayMiniMap from './DayMiniMap';
import RegenerateDayModal from './RegenerateDayModal';
import ModifyDayModal from './ModifyDayModal';
import EditActivityModal from './EditActivityModal';
import DayPhotos from './DayPhotos';
import DaySpecialties from './DaySpecialties';
import ItineraryTable from './ItineraryTable';
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

const TABS = [
  { id: 'planning', label: 'Planning' },
  { id: 'table', label: 'Tableau' },
  { id: 'map', label: 'Carte' },
  { id: 'budget', label: 'Budget' },
  { id: 'notes', label: 'Pratique' },
  { id: 'activities', label: 'Activités' },
];

const VAN_TRIP_TYPES = new Set([
  'roadtrip-van',
  'roadtrip-camping-car',
]);

const formatEur = (n) =>
  typeof n === 'number'
    ? n.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €'
    : '—';

const formatEurOrFree = (n) => (n === 0 ? 'Gratuit' : formatEur(n));

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
      (d.activities || []).map((a) => ({ ...a, day: d.label, date: d.date }))
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

  if (!itinerary) return null;
  const { summary, days, budget_summary, notes, metadata } = itinerary;
  const adults = summary?.travellers?.adults || 2;
  const children = summary?.travellers?.children_ages?.length || 0;
  const isVanTrip = VAN_TRIP_TYPES.has(summary?.trip_type);
  const aiCostEur = costEur(metadata?.total_cost_usd);

  async function handleSubmitRegen(instructions) {
    if (!regenTarget) return;
    await onRegenerateDay?.(regenTarget.index, instructions);
    setRegenTarget(null);
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
      <header className="relative overflow-hidden rounded-3xl bg-hero-gradient text-white p-6 sm:p-10 shadow-glow animate-fade-up print:bg-white print:text-slate-900 print:shadow-none">
        {/* Bulles décoratives */}
        <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full bg-white/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -left-10 w-72 h-72 rounded-full bg-sunset-400/30 blur-3xl pointer-events-none" />

        <div className="relative">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <span className="inline-block text-xs uppercase tracking-widest text-white/80 mb-2 print:text-slate-500">
                ✨ Itinéraire sur mesure
              </span>
              <h1 className="text-3xl sm:text-4xl font-bold leading-tight">
                {summary?.destinations}
              </h1>
              {summary?.headline && (
                <p className="text-white/90 mt-3 italic text-base sm:text-lg print:text-slate-600">
                  "{summary.headline}"
                </p>
              )}
            </div>
            <div className="text-right bg-white/15 backdrop-blur rounded-2xl px-4 py-3 print:bg-slate-100">
              <div className="text-[10px] uppercase tracking-widest text-white/80 print:text-slate-500">
                Budget total
              </div>
              <div className="text-3xl font-bold tabular-nums">
                {formatEur(budget_summary?.grand_total_eur)}
              </div>
              <div className="text-xs text-white/80 print:text-slate-500">
                {formatEur(budget_summary?.per_person_eur)} / pers.
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <HeroChip icon="📅" label={`${summary?.duration_days} jours`} />
            <HeroChip
              icon="👥"
              label={`${adults} adulte(s)${children ? ` + ${children} enfant(s)` : ''}`}
            />
            <HeroChip icon="🎯" label={summary?.trip_type} />
            <HeroChip icon="💎" label={summary?.budget_level} />
            {summary?.total_distance_km != null && (
              <HeroChip
                icon="🛣️"
                label={`${summary.total_distance_km.toLocaleString('fr-FR')} km`}
              />
            )}
            {summary?.vehicle_summary && (
              <HeroChip icon="🚐" label={summary.vehicle_summary} />
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
                🗺️ Ouvrir tout l'itinéraire dans Google Maps
              </a>
            </div>
          )}

          {aiCostEur != null && (
            <div
              className="mt-4 text-xs text-white/70 print:text-slate-500"
              title={`${metadata.call_count || 0} appels IA · ${(metadata.total_input_tokens || 0).toLocaleString('fr-FR')} tokens entrée + ${(metadata.total_output_tokens || 0).toLocaleString('fr-FR')} tokens sortie · modèle(s) : ${(metadata.models_used || []).join(', ') || '?'}`}
            >
              💸 Coût IA de génération : {formatAiCost(aiCostEur)}
              {metadata.call_count > 1 && (
                <span className="opacity-70 ml-1">
                  ({metadata.call_count} appels)
                </span>
              )}
            </div>
          )}
        </div>
      </header>

      <nav className="print:hidden">
        <ul className="flex flex-wrap gap-1 border-b border-slate-200">
          {TABS.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => setTab(t.id)}
                className={`px-4 py-2 text-sm font-medium rounded-t-md border-b-2 transition-colors ${
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
            adults={adults}
            childrenCount={children}
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
  adults,
  childrenCount,
  isVanTrip,
  onOpenRegen,
  onOpenModify,
  onEditActivity,
  onRemoveActivity,
  onFetchSpecialties,
  loadingSpecialtiesIdx,
  canRegenerate,
  canEditActivities,
}) {
  // Tous les jours fermés par défaut : on voit la liste d'un coup d'œil
  // et on déplie au besoin.
  const [expandedDays, setExpandedDays] = useState(() => new Set());

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
      <div className="flex flex-wrap items-baseline justify-between gap-3 print:block">
        <h2 className="text-xl font-semibold text-slate-900 print:break-before-page">
          Programme jour par jour
        </h2>
        <button
          type="button"
          onClick={toggleAll}
          className="text-sm text-brand-700 hover:underline print:hidden"
        >
          {allExpanded ? '↑ Tout replier' : '↓ Tout déplier'}
        </button>
      </div>
      {days.map((d, i) => (
        <DayCard
          key={`${d.label}-${i}`}
          day={d}
          dayIndex={i}
          allDays={days}
          expanded={expandedDays.has(i)}
          onToggleExpand={() => toggleDay(i)}
          adults={adults}
          childrenCount={childrenCount}
          isVanTrip={isVanTrip}
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
        />
      ))}
    </section>
  );
}

function DayCard({
  day,
  dayIndex,
  allDays,
  expanded,
  onToggleExpand,
  adults,
  childrenCount,
  isVanTrip,
  onOpenRegen,
  onOpenModify,
  onEditActivity,
  onRemoveActivity,
  onFetchSpecialties,
  loadingSpecialties,
  canRegenerate,
  canEditActivities,
}) {
  // Fallback titre accrocheur : day_title (nouveau schéma) → titre du matin
  // (pour les anciens itinéraires sans day_title)
  const dayTitle =
    day.day_title || day.morning?.title || `Journée à ${day.location}`;
  const accomLink = bestAccommodationLink(day.accommodation, {
    location: day.location,
    checkin: day.date,
    checkout: day.date,
    adults,
    children: childrenCount,
  });

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
        className="flex flex-wrap items-start justify-between gap-3 cursor-pointer select-none -m-2 p-2 rounded-xl hover:bg-slate-50 transition-colors print:cursor-auto print:hover:bg-transparent"
      >
        <div className="flex items-start gap-3 sm:gap-4 min-w-0 flex-1">
          <div
            className={`shrink-0 grid place-items-center h-14 w-14 rounded-2xl text-white font-bold text-lg shadow-pop print:bg-slate-900 ${
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
            <p className="text-sm font-semibold text-slate-700 mt-1.5 leading-snug">
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
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-widest text-slate-400">
              Total jour
            </div>
            <div className="text-xl font-bold text-slate-900 tabular-nums">
              {formatEur(day.day_total_eur)}
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

      <div className="mt-4 grid lg:grid-cols-2 gap-3">
        <DayMiniMap
          coordinates={day.coordinates}
          label={day.label}
          location={day.location}
          allDays={allDays}
        />
        <DayPhotos location={day.location} max={5} aspect />
      </div>

      <button
        type="button"
        onClick={onToggleExpand}
        className="mt-4 w-full rounded-xl border border-dashed border-slate-200 bg-slate-50 hover:bg-slate-100 text-sm text-slate-600 py-2.5 transition-colors print:hidden"
      >
        {expanded
          ? '↑ Replier les détails de la journée'
          : '↓ Voir tous les détails de la journée'}
      </button>

      {expanded && (
      <>
      <div className="mt-4 grid md:grid-cols-2 gap-3">
        <Moment label="Matin" m={day.morning} />
        <Moment label="Midi" m={day.noon} />
        <Moment label="Après-midi" m={day.afternoon} />
        <Moment label="Soir" m={day.evening} />
      </div>

      {day.activities?.length > 0 && (
        <div className="mt-4">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-2">
            Activités & excursions
          </h4>
          <ul className="space-y-2">
            {day.activities.map((a, i) => (
              <li
                key={i}
                className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-slate-800">{a.title}</div>
                    <div className="text-xs text-slate-500">
                      {a.schedule}
                      {a.duration ? ` · ${a.duration}` : ''}
                    </div>
                    {a.description && (
                      <p className="text-slate-600 mt-1">{a.description}</p>
                    )}
                    <div className="print:hidden mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs items-center">
                      {isLikelyBookable(a) && (
                        <>
                          <a
                            href={getYourGuideSearch(a.title, day.location)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 hover:bg-emerald-200 px-2.5 py-0.5 font-semibold"
                          >
                            🎫 Réserver (GetYourGuide)
                          </a>
                          <a
                            href={tiqetsSearch(a.title, day.location)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-brand-700 hover:underline"
                          >
                            🏛️ Tiqets
                          </a>
                        </>
                      )}
                      <a
                        href={googleMapsSearch(`${a.title} ${day.location}`)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand-700 hover:underline"
                      >
                        📍 Google Maps
                      </a>
                      {canEditActivities && (
                        <>
                          <button
                            onClick={() =>
                              onEditActivity?.(dayIndex, i, a, day.location)
                            }
                            className="text-slate-500 hover:text-brand-700 hover:underline"
                          >
                            ✏️ Modifier
                          </button>
                          <button
                            onClick={() => onRemoveActivity?.(dayIndex, i)}
                            className="text-slate-400 hover:text-red-600 hover:underline"
                          >
                            🗑️ Supprimer
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-right text-xs shrink-0">
                    <div className="text-slate-500">
                      {formatEur(a.price_per_person_eur)} / pers.
                    </div>
                    <div className="font-semibold text-slate-800">
                      Famille : {formatEur(a.family_total_eur)}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {day.trips?.length > 0 && (
        <div className="mt-4">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-2">
            Trajets
          </h4>
          <ul className="space-y-2 text-sm">
            {day.trips.map((t, i) => (
              <TripRow key={i} trip={t} dayDate={day.date} />
            ))}
          </ul>
        </div>
      )}

      {day.service_stops?.length > 0 && (
        <div className="mt-4">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-2">
            Aires de service & courses
          </h4>
          <ul className="space-y-2 text-sm">
            {day.service_stops.map((s, i) => (
              <li
                key={i}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-emerald-100 bg-emerald-50 p-3"
              >
                <div>
                  <span className="font-medium capitalize">{s.type}</span>
                  <span className="text-slate-700 ml-2">{s.name}</span>
                  {s.location && (
                    <span className="text-slate-500 ml-1">— {s.location}</span>
                  )}
                </div>
                <div className="font-semibold">
                  {formatEurOrFree(s.estimated_cost_eur)}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 grid md:grid-cols-2 gap-3">
        {day.accommodation && (
          <Block title="Hébergement / nuit">
            <div className="font-medium text-slate-800">
              {day.accommodation.name}
            </div>
            <div className="text-slate-500">
              {day.accommodation.type} —{' '}
              {formatEurOrFree(day.accommodation.price_eur)}
              {day.accommodation.price_eur > 0 ? ' / nuit' : ''}
            </div>
            {day.accommodation.coordinates_hint && (
              <div className="text-slate-400 italic mt-1">
                📍 {day.accommodation.coordinates_hint}
              </div>
            )}
            {day.accommodation.services?.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {day.accommodation.services.map((s, i) => (
                  <span
                    key={i}
                    className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                  >
                    {s}
                  </span>
                ))}
              </div>
            )}
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
          </Block>
        )}
        {day.meals && (
          <Block title="Repas (famille)">
            <div className="font-medium text-slate-800">
              {formatEur(day.meals.daily_family_budget_eur)} / jour
            </div>
            {day.meals.style && (
              <div className="text-xs text-slate-500 capitalize">
                {day.meals.style}
              </div>
            )}
            {day.meals.note && (
              <div className="text-slate-500 mt-1">{day.meals.note}</div>
            )}
          </Block>
        )}
      </div>

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

function TripRow({ trip, dayDate }) {
  const hasBreakdown =
    trip.fuel_cost_eur != null ||
    trip.toll_cost_eur != null ||
    trip.ferry_cost_eur != null;
  const isFerry = (trip.mode || '').toLowerCase().includes('ferry');

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
        <div className="text-right">
          <div className="font-semibold">
            {formatEur(trip.estimated_cost_eur)}
          </div>
          {trip.cost_note && (
            <div className="text-xs text-slate-400">{trip.cost_note}</div>
          )}
        </div>
      </div>
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
        <a
          href={googleMapsDirections(trip.from, trip.to)}
          target="_blank"
          rel="noreferrer"
          className="text-brand-700 hover:underline"
        >
          🗺️ Itinéraire Google Maps
        </a>
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
      </div>
      {trip.road_warning && (
        <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          ⚠️ {trip.road_warning}
        </div>
      )}
    </li>
  );
}

function Moment({ label, m }) {
  if (!m) return null;
  const hasDetail = !!m.description;
  // Quand il n'y a pas de description, pas de toggle (le moment reste plat)
  if (!hasDetail) {
    return (
      <div className="rounded-lg border border-slate-100 p-3 bg-white">
        <div className="text-xs uppercase tracking-wide text-brand-700 font-semibold">
          {label}
        </div>
        <div className="text-slate-800 font-medium mt-1">{m.title}</div>
      </div>
    );
  }
  return (
    <details className="group rounded-lg border border-slate-100 bg-white open:bg-slate-50/50 transition-colors print:open">
      <summary className="cursor-pointer list-none p-3 flex items-start justify-between gap-2 hover:bg-slate-50 rounded-lg select-none">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-brand-700 font-semibold">
            {label}
          </div>
          <div className="text-slate-800 font-medium mt-1">{m.title}</div>
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
      <p className="text-sm text-slate-600 px-3 pb-3 leading-relaxed">
        {m.description}
      </p>
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

  const rows = [
    ['Trajets (total)', budget.trips_eur],
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
      <table className="mt-4 w-full text-sm">
        <tbody>
          {rows.map(([label, value]) => (
            <tr
              key={label}
              className="border-b border-slate-100 last:border-0"
            >
              <td className="py-2 text-slate-600">{label}</td>
              <td className="py-2 text-right font-medium">
                {formatEur(value)}
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-slate-200">
            <td className="py-3 font-semibold text-slate-900">Grand total</td>
            <td className="py-3 text-right text-lg font-bold text-brand-700">
              {formatEur(budget.grand_total_eur)}
            </td>
          </tr>
          <tr>
            <td className="py-1 text-sm text-slate-500">Par personne</td>
            <td className="py-1 text-right text-slate-700">
              {formatEur(budget.per_person_eur)}
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
            <span className="text-slate-500">
              {formatEur(a.price_per_person_eur)} / personne
            </span>
            <span className="font-semibold text-slate-800">
              Total famille : {formatEur(a.family_total_eur)}
            </span>
          </div>
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
      <span aria-hidden>{icon}</span>
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
