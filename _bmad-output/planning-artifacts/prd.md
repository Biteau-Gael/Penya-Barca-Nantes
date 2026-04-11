---
stepsCompleted: ['step-01-init', 'step-02-discovery', 'step-02b-vision', 'step-02c-executive-summary', 'step-03-success', 'step-04-journeys', 'step-05-domain-skipped', 'step-06-innovation-skipped', 'step-07-project-type', 'step-08-scoping', 'step-09-functional', 'step-10-nonfunctional', 'step-11-polish', 'step-12-complete']
workflowCompleted: true
completedAt: '2026-04-10'
inputDocuments: ['brainstorming/brainstorming-session-2026-04-10.md']
workflowType: 'prd'
documentCounts:
  briefs: 0
  research: 0
  brainstorming: 1
  projectDocs: 0
classification:
  projectType: web_app
  domain: community_entertainment
  complexity: low-medium
  projectContext: greenfield
---

# Product Requirements Document — Penya Barca Nantes

**Auteur :** Mrbit
**Date :** 2026-04-10

## Résumé Exécutif

Penya Barca Nantes est une application web communautaire conçue pour rassembler les supporters du FC Barcelone dans la région nantaise autour d'une passion commune. La plateforme constitue l'épine dorsale digitale des Barcelonais Nantais — une Penya locale ancrée au Bar Solo Nantais comme point de ralliement physique.

**Le problème :** Des culers isolés dans une ville sans communauté structurée et bienveillante pour les supporters de clubs étrangers. Ils regardent les matchs seuls, subissent la toxicité des réseaux sociaux, et n'ont aucun espace pour vivre leur passion collectivement.

**La solution :** Une app qui combine un fil d'actualité social, un jeu de pronostics gratuits avec gamification (streaks, classements, resets saisonniers), la gestion des membres, la coordination d'événements et un affichage temps réel au bar — créant une boucle d'engagement sur 365 jours qui dépasse largement les soirées de match.

### Ce qui rend ce produit unique

Aucune plateforme comparable n'existe pour les communautés Barça locales. Les alternatives actuelles — groupes WhatsApp, serveurs Discord, Google Forms — sont fragmentées, sans âme, et échouent à créer un sentiment d'appartenance. Cette app offre une expérience moderne, interactive et intuitive : un fil communautaire vivant, des flux de pronostics au design blaugrana soigné, des classements en temps réel, et une gamification sans risque qui récompense l'engagement sans aucun pari financier.

Le timing est idéal — la renaissance du FC Barcelone post-reconstruction ravive la passion mondiale des fans, et le groupe fondateur vit déjà cette communauté de manière organique depuis plus d'un an. L'app formalise ce qui existe déjà et ouvre la porte à tous ceux qui veulent en être.

## ADN & Principes de Design

Les valeurs fondatrices de la communauté guident chaque décision de design, de ton et d'expérience utilisateur dans l'app.

### Valeurs Fondatrices

- **Bienveillance > Élitisme** — Aucun gatekeeping. Pas besoin de connaître le XI de 2009 pour être accepté. Fan depuis 20 ans ou 2 semaines, tout le monde est bienvenu.
- **Légèreté > Sérieux** — Le ton est fun, décontracté, jamais agressif. On chambre, on rigole, zéro prise de tête.
- **Ouverture > Exclusivité** — La porte d'entrée est douce. Le curieux peut venir sans engagement, traîner, voir l'ambiance. Le passage de visiteur à membre se fait naturellement, pas sous pression.

### Application au Design

- **Ton de l'interface :** Chaleureux, inclusif, jamais formel. Les messages système et les notifications parlent comme un ami, pas comme une institution.
- **Onboarding :** Zéro friction. Pas de questionnaire, pas de validation sociale. "Viens comme tu es."
- **Modération :** La bienveillance est protégée activement. Le contenu toxique ou élitiste est modéré pour préserver le safe space culer.
- **Identité visuelle :** Couleurs blaugrana assumées. L'app doit donner la fierté de supporter le Barça — un mur de blaugrana digital.

