import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { signOut } from '../lib/supabase';

const STATUS_MESSAGES = {
  pending: {
    title: 'Votre compte est en attente d\'approbation',
    body: 'Merci pour votre inscription ! Un administrateur va examiner votre demande et vous donner accès à TravelO. Vous pouvez fermer cette page — vous recevrez une notification (ou retentez plus tard).',
    tone: 'amber',
  },
  rejected: {
    title: 'Votre compte a été refusé',
    body: 'L\'administrateur a refusé l\'accès à votre compte. Si vous pensez qu\'il s\'agit d\'une erreur, contactez l\'équipe TravelO.',
    tone: 'red',
  },
  suspended: {
    title: 'Votre compte est suspendu',
    body: 'L\'accès à votre compte a été suspendu. Contactez l\'administrateur pour plus d\'informations.',
    tone: 'red',
  },
};

const toneClasses = {
  amber: 'border-amber-200 bg-amber-50 text-amber-900',
  red: 'border-red-200 bg-red-50 text-red-900',
};

export default function PendingAccountPage() {
  const { user, profile, loading, refreshProfile } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate('/connexion', { replace: true });
    } else if (!loading && profile?.status === 'approved') {
      navigate('/mes-voyages', { replace: true });
    }
  }, [user, profile, loading, navigate]);

  if (loading) return <p className="text-slate-500">Chargement…</p>;

  const status = profile?.status || 'pending';
  const message = STATUS_MESSAGES[status] || STATUS_MESSAGES.pending;

  async function handleSignOut() {
    await signOut();
    navigate('/');
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div
        className={`rounded-lg border p-6 ${toneClasses[message.tone]}`}
      >
        <h1 className="text-xl font-semibold">{message.title}</h1>
        <p className="mt-3 text-sm leading-relaxed">{message.body}</p>
      </div>

      <div className="card text-sm text-slate-600 space-y-2">
        <div>
          <span className="font-medium">Email :</span> {user?.email}
        </div>
        <div>
          <span className="font-medium">Statut :</span>{' '}
          <span className="capitalize">{status}</span>
        </div>
      </div>

      <div className="flex justify-between gap-2">
        <button onClick={refreshProfile} className="btn-secondary">
          Vérifier à nouveau
        </button>
        <button onClick={handleSignOut} className="btn-secondary">
          Se déconnecter
        </button>
      </div>
    </div>
  );
}
