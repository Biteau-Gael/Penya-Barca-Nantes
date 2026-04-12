# Phase 2 — Roadmap Croissance

> Document de planification des fonctionnalites post-MVP.
> Chaque priorite est documentee avec son contexte, son perimetre fonctionnel, ses criteres d'acceptation et ses considerations techniques.

---

## Vue d'ensemble

| # | Feature | Effort | Impact | Epic |
|---|---------|--------|--------|------|
| P1 | Notifications avant deadline | Faible | Fort | E8 |
| P2 | Dashboard partenaire bar | Faible | Fort (business) | E7 |
| P3 | Page soiree match (live) | Moyen | Tres fort | E9 |
| P4 | Micro-pronostics en live | Moyen | Tres fort | E10 |
| P5 | Series & recompenses bar | Faible | Fort | E11 |
| P6 | PWA + push notifications | Moyen | Fort | E12 |
| P7 | Badges & achievements | Faible | Moyen | E13 |
| P8 | Reset saisonnier classements | Faible | Moyen | E14 |

---

## P1 — Notifications avant deadline

### Contexte

Les membres oublient de pronostiquer. Le taux de participation depend directement des rappels. Sans notification, seuls les membres les plus actifs pensent a pronostiquer avant chaque match.

### Perimetre fonctionnel

- **FR-P1.1** : Un membre recoit un email de rappel 2h avant la deadline d'un pronostic qu'il n'a pas encore soumis
- **FR-P1.2** : Un membre peut desactiver les notifications de rappel depuis son profil
- **FR-P1.3** : L'email contient un lien direct vers le formulaire de pronostic du match
- **FR-P1.4** : L'admin peut voir le taux de participation avant deadline sur le dashboard

### Criteres d'acceptation

- [ ] Un email est envoye exactement 2h avant la deadline pour chaque membre n'ayant pas pronostique
- [ ] L'email contient : adversaire, competition, date/heure, lien direct vers le match
- [ ] Le membre peut se desinscrire des rappels en un clic depuis son profil
- [ ] Aucun email n'est envoye si le membre a deja pronostique
- [ ] Aucun email n'est envoye si le membre a desactive les notifications

### Considerations techniques

- **Service email** : Resend, Postmark ou Amazon SES (cout faible, API simple)
- **Declenchement** : Job cron qui tourne toutes les 15 minutes, verifie les deadlines a venir dans les 2h, envoie les rappels
- **Schema DB** : Ajouter `notificationsEnabled: boolean` au schema user (defaut: true)
- **Table de tracking** : `notification_log` pour eviter les doublons (matchId + userId + type)
- **Alternative** : Si pas de service email, utiliser les push notifications (voir P6)

---

## P2 — Dashboard partenaire bar

### Contexte

Le Bar Solo Nantais est le partenaire physique de la penya. Le barman a besoin de savoir combien de personnes sont attendues les soirs de match pour preparer le service. Le nombre de pronostics soumis est un excellent indicateur d'affluence.

### Perimetre fonctionnel

- **FR-P2.1** : Un utilisateur avec le role "partenaire" peut acceder a un dashboard dedie (`/partenaire`)
- **FR-P2.2** : Le dashboard affiche les 5 prochains matchs avec le nombre de pronostics soumis pour chacun
- **FR-P2.3** : Le dashboard affiche le nombre de membres actifs (ayant pronostique dans les 30 derniers jours)
- **FR-P2.4** : Le dashboard affiche l'historique de frequentation estimee (pronos par match sur les 10 derniers matchs)
- **FR-P2.5** : L'admin peut attribuer le role "partenaire" a un compte

### Criteres d'acceptation

- [ ] Le role "partenaire" existe et donne acces uniquement au dashboard partenaire
- [ ] Le dashboard affiche les matchs a venir avec nombre de pronos / nombre de membres
- [ ] Un graphique simple montre l'evolution de la participation sur les derniers matchs
- [ ] Le partenaire ne peut pas acceder aux donnees personnelles des membres
- [ ] L'interface est simple et lisible sur mobile (le barman utilise son telephone)

### Considerations techniques

- **Role** : Le role "partenaire" existe deja dans le schema Better Auth (member/admin/partner)
- **Route** : `/partenaire` protegee par un middleware de role
- **Donnees** : Requetes d'agregation sur `match_predictions` (count par match, count distinct userId sur 30j)
- **UI** : Page simple avec des cards et un petit graphique (recharts ou chart.js, ou simplement des barres CSS)

---

## P3 — Page soiree match (live)