## Classification du Projet

- **Type de projet :** Application Web Responsive MPA (mobile-first, potentiel PWA)
- **Domaine :** Communauté / Divertissement Social
- **Complexité :** Low-Medium — pas de contraintes réglementaires ; complexité liée aux fonctionnalités temps réel, mécaniques sociales et back-office admin
- **Contexte du projet :** Greenfield — nouveau produit créé de zéro

## Critères de Succès

### Succès Utilisateur

- **Le moment "chez soi" :** Un nouveau membre discute avec des gens rencontrés via l'app comme si c'étaient des amis d'enfance. Quand il entre au Bar Solo et qu'on l'accueille comme un membre de la famille, le produit a réussi.
- **L'habitude du soir de match :** Les membres viennent à quasiment tous les matchs — c'est LE moment garanti de convivialité dans leur semaine.
- **Engagement quotidien :** Les membres ouvrent l'app tous les jours pour consulter le fil d'actu, réagir aux news, parcourir les pronostics et rester connectés à leur groupe.

### Succès Business

- **Taux de participation aux pronos :** 70-80% des membres actifs soumettent régulièrement leurs pronostics avant les matchs.
- **Présence au bar :** 20+ membres présents lors d'un soir de match typique, créant une énergie visible qui attire naturellement les curieux.
- **Rétention plutôt que volume :** Le succès se mesure par la profondeur d'engagement (présence récurrente, ouvertures quotidiennes, streaks de pronos) plutôt que par le nombre brut de membres.
- **Croissance organique :** Les nouveaux membres rejoignent par bouche-à-oreille et par la visibilité au bar.

### Succès Technique

- **Responsive mobile-first :** Expérience impeccable sur smartphone.
- **Fiabilité temps réel :** Pronostics, classements et fil communautaire se mettent à jour sans lag.
- **Onboarding intuitif :** Compte créé, fil parcouru et premier pronostic soumis en moins de 2 minutes.
- **Stabilité de l'écran bar :** Fonctionnement fiable pendant toute la soirée de match.

### Résultats Mesurables

| Métrique | Cible | Échéance |
|----------|-------|----------|
| Participation aux pronos | 70-80% des membres actifs | Par match |
| Présence soir de match au bar | 20+ membres | En continu |
| Fréquence d'ouverture de l'app | Quotidienne (membres actifs) | Moyenne hebdo |
| Complétion de l'onboarding | < 2 minutes | Par nouveau membre |
| Engagement fil communautaire | Posts/réactions quotidiennes | Hebdomadaire |

## Parcours Utilisateur

### Parcours 1 : Karim, le culer isolé — Le chemin vers "chez soi"

**Qui :** Karim, 28 ans, fan du Barça depuis l'enfance. Il regarde les matchs seul, subit la toxicité des réseaux sociaux, et n'a jamais osé porter son maillot en public à Nantes.

**Scène d'ouverture :** Mardi soir, 21h. Karim est seul dans son salon. Il scrolle Twitter pendant la mi-temps et tombe sur des commentaires toxiques. Un ami lui envoie un lien : "Regarde ça, y'a un groupe de culers à Nantes."

**Action montante :** Karim ouvre l'app, découvre le fil d'actu — des gens enthousiastes, des discussions bienveillantes, des pronos pour le prochain match. Il crée son compte en moins de 2 minutes, soumet son premier pronostic. Le vendredi, il voit sur le fil que tout le monde se retrouve au Bar Solo.

**Climax :** Samedi soir, Karim pousse la porte du bar. Maillots blaugrana, hymne, pseudos reconnus. "Eh, t'es Karim_FCB ? Ton prono est chaud, viens t'asseoir avec nous !" Il se sent instantanément chez lui.

