import { supabase } from './supabase';

const FN_NAME = 'generate-itinerary';

export async function generateItinerary(preferences) {
  const { data, error } = await supabase.functions.invoke(FN_NAME, {
    body: { preferences },
  });

  if (error) {
    const message =
      error?.context?.error ||
      error?.message ||
      "L'Edge Function generate-itinerary a renvoyé une erreur.";
    throw new Error(message);
  }

  if (data?.error) throw new Error(data.error);
  if (!data?.itinerary) {
    throw new Error('Réponse vide reçue de l\'Edge Function.');
  }
  return data.itinerary;
}
