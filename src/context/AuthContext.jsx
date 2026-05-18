import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext({
  user: null,
  profile: null,
  loading: true,
  refreshProfile: async () => {},
});

const PROFILE_TIMEOUT_MS = 5000;
const AUTH_SAFETY_TIMEOUT_MS = 8000;

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
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    if (!user) {
      setProfile(null);
      return;
    }
    const p = await loadProfile(user.id);
    setProfile(p);
  }, [user]);

  useEffect(() => {
    let mounted = true;

    // Garde-fou : on ne reste JAMAIS bloqué en loading plus de N secondes,
    // même si une requête réseau hang silencieusement.
    const safetyTimer = setTimeout(() => {
      if (mounted) {
        console.warn('[auth] safety timeout — forcing loading=false');
        setLoading(false);
      }
    }, AUTH_SAFETY_TIMEOUT_MS);

    async function applySession(session) {
      const u = session?.user ?? null;
      if (mounted) setUser(u);
      if (u) {
        const p = await loadProfile(u.id);
        if (mounted) setProfile(p);
      } else if (mounted) {
        setProfile(null);
      }
      if (mounted) setLoading(false);
    }

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        await applySession(data.session);
      } catch (e) {
        console.error('[auth] getSession failed', e);
        if (mounted) setLoading(false);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted) return;
      await applySession(session);
    });

    return () => {
      mounted = false;
      clearTimeout(safetyTimer);
      sub.subscription.unsubscribe();
    };
  }, []);

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