**Résolution :** Karim vient désormais à quasiment tous les matchs. Il ouvre l'app chaque jour. Il a amené deux amis. Le Barça est redevenu une source de joie pure.

> **Capacités révélées :** Onboarding rapide, fil communautaire engageant, système de pronos accessible, profils membres, calendrier des matchs, lien identité digitale ↔ expérience physique.

---

### Parcours 2 : Sophie, la curieuse du bar — De passante à membre

**Qui :** Sophie, 32 ans, supporte le Barça depuis l'ère Messi mais ne connaît personne à Nantes qui partage cette passion.

**Scène d'ouverture :** Un mercredi soir, Sophie passe devant Le Bar Solo. Elle entend des cris de joie, voit des drapeaux blaugrana. Elle pousse la porte par curiosité.

**Action montante :** Un membre l'aborde naturellement : "Tu supportes le Barça ? Viens, installe-toi !" On lui parle de l'app, elle scanne un QR code, crée son compte sur place. Elle soumet son premier prono directement depuis le bar.

**Climax :** Le dimanche suivant, elle revient. On la reconnaît, on l'appelle par son prénom. Son prono était presque juste — tout le monde la chambre gentiment. Elle se sent appartenir.

**Résolution :** Sophie est devenue une habituée. Elle consulte l'app quotidiennement, participe aux événements hors-match. Elle a trouvé sa bande.

> **Capacités révélées :** Inscription simplifiée (QR code), accueil du nouveau membre, transition visiteur → membre, accessibilité mobile au bar.

---

### Parcours 3 : Mrbit, l'admin fondateur — Orchestrer la communauté

**Qui :** Mrbit, fondateur de la Penya. Il veut que l'app lui facilite la vie plutôt que lui en rajouter.

**Scène d'ouverture :** Lundi matin. Mrbit ouvre le back-office pour préparer la semaine. Trois matchs du Barça sont prévus.

**Action montante :** Il configure les trois matchs dans le calendrier. Les pronostics s'ouvrent automatiquement. Il rédige un post sur le fil d'actu, vérifie les 3 nouveaux inscrits de la semaine, valide leurs comptes, consulte le classement des pronos.

**Climax :** Samedi soir au bar. L'app tourne, les pronos sont affichés à l'écran, l'ambiance bat son plein. Mrbit annonce le MVP de la soirée. Tout roule — l'app fait le boulot, lui il profite.

**Résolution :** La gestion de la communauté ne lui prend que quelques minutes par semaine. Il se concentre sur ce qui compte : être présent avec les gens.

> **Capacités révélées :** Back-office admin (CRUD matchs, membres, événements, posts), configuration des pronos, modération du fil, tableau de bord.

---

### Parcours 4 : Antoine, le patron du Bar Solo — Le partenaire gagnant

**Qui :** Antoine, gérant du Bar Solo Nantais. Il cherche à remplir son bar les soirs de semaine.

**Scène d'ouverture :** Antoine regarde son planning. Mardi et mercredi, normalement c'est mort. Mais le Barça joue mardi soir.

**Action montante :** Il ouvre l'app avec son accès partenaire. 18 personnes ont déjà pronostiqué pour mardi — du monde garanti. Il prépare son stock en conséquence.

**Climax :** Mardi soir, 25 personnes sont là. Le bar est vivant un soir habituellement vide.

**Résolution :** Antoine n'a plus de soirées mortes les soirs de match. Il co-finance les récompenses parce que le retour est évident. La Penya est son meilleur investissement marketing.

> **Capacités révélées :** Accès partenaire avec visibilité sur l'engagement, statistiques de participation, anticipation de la fréquentation.

---

### Résumé des Capacités Révélées par les Parcours

