---
stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics', 'step-03-create-stories', 'step-04-final-validation']
workflowCompleted: true
completedAt: '2026-04-11'
inputDocuments: ['planning-artifacts/prd.md', 'planning-artifacts/architecture.md']
---

# Penya Barca Nantes - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Penya Barca Nantes, decomposing the requirements from the PRD and Architecture into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: Un visiteur peut créer un compte membre avec email et mot de passe
FR2: Un membre peut se connecter et se déconnecter de son compte
FR3: Un membre peut consulter et modifier son profil (pseudo, avatar, informations personnelles)
FR4: Un membre peut consulter le profil d'un autre membre
FR5: Un membre peut consulter son historique de pronostics et ses statistiques personnelles
FR6: Un admin peut valider, suspendre ou supprimer un compte membre
FR7: Un admin peut consulter la liste complète des membres et leur statut
FR8: Un nouveau membre reçoit une notification de bienvenue de la communauté lors de sa première connexion
FR9: Un membre peut publier un post sur le fil communautaire (texte, image)
FR10: Un membre peut réagir à un post (likes, réactions)
FR11: Un membre peut commenter un post
FR12: Un membre peut consulter le fil communautaire avec les posts les plus récents en premier
FR13: Le fil communautaire se met à jour en temps réel sans rechargement de page
FR14: Un admin peut modérer le fil communautaire (supprimer un post, supprimer un commentaire)
FR15: Un admin peut publier un post en tant qu'annonce officielle (mise en avant visuelle)
FR16: Un membre peut soumettre un pronostic de score pour un match à venir
FR17: Un membre peut modifier son pronostic tant que la deadline n'est pas dépassée
FR18: Un membre peut consulter les pronostics des autres membres après la deadline
FR19: Le système calcule automatiquement les points des pronostics après chaque match
FR20: Un membre peut consulter le classement général des pronostiqueurs
FR21: Un membre peut consulter les résultats détaillés de ses pronostics par match
FR22: Un admin peut configurer un match et ses paramètres de pronostic (deadline, barème de points)
FR23: Un admin peut saisir le résultat final d'un match pour déclencher le calcul des points
FR24: Un membre peut consulter le calendrier des prochains matchs du Barça
FR25: Un membre peut voir les détails d'un match (date, heure, adversaire, compétition, lieu)
FR26: Un membre peut accéder directement au formulaire de pronostic depuis un match du calendrier
FR27: Un admin peut créer, modifier et supprimer des matchs dans le calendrier
FR28: Un admin peut accéder à un tableau de bord avec les indicateurs clés (membres actifs, taux de participation pronos, activité du fil)
FR29: Un admin peut créer et gérer des événements (titre, date, description, lieu)
FR30: Un admin peut gérer les rôles des utilisateurs (membre, admin, partenaire)
FR31: Un admin peut configurer les paramètres généraux de l'application
FR32: Le partenaire bar peut consulter les statistiques d'engagement de la communauté
FR33: Le partenaire bar peut voir le nombre de pronostics soumis par match (indicateur de fréquentation prévue)
FR34: Un visiteur peut consulter une page d'accueil présentant la communauté et ses valeurs
FR35: Un visiteur peut consulter le calendrier des prochains matchs sans être connecté
FR36: Un visiteur peut accéder à une page d'inscription pour rejoindre la communauté

### NonFunctional Requirements

NFR1: Les pages se chargent en moins de 3 secondes sur mobile 4G
NFR2: Les mises à jour temps réel (fil, pronos, classements) sont délivrées en moins de 1 seconde
NFR3: La soumission d'un pronostic est confirmée en moins de 2 secondes
NFR4: Le fil communautaire charge les 20 derniers posts instantanément, avec chargement progressif pour l'historique
NFR5: Toutes les communications chiffrées en transit (HTTPS/TLS)
NFR6: Mots de passe hashés et salés (jamais stockés en clair)
NFR7: Sessions utilisateur expirent après une période d'inactivité
NFR8: Séparation stricte des rôles : membre, admin, partenaire — aucun accès croisé non autorisé
NFR9: Conformité RGPD : consentement explicite, droit d'accès, de rectification et de suppression des données personnelles
NFR10: Données stockées minimales : email, pseudo, avatar, historique de pronos. Pas de données de paiement
NFR11: Le système supporte 500 utilisateurs simultanés un soir de match sans dégradation
NFR12: L'architecture temps réel supporte 500 connexions persistantes en parallèle
NFR13: Le système gère les pics d'activité (pronos avant deadline, posts pendant un but) sans perte de données
NFR14: Conformité WCAG 2.1 niveau AA
NFR15: Contrastes de couleurs suffisants (ratio minimum 4.5:1 pour le texte)
NFR16: Navigation au clavier fonctionnelle sur toutes les pages
NFR17: Labels ARIA et textes alternatifs sur les éléments interactifs et images
NFR18: Tailles de police lisibles sur mobile sans zoom
NFR19: Disponibilité cible de 99% sur une base mensuelle
NFR20: Soirs de match critiques — indisponibilité à éviter en priorité
NFR21: Dégradation gracieuse en cas de panne

