import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext({
  user: null,
  profile: null,
  loading: true,
  refreshProfile: async () => {},
});

const PROFILE_TIMEOUT_MS = 10000;

async function loadProfile(userId) {
  if (!userId) return null;
  try {
    const result = await Promise.race([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      new Promise((resolve) =>
        setTimeout(
          () => resolve({ data: null, error: { message: 'timeout' } }),
          PROFILE_TIMEOUT_MS
        )
      ),
    ]);
    if (result?.error) {
      console.warn('[auth] loadProfile error', result.error);
      return null;
    }
    return result?.data ?? null;
  } catch (e) {
    console.error('[auth] loadProfile crashed', e);
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);

  const refreshProfile = useCallback(async () => {
    if (!user) {
      setProfile(null);
      return;
    }
    setProfileLoading(true);
    const p = await loadProfile(user.id);
    setProfile(p);
    setProfileLoading(false);
  }, [user]);

  // Effet 1 : suit l'état d'auth (session). Synchrone, jamais bloquant.
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;
        setUser(data.session?.user ?? null);
      } catch (e) {
        console.error('[auth] getSession failed', e);
      } finally {
        if (mounted) setAuthLoading(false);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Effet 2 : recharge le profil UNIQUEMENT quand l'identité change
  // (pas sur les token refresh, qui réémettent le même user.id).
  useEffect(() => {
    let active = true;
    if (!user?.id) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }
    setProfileLoading(true);
    loadProfile(user.id).then((p) => {
      if (active) {
        // Si le chargement a réussi (profil non null), on l'enregistre.
        // Sinon (timeout / erreur), on garde l'ancien profil pour éviter
        // de faire perdre l'admin/approved à l'utilisateur en cas d'un seul
        // hoquet réseau.
        if (p) setProfile(p);
        setProfileLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [user?.id]);

  const loading = authLoading || (!!user && profileLoading && !profile);
  const isAdmin = profile?.role === 'admin';
  const isApproved = profile?.status === 'approved';

  return (
    <AuthContext.Provider
      value={{ user, profile, loading, isAdmin, isApproved, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
