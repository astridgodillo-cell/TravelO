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
  // Mes itinéraires
  const owned = await supabase
    .from('itineraries')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (owned.error) return owned;

  // + ceux qu'on a partagés avec moi et que j'ai acceptés
  const { data: shareRows } = await supabase
    .from('itinerary_shares')
    .select('itinerary_id')
    .eq('recipient_id', user.id)
    .eq('status', 'accepted');
  const sharedIds = (shareRows || []).map((r) => r.itinerary_id);

  let shared = [];
  if (sharedIds.length) {
    const res = await supabase
      .from('itineraries')
      .select('*')
      .in('id', sharedIds)
      .order('created_at', { ascending: false });
    shared = (res.data || []).map((it) => ({ ...it, _shared: true }));
  }

  const ownedData = (owned.data || []).map((it) => ({ ...it, _shared: false }));
  return { data: [...ownedData, ...shared], error: null };
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
  // RLS renvoie à la fois mes listes et celles qu'on a partagées avec moi
  // (et que j'ai acceptées). On marque les listes partagées pour l'affichage.
  const res = await supabase
    .from('user_packing_lists')
    .select('*')
    .order('created_at', { ascending: false });
  if (res.data) {
    res.data = res.data.map((l) => ({ ...l, _shared: l.user_id !== user.id }));
  }
  return res;
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

// Enregistre les cases cochées d'une liste (positions des articles cochés).
// Partagé entre collaborateurs : la mise à jour déclenche le temps réel.
export async function setPackingListChecks(id, checkedItems) {
  return supabase
    .from('user_packing_lists')
    .update({ checked_items: checkedItems, updated_at: new Date().toISOString() })
    .eq('id', id);
}

// ----- STOCKAGE DES PHOTOS DE BROCHURE (images importées) -----

const BROCHURE_BUCKET = 'brochure-photos';

