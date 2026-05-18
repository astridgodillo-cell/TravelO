import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext({
  user: null,
  profile: null,
  loading: true,
  refreshProfile: async () => {},
});

async function loadProfile(userId) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    console.warn('[auth] loadProfile error', error);
    return null;
  }
  return data;
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
    (async () => {
      const { data } = await supabase.auth.getSession();
      const sessUser = data.session?.user ?? null;
      if (!mounted) return;
      setUser(sessUser);
      if (sessUser) {
        const p = await loadProfile(sessUser.id);
        if (!mounted) return;
        setProfile(p);
      }
      setLoading(false);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        const p = await loadProfile(u.id);
        setProfile(p);
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return () => {
      mounted = false;
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