| Capacité | Parcours concernés |
|----------|-------------------|
| Onboarding rapide (< 2 min) | Karim, Sophie |
| Fil communautaire (posts, réactions) | Karim, Sophie, Mrbit |
| Système de pronostics avant-match | Karim, Sophie, Mrbit |
| Classements et stats | Karim, Sophie, Antoine |
| Calendrier des matchs | Karim, Mrbit |
| Profils membres | Karim, Sophie |
| Back-office admin (matchs, membres, événements) | Mrbit |
| Modération du fil d'actu | Mrbit |
| MVP de la soirée | Mrbit |
| Accès partenaire / stats d'engagement | Antoine |
| Écran d'affichage bar | Karim, Sophie, Mrbit, Antoine |
| Inscription simplifiée (QR code) | Sophie |
| Accueil nouveau membre | Sophie |

## Expérience Communautaire — Rituels IRL

Ces rituels physiques ne sont pas des fonctionnalités de l'app mais définissent l'expérience vécue au bar. Ils servent de référence pour le design (ambiance, ton, interactions) et pourront inspirer des fonctionnalités futures.

### Rituels Avant-Match

- **Lancement d'avant-match** — 30 min avant le coup d'envoi : hymne du Barça, affichage des pronos sur écran, tour de table "votre prono ce soir ?".
- **Dress code culer** — Chaque soir de match, les membres portent un signe du Barça (maillot, écharpe, casquette). Un mur de blaugrana dans le bar.

### Rituels Pendant le Match

- **Le son du but** — Dès que le Barça marque, un son iconique se lance. Le son déclenche la réaction collective.
- **La célébration physique** — Le but = câlins, accolades, bras en l'air. L'émotion partagée avec son corps. La raison d'être du lieu physique.

### Rituels Après-Match

- **MVP de la soirée** — Le meilleur pronostiqueur est annoncé. La gloire, les applaudissements, et le fameux saucisson.
- **"On lâche rien"** — Après une défaite, on reste ensemble, on débrief, on se remonte le moral. La plupart des bars se vident après une défaite — ici, on reste.
- **Le regard vers l'avant** — Après chaque match, on annonce le prochain. On ne se dit jamais "au revoir" mais "à la prochaine".

### Accueil du Nouveau Membre

- **Bienvenue chaleureuse** — Le nouveau reçoit une pinte offerte ou à prix réduit. "On est contents que tu sois là." L'accueil se vit dans le corps, pas dans l'administratif.

## Exigences Spécifiques Web App

### Vue d'ensemble

Application web multi-pages (MPA) responsive, mobile-first. L'architecture MPA favorise la simplicité de navigation, le référencement naturel et une structure claire par section. Le temps réel est un pilier technique pour l'engagement communautaire.

### Architecture Technique

- **Architecture MPA responsive** — Pages dédiées par fonctionnalité (accueil, fil communautaire, pronos, calendrier, profil, admin). Navigation optimisée mobile-first.
- **Temps réel** — WebSockets ou Server-Sent Events pour les mises à jour instantanées : nouveaux posts, soumissions de pronos, évolution des classements, affichage écran bar.
- **Support navigateurs** — Chrome (mobile + desktop), Safari (iOS + macOS), Firefox, Edge. Priorité mobile avec expérience desktop complète.
- **SEO** — Pages publiques optimisées pour le référencement (accueil, présentation communauté, calendrier). Contenu membres non indexé. Bonus d'acquisition, pas pilier vital.
- **Accessibilité** — Conformité WCAG 2.1 niveau AA.
- **Performance** — Temps de chargement < 3s sur mobile 4G. Lazy loading pour le fil communautaire.

### Implémentation

- **Authentification** — Email + mot de passe, possibilité d'ajout OAuth ultérieurement. Rôles : membre, admin, partenaire bar.
- **Écran bar** — Vue dédiée grand écran, lecture seule, rafraîchissement temps réel automatique.
- **Responsive design** — Mobile-first avec breakpoints desktop. Même base de code.
- **API** — Backend API REST pour alimenter les vues et l'écran bar. Structure préparée pour une éventuelle PWA future.

## Cadrage du Projet & Développement Phasé