// Envoie une image (File ou Blob) dans le stockage Supabase et renvoie son
// lien public. Évite de stocker l'image « en dur » (base64) dans le voyage,
// ce qui rendait l'enregistrement trop lourd (timeout).
export async function uploadBrochureImage(fileOrBlob) {
  const user = await getCurrentUser();
  const type = fileOrBlob?.type || 'image/jpeg';
  const ext = (type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  const rand =
    (crypto.randomUUID && crypto.randomUUID()) ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = `${user?.id || 'anon'}/${rand}.${ext}`;
  const { error } = await supabase.storage
    .from(BROCHURE_BUCKET)
    .upload(path, fileOrBlob, { contentType: type, upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from(BROCHURE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

// Convertit une URL « data: » (base64) en lien stocké. Renvoie l'URL telle
// quelle si ce n'est pas une data URL.
export async function externalizeImageUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('data:')) return url;
  const blob = await (await fetch(url)).blob();
  return uploadBrochureImage(blob);
}

// ----- STOCKAGE DES PHOTOS D'ALBUM (deux résolutions) -----
// On réutilise le bucket existant « brochure-photos » (déjà public), donc
// aucune nouvelle configuration côté Supabase n'est nécessaire.

// Redessine une image (réduite à maxDim si besoin) sur un canvas en
// APPLIQUANT son orientation EXIF, puis renvoie un Blob JPEG + ses dimensions
// réelles (après rotation). Indispensable pour les photos de téléphone prises
// en mode portrait : sinon elles s'affichent couchées et déformées.
async function renderOriented(file, maxDim, quality) {
  // imageOrientation: 'from-image' → la rotation enregistrée par l'appareil
  // est appliquée, et bitmap.width/height reflètent l'image telle qu'on la voit.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const blob = await new Promise((res) =>
    canvas.toBlob(res, 'image/jpeg', quality)
  );
  return { blob, w, h };
}

// Envoi d'une image-sticker (PNG/clipart) à poser sur une page/photo. On
// conserve la TRANSPARENCE (export PNG) et on limite la taille (max 700 px).
export async function uploadAlbumSticker(file) {
  let blob = file;
  let w = null;
  let h = null;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const max = 700;
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    w = Math.max(1, Math.round(bitmap.width * scale));
    h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    const b = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    if (b) blob = b;
  } catch {
    /* repli : fichier d'origine */
  }
  const url = await uploadToBrochureBucket(blob, '-stk');
  return { url, w, h };
}

async function uploadToBrochureBucket(fileOrBlob, suffix = '') {
  const user = await getCurrentUser();
  const type = fileOrBlob?.type || 'image/jpeg';
  const ext = (type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  const rand =
    (crypto.randomUUID && crypto.randomUUID()) ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = `${user?.id || 'anon'}/album/${rand}${suffix}.${ext}`;
  const { error } = await supabase.storage
    .from(BROCHURE_BUCKET)
    .upload(path, fileOrBlob, { contentType: type, upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from(BROCHURE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

// Envoie une photo d'album en DEUX résolutions, orientation EXIF appliquée :
//   - full    : haute définition (jusqu'à 3500 px), conservée pour
//               l'impression à 300 DPI ;
//   - display : version allégée (max 1600 px) pour l'affichage web.
// On réencode les deux à partir d'un canvas pour « graver » la rotation : ainsi
// les photos portrait ne sont plus couchées dans le PDF (qui n'applique pas
// l'orientation EXIF). Renvoie aussi w/h (dimensions réelles, après rotation),
// utilisés pour vérifier la résolution et caler la mise en page mosaïque.
export async function uploadAlbumPhoto(file) {
  // Version haute définition (orientation gravée). Repli sur le fichier brut
  // si le canvas échoue (navigateur ancien, format exotique…).
  let fullBlob = file;
  let w = null;
  let h = null;
  try {
    const big = await renderOriented(file, 3500, 0.92);
    if (big.blob) {
      fullBlob = big.blob;
      w = big.w;
      h = big.h;
    }
  } catch {
    /* repli : fichier d'origine, dimensions inconnues */
  }

  // Version d'affichage (orientation gravée également).
  let displayBlob = fullBlob;
  try {
    const ds = await renderOriented(file, 1600, 0.82);
    if (ds.blob) displayBlob = ds.blob;
  } catch {
    /* repli : on affichera la version pleine résolution */
  }

  const [full, display] = await Promise.all([
    uploadToBrochureBucket(fullBlob, '-full'),
    uploadToBrochureBucket(displayBlob, '-disp'),
  ]);
  return { full, display, w, h };
}

// Répare une photo d'album déjà enregistrée « à l'ancienne » (couchée parce que
// son orientation n'avait pas été appliquée). On récupère l'image stockée, on
// calcule ses dimensions correctement orientées :
//   - si elles correspondent déjà à ce qui est enregistré → photo déjà bonne,
//     on la renvoie telle quelle (aucun réenvoi, pas de perte de qualité) ;
//   - sinon → on la réencode avec l'orientation appliquée et on la renvoie
//     corrigée (nouveaux liens + bonnes dimensions).
export async function repairAlbumPhoto(photo) {
  if (!photo?.full) return photo;

  let blob;
  try {
    blob = await (await fetch(photo.full)).blob();
  } catch {
    return photo; // image inaccessible (réseau/CORS) → on n'y touche pas
  }

  let ow;
  let oh;
  try {
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    ow = bmp.width;
    oh = bmp.height;
    bmp.close?.();
  } catch {
    return photo;
  }

  // Déjà à l'endroit (dimensions enregistrées = dimensions orientées) → on garde.
  if (ow && oh && photo.w === ow && photo.h === oh) return photo;

  try {
    const big = await renderOriented(blob, 3500, 0.92);
    const ds = await renderOriented(blob, 1600, 0.82);
    const [full, display] = await Promise.all([
      uploadToBrochureBucket(big.blob || blob, '-full'),
      uploadToBrochureBucket(ds.blob || big.blob || blob, '-disp'),
    ]);
    return { ...photo, full, display, w: big.w ?? ow, h: big.h ?? oh };
  } catch {
    // En cas d'échec du réencodage, on corrige au moins les dimensions, ce qui
    // évite déjà la déformation dans la mise en page mosaïque.
    return { ...photo, w: ow, h: oh };
  }
}

// ----- ALBUMS AUTONOMES (créés de zéro, sans voyage) -----
// Table `albums` : { id, user_id, title, content (jsonb), created_at, updated_at }

export async function listAlbums() {
  const user = await getCurrentUser();
  if (!user) return { data: [], error: null };
  return supabase
    .from('albums')
    .select('id, title, content, created_at, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });
}

export async function getAlbum(id) {
  return supabase.from('albums').select('*').eq('id', id).single();
}

export async function createAlbum(title, content) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Utilisateur non connecté');
  return supabase
    .from('albums')
    .insert({ user_id: user.id, title: title || 'Mon album', content: content || {} })
    .select()
    .single();
}

export async function updateAlbum(id, patch) {
  return supabase
    .from('albums')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
}

export async function deleteAlbum(id) {
  return supabase.from('albums').delete().eq('id', id);
}

// ----- PARTAGE DE LISTES (entre utilisateurs, en temps réel) -----

// Invite un utilisateur (par email) à partager une liste. Crée une invitation
// "pending" que le destinataire devra accepter ou refuser.
export async function shareListByEmail(listId, email) {
  return supabase.rpc('share_list_by_email', {
    p_list_id: listId,
    p_email: email,
  });
}

// Invitations reçues encore en attente de réponse (pour le destinataire).
export async function getIncomingPendingShares() {
  const user = await getCurrentUser();
  if (!user) return { data: [], error: null };
  return supabase
    .from('list_shares')
    .select('*')
    .eq('recipient_id', user.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
}

// Le destinataire accepte ou refuse une invitation.
export async function respondToShare(shareId, accept) {
  return supabase
    .from('list_shares')
    .update({
      status: accept ? 'accepted' : 'refused',
      responded_at: new Date().toISOString(),
    })
    .eq('id', shareId)
    .select()
    .single();
}

// Tous les partages liés à une liste (pour afficher avec qui elle est partagée).
export async function listSharesForList(listId) {
  return supabase
    .from('list_shares')
    .select('*')
    .eq('list_id', listId)
    .order('created_at', { ascending: false });
}

// Tous les partages que j'ai initiés (pour afficher "partagée avec…" sur mes cartes).
export async function getMyOutgoingListShares() {
  const user = await getCurrentUser();
  if (!user) return { data: [], error: null };
  return supabase.from('list_shares').select('*').eq('owner_id', user.id);
}

// Supprime un partage (propriétaire qui retire l'accès, ou destinataire qui quitte).
export async function deleteShare(shareId) {
  return supabase.from('list_shares').delete().eq('id', shareId);
}

// ----- PARTAGE D'ITINÉRAIRES (entre utilisateurs, en temps réel) -----

export async function shareItineraryByEmail(itineraryId, email) {
  return supabase.rpc('share_itinerary_by_email', {
    p_itinerary_id: itineraryId,
    p_email: email,
  });
}

export async function getIncomingPendingItineraryShares() {
  const user = await getCurrentUser();
  if (!user) return { data: [], error: null };
  return supabase
    .from('itinerary_shares')
    .select('*')
    .eq('recipient_id', user.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
}

export async function respondToItineraryShare(shareId, accept) {
  return supabase
    .from('itinerary_shares')
    .update({
      status: accept ? 'accepted' : 'refused',
      responded_at: new Date().toISOString(),
    })
    .eq('id', shareId)
    .select()
    .single();
}

export async function listSharesForItinerary(itineraryId) {
  return supabase
    .from('itinerary_shares')
    .select('*')
    .eq('itinerary_id', itineraryId)
    .order('created_at', { ascending: false });
}

export async function deleteItineraryShare(shareId) {
  return supabase.from('itinerary_shares').delete().eq('id', shareId);
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
