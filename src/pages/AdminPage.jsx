import { useEffect, useMemo, useState } from 'react';
import { adminListUsers, adminUpdateUser } from '../lib/supabase';

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

export default function AdminPage() {
  const [filter, setFilter] = useState('pending');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

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

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function patch(userId, p) {
    setBusyId(userId);
    setError(null);
    const { error } = await adminUpdateUser(userId, p);
    if (error) setError(error.message);
    else await refresh();
    setBusyId(null);
  }

  const counts = useMemo(() => {
    const c = { all: users.length };
    for (const u of users) c[u.status] = (c[u.status] || 0) + 1;
    return c;
  }, [users]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          Administration
        </h1>
        <p className="text-sm text-slate-500">
          Gérez les inscriptions, validez ou refusez les comptes et ajustez les
          niveaux d'abonnement.
        </p>
      </div>

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

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="card p-0 overflow-x-auto">
        {loading ? (
          <p className="text-slate-500 p-6">Chargement…</p>
        ) : users.length === 0 ? (
          <p className="text-slate-500 p-6">Aucun utilisateur dans cette catégorie.</p>
        ) : (
          <table className="w-full text-sm">
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
                  <tr
                    key={u.id}
                    className="border-t border-slate-100 hover:bg-slate-50"
                  >
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
                          patch(u.id, { subscription_tier: e.target.value })
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
                            onClick={() => patch(u.id, { status: 'approved' })}
                            className="text-xs px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            Approuver
                          </button>
                        )}
                        {u.status !== 'rejected' && (
                          <button
                            disabled={busy}
                            onClick={() => patch(u.id, { status: 'rejected' })}
                            className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50"
                          >
                            Refuser
                          </button>
                        )}
                        {u.status === 'approved' && (
                          <button
                            disabled={busy}
                            onClick={() => patch(u.id, { status: 'suspended' })}
                            className="text-xs px-2 py-1 rounded bg-slate-200 text-slate-700 hover:bg-slate-300 disabled:opacity-50"
                          >
                            Suspendre
                          </button>
                        )}
                        {u.role === 'user' ? (
                          <button
                            disabled={busy}
                            onClick={() => patch(u.id, { role: 'admin' })}
                            className="text-xs px-2 py-1 rounded bg-purple-100 text-purple-700 hover:bg-purple-200 disabled:opacity-50"
                          >
                            ↑ Admin
                          </button>
                        ) : (
                          <button
                            disabled={busy}
                            onClick={() => patch(u.id, { role: 'user' })}
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