### Contexte

Les soirs de match, les membres sont soit au bar soit chez eux. Ils veulent vivre le match ensemble, meme a distance. Une page "soiree match" sert de second ecran : score en direct, pronos de la communaute affiches, et fil de reactions en temps reel.

### Perimetre fonctionnel

- **FR-P3.1** : Une page `/soiree/:matchId` affiche le score en direct du match en cours
- **FR-P3.2** : La page affiche les pronostics de tous les membres (reveles apres le coup d'envoi)
- **FR-P3.3** : Un fil de reactions en temps reel permet aux membres de reagir pendant le match (messages courts, emojis)
- **FR-P3.4** : Les evenements du match (buts, cartons, remplacements) apparaissent en temps reel
- **FR-P3.5** : A la fin du match, les points sont calcules et affiches avec un classement de la soiree
- **FR-P3.6** : La page est accessible depuis le calendrier quand un match est en cours

### Criteres d'acceptation

- [ ] Le score se met a jour automatiquement sans recharger la page (polling API toutes les 60s)
- [ ] Les pronostics des membres sont reveles automatiquement au coup d'envoi
- [ ] Le fil de reactions est en temps reel (SSE/WebSocket) avec un debit raisonnable
- [ ] Les reactions sont ephemeres (non stockees au-dela de 24h pour economiser l'espace)
- [ ] Un lien "Soiree en cours" apparait dans le header quand un match est en cours
- [ ] La page fonctionne bien sur mobile (priorite absolue — les membres sont au bar avec leur telephone)

### Considerations techniques

- **Score live** : L'API RapidAPI a un endpoint `Get_LivescoresMatchesEvents` — polling cote serveur toutes les 60s, pousse aux clients via SSE
- **Reactions** : Redis Pub/Sub pour le temps reel. Stockage temporaire dans Redis (TTL 24h) plutot qu'en DB
- **SSE** : Infra deja en place (Redis + SSE mentionne dans l'architecture). Creer un resource route SSE `/api/soiree-stream/:matchId`
- **Evenements match** : Parser les events depuis les lineups API (meme structure que les stats enrichies deja implementees)
- **Detection "en cours"** : Verifier `match.status.started && !match.status.finished` dans les donnees sync

---

## P4 — Micro-pronostics en live

### Contexte

Pendant le match, l'engagement baisse si les membres n'ont rien a faire. Les micro-pronostics sont des questions flash posees pendant le match : "Qui marque le prochain but ?", "Score a la mi-temps ?", "Nombre de corners en 2e MT ?". C'est le moteur d'engagement de la soiree match.

### Perimetre fonctionnel

- **FR-P4.1** : L'admin peut creer un micro-pronostic pendant un match en cours (question + options ou champ libre)
- **FR-P4.2** : Le micro-pronostic apparait en temps reel sur la page soiree de tous les membres
- **FR-P4.3** : Un membre peut repondre a un micro-pronostic dans un delai limite (configurable, defaut 2 minutes)
- **FR-P4.4** : L'admin peut cloturer un micro-pronostic et designer la bonne reponse
- **FR-P4.5** : Les points des micro-pronostics sont attribues immediatement et affiches
- **FR-P4.6** : Un classement temporaire de la soiree integre les points des micro-pronostics

### Criteres d'acceptation

- [ ] Un micro-pronostic arrive en push sur tous les clients connectes a la soiree (SSE)
- [ ] Le compte a rebours est visible et synchronise entre tous les clients
- [ ] La reponse est bloquee apres expiration du delai
- [ ] Les points sont affiches en temps reel apres cloture
- [ ] L'admin peut enchainer plusieurs micro-pronostics dans une soiree
- [ ] Types supportes : QCM (choix multiples), score (2 champs), joueur (selection dans la compo)

### Considerations techniques

- **Depend de P3** : La page soiree match doit exister avant
- **Schema DB** : Nouvelle table `micro_predictions` (id, matchId, question, type, options JSON, deadline, correctAnswer, createdAt)
- **Schema DB** : Nouvelle table `micro_prediction_answers` (id, microPredictionId, userId, answer, points, createdAt)
- **Temps reel** : Meme canal SSE que la soiree match, events de type `micro-prediction-new`, `micro-prediction-closed`
- **Points** : Configurable par l'admin (defaut : 1 pt pour bonne reponse micro)
- **UX** : Toast/modal non-bloquant qui apparait par-dessus la page soiree

---

## P5 — Series & recompenses bar

### Contexte

Le lien entre l'app et le bar physique est la force unique de cette penya. Les series (3 scores exacts d'affilee = boisson offerte) creent un objectif tangible et un rituel communautaire. C'est ce qui transforme un jeu de pronostics en experience sociale.

### Perimetre fonctionnel

- **FR-P5.1** : Le systeme detecte automatiquement les series de scores exacts consecutifs
- **FR-P5.2** : A 3 scores exacts d'affilee, le membre recoit une recompense virtuelle (badge + notification)
- **FR-P5.3** : La recompense est visible sur le profil du membre et dans le classement
- **FR-P5.4** : L'admin peut configurer les paliers de recompense (3, 5, 10 scores exacts)
- **FR-P5.5** : L'admin peut marquer une recompense comme "reclamee" (le membre est venu au bar)
- **FR-P5.6** : Un compteur de serie en cours est visible sur le profil de chaque membre
- **FR-P5.7** : Une notification est envoyee dans le fil communautaire quand un membre atteint un palier

### Criteres d'acceptation

- [ ] La serie est calculee automatiquement apres chaque match (pendant le calcul des points)
- [ ] La serie est remise a zero des qu'un pronostic n'est pas un score exact
- [ ] Les paliers sont configurables par l'admin
- [ ] La recompense apparait sur le profil avec un statut (gagnee / reclamee)
- [ ] Un post automatique est publie dans le fil quand un membre atteint un palier

### Considerations techniques

- **Schema DB** : Ajouter `currentStreak: integer` et `bestStreak: integer` au schema user
- **Schema DB** : Nouvelle table `rewards` (id, userId, type, matchId, claimedAt, createdAt)
- **Calcul** : Integrer dans le flux existant de calcul des points (syncMatches + admin set-result)
- **Configuration** : Table `app_config` ou JSON configurable par l'admin (paliers, noms des recompenses)
- **Fil automatique** : Inserer un `feed_post` avec un flag `isSystem: true` quand un palier est atteint

---

## P6 — PWA + push notifications

### Contexte

L'app est mobile-first mais accessible uniquement via navigateur. Une PWA permet aux membres d'ajouter l'app a leur ecran d'accueil et de recevoir des push notifications (rappels pronos, debut de match, buts). C'est un gain d'engagement enorme pour un effort modere.

### Perimetre fonctionnel

- **FR-P6.1** : L'app est installable en tant que PWA (manifest.json, service worker)
- **FR-P6.2** : Un membre peut installer l'app depuis une banniere "Ajouter a l'ecran d'accueil"
- **FR-P6.3** : Les push notifications sont envoyees pour : rappel de pronostic, debut de match, but marque
- **FR-P6.4** : Un membre peut configurer les types de notifications qu'il souhaite recevoir
- **FR-P6.5** : L'app fonctionne hors-ligne en mode degrade (page cache avec message "Connexion requise")

### Criteres d'acceptation

- [ ] L'app passe l'audit Lighthouse PWA (score > 90)
- [ ] L'icone de l'app apparait sur l'ecran d'accueil avec le logo Penya
- [ ] Les notifications push arrivent sur mobile meme quand l'app est fermee
- [ ] Le membre peut activer/desactiver chaque type de notification independamment
- [ ] Hors-ligne, l'app affiche une page d'attente elegante plutot qu'une erreur navigateur

### Considerations techniques

- **manifest.json** : A creer dans `/public` (nom, icones, couleurs blaugrana, display: standalone)
- **Service worker** : Utiliser Workbox pour le precaching des assets statiques
- **Push** : Web Push API + bibliotheque `web-push` cote serveur. Stocker les subscriptions en DB
- **Schema DB** : Nouvelle table `push_subscriptions` (id, userId, endpoint, keys JSON, createdAt)
- **Preferences** : Ajouter `notificationPrefs: JSON` au schema user (types actives)
- **Declenchement push** : Hook dans le sync (but marque), hook dans le cron deadline (rappel), hook dans le calcul de points (resultat)

---

## P7 — Badges & achievements

### Contexte

La gamification legere renforce l'engagement a long terme. Les badges sont des objectifs secondaires qui recompensent la participation reguliere, pas seulement la performance. Ils encouragent les nouveaux membres a s'investir.

### Perimetre fonctionnel

- **FR-P7.1** : Un systeme de badges recompense des actions specifiques (premier pronostic, 10 pronos, premier score exact, serie de 5, participation a un evenement)
- **FR-P7.2** : Les badges sont visibles sur le profil de chaque membre
- **FR-P7.3** : Une notification est envoyee quand un badge est debloque
- **FR-P7.4** : La liste des badges disponibles est consultable avec la progression de chaque membre
- **FR-P7.5** : L'admin peut creer des badges personnalises (pour des evenements speciaux)

### Criteres d'acceptation

- [ ] Au moins 10 badges de base sont disponibles au lancement
- [ ] Les badges sont attribues automatiquement quand la condition est remplie
- [ ] Les badges apparaissent sur le profil avec icone, nom et date d'obtention
- [ ] Une page `/badges` liste tous les badges avec ceux debloques mis en avant
- [ ] Les badges personnalises sont attribuables manuellement par l'admin

### Badges de base proposes

| Badge | Condition | Icone |
|-------|-----------|-------|
| Premier pas | Soumettre son premier pronostic | Ballon |
| Voyant | Premier score exact | Boule de cristal |
| Regulier | 10 pronostics soumis | Calendrier |
| Fidele | 50 pronostics soumis | Etoile |
| En serie | 3 scores exacts d'affilee | Flamme |
| Commentateur | 10 commentaires sur le fil | Bulle |
| Reactif | 50 reactions sur le fil | Pouce |
| Bienvenue | Se connecter pour la premiere fois | Porte |
| Nocturne | Pronostiquer apres 23h | Lune |
| Culer | Participer a un evenement de la penya | Blason |

### Considerations techniques

- **Schema DB** : Table `badges` (id, key, name, description, icon, condition JSON)
- **Schema DB** : Table `user_badges` (id, userId, badgeId, unlockedAt)
- **Evaluation** : Hook apres chaque action (pronostic, commentaire, reaction) qui verifie les conditions
- **Conditions** : Systeme simple de regles JSON evaluees cote serveur (ex: `{"type": "predictions_count", "threshold": 10}`)
- **Effort faible** : Pas de temps reel necessaire, juste des checks ponctuels

---

## P8 — Reset saisonnier classements

### Contexte

La saison de football dure d'aout a juin. A chaque nouvelle saison, le classement des pronostiqueurs doit repartir a zero pour donner une chance a tout le monde. L'historique des saisons precedentes reste consultable.

### Perimetre fonctionnel

- **FR-P8.1** : L'admin peut declencher un reset saisonnier du classement
- **FR-P8.2** : Le classement actuel est archive avec le label de la saison (ex: "2025-2026")
- **FR-P8.3** : Les points de tous les membres sont remis a zero pour la nouvelle saison
- **FR-P8.4** : Un membre peut consulter les classements des saisons precedentes
- **FR-P8.5** : Le podium de la saison precedente est mis en avant (post automatique dans le fil)

### Criteres d'acceptation

- [ ] Le reset ne supprime aucune donnee — les pronostics et points restent en base
- [ ] Le classement actif ne montre que les points de la saison en cours
- [ ] Une page `/classement/archives` liste les saisons passees avec le podium
- [ ] L'admin a une confirmation avant de declencher le reset (action irreversible du point de vue affichage)
- [ ] Un post automatique annonce le podium de la saison terminee dans le fil

### Considerations techniques

- **Schema DB** : Ajouter `season: varchar` au schema matches (ex: "2025-2026")
- **Schema DB** : Table `seasons` (id, label, startDate, endDate, isActive)
- **Classement** : La query de classement filtre par `season.isActive = true` au lieu de tout sommer
- **Archives** : Meme query de classement mais filtree par seasonId
- **Minimal** : Pas de migration complexe — ajouter le champ season et backfill les matchs existants avec "2025-2026"

---

## Dependances entre priorites

```
P1 (Notifications email) ─── standalone
P2 (Dashboard bar) ─────── standalone
P3 (Soiree match) ─────── standalone
P4 (Micro-pronostics) ──── depend de P3
P5 (Series & recompenses) ─ standalone (enrichi par P7)
P6 (PWA + push) ─────────── standalone (remplace/enrichit P1)
P7 (Badges) ──────────────── standalone (enrichi par P5)
P8 (Reset saisonnier) ───── standalone
```

## Ordre d'implementation recommande

**Sprint 1** : P1 + P2 (effort faible, impact immediat, standalone)
**Sprint 2** : P3 (page soiree — fondation pour P4)
**Sprint 3** : P4 + P5 (micro-pronos + series — experience match complete)
**Sprint 4** : P6 (PWA — consolidation de l'engagement)
**Sprint 5** : P7 + P8 (badges + saisons — polish et perennite)