### Stratégie MVP

**Approche :** Experience-first — livrer l'expérience communautaire complète dès le jour 1. Le fil d'actu, les pronos et le calendrier forment un ensemble indissociable.

**Ressources :** Développeur solo (Mrbit), sans contrainte de délai. Priorité à la qualité et à la solidité technique.

### Phase 1 — MVP

**Parcours supportés :** Karim (membre), Sophie (curieuse), Mrbit (admin) — parcours complets.

**Capacités :**
- Fil communautaire avec temps réel (posts, réactions, commentaires)
- Système de pronostics avant-match avec classement
- Calendrier des matchs du Barça
- Profils membres (inscription, profil, historique, stats)
- Back-office admin complet (matchs, membres, événements, posts, modération)
- Infrastructure temps réel solide (WebSocket/SSE)
- Pages publiques (accueil, inscription, calendrier)
- Responsive mobile-first

### Phase 2 — Croissance

- Accès partenaire bar (vue engagement pour Antoine)
- Micro-pronos live en cours de match ("prochain buteur ?", "carton avant la mi-temps ?")
- Système de streaks et récompenses bar (pintes à prix réduit, saucisson offert)
- Récompenses à coût zéro (tableau des légendes, badge MVP, reconnaissance communautaire, statut spécial)
- Écran d'affichage dédié au bar
- MVP de la soirée (annonce du meilleur pronostiqueur)
- Gestion d'événements hors-match avec inscription
- Reset saisonnier des classements
- Notification de bienvenue communautaire pour les nouveaux membres

### Phase 3 — Expansion

- Expansion multi-communautés (autres Penyas)
- Suivi des matchs internationaux pendant les trêves
- Gamification avancée (badges, achievements, catalogue de récompenses terroir)
- PWA avec notifications push
- Intégration avec le système du bar (échange automatique de récompenses)

### Mitigation des Risques

**Technique :** Le temps réel est le point critique. Architecture WebSocket/SSE posée dès le début, testée en charge avant le lancement.

**Marché :** Le noyau dur existe depuis +1 an. Les premiers utilisateurs sont garantis. Croissance organique via bouche-à-oreille et visibilité au bar.

**Ressources :** Développeur solo, MVP à taille humaine, pas de deadline. Architecture modulaire pour faciliter une aide future.

## Exigences Fonctionnelles

### Gestion des Membres

- **FR1 :** Un visiteur peut créer un compte membre avec email et mot de passe
- **FR2 :** Un membre peut se connecter et se déconnecter de son compte
- **FR3 :** Un membre peut consulter et modifier son profil (pseudo, avatar, informations personnelles)
- **FR4 :** Un membre peut consulter le profil d'un autre membre
- **FR5 :** Un membre peut consulter son historique de pronostics et ses statistiques personnelles
- **FR6 :** Un admin peut valider, suspendre ou supprimer un compte membre
- **FR7 :** Un admin peut consulter la liste complète des membres et leur statut
- **FR8 :** Un nouveau membre reçoit une notification de bienvenue de la communauté lors de sa première connexion

### Fil Communautaire

- **FR9 :** Un membre peut publier un post sur le fil communautaire (texte, image)
- **FR10 :** Un membre peut réagir à un post (likes, réactions)
- **FR11 :** Un membre peut commenter un post
- **FR12 :** Un membre peut consulter le fil communautaire avec les posts les plus récents en premier
- **FR13 :** Le fil communautaire se met à jour en temps réel sans rechargement de page
- **FR14 :** Un admin peut modérer le fil communautaire (supprimer un post, supprimer un commentaire)
- **FR15 :** Un admin peut publier un post en tant qu'annonce officielle (mise en avant visuelle)

### Système de Pronostics

