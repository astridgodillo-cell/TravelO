import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  supabase,
  getIncomingPendingShares,
  respondToShare,
} from '../lib/supabase';

// Affiché globalement (au-dessus de toute l'appli) pour l'utilisateur connecté.
// - Montre une fenêtre quand quelqu'un veut partager une liste (Accepter/Refuser).
// - Montre une fenêtre à l'initiateur quand sa proposition est acceptée/refusée.
export default function ShareNotifications() {
  const { user } = useAuth();
  const [incoming, setIncoming] = useState([]); // invitations reçues (pending)
  const [response, setResponse] = useState(null); // réponse reçue (pour l'initiateur)
  const [busy, setBusy] = useState(false);

  // Charge les invitations en attente à l'ouverture de l'appli.
  useEffect(() => {
    if (!user?.id) {
      setIncoming([]);
      return;
    }
    let active = true;
    getIncomingPendingShares().then(({ data }) => {
      if (active) setIncoming(data || []);
    });
    return () => {
      active = false;
    };
  }, [user?.id]);

  // Écoute en temps réel les nouvelles invitations et les réponses.
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`share-notifs-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'list_shares',
          filter: `recipient_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new;
          if (row?.status === 'pending') {
            setIncoming((prev) =>
              prev.some((s) => s.id === row.id) ? prev : [row, ...prev]
            );
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'list_shares',
          filter: `owner_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new;
          if (row?.status === 'accepted' || row?.status === 'refused') {
            setResponse(row);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  async function handleRespond(share, accept) {
    setBusy(true);
    const { error } = await respondToShare(share.id, accept);
    setBusy(false);
    if (error) {
      alert(error.message);
      return;
    }
    setIncoming((prev) => prev.filter((s) => s.id !== share.id));
    // Prévient la page « Mes listes » de se rafraîchir (la liste apparaît si accepté).
    window.dispatchEvent(new CustomEvent('travelo:lists-refresh'));
  }

  if (!user) return null;

  const current = incoming[0];

  return (
    <>
      {/* Fenêtre : invitation reçue */}
      {current && (
        <Modal>
          <h2 className="text-lg font-semibold text-slate-900">
            📋 Partage de liste
          </h2>
          <p className="mt-2 text-slate-600">
            <span className="font-medium text-slate-900">
              {current.owner_email || 'Un utilisateur'}
            </span>{' '}
            souhaite partager la liste «&nbsp;
            <span className="font-medium text-slate-900">
              {current.list_name || 'sans nom'}
            </span>
            &nbsp;» avec toi. Vous pourrez la modifier à deux, en direct.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={() => handleRespond(current, false)}
              disabled={busy}
              className="btn-secondary"
            >
              Refuser
            </button>
            <button
              onClick={() => handleRespond(current, true)}
              disabled={busy}
              className="btn-primary"
            >
              Accepter
            </button>
          </div>
          {incoming.length > 1 && (
            <p className="mt-3 text-xs text-slate-400">
              + {incoming.length - 1} autre
              {incoming.length - 1 > 1 ? 's' : ''} invitation
              {incoming.length - 1 > 1 ? 's' : ''} en attente
            </p>
          )}
        </Modal>
      )}

      {/* Fenêtre : réponse à ma proposition (pour l'initiateur) */}
      {response && (
        <Modal>
          <h2 className="text-lg font-semibold text-slate-900">
            {response.status === 'accepted'
              ? '✅ Partage accepté'
              : '🚫 Partage refusé'}
          </h2>
          <p className="mt-2 text-slate-600">
            <span className="font-medium text-slate-900">
              {response.recipient_email || 'L\'utilisateur'}
            </span>{' '}
            a {response.status === 'accepted' ? 'accepté' : 'refusé'} de partager
            la liste «&nbsp;
            <span className="font-medium text-slate-900">
              {response.list_name || 'sans nom'}
            </span>
            &nbsp;».
          </p>
          <div className="mt-5 flex justify-end">
            <button onClick={() => setResponse(null)} className="btn-primary">
              OK
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function Modal({ children }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl animate-fade-up">
        {children}
      </div>
    </div>
  );
}
