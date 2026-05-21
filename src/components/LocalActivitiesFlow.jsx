import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  suggestLocalActivities,
  buildDayFromActivities,
  getPlacePredictions,
} from '../lib/ai';
import {
  getMyProfile,
  updateMyProfile,
  saveItinerary,
} from '../lib/supabase';

const ACTIVITY_TYPES = [
  { id: 'insolite', label: '✨ Insolite' },
  { id: 'culture', label: '🏛️ Culture' },
  { id: 'nature', label: '🌳 Nature' },
  { id: 'baignade', label: '🏊 Baignade' },
  { id: 'sport', label: '🚴 Sport' },
  { id: 'aventure', label: '🎢 Aventure' },
  { id: 'panorama', label: '🌅 Panorama' },
  { id: 'gastronomie', label: '🍽️ Gastronomie' },
  { id: 'famille', label: '👨‍👩‍👧 Famille' },
  { id: 'animalier', label: '🦒 Animalier' },
  { id: 'festival', label: '🎪 Festival' },
  { id: 'bien-etre', label: '♨️ Bien-être' },
  { id: 'spirituel', label: '🧘 Spirituel' },
  { id: 'vie-nocturne', label: '🌃 Vie nocturne' },
  { id: 'shopping', label: '🛍️ Shopping' },
  { id: 'romantique', label: '💑 Romantique' },
];

const RADIUS_OPTIONS = [10, 20, 30, 50, 75, 100];

