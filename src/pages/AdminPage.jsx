import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  adminListUsers,
  adminUpdateUser,
  adminListAllItineraries,
  adminGetStats,
  getAppConfig,
  setAppConfig,
} from '../lib/supabase';
import { costEur } from '../lib/ai';
import PageHeader from '../components/PageHeader';
import Icon from '../components/Icon';

const STATUS_FILTERS = [
  { id: 'all', label: 'Tous' },
  { id: 'pending', label: 'En attente' },
  { id: 'approved', label: 'Approuvés' },
  { id: 'rejected', label: 'Rejetés' },
  { id: 'suspended', label: 'Suspendus' },
];

const STATUS_BADGES = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
  suspended: 'bg-slate-200 text-slate-700',
};

const TIER_OPTIONS = ['free', 'pro', 'illimited'];

const BACKEND_OPTIONS = [
  { id: 'gemini', label: 'Gemini 2.5 Flash', dot: 'bg-emerald-500', hint: 'Le moins cher après DeepSeek. Quota élevé. Recommandé par défaut.' },
  { id: 'deepseek', label: 'DeepSeek Chat', dot: 'bg-blue-500', hint: 'Le moins cher (~5× moins que Claude). Qualité narrative légèrement inférieure.' },
  { id: 'claude', label: 'Claude Sonnet + Haiku', dot: 'bg-orange-500', hint: 'Meilleure qualité narrative. Plus cher, quotas plus stricts.' },
];

const FLIGHT_PROVIDER_OPTIONS = [
  { id: 'travelpayouts', label: 'Aviasales (Travelpayouts)', dot: 'bg-sky-500', hint: 'Affiliation Aviasales. Bon pour les long-courriers. Deeplink réservation Aviasales.' },
  { id: 'duffel', label: 'Duffel', dot: 'bg-fuchsia-500', hint: 'API moderne 300+ compagnies. Prix temps réel en EUR. Bouton de comparaison Google Flights.' },
];

const TABS = [
  { id: 'users', label: 'Utilisateurs', icon: 'users' },
  { id: 'trips', label: 'Tous les itinéraires', icon: 'plane' },
];

