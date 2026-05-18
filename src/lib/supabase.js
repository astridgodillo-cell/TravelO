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

// ----- AUTH -----
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

// ----- ITINERARIES -----
export async function saveItinerary(payload) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Utilisateur non connecté');
  return supabase
    .from('itineraries')
    .insert({ ...payload, user_id: user.id })
    .select()
    .single();
}

export async function updateItinerary(id, patch) {
  return supabase
    .from('itineraries')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
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

export async function getPublicItinerary(slug) {
  return supabase
    .from('itineraries')
    .select('id, title, preferences, itinerary, public_slug, created_at')
    .eq('public_slug', slug)
    .eq('is_public', true)
    .single();
}

export async function deleteItinerary(id) {
  return supabase.from('itineraries').delete().eq('id', id);
}

export async function setItineraryPublic(id, makePublic) {
  if (makePublic) {
    const { data: slugData, error: slugErr } = await supabase.rpc(
      'generate_short_slug'
    );
    if (slugErr) return { data: null, error: slugErr };
    return supabase
      .from('itineraries')
      .update({ is_public: true, public_slug: slugData })
      .eq('id', id)
      .select()
      .single();
  }
  return supabase
    .from('itineraries')
    .update({ is_public: false })
    .eq('id', id)
    .select()
    .single();
}

// ----- TEMPLATES -----
export async function listTemplates() {
  const user = await getCurrentUser();
  if (!user) return { data: [], error: null };
  return supabase
    .from('preference_templates')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
}

export async function saveTemplate(name, preferences) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Utilisateur non connecté');
  return supabase
    .from('preference_templates')
    .insert({ user_id: user.id, name, preferences })
    .select()
    .single();
}

export async function deleteTemplate(id) {
  return supabase.from('preference_templates').delete().eq('id', id);
}
