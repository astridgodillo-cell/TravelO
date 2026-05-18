import { useMemo, useState } from 'react';
import RouteMap from './RouteMap';
import RegenerateDayModal from './RegenerateDayModal';
import ModifyDayModal from './ModifyDayModal';
import DayPhotos from './DayPhotos';
import ItineraryTable from './ItineraryTable';
import {
  bestAccommodationLink,
  googleMapsDirections,
  googleMapsSearch,
  googleMapsMultiStop,
  directFerriesSearch,
  park4nightSearch,
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

export default function ItineraryView({
  itinerary,
  onRegenerateDay,
  onReplanFromDay,
  regenerating,
}) {
  const [tab, setTab] = useState('planning');
  const [regenTarget, setRegenTarget] = useState(null);
  const [modifyTarget, setModifyTarget] = useState(null);

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
  const { summary, days, budget_summary, notes } = itinerary;
  const adults = summary?.travellers?.adults || 2;
  const children = summary?.travellers?.children_ages?.length || 0;
  const isVanTrip = VAN_TRIP_TYPES.has(summary?.trip_type);

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

  return (
    <div className="space-y-6">
      <header className="card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {summary?.destinations}
            </h1>
            {summary?.headline && (
              <p className="text-slate-600 mt-1 italic">"{summary.headline}"</p>
            )}
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-slate-400">
              Budget total estimé
            </div>
            <div className="text-2xl font-bold text-brand-700">
              {formatEur(budget_summary?.grand_total_eur)}
            </div>
            <div className="text-xs text-slate-500">
              soit {formatEur(budget_summary?.per_person_eur)} / personne
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Info label="Du" value={summary?.start_date} />
          <Info label="Au" value={summary?.end_date} />
          <Info label="Durée" value={`${summary?.duration_days} jours`} />
          <Info
            label="Voyageurs"
            value={`${adults} adulte(s)${children ? ` + ${children} enfant(s)` : ''}`}
          />
          <Info label="Type" value={summary?.trip_type} />
          <Info label="Niveau" value={summary?.budget_level} />
          <Info label="Départ" value={summary?.departure_location} />
          <Info
            label={summary?.is_round_trip ? 'Retour' : 'Arrivée'}
            value={summary?.return_location}
          />
          {summary?.vehicle_summary && (
            <Info label="Véhicule" value={summary.vehicle_summary} />
          )}
          {summary?.total_distance_km != null && (
            <Info
              label="Distance totale"
              value={`${summary.total_distance_km.toLocaleString('fr-FR')} km`}
            />
          )}
        </div>

        {googleMapsUrl && (
          <div className="mt-4 print:hidden">
            <a
              href={googleMapsUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary"
            >
              🗺️ Ouvrir tout l'itinéraire dans Google Maps
            </a>
          </div>
        )}
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
            canRegenerate={typeof onRegenerateDay === 'function'}
          />
        </div>
        <div className={tab === 'table' ? '' : 'hidden'}>
          <ItineraryTable days={days} />
        </div>
        <div className={tab === 'map' ? '' : 'hidden'}>
          <RouteMap itinerary={itinerary} />
        </div>
        <div className={tab === 'budget' ? '' : 'hidden print:block'}>
          <BudgetGlobal budget={budget_summary} />
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
  canRegenerate,
}) {
  if (!days?.length) return null;
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold text-slate-900 print:break-before-page">
        Programme jour par jour
      </h2>
      {days.map((d, i) => (
        <DayCard
          key={`${d.label}-${i}`}
          day={d}
          adults={adults}
          childrenCount={childrenCount}
          isVanTrip={isVanTrip}
          onOpenRegen={onOpenRegen ? () => onOpenRegen(i, d) : null}
          onOpenModify={onOpenModify ? () => onOpenModify(i, d) : null}
          canRegenerate={canRegenerate}
        />
      ))}
    </section>
  );
}

function DayCard({
  day,
  adults,
  childrenCount,
  isVanTrip,
  onOpenRegen,
  onOpenModify,
  canRegenerate,
}) {
  const accomLink = bestAccommodationLink(day.accommodation, {
    location: day.location,
    checkin: day.date,
    checkout: day.date,
    adults,
    children: childrenCount,
  });

  return (
    <article className="card print:break-inside-avoid print:shadow-none print:border-slate-300">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-3">
        <div>
          <h3 className="text-lg font-bold text-slate-900">
            {day.label} — {day.location}
          </h3>
          <p className="text-sm text-slate-500 capitalize">
            {day.weekday} {day.date}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {day.weather && (
            <div className="text-sm text-slate-600">
              <span className="text-lg mr-1">{day.weather.emoji}</span>
              {day.weather.temperature_c}°C
            </div>
          )}
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-slate-400">
              Total jour
            </div>
            <div className="font-bold text-slate-900">
              {formatEur(day.day_total_eur)}
            </div>
          </div>
          {canRegenerate && (
            <div className="flex gap-2 print:hidden">
              {onOpenModify && (
                <button
                  onClick={onOpenModify}
                  className="text-xs text-brand-700 hover:underline"
                  title="Modifier cette journée"
                >
                  ✏️ Modifier
                </button>
              )}
              {onOpenRegen && (
                <button
                  onClick={onOpenRegen}
                  className="text-xs text-slate-500 hover:underline"
                  title="Régénérer cette journée"
                >
                  ↻ Régénérer
                </button>
              )}
            </div>
          )}
        </div>
      </header>

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
                  <div>
                    <div className="font-medium text-slate-800">{a.title}</div>
                    <div className="text-xs text-slate-500">
                      {a.schedule}
                      {a.duration ? ` · ${a.duration}` : ''}
                    </div>
                    {a.description && (
                      <p className="text-slate-600 mt-1">{a.description}</p>
                    )}
                    <a
                      href={googleMapsSearch(`${a.title} ${day.location}`)}
                      target="_blank"
                      rel="noreferrer"
                      className="print:hidden inline-block text-xs text-brand-700 hover:underline mt-1"
                    >
                      📍 Voir sur Google Maps
                    </a>
                  </div>
                  <div className="text-right text-xs">
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

      <DayPhotos location={day.location} max={5} />
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
  return (
    <div className="rounded-lg border border-slate-100 p-3 bg-white">
      <div className="text-xs uppercase tracking-wide text-brand-700 font-semibold">
        {label}
      </div>
      <div className="text-slate-800 font-medium mt-1">{m.title}</div>
      {m.description && (
        <p className="text-sm text-slate-600 mt-1">{m.description}</p>
      )}
    </div>
  );
}

function BudgetGlobal({ budget }) {
  if (!budget) return null;
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

      {tripsBreakdown.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-2">
            Détail des trajets
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
    </section>
  );
}

function NotesConseils({ notes }) {
  if (!notes) return null;
  const phrases = notes.local_phrases;
  const packing = notes.packing_list;

  return (
    <div className="space-y-6">
      {packing && (
        <PackingList packing={packing} />
      )}
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
  const categories = [
    { key: 'essentials', label: 'Essentiels' },
    { key: 'clothing', label: 'Vêtements' },
    { key: 'tech_and_papers', label: 'Tech & Papiers' },
    { key: 'vehicle_specific', label: 'Véhicule' },
    { key: 'activities_specific', label: 'Activités' },
  ].filter((c) => packing[c.key]?.length > 0);

  if (!categories.length) return null;

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
