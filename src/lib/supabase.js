import { createClient } from '@supabase/supabase-js';

const rawUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!rawUrl || !supabaseAnonKey) {
  throw new Error(
    'VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY doivent être définis dans .env'
  );
}

// Tolère un /rest/v1, /auth/v1, /functions/v1 ou un slash final dans l'URL.
const supabaseUrl = rawUrl
  .replace(/\/(rest|auth|functions|storage|realtime)\/v\d+\/?$/, '')
  .replace(/\/+$/, '');

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

export async function signInWithGoogle(redirectPath = '/') {
  const redirectTo = `${window.location.origin}${redirectPath}`;
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  });
}

export async function signOut() {
  return supabase.auth.signOut();
}

// ----- PROFILE (du user courant) -----
export async function getMyProfile() {
  const user = await getCurrentUser();
  if (!user) return { data: null, error: null };
  return supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
}

// Patch sur les champs éditables par le user lui-même.
// Le trigger SQL protect_admin_fields empêche déjà toute modification
// de role/status/subscription_tier côté DB, donc on peut passer
// n'importe quel patch sans risque.
export async function updateMyProfile(patch) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Utilisateur non connecté');
  return supabase
    .from('profiles')
    .update(patch)
    .eq('id', user.id)
    .select()
    .single();
}

// ----- TRAVELERS (carnet de voyageurs récurrents) -----
export async function listTravelers() {
  const user = await getCurrentUser();
  if (!user) return { data: [], error: null };
  return supabase
    .from('travelers')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });
}

export async function saveTraveler(traveler) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Utilisateur non connecté');
  return supabase
    .from('travelers')
    .insert({ ...traveler, user_id: user.id })
    .select()
    .single();
}

export async function updateTraveler(id, patch) {
  return supabase
    .from('travelers')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
}

export async function deleteTraveler(id) {
  return supabase.from('travelers').delete().eq('id', id);
}

// Définir un persona par défaut : on désactive tous les autres puis on active celui-là.
// L'index unique partiel garantit qu'il n'y a jamais plus d'un is_default=true par user.
export async function setDefaultTemplate(id) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Utilisateur non connecté');
  const { error: clearErr } = await supabase
    .from('preference_templates')
    .update({ is_default: false })
    .eq('user_id', user.id)
    .eq('is_default', true);
  if (clearErr) return { data: null, error: clearErr };
  return supabase
    .from('preference_templates')
    .update({ is_default: true })
    .eq('id', id)
    .select()
    .single();
}

export async function updateTemplate(id, patch) {
  return supabase
    .from('preference_templates')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
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

// ----- PERSONAL PACKING LISTS -----
export async function listPackingLists() {
  const user = await getCurrentUser();
  if (!user) return { data: [], error: null };
  return supabase
    .from('user_packing_lists')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
}

export async function savePackingList(name, items) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Utilisateur non connecté');
  return supabase
    .from('user_packing_lists')
    .insert({ user_id: user.id, name, items })
    .select()
    .single();
}

export async function updatePackingList(id, patch) {
  return supabase
    .from('user_packing_lists')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
}

export async function deletePackingList(id) {
  return supabase.from('user_packing_lists').delete().eq('id', id);
}

// ----- TEMPLATES (modèles d'itinéraires publics) -----
export async function listTemplateItineraries() {
  return supabase
    .from('itineraries')
    .select('id, title, preferences, itinerary, template_category, template_description, created_at')
    .eq('is_template', true)
    .order('created_at', { ascending: false });
}

export async function getTemplateItinerary(id) {
  return supabase
    .from('itineraries')
    .select('id, title, preferences, itinerary, template_category, template_description, created_at')
    .eq('id', id)
    .eq('is_template', true)
    .maybeSingle();
}

export async function setItineraryAsTemplate(id, patch) {
  // patch = { is_template, template_category, template_description }
  return supabase
    .from('itineraries')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
}

// ----- ADMIN -----
export async function adminListUsers({ status } = {}) {
  let q = supabase
    .from('admin_users_overview')
    .select('*')
    .order('signed_up_at', { ascending: false });
  if (status) q = q.eq('status', status);
  return q;
}

export async function adminUpdateUser(userId, patch) {
  const user = await getCurrentUser();
  const update = { ...patch };
  if (patch.status === 'approved' && !update.approved_at) {
    update.approved_at = new Date().toISOString();
    update.approved_by = user?.id || null;
  }
  return supabase
    .from('profiles')
    .update(update)
    .eq('id', userId)
    .select()
    .single();
}

// Configuration globale (lecture/écriture admin)
export async function getAppConfig(key) {
  const { data, error } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) return { value: null, error };
  return { value: data?.value ?? null, error: null };
}

export async function setAppConfig(key, value) {
  const user = await getCurrentUser();
  return supabase
    .from('app_config')
    .upsert(
      {
        key,
        value,
        updated_at: new Date().toISOString(),
        updated_by: user?.id || null,
      },
      { onConflict: 'key' }
    )
    .select()
    .single();
}

// Tous les itinéraires (admin only, RLS le permet via is_admin())
export async function adminListAllItineraries() {
  return supabase
    .from('itineraries')
    .select(
      'id, user_id, title, preferences, itinerary, is_public, is_template, template_category, template_description, created_at, updated_at'
    )
    .order('created_at', { ascending: false });
}

// Stats agrégées pour le dashboard admin
export async function adminGetStats() {
  // On récupère les utilisateurs + itinéraires côté client puis on agrège.
  // À l'échelle d'une app perso/PME c'est largement suffisant.
  const [usersRes, tripsRes] = await Promise.all([
    supabase.from('profiles').select('id, status, role, subscription_tier'),
    supabase.from('itineraries').select('id, user_id, itinerary, created_at, is_template'),
  ]);

  const users = usersRes.data || [];
  const trips = tripsRes.data || [];

  const byStatus = users.reduce((acc, u) => {
    acc[u.status] = (acc[u.status] || 0) + 1;
    return acc;
  }, {});

  let totalCostUsd = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const modelsCount = {};

  for (const t of trips) {
    const m = t.itinerary?.metadata;
    if (!m) continue;
    totalCostUsd += m.total_cost_usd || 0;
    totalInputTokens += m.total_input_tokens || 0;
    totalOutputTokens += m.total_output_tokens || 0;
    for (const mod of m.models_used || []) {
      modelsCount[mod] = (modelsCount[mod] || 0) + 1;
    }
  }

  // Itinéraires du mois en cours
  const thisMonth = new Date();
  thisMonth.setDate(1);
  thisMonth.setHours(0, 0, 0, 0);
  const tripsThisMonth = trips.filter(
    (t) => new Date(t.created_at) >= thisMonth
  ).length;

  return {
    users: {
      total: users.length,
      pending: byStatus.pending || 0,
      approved: byStatus.approved || 0,
      rejected: byStatus.rejected || 0,
      suspended: byStatus.suspended || 0,
      admins: users.filter((u) => u.role === 'admin').length,
    },
    trips: {
      total: trips.length,
      this_month: tripsThisMonth,
      templates: trips.filter((t) => t.is_template).length,
    },
    ai: {
      total_cost_usd: totalCostUsd,
      total_input_tokens: totalInputTokens,
      total_output_tokens: totalOutputTokens,
      models_count: modelsCount,
    },
  };
}