export default function AdminPage() {
  const [tab, setTab] = useState('users');
  const [filter, setFilter] = useState('pending');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [backend, setBackend] = useState(null);
  const [backendBusy, setBackendBusy] = useState(false);
  const [flightProvider, setFlightProvider] = useState(null);
  const [flightProviderBusy, setFlightProviderBusy] = useState(false);
  const [stats, setStats] = useState(null);
  const [allTrips, setAllTrips] = useState([]);
  const [tripsLoading, setTripsLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    const { data, error } = await adminListUsers(
      filter === 'all' ? {} : { status: filter }
    );
    if (error) setError(error.message);
    else setUsers(data || []);
    setLoading(false);
  }

  async function refreshStats() {
    const s = await adminGetStats();
    setStats(s);
  }

  async function refreshBackend() {
    const { value } = await getAppConfig('llm_backend');
    setBackend(value || 'gemini');
  }

  async function refreshFlightProvider() {
    const { value } = await getAppConfig('flight_provider');
    setFlightProvider(value || 'travelpayouts');
  }

  async function refreshAllTrips() {
    setTripsLoading(true);
    const { data, error } = await adminListAllItineraries();
    if (error) setError(error.message);
    else setAllTrips(data || []);
    setTripsLoading(false);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    refreshStats();
    refreshBackend();
    refreshFlightProvider();
  }, []);

  useEffect(() => {
    if (tab === 'trips') refreshAllTrips();
  }, [tab]);

  async function patchUser(userId, p) {
    setBusyId(userId);
    setError(null);
    const { error } = await adminUpdateUser(userId, p);
    if (error) setError(error.message);
    else await Promise.all([refresh(), refreshStats()]);
    setBusyId(null);
  }

  async function changeBackend(newBackend) {
    if (newBackend === backend) return;
    setBackendBusy(true);
    setError(null);
    const { error } = await setAppConfig('llm_backend', newBackend);
    if (error) setError(error.message);
    else setBackend(newBackend);
    setBackendBusy(false);
  }

  async function changeFlightProvider(newProvider) {
    if (newProvider === flightProvider) return;
    setFlightProviderBusy(true);
    setError(null);
    const { error } = await setAppConfig('flight_provider', newProvider);
    if (error) setError(error.message);
    else setFlightProvider(newProvider);
    setFlightProviderBusy(false);
  }

  const counts = useMemo(() => {
    const c = { all: users.length };
    for (const u of users) c[u.status] = (c[u.status] || 0) + 1;
    return c;
  }, [users]);

  const totalAiEur = costEur(stats?.ai?.total_cost_usd);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        eyebrowColor="slate"
        title="Tableau de bord admin"
        description="Gestion des utilisateurs, backend LLM, bibliothèque de modèles et stats globales."
      />

      {/* Paramètres globaux : choix du backend LLM */}
      <section className="card">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-3 inline-flex items-center gap-1.5">
          <Icon name="settings" className="h-4 w-4" />
          Backend LLM utilisé par tous les utilisateurs
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {BACKEND_OPTIONS.map((b) => {
            const active = backend === b.id;
            return (
              <button
                key={b.id}
                onClick={() => changeBackend(b.id)}
                disabled={backendBusy}
                className={`rounded-xl border p-3 text-left transition-all ${
                  active
                    ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <span className={`h-2 w-2 rounded-full ${b.dot}`} />
                  {b.label}
                </div>
                <div className="text-xs text-slate-500 mt-1">{b.hint}</div>
                {active && (
                  <div className="text-xs text-brand-700 mt-1 font-medium inline-flex items-center gap-1">
                    <Icon name="check" className="h-3 w-3" />
                    Actif
                  </div>
                )}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-slate-500 mt-3">
          Le changement prend effet sous 60 secondes (cache Edge Function). La
          clé API du backend choisi doit être configurée dans Supabase Secrets :{' '}
          <code className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded">
            GEMINI_API_KEY
          </code>{' '}
          /{' '}
          <code className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded">
            DEEPSEEK_API_KEY
          </code>{' '}
          /{' '}
          <code className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded">
            ANTHROPIC_API_KEY
          </code>
          .
        </p>
      </section>

      {/* Paramètres globaux : choix du fournisseur de vols */}
      <section className="card">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-3 inline-flex items-center gap-1.5">
          <Icon name="plane" className="h-4 w-4" />
          Fournisseur de vols (recherche prix + horaires réels)
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {FLIGHT_PROVIDER_OPTIONS.map((b) => {
            const active = flightProvider === b.id;
            return (
              <button
                key={b.id}
                onClick={() => changeFlightProvider(b.id)}
                disabled={flightProviderBusy}
                className={`rounded-xl border p-3 text-left transition-all ${
                  active
                    ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <span className={`h-2 w-2 rounded-full ${b.dot}`} />
                  {b.label}
                </div>
                <div className="text-xs text-slate-500 mt-1">{b.hint}</div>
                {active && (
                  <div className="text-xs text-brand-700 mt-1 font-medium inline-flex items-center gap-1">
                    <Icon name="check" className="h-3 w-3" />
                    Actif
                  </div>
                )}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-slate-500 mt-3">
          Effectif sous 15 secondes. Si le fournisseur choisi n'a pas sa clé
          configurée dans Supabase Secrets (
          <code className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded">
            TRAVELPAYOUTS_TOKEN
          </code>
          {' / '}
          <code className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded">
            TRAVELPAYOUTS_MARKER
          </code>
          {' '}ou{' '}
          <code className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded">
            DUFFEL_API_TOKEN
          </code>
          ), TravelO bascule automatiquement sur l'autre.
        </p>
      </section>

      {/* Statistiques globales */}
      {stats && (
        <section className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label="Utilisateurs"
            value={stats.users.total}
            detail={`${stats.users.approved} approuvés · ${stats.users.pending} en attente`}
          />
          <StatCard
            label="Itinéraires"
            value={stats.trips.total}
            detail={`${stats.trips.this_month} ce mois · ${stats.trips.templates} modèles`}
          />
          <StatCard
            label="Tokens IA"
            value={`${((stats.ai.total_input_tokens + stats.ai.total_output_tokens) / 1000).toFixed(0)}k`}
            detail={`${(stats.ai.total_input_tokens / 1000).toFixed(0)}k in · ${(stats.ai.total_output_tokens / 1000).toFixed(0)}k out`}
          />
          <StatCard
            label="Coût IA cumulé"
            value={
              totalAiEur != null
                ? totalAiEur.toLocaleString('fr-FR', {
                    style: 'currency',
                    currency: 'EUR',
                    maximumFractionDigits: 2,
                  })
                : '—'
            }
            detail={
              Object.keys(stats.ai.models_count).length > 0
                ? Object.entries(stats.ai.models_count)
                    .map(([m, n]) => `${m.split('-')[0]}×${n}`)
                    .join(' · ')
                : 'Aucun appel'
            }
          />
        </section>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Tabs */}
      <nav className="-mx-4 sm:mx-0 overflow-x-auto scrollbar-hide">
        <div className="flex gap-1 border-b border-slate-200 px-4 sm:px-0 sm:flex-wrap min-w-max sm:min-w-0">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 text-sm font-medium rounded-t-md border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                tab === t.id
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Icon name={t.icon} className="h-4 w-4" />
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {tab === 'users' && (
        <UsersTab
          filter={filter}
          setFilter={setFilter}
          users={users}
          counts={counts}
          loading={loading}
          busyId={busyId}
          patchUser={patchUser}
        />
      )}

      {tab === 'trips' && (
        <AllTripsTab trips={allTrips} loading={tripsLoading} />
      )}
    </div>
  );
}

function StatCard({ label, value, detail }) {
  return (
    <div className="card">
      <div className="text-[10px] uppercase tracking-widest text-slate-400">
        {label}
      </div>
      <div className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
        {value}
      </div>
      <div className="text-xs text-slate-500 mt-0.5 truncate" title={detail}>
        {detail}
      </div>
    </div>
  );
}

function UsersTab({ filter, setFilter, users, counts, loading, busyId, patchUser }) {
  return (
    <>
      <nav className="flex flex-wrap gap-1 border-b border-slate-200">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-4 py-2 text-sm font-medium rounded-t-md border-b-2 transition-colors ${
              filter === f.id
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {f.label}
            {counts[f.id === 'all' ? 'all' : f.id] != null && (
              <span className="ml-2 text-xs text-slate-400">
                {counts[f.id === 'all' ? 'all' : f.id]}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="card p-0 overflow-x-auto">
        {loading ? (
          <p className="text-slate-500 p-6">Chargement…</p>
        ) : users.length === 0 ? (
          <p className="text-slate-500 p-6">Aucun utilisateur.</p>
        ) : (
          <table className="w-full text-sm min-w-[760px]">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="text-left px-4 py-3">Email</th>
                <th className="text-left px-4 py-3">Inscription</th>
                <th className="text-left px-4 py-3">Statut</th>
                <th className="text-left px-4 py-3">Tier</th>
                <th className="text-left px-4 py-3">Itinéraires</th>
                <th className="text-left px-4 py-3">Rôle</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const busy = busyId === u.id;
                return (
                  <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{u.email}</div>
                      {u.full_name && (
                        <div className="text-xs text-slate-500">{u.full_name}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {formatDate(u.signed_up_at)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          STATUS_BADGES[u.status] || 'bg-slate-100'
                        }`}
                      >
                        {u.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        disabled={busy}
                        value={u.subscription_tier}
                        onChange={(e) =>
                          patchUser(u.id, { subscription_tier: e.target.value })
                        }
                        className="input py-1 text-xs"
                      >
                        {TIER_OPTIONS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {u.itineraries_count}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          u.role === 'admin'
                            ? 'bg-purple-100 text-purple-800'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-1">
                        {u.status !== 'approved' && (
                          <button
                            disabled={busy}
                            onClick={() => patchUser(u.id, { status: 'approved' })}
                            className="text-xs px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            Approuver
                          </button>
                        )}
                        {u.status !== 'rejected' && (
                          <button
                            disabled={busy}
                            onClick={() => patchUser(u.id, { status: 'rejected' })}
                            className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50"
                          >
                            Refuser
                          </button>
                        )}
                        {u.status === 'approved' && (
                          <button
                            disabled={busy}
                            onClick={() => patchUser(u.id, { status: 'suspended' })}
                            className="text-xs px-2 py-1 rounded bg-slate-200 text-slate-700 hover:bg-slate-300 disabled:opacity-50"
                          >
                            Suspendre
                          </button>
                        )}
                        {u.role === 'user' ? (
                          <button
                            disabled={busy}
                            onClick={() => patchUser(u.id, { role: 'admin' })}
                            className="text-xs px-2 py-1 rounded bg-purple-100 text-purple-700 hover:bg-purple-200 disabled:opacity-50"
                          >
                            ↑ Admin
                          </button>
                        ) : (
                          <button
                            disabled={busy}
                            onClick={() => patchUser(u.id, { role: 'user' })}
                            className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                          >
                            ↓ User
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function AllTripsTab({ trips, loading }) {
  return (
    <div className="card p-0 overflow-x-auto">
      {loading ? (
        <p className="text-slate-500 p-6">Chargement…</p>
      ) : trips.length === 0 ? (
        <p className="text-slate-500 p-6">Aucun itinéraire pour l'instant.</p>
      ) : (
        <table className="w-full text-sm min-w-[760px]">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="text-left px-4 py-3">Titre</th>
              <th className="text-left px-4 py-3">Créé le</th>
              <th className="text-left px-4 py-3">Durée</th>
              <th className="text-left px-4 py-3">Coût IA</th>
              <th className="text-left px-4 py-3">Statut</th>
              <th className="text-right px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {trips.map((t) => {
              const meta = t.itinerary?.metadata;
              const eur = costEur(meta?.total_cost_usd);
              return (
                <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800 truncate max-w-xs">
                      {t.title}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {formatDate(t.created_at)}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {t.itinerary?.summary?.duration_days
                      ? `${t.itinerary.summary.duration_days} j`
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-700 tabular-nums">
                    {eur != null
                      ? eur.toLocaleString('fr-FR', {
                          style: 'currency',
                          currency: 'EUR',
                          maximumFractionDigits: 3,
                          minimumFractionDigits: 2,
                        })
                      : '—'}
                  </td>
                  <td className="px-4 py-3 space-x-1">
                    {t.is_template && (
                      <span className="chip bg-purple-100 text-purple-700">
                        <Icon name="book" className="inline h-3 w-3 mr-1" />
                        Modèle
                      </span>
                    )}
                    {t.is_public && (
                      <span className="chip bg-emerald-100 text-emerald-700">
                        Public
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/itineraire/${t.id}`}
                      className="text-xs text-brand-700 hover:underline"
                    >
                      Ouvrir →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function formatDate(s) {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return s;
  }
}