### Additional Requirements

- Starter template : React Router v7 Framework Mode (`npx create-react-router@latest`) — constitue la première story d'implémentation
- Docker Compose avec 4 services : app (Node.js/RR7), postgres (PostgreSQL), redis (sessions/cache/pub-sub), nginx (reverse proxy + HTTPS)
- Drizzle ORM v0.45+ pour la modélisation relationnelle et les migrations versionnées
- Better Auth v1.6 pour l'authentification email/mot de passe et la gestion des rôles (membre, admin, partenaire)
- Redis pour les sessions, le cache applicatif et le backbone temps réel (Pub/Sub)
- SSE (Server-Sent Events) via resource routes React Router pour le temps réel (fil, classements, pronos, écran bar)
- Zod pour la validation de schémas partagée front/back
- Tailwind CSS v4 + shadcn/ui pour les composants accessibles avec palette blaugrana
- Pino pour le logging structuré JSON côté serveur
- Vitest pour les tests unitaires et d'intégration
- CI/CD : GitHub Actions (build, lint, tests) → déploiement SSH docker compose up sur merge main
- Rate limiting Redis-based pour la protection brute force et spam
- Headers sécurité via Helmet (X-Frame-Options, CSP, HSTS)
- Upload d'images : stockage local volume Docker /uploads pour le MVP
- Notification de bienvenue : message in-app au MVP (pas d'email)
- Backup PostgreSQL : pg_dump quotidien automatisé (cron), rotation des backups
- Endpoint /health (app + DB + Redis) pour le monitoring

### UX Design Requirements

Aucun document UX Design n'a été fourni. Les exigences UX seront dérivées du PRD (mobile-first, identité blaugrana, ton chaleureux) et de l'architecture (shadcn/ui, Tailwind, WCAG 2.1 AA).

### FR Coverage Map

| FR | Epic | Description |
|----|------|-------------|
| FR1 | Epic 1 | Inscription email/mot de passe |
| FR2 | Epic 1 | Connexion/déconnexion |
| FR3 | Epic 2 | Consulter/modifier son profil |
| FR4 | Epic 2 | Consulter le profil d'un autre membre |
| FR5 | Epic 2 | Historique pronos et stats perso |
| FR6 | Epic 6 | Admin : valider/suspendre/supprimer un membre |
| FR7 | Epic 6 | Admin : liste complète des membres |
| FR8 | Epic 2 | Notification de bienvenue |
| FR9 | Epic 5 | Publier un post (texte, image) |
| FR10 | Epic 5 | Réagir à un post |
| FR11 | Epic 5 | Commenter un post |
| FR12 | Epic 5 | Consulter le fil (récents en premier) |
| FR13 | Epic 5 | Fil temps réel sans rechargement |
| FR14 | Epic 5 | Admin : modérer le fil |
| FR15 | Epic 5 | Admin : annonces officielles |
| FR16 | Epic 4 | Soumettre un pronostic |
| FR17 | Epic 4 | Modifier prono avant deadline |
| FR18 | Epic 4 | Consulter pronos des autres après deadline |
| FR19 | Epic 4 | Calcul automatique des points |
| FR20 | Epic 4 | Classement général |
| FR21 | Epic 4 | Résultats détaillés par match |
| FR22 | Epic 4 | Admin : configurer un match/prono |
| FR23 | Epic 4 | Admin : saisir le résultat final |
| FR24 | Epic 3 | Consulter le calendrier des matchs |
| FR25 | Epic 3 | Détails d'un match |
| FR26 | Epic 4 | Accès direct formulaire prono depuis calendrier |
| FR27 | Epic 3 | Admin : CRUD matchs |
| FR28 | Epic 6 | Admin : tableau de bord KPIs |
| FR29 | Epic 6 | Admin : gestion événements |
| FR30 | Epic 6 | Admin : gestion des rôles |
| FR31 | Epic 6 | Admin : paramètres généraux |
| FR32 | Epic 7 | Partenaire : stats engagement |
| FR33 | Epic 7 | Partenaire : pronos par match |
| FR34 | Epic 1 | Page d'accueil publique |
| FR35 | Epic 3 | Calendrier public sans auth |
| FR36 | Epic 1 | Page d'inscription |

## Epic List

### Epic 1 : Accueil & Inscription des Membres
Un visiteur découvre la communauté via la page d'accueil, crée son compte et se connecte. C'est le socle technique et fonctionnel sur lequel tout repose — inclut le setup du projet (starter RR7, Docker, DB, auth Better Auth).
**FRs couverts :** FR1, FR2, FR34, FR36

### Epic 2 : Profils & Identité des Membres
Un membre gère son identité (pseudo, avatar), consulte les profils des autres membres, accède à ses stats personnelles et reçoit un accueil chaleureux dès sa première connexion.
**FRs couverts :** FR3, FR4, FR5, FR8

### Epic 3 : Calendrier des Matchs
Membres et visiteurs peuvent suivre les prochains matchs du Barça. Les admins gèrent les matchs via le back-office. Le calendrier est accessible publiquement sans authentification.
**FRs couverts :** FR24, FR25, FR27, FR35

### Epic 4 : Pronostics & Classements
Les membres pronostiquent les scores des matchs, gagnent des points calculés automatiquement et grimpent au classement — le moteur d'engagement principal de la Penya. Inclut la configuration admin et le lien direct depuis le calendrier.
**FRs couverts :** FR16, FR17, FR18, FR19, FR20, FR21, FR22, FR23, FR26

### Epic 5 : Fil Communautaire
Les membres partagent des posts, réagissent, commentent et échangent en temps réel — le cœur social de la Penya. Inclut la modération admin et les annonces officielles.
**FRs couverts :** FR9, FR10, FR11, FR12, FR13, FR14, FR15

### Epic 6 : Administration & Back-Office
Mrbit gère toute la communauté depuis un tableau de bord centralisé : gestion des membres, événements hors-match, rôles et paramètres de l'application.
**FRs couverts :** FR6, FR7, FR28, FR29, FR30, FR31

### Epic 7 : Accès Partenaire Bar *(Phase 2)*
Le patron du bar consulte les statistiques d'engagement de la communauté et le nombre de pronostics par match pour anticiper la fréquentation. Différé Phase 2, conforme au PRD.
**FRs couverts :** FR32, FR33

## Epic 1 : Accueil & Inscription des Membres

Un visiteur découvre la communauté via la page d'accueil, crée son compte et se connecte. C'est le socle technique et fonctionnel sur lequel tout repose — inclut le setup du projet (starter RR7, Docker, DB, auth Better Auth).

### Story 1.1 : Initialisation du Projet et Infrastructure Docker

As a développeur,
I want initialiser le projet React Router v7 avec l'environnement Docker Compose complet,
So that j'ai une base de développement fonctionnelle pour construire toutes les fonctionnalités.

**Acceptance Criteria:**

**Given** un environnement de développement vierge
**When** je lance `npx create-react-router@latest` et configure Docker Compose
**Then** le projet démarre avec 4 services (app, postgres, redis, nginx)
**And** le hot reload fonctionne via Vite HMR
**And** la structure de dossiers suit l'architecture définie (app/routes, app/db, app/lib, app/components)
**And** Tailwind CSS v4 est configuré avec les design tokens blaugrana (primary, secondary, accent)
**And** shadcn/ui est installé et les composants de base sont disponibles
**And** Drizzle ORM est connecté à PostgreSQL avec la commande de migration fonctionnelle
**And** Redis est accessible depuis l'app
**And** Pino logging est configuré côté serveur
**And** le fichier `.env.example` est créé avec toutes les variables documentées
**And** l'endpoint `/health` retourne le statut de l'app, DB et Redis

### Story 1.2 : Inscription d'un Nouveau Membre

As a visiteur,
I want créer un compte avec mon email et un mot de passe,
So that je puisse rejoindre la communauté Penya Barca Nantes.

**Acceptance Criteria:**

**Given** un visiteur sur la page d'inscription
**When** il remplit le formulaire (email, pseudo, mot de passe, confirmation mot de passe)
**Then** un compte membre est créé avec le rôle "membre" par défaut
**And** le mot de passe est hashé et salé (jamais stocké en clair) — NFR6
**And** le consentement RGPD est recueilli explicitement avant la création — NFR9
**And** la validation Zod vérifie les champs (email valide, mot de passe fort, pseudo unique)
**And** les erreurs de validation sont affichées clairement en français
**And** le membre est automatiquement connecté après inscription
**And** la page est accessible WCAG 2.1 AA (contrastes, clavier, ARIA) — NFR14-17

**Given** un email déjà utilisé
**When** le visiteur tente de s'inscrire
**Then** un message d'erreur explicite est affiché sans révéler si l'email existe (sécurité)

### Story 1.3 : Connexion et Déconnexion

As a membre,
I want me connecter et me déconnecter de mon compte,
So that j'accède à mon espace de manière sécurisée.

**Acceptance Criteria:**

**Given** un membre avec un compte existant
**When** il saisit son email et mot de passe corrects sur la page de connexion
**Then** il est authentifié et redirigé vers le fil communautaire (ou l'accueil authentifié)
**And** une session est créée dans Redis avec expiration après inactivité — NFR7
**And** la séparation des rôles est active (membre, admin, partenaire) — NFR8

**Given** un membre connecté
**When** il clique sur "Se déconnecter"
**Then** sa session Redis est invalidée
**And** il est redirigé vers la page d'accueil publique

**Given** un visiteur avec des identifiants incorrects
**When** il tente de se connecter
**Then** un message d'erreur générique est affiché ("Email ou mot de passe incorrect")
**And** le rate limiting protège contre le brute force

**Given** une session expirée
**When** le membre tente d'accéder à une page protégée
**Then** il est redirigé vers la page de connexion

### Story 1.4 : Page d'Accueil Publique

As a visiteur,
I want découvrir une page d'accueil présentant la communauté et ses valeurs,
So that je comprenne ce qu'est la Penya et que j'aie envie de la rejoindre.

**Acceptance Criteria:**

**Given** un visiteur (non connecté) arrivant sur le site
**When** il accède à la page d'accueil
**Then** il voit une présentation chaleureuse de la communauté (valeurs : bienveillance, légèreté, ouverture)
**And** le design est blaugrana avec le branding de la Penya
**And** un call-to-action visible l'invite à rejoindre la communauté (lien vers inscription)
**And** la page est rendue côté serveur (SSR) pour le SEO
**And** la page se charge en moins de 3 secondes sur mobile 4G — NFR1
**And** la page est responsive mobile-first
**And** la navigation affiche les liens vers le calendrier public et l'inscription

**Given** un membre déjà connecté
**When** il accède à la page d'accueil
**Then** la navigation lui propose d'accéder à son espace (fil, pronos, profil)

## Epic 2 : Profils & Identité des Membres

Un membre gère son identité (pseudo, avatar), consulte les profils des autres membres, accède à ses stats personnelles et reçoit un accueil chaleureux dès sa première connexion.

### Story 2.1 : Consulter et Modifier son Profil

As a membre,
I want consulter et modifier mon profil (pseudo, avatar, informations personnelles),
So that mon identité dans la communauté me représente.

**Acceptance Criteria:**

**Given** un membre connecté
**When** il accède à sa page de profil
**Then** il voit ses informations actuelles (pseudo, avatar, email, date d'inscription)
**And** il peut modifier son pseudo et son avatar
**And** l'upload d'avatar est stocké localement dans le volume Docker `/uploads`
**And** les images sont compressées et optimisées (WebP/AVIF)
**And** la validation Zod vérifie les champs (pseudo unique, taille image max)
**And** les modifications sont confirmées avec un message de succès

**Given** un membre souhaitant exercer ses droits RGPD
**When** il accède aux paramètres de son profil
**Then** il peut consulter toutes ses données personnelles stockées — NFR9
**And** il peut demander la suppression de son compte

**Given** un pseudo déjà pris par un autre membre
**When** le membre tente de le choisir
**Then** une erreur explicite est affichée

### Story 2.2 : Consulter le Profil d'un Autre Membre

As a membre,
I want consulter le profil d'un autre membre,
So that je puisse le connaître et me sentir connecté à la communauté.

**Acceptance Criteria:**

**Given** un membre connecté
**When** il accède au profil d'un autre membre
**Then** il voit le pseudo, l'avatar, la date d'inscription et les stats publiques du membre
**And** les informations privées (email) ne sont pas visibles
**And** la page est responsive mobile-first

**Given** un membre connecté consultant un profil inexistant
**When** il accède à une URL de membre invalide
**Then** une page d'erreur 404 conviviale est affichée

### Story 2.3 : Historique de Pronostics et Statistiques Personnelles

As a membre,
I want consulter mon historique de pronostics et mes statistiques personnelles,
So that je puisse suivre ma progression et me comparer aux autres.

**Acceptance Criteria:**

**Given** un membre connecté sur sa page de profil
**When** il consulte sa section statistiques
**Then** il voit son nombre total de pronostics soumis
**And** il voit son taux de réussite et ses points cumulés
**And** il voit son historique de pronostics par match (score prédit vs score réel, points gagnés)
**And** les statistiques sont calculées à partir des données existantes (tables predictions/matches)
**And** si aucun pronostic n'a encore été soumis, un état vide encourageant est affiché

**Note :** Cette story crée l'affichage des stats. Les données de pronostics seront alimentées par l'Epic 4. En attendant, l'état vide est géré gracieusement.

### Story 2.4 : Notification de Bienvenue

As a nouveau membre,
I want recevoir une notification de bienvenue chaleureuse lors de ma première connexion,
So that je me sente accueilli dans la communauté dès le premier instant.

**Acceptance Criteria:**

**Given** un nouveau membre qui vient de créer son compte
**When** il se connecte pour la première fois
**Then** une notification in-app de bienvenue s'affiche avec un message chaleureux et bienveillant
**And** le ton est celui de la Penya : "Bienvenue dans la famille culer !" (pas institutionnel)
**And** la notification suggère les premières actions (explorer le fil, soumettre un prono, consulter le calendrier)
**And** la notification ne s'affiche qu'une seule fois (flag `welcomeShown` en base)

**Given** un membre qui s'est déjà connecté auparavant
**When** il se reconnecte
**Then** la notification de bienvenue ne s'affiche pas

## Epic 3 : Calendrier des Matchs

Membres et visiteurs peuvent suivre les prochains matchs du Barça. Les admins gèrent les matchs via le back-office. Le calendrier est accessible publiquement sans authentification.

### Story 3.1 : Administration des Matchs (CRUD)

As a admin,
I want créer, modifier et supprimer des matchs dans le calendrier,
So that les membres puissent toujours voir les prochains matchs du Barça à jour.

**Acceptance Criteria:**

**Given** un admin connecté sur la page d'administration des matchs
**When** il crée un nouveau match
**Then** il renseigne : date, heure, adversaire, compétition (Liga, Champions League, etc.), lieu (domicile/extérieur)
**And** la validation Zod vérifie tous les champs obligatoires
**And** le match est enregistré dans la table `matches` en base
**And** un message de succès confirme la création

**Given** un admin sur la liste des matchs
**When** il modifie un match existant
**Then** il peut mettre à jour tous les champs
**And** les modifications sont sauvegardées et confirmées

**Given** un admin sur la liste des matchs
**When** il supprime un match
**Then** une confirmation est demandée avant suppression
**And** le match est supprimé (ou soft-deleted si des pronostics y sont liés)

**Given** un utilisateur avec le rôle "membre"
**When** il tente d'accéder à l'administration des matchs
**Then** l'accès est refusé (403) — NFR8

### Story 3.2 : Calendrier des Matchs (Membres)

As a membre,
I want consulter le calendrier des prochains matchs du Barça et voir les détails d'un match,
So that je sache quand et où regarder les matchs avec la communauté.

**Acceptance Criteria:**

**Given** un membre connecté
**When** il accède à la page du calendrier
**Then** il voit la liste des prochains matchs triés par date chronologique
**And** chaque match affiche : date, heure, adversaire, compétition, lieu
**And** les matchs passés sont distincts visuellement des matchs à venir
**And** la page est responsive mobile-first

**Given** un membre sur le calendrier
**When** il clique sur un match
**Then** il accède à la page de détail du match
**And** il voit toutes les informations du match (date, heure, adversaire, compétition, lieu)
**And** la page se charge en moins de 3 secondes sur mobile 4G — NFR1

### Story 3.3 : Calendrier Public (Sans Authentification)

As a visiteur (non connecté),
I want consulter le calendrier des prochains matchs sans avoir de compte,
So that je puisse voir l'activité de la communauté et être tenté de la rejoindre.

**Acceptance Criteria:**

**Given** un visiteur non connecté
**When** il accède à la page calendrier publique
**Then** il voit la liste des prochains matchs (même format que pour les membres)
**And** la page est rendue côté serveur (SSR) pour le SEO
**And** un call-to-action l'invite à s'inscrire pour participer aux pronostics
**And** la page est accessible depuis la navigation de la page d'accueil

**Given** un visiteur sur le calendrier public
**When** il clique sur un match
**Then** il voit les informations de base du match
**And** il ne voit pas les pronostics des membres (réservé aux connectés)

## Epic 4 : Pronostics & Classements

Les membres pronostiquent les scores des matchs, gagnent des points calculés automatiquement et grimpent au classement — le moteur d'engagement principal de la Penya. Inclut la configuration admin et le lien direct depuis le calendrier.

### Story 4.1 : Configuration Admin des Pronostics

As a admin,
I want configurer les paramètres de pronostic pour chaque match (deadline, barème de points),
So that les pronostics soient cadrés avant l'ouverture aux membres.

**Acceptance Criteria:**

**Given** un admin sur la page d'administration d'un match existant
**When** il configure les paramètres de pronostic
**Then** il peut définir la deadline de soumission (date/heure)
**And** il peut choisir le barème de points (score exact, bon résultat, bon écart, etc.)
**And** la validation Zod vérifie la cohérence (deadline avant le coup d'envoi)
**And** les paramètres sont sauvegardés en base sur la table `matches`
**And** un message de succès confirme la configuration

**Given** un match sans configuration de pronostic
**When** un membre consulte ce match
**Then** le formulaire de pronostic n'est pas affiché (pronostics pas encore ouverts)

### Story 4.2 : Soumettre et Modifier un Pronostic

As a membre,
I want soumettre un pronostic de score pour un match à venir et le modifier tant que la deadline n'est pas dépassée,
So that je puisse participer au jeu et ajuster mon prono si je change d'avis.

**Acceptance Criteria:**

**Given** un membre connecté sur la page de détail d'un match avec pronostics ouverts
**When** il soumet son pronostic (score domicile + score extérieur)
**Then** le pronostic est enregistré dans la table `match_predictions`
**And** la confirmation est affichée en moins de 2 secondes — NFR3
**And** l'Optimistic UI via `useFetcher()` donne un feedback instantané
**And** la validation Zod vérifie les scores (entiers positifs)

**Given** un membre ayant déjà soumis un pronostic
**When** il modifie son pronostic avant la deadline
**Then** le pronostic est mis à jour en base
**And** la modification est confirmée

**Given** un membre tentant de soumettre/modifier après la deadline
**When** la deadline est dépassée
**Then** le formulaire est verrouillé avec un message explicite ("Deadline dépassée")
**And** l'erreur métier `PronoDeadlinePassed` est retournée si tentative côté serveur

**Given** un membre sur la page calendrier (FR26)
**When** il clique sur un match à venir
**Then** il accède directement au formulaire de pronostic sur la page de détail du match

### Story 4.3 : Consulter les Pronostics des Autres Membres

As a membre,
I want consulter les pronostics des autres membres après la deadline,
So that je puisse comparer mon prono avec ceux de la communauté et vivre l'attente ensemble.

**Acceptance Criteria:**

**Given** un membre connecté sur la page de détail d'un match dont la deadline est passée
**When** il consulte les pronostics
**Then** il voit la liste de tous les pronostics soumis par les autres membres (pseudo + score prédit)
**And** son propre pronostic est mis en évidence visuellement
**And** les pronostics sont triés de manière lisible (par score, ou par pseudo)

**Given** un membre consultant un match dont la deadline n'est PAS encore passée
**When** il consulte la page du match
**Then** il ne voit que son propre pronostic (s'il en a soumis un)
**And** les pronostics des autres sont masqués avec un message ("Révélés après la deadline")

### Story 4.4 : Calcul Automatique des Points et Saisie du Résultat

As a admin,
I want saisir le résultat final d'un match pour déclencher le calcul automatique des points,
So that les classements se mettent à jour et les membres voient leurs résultats.

**Acceptance Criteria:**

**Given** un admin sur la page d'administration d'un match terminé
**When** il saisit le score final (domicile + extérieur)
**Then** le système calcule automatiquement les points de chaque pronostic selon le barème défini
**And** le calcul utilise la logique dans `app/lib/points.ts`
**And** les points sont enregistrés en base pour chaque prédiction
**And** un événement Redis `prediction:scored` est publié pour notifier les classements
**And** un message de confirmation affiche le nombre de pronostics calculés

**Given** un barème de points standard
**When** le calcul s'exécute
**Then** le score exact rapporte le maximum de points
**And** le bon résultat (victoire/nul/défaite) rapporte des points intermédiaires
**And** un mauvais résultat rapporte 0 point

**Given** un admin qui saisit un résultat par erreur
**When** il modifie le score final
**Then** les points sont recalculés automatiquement pour tous les pronostics du match

### Story 4.5 : Classement Général et Résultats Détaillés

As a membre,
I want consulter le classement général des pronostiqueurs et mes résultats détaillés par match,
So that je puisse suivre ma position et ma progression dans la communauté.

**Acceptance Criteria:**

**Given** un membre connecté sur la page des pronostics
**When** il consulte le classement général
**Then** il voit le classement de tous les membres trié par points cumulés (décroissant)
**And** chaque ligne affiche : position, pseudo, avatar, points totaux, nombre de pronos
**And** sa propre position est mise en évidence visuellement
**And** le classement se met à jour en temps réel via SSE + Redis Pub/Sub — NFR2
**And** l'événement SSE `ranking:updated` est consommé côté client

**Given** un membre sur la page des pronostics
**When** il consulte ses résultats détaillés
**Then** il voit l'historique de ses pronostics par match (score prédit, score réel, points gagnés)
**And** les matchs sont triés du plus récent au plus ancien
**And** un résumé affiche ses stats (total points, meilleur prono, taux de réussite)

**Given** aucun match avec résultat enregistré
**When** le membre consulte le classement
**Then** un état vide encourageant est affiché ("Les premiers points arrivent bientôt !")

## Epic 5 : Fil Communautaire

Les membres partagent des posts, réagissent, commentent et échangent en temps réel — le cœur social de la Penya. Inclut la modération admin et les annonces officielles.

### Story 5.1 : Publier un Post sur le Fil Communautaire

As a membre,
I want publier un post sur le fil communautaire (texte et/ou image),
So that je puisse partager avec la communauté.

**Acceptance Criteria:**

**Given** un membre connecté sur la page du fil communautaire
**When** il rédige un post (texte obligatoire, image optionnelle) et le publie
**Then** le post est enregistré dans la table `feed_posts` avec l'auteur et le timestamp
**And** l'image est uploadée dans le volume Docker `/uploads` et compressée (WebP/AVIF)
**And** la validation Zod vérifie le contenu (texte non vide, taille image max)
**And** le post apparaît immédiatement en haut du fil grâce à l'Optimistic UI
**And** un événement Redis `feed:new-post` est publié

**Given** un membre tentant de publier un post vide
**When** il soumet le formulaire sans texte
**Then** une erreur de validation est affichée

### Story 5.2 : Consulter le Fil Communautaire avec Temps Réel

As a membre,
I want consulter le fil communautaire avec les posts récents en premier et recevoir les nouveaux posts en temps réel,
So that je reste connecté à la vie de la communauté sans rafraîchir la page.

**Acceptance Criteria:**

**Given** un membre connecté sur la page du fil
**When** la page se charge
**Then** les 20 derniers posts s'affichent instantanément (triés du plus récent au plus ancien) — NFR4
**And** chaque post affiche : auteur (pseudo + avatar), contenu, image (si présente), date, nombre de réactions et commentaires
**And** un skeleton loader s'affiche pendant le chargement

**Given** un membre ayant scrollé jusqu'en bas du fil
**When** il continue de scroller
**Then** les posts suivants se chargent progressivement (pagination infinie / lazy loading) — NFR4

**Given** un membre consultant le fil
**When** un autre membre publie un nouveau post
**Then** le nouveau post apparaît en temps réel en haut du fil via SSE — NFR2
**And** une notification discrète ("Nouveau post") s'affiche si le membre a scrollé vers le bas

### Story 5.3 : Réagir à un Post

As a membre,
I want réagir à un post (likes, réactions),
So that je puisse exprimer mon ressenti rapidement sans écrire un commentaire.

**Acceptance Criteria:**

**Given** un membre connecté consultant un post
**When** il clique sur une réaction (like ou autre type de réaction)
**Then** la réaction est enregistrée dans la table `reactions`
**And** le compteur de réactions se met à jour instantanément via Optimistic UI
**And** un événement Redis est publié pour mettre à jour les autres clients

**Given** un membre ayant déjà réagi à un post
**When** il clique à nouveau sur la même réaction
**Then** sa réaction est retirée (toggle)

**Given** un membre consultant un post
**When** d'autres membres réagissent
**Then** les compteurs de réactions se mettent à jour en temps réel via SSE

### Story 5.4 : Commenter un Post

As a membre,
I want commenter un post,
So that je puisse participer à la discussion et échanger avec la communauté.

**Acceptance Criteria:**

**Given** un membre connecté consultant un post
**When** il rédige et soumet un commentaire
**Then** le commentaire est enregistré dans la table `comments` lié au post
**And** le commentaire apparaît immédiatement sous le post via Optimistic UI
**And** la validation Zod vérifie le contenu (texte non vide)
**And** le compteur de commentaires du post se met à jour

**Given** un membre consultant un post avec des commentaires
**When** il déploie les commentaires
**Then** il voit la liste des commentaires triés par date (du plus ancien au plus récent)
**And** chaque commentaire affiche : auteur (pseudo + avatar), texte, date

**Given** un autre membre ajoutant un commentaire
**When** le fil est ouvert en temps réel
**Then** le nouveau commentaire apparaît via SSE sans rechargement

### Story 5.5 : Modération et Annonces Officielles

As a admin,
I want modérer le fil communautaire et publier des annonces officielles,
So that la bienveillance de la communauté soit protégée et les informations importantes soient visibles.

**Acceptance Criteria:**

**Given** un admin consultant le fil communautaire
**When** il identifie un post ou commentaire inapproprié
**Then** il peut le supprimer avec un bouton de modération
**And** le contenu disparaît du fil pour tous les membres
**And** l'action est loggée côté serveur (Pino)

**Given** un admin souhaitant publier une annonce
**When** il crée un post et coche l'option "Annonce officielle"
**Then** le post est affiché avec une mise en avant visuelle distincte (badge, couleur, épinglage)
**And** l'annonce reste visible en haut du fil (épinglée)

**Given** un utilisateur avec le rôle "membre"
**When** il tente de supprimer le post d'un autre membre ou de publier une annonce
**Then** les options de modération et d'annonce ne sont pas visibles dans son interface

## Epic 6 : Administration & Back-Office

Mrbit gère toute la communauté depuis un tableau de bord centralisé : gestion des membres, événements hors-match, rôles et paramètres de l'application.

### Story 6.1 : Tableau de Bord Admin

As a admin,
I want accéder à un tableau de bord avec les indicateurs clés de la communauté,
So that je puisse suivre la santé de la Penya d'un coup d'œil.

**Acceptance Criteria:**

**Given** un admin connecté
**When** il accède au back-office (`_admin.dashboard`)
**Then** il voit un tableau de bord avec les KPIs suivants :
**And** nombre de membres actifs (et évolution)
**And** taux de participation aux pronos (par match récent)
**And** activité du fil communautaire (posts/réactions/commentaires sur la période)
**And** nombre de nouveaux inscrits récents
**And** le layout admin avec sidebar est affiché pour la navigation entre les sections
**And** la page est responsive mobile-first

**Given** un utilisateur avec le rôle "membre"
**When** il tente d'accéder à `/admin/dashboard`
**Then** l'accès est refusé (403) et il est redirigé — NFR8

### Story 6.2 : Gestion des Membres

As a admin,
I want consulter la liste des membres et gérer leurs comptes (valider, suspendre, supprimer),
So that je puisse administrer la communauté et protéger son esprit bienveillant.

**Acceptance Criteria:**

**Given** un admin sur la page de gestion des membres
**When** il consulte la liste
**Then** il voit tous les membres avec : pseudo, email, rôle, statut (actif/suspendu), date d'inscription
**And** il peut filtrer et rechercher par pseudo ou email
**And** la liste est paginée

**Given** un admin consultant un membre
**When** il valide un compte en attente
**Then** le statut du membre passe à "actif"

**Given** un admin consultant un membre actif
**When** il suspend le compte
**Then** le membre ne peut plus se connecter
**And** sa session Redis est invalidée immédiatement

**Given** un admin consultant un membre
**When** il supprime le compte
**Then** une confirmation est demandée
**And** les données personnelles sont supprimées conformément au RGPD — NFR9
**And** les pronostics et posts sont anonymisés (pas supprimés)

### Story 6.3 : Gestion des Événements Hors-Match

As a admin,
I want créer et gérer des événements communautaires (titre, date, description, lieu),
So that la communauté puisse se retrouver en dehors des soirs de match.

**Acceptance Criteria:**

**Given** un admin sur la page de gestion des événements
**When** il crée un nouvel événement
**Then** il renseigne : titre, date, heure, description, lieu
**And** la validation Zod vérifie les champs obligatoires
**And** l'événement est enregistré dans la table `events`
**And** un message de succès confirme la création

**Given** un admin sur la liste des événements
**When** il modifie un événement existant
**Then** il peut mettre à jour tous les champs
**And** les modifications sont sauvegardées

**Given** un admin sur la liste des événements
**When** il supprime un événement
**Then** une confirmation est demandée avant suppression

### Story 6.4 : Gestion des Rôles et Paramètres de l'Application

As a admin,
I want gérer les rôles des utilisateurs et configurer les paramètres généraux de l'app,
So that je puisse déléguer l'administration et adapter l'application aux besoins de la communauté.

**Acceptance Criteria:**

**Given** un admin sur la page de gestion des rôles
**When** il modifie le rôle d'un utilisateur
**Then** il peut attribuer les rôles : membre, admin, partenaire
**And** le changement prend effet immédiatement
**And** la session du membre concerné est mise à jour

**Given** un admin tentant de retirer son propre rôle admin
**When** il modifie son propre rôle
**Then** l'action est bloquée avec un message d'avertissement (protection contre le verrouillage)

**Given** un admin sur la page des paramètres
**When** il configure les paramètres généraux
**Then** il peut modifier : nom de la communauté, description, informations de contact
**And** les paramètres sont sauvegardés et appliqués immédiatement

## Epic 7 : Accès Partenaire Bar *(Phase 2)*

Le patron du bar consulte les statistiques d'engagement de la communauté et le nombre de pronostics par match pour anticiper la fréquentation. Différé Phase 2, conforme au PRD.

**FRs couverts :** FR32, FR33

*Stories à détailler lors de la planification de la Phase 2.*
