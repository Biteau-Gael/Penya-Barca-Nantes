# Story 1.4 : Page d'Accueil Publique

Status: review

## Story

As a visiteur (non connecte),
I want decouvrir une page d'accueil presentant la communaute et ses valeurs,
so that je comprenne ce qu'est la Penya et que j'aie envie de la rejoindre.

## Acceptance Criteria

1. Un visiteur non connecte voit une presentation chaleureuse de la communaute (valeurs : bienveillance, legerete, ouverture)
2. Le design est blaugrana avec le branding de la Penya
3. Un call-to-action visible invite a rejoindre la communaute (lien vers inscription)
4. La page est rendue cote serveur (SSR) pour le SEO
5. La page se charge en moins de 3 secondes sur mobile 4G — NFR1
6. La page est responsive mobile-first
7. La navigation affiche les liens vers le calendrier public et l'inscription
8. Un membre deja connecte voit une navigation vers son espace (fil, pronos, profil)

## Tasks / Subtasks

- [x] Task 1 : Refactorer la page d'accueil existante (AC: #1, #2, #3, #4, #6)
  - [x] 1.1 Remplacer le contenu de `app/routes/home.tsx` par la page d'accueil Penya :
    - Section hero : titre "Penya Blaugrana Nantes", sous-titre accueillant, CTA "Rejoindre la communaute"
    - Section valeurs : 3 cartes (Bienveillance, Legerete, Ouverture) avec icones et descriptions
    - Section "Comment ca marche" : 3 etapes (S'inscrire, Pronostiquer, Vivre les matchs)
    - Section CTA final : invitation a rejoindre avec bouton vers `/inscription`
  - [x] 1.2 Utiliser les composants shadcn/ui (Card, Button) et les couleurs blaugrana
  - [x] 1.3 La page est une route `index` — rendue en SSR par defaut (AC #4)
  - [x] 1.4 Aucun JS cote client necessaire pour le rendu initial (HTML pur SSR)

- [x] Task 2 : SEO et meta tags (AC: #4)
  - [x] 2.1 Ajouter la fonction `meta()` dans `home.tsx` :
    ```typescript
    export const meta: Route.MetaFunction = () => [
      { title: "Penya Blaugrana Nantes — Communaute culer" },
      { name: "description", content: "Rejoins la communaute des supporters du FC Barcelone a Nantes. Pronostics gratuits, soirees match au bar, et bienveillance culer." },
    ];
    ```

- [x] Task 3 : Navigation conditionnelle dans le header (AC: #7, #8)
  - [x] 3.1 Mettre a jour `app/components/layout/header.tsx` :
    - Non connecte : liens "Calendrier" (vers `/calendrier`, desactive pour l'instant), "Connexion", bouton "S'inscrire"
    - Connecte : liens "Fil" (desactive), "Pronos" (desactive), "Profil" (desactive), pseudo, bouton "Deconnexion"
    - Les liens desactives pointent vers `#` avec un style `opacity-50 cursor-not-allowed` et un `title` explicatif
  - [x] 3.2 Navigation responsive : sur mobile, les liens sont compacts (icones ou menu simplifie)

- [x] Task 4 : Performance et accessibilite (AC: #5, #6)
  - [x] 4.1 Verifier que la page ne charge aucune ressource lourde (pas d'images non optimisees)
  - [x] 4.2 Contrastes WCAG 2.1 AA sur tous les textes (NFR15)
  - [x] 4.3 Navigation clavier fonctionnelle sur tous les elements interactifs (NFR16)
  - [x] 4.4 Textes alternatifs sur les elements visuels (NFR17)

- [x] Task 5 : Tests (AC: #1-#8)
  - [x] 5.1 Executer `npm run test:run` — TOUS les tests passent a 100%

## Dev Notes

### Learnings Stories 1.1-1.3 (CRITIQUE)

- **Routes RR7 :** toutes dans `app/routes.ts` via `route()` ou `index()`
- **Header global :** deja dans `root.tsx` avec loader session — la nav conditionnelle est deja en place
- **SSR :** active par defaut dans `react-router.config.ts` (`ssr: true`)
- **Composants shadcn/ui dispo :** button, card, input, label
- **Palette blaugrana :** primary (#A50044), secondary (#004D98), accent (#EDBB00)

### Fichiers a modifier (NE PAS recreer)

| Fichier | Action |
|---------|--------|
| `app/routes/home.tsx` | REMPLACER le contenu (page accueil scaffold → page Penya) |
| `app/components/layout/header.tsx` | MODIFIER la nav (ajout liens futurs) |

### Fichiers a NE PAS toucher

- `app/routes.ts` — la route index pointe deja vers `routes/home.tsx`
- `app/root.tsx` — le header et le loader session sont deja en place

### Design Guidelines (du PRD)

- **Ton :** Chaleureux, inclusif, jamais formel. "Viens comme tu es."
- **Valeurs a presenter :**
  - **Bienveillance > Elitisme** — Pas besoin de connaitre le XI de 2009
  - **Legerete > Serieux** — Fun, decontracte, zero prise de tete
  - **Ouverture > Exclusivite** — La porte est toujours ouverte
- **CTA principal :** "Rejoindre la communaute" → `/inscription`
- **Pas d'images lourdes :** utiliser des icones ou emojis pour les visuels

### Anti-Patterns

- **NE PAS** ajouter d'images lourdes (performance NFR1)
- **NE PAS** utiliser de JavaScript cote client pour le rendu initial
- **NE PAS** creer de routes supplementaires — la page d'accueil est deja `index`

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.4]
- [Source: _bmad-output/planning-artifacts/prd.md#ADN & Principes de Design]
- [Source: _bmad-output/planning-artifacts/prd.md#Resume Executif]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- Aucun probleme rencontre. SSR fonctionne nativement.

### Completion Notes List

- Page d'accueil refactoree : hero blaugrana, 3 valeurs (Bienveillance/Legerete/Ouverture), 3 etapes, CTA final, footer
- Meta SEO : title + description optimises pour le referencement
- Header enrichi : liens Calendrier/Fil/Pronos (desactives avec tooltip) selon l'etat de connexion
- Responsive mobile-first, pas d'images lourdes, WCAG AA (aria-hidden sur icones decoratives)
- 33 tests passent a 100%

### Change Log

- 2026-04-11 : Implementation Story 1.4 — page d'accueil publique Penya

### File List

- app/routes/home.tsx (modifie — page d'accueil complete Penya)
- app/components/layout/header.tsx (modifie — navigation enrichie)