export default function LocalActivitiesFlow() {
  const navigate = useNavigate();
  const [location, setLocation] = useState('');
  const [radius, setRadius] = useState(30);
  const [types, setTypes] = useState([]);
  const [rainyOnly, setRainyOnly] = useState(false);
  const [withKids, setWithKids] = useState(false);
  const [gettingPosition, setGettingPosition] = useState(false);

  // Autocomplete d'adresse : déclenche à partir de 3 lettres, debounce 300ms.
  const [predictions, setPredictions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  // Session token Google Places : groupe les frappes d'une même saisie
  // en une seule session billable. Régénéré après chaque sélection.
  const sessionTokenRef = useRef(crypto.randomUUID());
  // Drapeau pour ignorer le prochain debounce après une sélection
  // (sinon le dropdown se réaffiche aussitôt avec le texte qu'on vient de poser).
  const justPickedRef = useRef(false);
  const wrapperRef = useRef(null);

  // Debounce de l'autocomplete
  useEffect(() => {
    if (justPickedRef.current) {
      justPickedRef.current = false;
      return;
    }
    const q = location.trim();
    if (q.length < 3) {
      setPredictions([]);
      return;
    }
    const timer = setTimeout(async () => {
      const preds = await getPlacePredictions(q, sessionTokenRef.current);
      setPredictions(preds);
      setShowSuggestions(preds.length > 0);
      setActiveSuggestion(-1);
    }, 300);
    return () => clearTimeout(timer);
  }, [location]);

  // Ferme le dropdown au clic en dehors
  useEffect(() => {
    function onClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function pickSuggestion(p) {
    justPickedRef.current = true;
    setLocation(p.text || p.main_text);
    setShowSuggestions(false);
    setPredictions([]);
    // Nouvelle session (Google : la session se termine quand l'utilisateur sélectionne)
    sessionTokenRef.current = crypto.randomUUID();
  }

  function onLocationKeyDown(e) {
    if (!showSuggestions || predictions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveSuggestion((i) => Math.min(i + 1, predictions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSuggestion((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter' && activeSuggestion >= 0) {
      e.preventDefault();
      pickSuggestion(predictions[activeSuggestion]);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  }

  const [activities, setActivities] = useState([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState({}); // {id: true}
  const [wishlistAdded, setWishlistAdded] = useState({}); // {title: true}
  const [building, setBuilding] = useState(false);

  function toggleType(id) {
    setTypes((t) =>
      t.includes(id) ? t.filter((x) => x !== id) : [...t, id]
    );
  }

  function toggleSelect(id) {
    setSelected((s) => {
      const next = { ...s };
      if (next[id]) delete next[id];
      else next[id] = true;
      return next;
    });
  }

  async function useMyPosition() {
    if (!navigator.geolocation) {
      setError('Géolocalisation non disponible sur ce navigateur.');
      return;
    }
    setGettingPosition(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
          // Nominatim (OSM) — gratuit, sans clé. Limite : 1 req/s.
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=fr&zoom=12`,
            { headers: { 'User-Agent': 'TravelO/1.0' } }
          );
          const data = await res.json();
          const addr = data?.address || {};
          const city =
            addr.city || addr.town || addr.village || addr.municipality;
          const state = addr.state || addr.county;
          const label = city
            ? `${city}${state ? `, ${state}` : ''}`
            : data?.display_name || `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
          setLocation(label);
        } catch (e) {
          setLocation(`${latitude.toFixed(3)}, ${longitude.toFixed(3)}`);
        } finally {
          setGettingPosition(false);
        }
      },
      (err) => {
        setError(
          err.code === 1
            ? 'Permission de géolocalisation refusée.'
            : 'Impossible de récupérer ta position.'
        );
        setGettingPosition(false);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
    );
  }

  async function runSearch(append = false) {
    if (!location.trim()) {
      setError('Indique une position pour commencer.');
      return;
    }
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      // On exclut par Place ID (stable Google Places) plutôt que par titre :
      // garantit qu'on ne revoit pas le même lieu même si le LLM varie le nom.
      const exclude = append
        ? activities.map((a) => a.id).filter(Boolean)
        : [];
      const { activities: newOnes } = await suggestLocalActivities({
        location,
        radiusKm: radius,
        types,
        rainyOnly,
        withKids,
        exclude,
      });
      if (append) {
        setActivities((prev) => [...prev, ...newOnes]);
      } else {
        setActivities(newOnes);
        setSelected({});
        setWishlistAdded({});
        setHasSearched(true);
      }
    } catch (e) {
      setError(e.message || 'Erreur lors de la recherche.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  async function addToWishlist(activity) {
    if (wishlistAdded[activity.title]) return;
    try {
      const { data: profile } = await getMyProfile();
      const current = Array.isArray(profile?.wishlist_places)
        ? profile.wishlist_places
        : [];
      const exists = current.some(
        (p) => p.name.toLowerCase() === activity.title.toLowerCase()
      );
      if (!exists) {
        await updateMyProfile({
          wishlist_places: [
            ...current,
            { name: activity.title, notes: activity.address || '' },
          ],
        });
      }
      setWishlistAdded((w) => ({ ...w, [activity.title]: true }));
    } catch (e) {
      setError(`Ajout wishlist échoué : ${e.message}`);
    }
  }

  async function buildDay() {
    const selectedActs = activities.filter((a) => selected[a.id]);
    if (selectedActs.length === 0) return;
    setBuilding(true);
    setError(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const itinerary = await buildDayFromActivities({
        selectedActivities: selectedActs,
        location,
        date: today,
        withKids,
        adults: 2,
        childrenAges: [],
      });
      const title =
        `Journée à ${location}`.slice(0, 80) + ' — 1j';
      const { data, error: dbError } = await saveItinerary({
        title,
        preferences: {
          destinations: location,
          startDate: today,
          endDate: today,
          departureLocation: location,
          returnLocation: location,
          adults: 2,
          childrenAges: [],
          tripType: 'sejour-fixe',
          interests: types,
          specificActivities: [],
          budget: 'moyen',
          offDays: 0,
          mustInclude: selectedActs.map((a) => a.title).join(', '),
          toAvoid: '',
          nightStayPreferences: [],
          cooking: 'restaurants',
          needsServicePoints: false,
          okWithFerry: true,
          vehicle: null,
        },
        itinerary,
      });
      if (dbError) throw new Error(dbError.message);
      navigate(`/itineraire/${data.id}`);
    } catch (e) {
      setError(e.message || 'Erreur lors de la construction de la journée.');
      setBuilding(false);
    }
  }

  const selectedCount = Object.keys(selected).length;

  return (
    <div className="space-y-6">
      {/* Formulaire de recherche */}
      <div className="card space-y-5">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            🧭 Activités autour de moi
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Découvre 10 idées d'activités à proximité. Tu peux les ajouter à ta
            wishlist ou en cocher quelques-unes pour qu'on te construise une journée.
          </p>
        </div>

        <div ref={wrapperRef}>
          <label className="label">📍 Ma position</label>
          <div className="flex gap-2 relative">
            <div className="flex-1 relative">
              <input
                className="input w-full"
                placeholder="Tape une ville, un code postal, une adresse…"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                onFocus={() => predictions.length > 0 && setShowSuggestions(true)}
                onKeyDown={onLocationKeyDown}
                autoComplete="off"
              />
              {showSuggestions && predictions.length > 0 && (
                <ul className="absolute left-0 right-0 top-full mt-1 z-30 bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-auto">
                  {predictions.map((p, i) => (
                    <li
                      key={p.place_id || p.text || i}
                      onMouseDown={(e) => {
                        // mouseDown plutôt que click : évite que l'input perde
                        // le focus et déclenche le clic-extérieur avant la sélection.
                        e.preventDefault();
                        pickSuggestion(p);
                      }}
                      onMouseEnter={() => setActiveSuggestion(i)}
                      className={`px-3 py-2 cursor-pointer text-sm ${
                        i === activeSuggestion
                          ? 'bg-brand-50 text-brand-900'
                          : 'hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <div className="font-medium">
                        📍 {p.main_text || p.text}
                      </div>
                      {p.secondary_text && (
                        <div className="text-xs text-slate-500 mt-0.5">
                          {p.secondary_text}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button
              type="button"
              onClick={useMyPosition}
              disabled={gettingPosition}
              className="btn-secondary shrink-0"
              title="Utiliser ma géolocalisation"
            >
              {gettingPosition ? '…' : '📍 GPS'}
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Tape 3 lettres minimum — on te propose des lieux au fur et à mesure.
          </p>
        </div>

        <div>
          <label className="label">Rayon de recherche</label>
          <div className="flex flex-wrap gap-2">
            {RADIUS_OPTIONS.map((r) => {
              const active = radius === r;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRadius(r)}
                  className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {r} km
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="label">
            Types d'activités{' '}
            <span className="text-slate-400 font-normal">
              (vide = tous types)
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            {ACTIVITY_TYPES.map((t) => {
              const active = types.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleType(t.id)}
                  className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
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
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={rainyOnly}
              onChange={(e) => setRainyOnly(e.target.checked)}
            />
            🌧️ Adapté temps de pluie (indoor uniquement)
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={withKids}
              onChange={(e) => setWithKids(e.target.checked)}
            />
            👨‍👩‍👧 Avec enfants
          </label>
        </div>

        <div className="flex justify-end pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={() => runSearch(false)}
            disabled={loading}
            className="btn-primary"
          >
            {loading ? 'Recherche en cours…' : '🔍 Trouver 10 activités'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Barre d'actions flottante quand sélection */}
      {selectedCount > 0 && !loading && !building && (
        <div className="sticky top-16 z-20 rounded-xl border-2 border-brand-300 bg-white shadow-glow p-3 flex items-center justify-between gap-3">
          <span className="text-sm text-slate-700">
            <strong>{selectedCount}</strong> activité(s) sélectionnée(s)
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSelected({})}
              className="text-xs text-slate-500 hover:underline"
            >
              Tout désélectionner
            </button>
            <button
              type="button"
              onClick={buildDay}
              className="btn-primary text-sm"
            >
              ✨ Construire ma journée
            </button>
          </div>
        </div>
      )}

      {building && (
        <div className="card text-center py-10">
          <div className="text-3xl mb-3">✨</div>
          <p className="text-slate-700 font-medium">
            On assemble ta journée…
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Horaires, repas, trajets — ça prend ~30 secondes.
          </p>
        </div>
      )}

      {/* Résultats */}
      {!loading && !building && activities.length > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {activities.map((a) => (
              <ActivityCard
                key={a.id || a.title}
                activity={a}
                selected={!!selected[a.id]}
                onToggleSelect={() => toggleSelect(a.id)}
                wishlisted={!!wishlistAdded[a.title]}
                onAddWishlist={() => addToWishlist(a)}
              />
            ))}
          </div>

          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => runSearch(true)}
              disabled={loadingMore}
              className="btn-secondary"
            >
              {loadingMore ? 'Chargement…' : '+ Charger 10 de plus'}
            </button>
          </div>
        </>
      )}

      {loading && (
        <div className="card text-center py-10">
          <div className="text-3xl mb-3">🧭</div>
          <p className="text-slate-700 font-medium">
            On cherche autour de {location}…
          </p>
          <p className="text-xs text-slate-500 mt-1">~15 secondes</p>
        </div>
      )}

      {/* Aucun résultat : on l'indique clairement plutôt que de cacher.
          C'est mieux que d'inventer (cf. retour utilisateur). */}
      {!loading && hasSearched && activities.length === 0 && (
        <div className="card text-center py-10">
          <div className="text-3xl mb-3">🔍</div>
          <p className="text-slate-700 font-medium">
            Aucune activité réelle trouvée dans ce rayon.
          </p>
          <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
            Essaie d'élargir le rayon, de changer les types d'activités ou de préciser
            une ville plus connue à proximité. On préfère ne rien afficher que de
            t'inventer des lieux qui n'existent pas.
          </p>
        </div>
      )}
    </div>
  );
}

function ActivityCard({
  activity,
  selected,
  onToggleSelect,
  wishlisted,
  onAddWishlist,
}) {
  const a = activity;
  return (
    <div
      className={`card transition-all ${
        selected
          ? 'ring-2 ring-brand-500 border-brand-300 bg-brand-50/30'
          : 'hover:border-slate-300'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-600">
              {a.type}
            </span>
            {a.indoor && (
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] text-blue-700">
                🏠 Indoor
              </span>
            )}
            {typeof a.distance_km === 'number' && (
              <span className="text-[10px] text-slate-500">
                · {a.distance_km} km
              </span>
            )}
            {a.rating && (
              <span
                className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-800 font-medium"
                title={`${a.user_ratings_count || 0} avis Google`}
              >
                ⭐ {a.rating}
                {a.user_ratings_count
                  ? ` (${formatCount(a.user_ratings_count)})`
                  : ''}
              </span>
            )}
          </div>
          <h3 className="font-semibold text-slate-900 leading-tight">
            {a.title}
          </h3>
          {a.hook && (
            <p className="text-sm text-slate-600 italic mt-1">{a.hook}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onToggleSelect}
          className={`shrink-0 w-8 h-8 rounded-full border flex items-center justify-center text-lg transition-colors ${
            selected
              ? 'bg-brand-600 border-brand-600 text-white'
              : 'bg-white border-slate-300 text-slate-400 hover:border-brand-400'
          }`}
          aria-label={selected ? 'Désélectionner' : 'Sélectionner'}
        >
          {selected ? '✓' : '+'}
        </button>
      </div>

      {a.description && (
        <p className="text-sm text-slate-700 mt-3">{a.description}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
        {a.duration && <span>⏱️ {a.duration}</span>}
        {(a.price_note || a.price_eur_per_person !== undefined) && (
          <span>
            💰 {a.price_note || `${a.price_eur_per_person} €/pers`}
          </span>
        )}
        {a.best_time && <span>🕒 {a.best_time}</span>}
      </div>

      {a.address && (
        <p className="text-xs text-slate-500 mt-1">📍 {a.address}</p>
      )}

      {/* Liens cliquables : Maps + Site + Réservation */}
      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href={buildMapsUrl(a)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md bg-slate-100 hover:bg-slate-200 px-2.5 py-1 text-xs text-slate-700 transition-colors"
        >
          📍 Maps
        </a>
        <a
          href={buildSiteSearchUrl(a)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md bg-slate-100 hover:bg-slate-200 px-2.5 py-1 text-xs text-slate-700 transition-colors"
        >
          🔗 Site
        </a>
        {a.booking_hint && (
          <a
            href={buildBookingUrl(a)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md bg-coral-50 hover:bg-coral-100 px-2.5 py-1 text-xs text-coral-700 transition-colors"
            title={a.booking_hint}
          >
            🎟️ Réserver
          </a>
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-slate-100 flex justify-end">
        <button
          type="button"
          onClick={onAddWishlist}
          disabled={wishlisted}
          className={`text-xs ${
            wishlisted
              ? 'text-emerald-700 cursor-default'
              : 'text-brand-700 hover:underline'
          }`}
        >
          {wishlisted ? '⭐ Ajouté à la wishlist' : '⭐ + Wishlist'}
        </button>
      </div>
    </div>
  );
}

// === Helpers liens externes ===
// Priorité : URL Google Places officielle si dispo (renvoyée par Places API),
// sinon fallback recherche.
function buildMapsUrl(a) {
  if (a.google_maps_url) return a.google_maps_url;
  if (a.coordinates?.lat && a.coordinates?.lng) {
    const q = encodeURIComponent(a.title || '');
    return `https://www.google.com/maps/search/?api=1&query=${q}&center=${a.coordinates.lat},${a.coordinates.lng}`;
  }
  const q = encodeURIComponent(`${a.title || ''} ${a.address || ''}`.trim());
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

// Site officiel : si Google Places nous a donné le vrai site (websiteUri),
// on l'utilise. Sinon fallback recherche Google.
function buildSiteSearchUrl(a) {
  if (a.website_url) return a.website_url;
  const q = encodeURIComponent(
    `${a.title || ''} ${a.address || ''} site officiel`.trim()
  );
  return `https://www.google.com/search?q=${q}`;
}

// Réservation : on cherche le titre + le hint donné par le LLM (souvent
// "GetYourGuide", "Tiqets", "Viator"…) sur Google.
function buildBookingUrl(a) {
  const q = encodeURIComponent(
    `${a.title || ''} ${a.booking_hint || 'réservation billetterie'}`.trim()
  );
  return `https://www.google.com/search?q=${q}`;
}

// Format compact des grands nombres d'avis : 1234 → "1.2k"
function formatCount(n) {
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
  return String(n);
}
