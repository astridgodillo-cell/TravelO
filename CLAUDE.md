CLAUDE.md — TravelO
Présentation du projet
TravelO est une application web de création d'itinéraires touristiques ultra-détaillés, à la manière des tours opérateurs. L'utilisateur renseigne ses préférences (lieux, dates, transport, hébergement, activités, budget, nombre de personnes) et l'appli génère un programme complet incluant hébergements, repas, excursions, temps de repos et budget prévisionnel.

Stack technique

Frontend : React + Vite + Tailwind CSS
Backend / BDD : Supabase (PostgreSQL + Auth + Edge Functions)
Déploiement : Vercel
Versioning : GitHub


Variables d'environnement
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
Ne jamais hardcoder ces valeurs dans le code. Toujours passer par les variables d'environnement.

Règles de workflow

Branche principale : toujours travailler et pusher sur main sauf indication contraire explicite
Migrations SQL : appliquées manuellement via le dashboard Supabase (pas de workflow GitHub automatisé)
Avant tout changement majeur : créer une branche backup (git checkout -b backup/avant-[feature])

Déploiements automatiques (NE PAS demander à l'utilisateur de redéployer manuellement)
- Frontend Vercel : auto-déploiement à chaque push sur main (existant)
- Edge Functions Supabase : auto-déploiement via .github/workflows/deploy-edge-functions.yml.
  Le workflow se déclenche dès qu'un fichier dans supabase/functions/ est modifié sur main.
  Les secrets GitHub SUPABASE_ACCESS_TOKEN et SUPABASE_PROJECT_REF sont déjà configurés.
  → Quand je modifie une Edge Function, je commit + push et c'est tout. Pas besoin de demander à
    l'utilisateur de coller le code dans le dashboard Supabase. Le déploiement se fait sous ~1 min
    et est visible dans l'onglet Actions du repo GitHub.
- Migrations SQL : restent manuelles (Supabase impose une exécution manuelle dans le SQL Editor).
  Je dois donner le SQL à coller dans le message à l'utilisateur.

Backend LLM (multi-provider)
- 3 providers supportés : Gemini, DeepSeek, Claude (cf. supabase/functions/generate-itinerary/index.ts)
- Le backend actif est stocké dans la table app_config (clé llm_backend)
- L'admin peut basculer en un clic depuis la navbar (composant BackendQuickSwitch) ou
  depuis la page /admin → section "Backend LLM"
- L'Edge Function lit la valeur à chaque appel (cache 15s)
- Pour ajouter un provider : ajouter callXxx() dans index.ts, ajouter au dispatcher callProvider,
  ajouter au BackendQuickSwitch et à AdminPage


Architecture cible
Fonctionnalités principales

Formulaire de préférences — saisie des paramètres du voyage :

Destination(s) / lieux
Dates de début et fin
Nombre de personnes (adultes / enfants)
Mode(s) de transport (avion, train, voiture, bateau…)
Type d'hébergement (hôtel, Airbnb, camping, auberge…)
Activités souhaitées (culture, plage, sport, nature, gastronomie…)
Budget total indicatif


Génération d'itinéraire — programme jour par jour incluant :

Hébergements avec prix estimés
Repas (restaurants / suggestions locales)
Excursions et activités planifiées avec horaires
Temps de repos
Transports entre étapes
Budget prévisionnel détaillé par poste


Gestion des itinéraires — sauvegarde, modification, partage et export (PDF) des programmes générés
Compte utilisateur — auth Supabase, historique des voyages, préférences sauvegardées


Conventions de code

Composants React en PascalCase
Fichiers utilitaires et hooks en camelCase
Toutes les appels Supabase centralisés dans /src/lib/supabase.js
Les appels à l'API IA centralisés dans /src/lib/ai.js


Ce que Claude Code décide seul
Toutes les décisions techniques : choix de librairies, structure des composants, schéma de base de données, logique métier. Aucune validation requise sauf si impact fonctionnel majeur.

Communication

Réponses courtes et en français
Une seule question à la fois si clarification nécessaire
Pas de blocs de code dans les explications — uniquement le résultat final