- **FR16 :** Un membre peut soumettre un pronostic de score pour un match à venir
- **FR17 :** Un membre peut modifier son pronostic tant que la deadline n'est pas dépassée
- **FR18 :** Un membre peut consulter les pronostics des autres membres après la deadline
- **FR19 :** Le système calcule automatiquement les points des pronostics après chaque match
- **FR20 :** Un membre peut consulter le classement général des pronostiqueurs
- **FR21 :** Un membre peut consulter les résultats détaillés de ses pronostics par match
- **FR22 :** Un admin peut configurer un match et ses paramètres de pronostic (deadline, barème de points)
- **FR23 :** Un admin peut saisir le résultat final d'un match pour déclencher le calcul des points

### Calendrier des Matchs

- **FR24 :** Un membre peut consulter le calendrier des prochains matchs du Barça
- **FR25 :** Un membre peut voir les détails d'un match (date, heure, adversaire, compétition, lieu)
- **FR26 :** Un membre peut accéder directement au formulaire de pronostic depuis un match du calendrier
- **FR27 :** Un admin peut créer, modifier et supprimer des matchs dans le calendrier

### Administration & Back-Office

- **FR28 :** Un admin peut accéder à un tableau de bord avec les indicateurs clés (membres actifs, taux de participation pronos, activité du fil)
- **FR29 :** Un admin peut créer et gérer des événements (titre, date, description, lieu)
- **FR30 :** Un admin peut gérer les rôles des utilisateurs (membre, admin, partenaire)
- **FR31 :** Un admin peut configurer les paramètres généraux de l'application

### Accès Partenaire Bar

- **FR32 :** Le partenaire bar peut consulter les statistiques d'engagement de la communauté
- **FR33 :** Le partenaire bar peut voir le nombre de pronostics soumis par match (indicateur de fréquentation prévue)

### Pages Publiques

- **FR34 :** Un visiteur peut consulter une page d'accueil présentant la communauté et ses valeurs
- **FR35 :** Un visiteur peut consulter le calendrier des prochains matchs sans être connecté
- **FR36 :** Un visiteur peut accéder à une page d'inscription pour rejoindre la communauté

## Exigences Non-Fonctionnelles

### Performance

- Les pages se chargent en moins de 3 secondes sur mobile 4G
- Les mises à jour temps réel (fil, pronos, classements) sont délivrées en moins de 1 seconde
- La soumission d'un pronostic est confirmée en moins de 2 secondes
- Le fil communautaire charge les 20 derniers posts instantanément, avec chargement progressif pour l'historique

### Sécurité

- Toutes les communications chiffrées en transit (HTTPS/TLS)
- Mots de passe hashés et salés (jamais stockés en clair)
- Sessions utilisateur expirent après une période d'inactivité
- Séparation stricte des rôles : membre, admin, partenaire — aucun accès croisé non autorisé
- Conformité RGPD : consentement explicite, droit d'accès, de rectification et de suppression des données personnelles
- Données stockées : email, pseudo, avatar, historique de pronos. Pas de données de paiement (renvoi vers Revolut externe)

### Scalabilité

- Le système supporte 500 utilisateurs simultanés un soir de match sans dégradation
- L'architecture temps réel supporte 500 connexions persistantes en parallèle
- Le système gère les pics d'activité (pronos avant deadline, posts pendant un but) sans perte de données
- Architecture dimensionnée pour le MVP, conçue pour monter en charge au-delà

### Accessibilité

- Conformité WCAG 2.1 niveau AA
- Contrastes de couleurs suffisants (ratio minimum 4.5:1 pour le texte)
- Navigation au clavier fonctionnelle sur toutes les pages
- Labels ARIA et textes alternatifs sur les éléments interactifs et images
- Tailles de police lisibles sur mobile sans zoom

### Disponibilité

- Disponibilité cible de 99% sur une base mensuelle
- Les soirs de match du Barça sont des périodes critiques — indisponibilité à éviter en priorité
- En cas de panne, l'expérience au bar continue (dégradation gracieuse) mais l'objectif reste la disponibilité maximale
