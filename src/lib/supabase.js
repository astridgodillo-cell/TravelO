import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY doivent être définis dans .env'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user;
}

export async function signUpWithEmail(email, password) {
  return supabase.auth.signUp({ email, password });
}

export async function signInWithEmail(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function saveItinerary(payload) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Utilisateur non connecté');
  return supabase
    .from('itineraries')
    .insert({ ...payload, user_id: user.id })
    .select()
    .single();
}

export async function listItineraries() {
  const user = await getCurrentUser();
  if (!user) return { data: [], error: null };
  return supabase
    .from('itineraries')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
}

export async function getItinerary(id) {
  return supabase.from('itineraries').select('*').eq('id', id).single();
}

export async function deleteItinerary(id) {
  return supabase.from('itineraries').delete().eq('id', id);
}
