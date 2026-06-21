import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  supabase,
  getIncomingPendingShares,
  respondToShare,
  getIncomingPendingItineraryShares,
  respondToItineraryShare,
  getIncomingPendingAlbumShares,
  respondToAlbumShare,
} from '../lib/supabase';

// Affiché globalement (au-dessus de toute l'appli) pour l'utilisateur connecté.
// Gère le partage des LISTES et des ITINÉRAIRES :
// - Fenêtre quand quelqu'un veut partager (Accepter/Refuser).
// - Fenêtre à l'initiateur quand sa proposition est acceptée/refusée.
//
// Chaque invitation porte un "kind" ('list' | 'itinerary') et un "name"
// d'affichage, pour adapter le texte de la fenêtre.
export default function ShareNotifications() {
  const { user } = useAuth();
  const [incoming, setIncoming] = useState([]); // invitations reçues (pending)
  const [response, setResponse] = useState(null); // réponse reçue (initiateur)
  const [busy, setBusy] = useState(false);

  const wordFor = (kind) =>
    kind === 'itinerary' ? 'le voyage' : kind === 'album' ? "l'album" : 'la liste';

  // Charge les invitations en attente (listes + itinéraires) à l'ouverture.
  useEffect(() => {
    let active = true;
    (async () => {
      if (!user?.id) {
        if (active) setIncoming([]);
        return;
      }
      const [lists, itins, albums] = await Promise.all([
        getIncomingPendingShares(),
        getIncomingPendingItineraryShares(),
        getIncomingPendingAlbumShares(),
      ]);
      if (!active) return;
      const a = (lists.data || []).map((r) => ({ ...r, kind: 'list', name: r.list_name }));
      const b = (itins.data || []).map((r) => ({ ...r, kind: 'itinerary', name: r.title }));
      const c = (albums.data || []).map((r) => ({ ...r, kind: 'album', name: r.album_title }));
      setIncoming([...a, ...b, ...c]);
    })();
    return () => {
      active = false;
    };
  }, [user?.id]);

  // Écoute en temps réel les nouvelles invitations et les réponses.
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`share-notifs-${user.id}`)
      // Invitations de LISTES reçues
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'list_shares',
          filter: `recipient_id=eq.${user.id}`,
        },
        (payload) => addIncoming(payload.new, 'list')
      )
      // Réponses à mes propositions de LISTES
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'list_shares',
          filter: `owner_id=eq.${user.id}`,
        },
        (payload) => showResponse(payload.new, 'list')
      )
      // Invitations d'ITINÉRAIRES reçues
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'itinerary_shares',
          filter: `recipient_id=eq.${user.id}`,
        },
        (payload) => addIncoming(payload.new, 'itinerary')
      )
      // Réponses à mes propositions d'ITINÉRAIRES
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'itinerary_shares',
          filter: `owner_id=eq.${user.id}`,
        },
        (payload) => showResponse(payload.new, 'itinerary')
      )
      // Invitations d'ALBUMS reçues
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'album_shares',
          filter: `recipient_id=eq.${user.id}`,
        },
        (payload) => addIncoming(payload.new, 'album')
      )
      // Réponses à mes propositions d'ALBUMS
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'album_shares',
          filter: `owner_id=eq.${user.id}`,
        },
        (payload) => showResponse(payload.new, 'album')
      )
      .subscribe();

    const nameOf = (row, kind) =>
      kind === 'itinerary' ? row.title : kind === 'album' ? row.album_title : row.list_name;

    function addIncoming(row, kind) {
      if (row?.status !== 'pending') return;
      const name = nameOf(row, kind);
      setIncoming((prev) =>
        prev.some((s) => s.id === row.id)
          ? prev
          : [{ ...row, kind, name }, ...prev]
      );
    }
    function showResponse(row, kind) {
      if (row?.status === 'accepted' || row?.status === 'refused') {
        setResponse({ ...row, kind, name: nameOf(row, kind) });
      }
    }

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  async function handleRespond(share, accept) {
    setBusy(true);
    const { error } =
      share.kind === 'itinerary'
        ? await respondToItineraryShare(share.id, accept)
        : share.kind === 'album'
          ? await respondToAlbumShare(share.id, accept)
          : await respondToShare(share.id, accept);
    setBusy(false);
    if (error) {
      alert(error.message);
      return;
    }
    setIncoming((prev) => prev.filter((s) => s.id !== share.id));
    // Prévient les pages concernées de se rafraîchir.
    const evt =
      share.kind === 'itinerary'
        ? 'travelo:itineraries-refresh'
        : share.kind === 'album'
          ? 'travelo:albums-refresh'
          : 'travelo:lists-refresh';
    window.dispatchEvent(new CustomEvent(evt));
  }

  if (!user) return null;

  const current = incoming[0];

  return (
    <>
      {/* Fenêtre : invitation reçue */}
      {current && (
        <Modal>
          <h2 className="text-lg font-semibold text-slate-900">
            {current.kind === 'itinerary'
              ? '🧳 Partage de voyage'
              : current.kind === 'album'
                ? '📷 Partage d’album'
                : '📋 Partage de liste'}
          </h2>
          <p className="mt-2 text-slate-600">
            <span className="font-medium text-slate-900">
              {current.owner_email || 'Un utilisateur'}
            </span>{' '}
            souhaite partager {wordFor(current.kind)} «&nbsp;
            <span className="font-medium text-slate-900">
              {current.name || 'sans nom'}
            </span>
            &nbsp;» avec toi. Vous pourrez le modifier à deux, en direct.
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
            a {response.status === 'accepted' ? 'accepté' : 'refusé'} de partager{' '}
            {wordFor(response.kind)} «&nbsp;
            <span className="font-medium text-slate-900">
              {response.name || 'sans nom'}
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
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl animate-fade-up my-8 mb-[max(2rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>
  );
}
