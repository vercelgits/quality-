# Orbit

Une plateforme de discussion en temps réel : ce qu'on aime dans Discord, sans
l'historique illisible, la recherche approximative et les trois gigaoctets de
mémoire.

Le client parle directement à Supabase. Il n'y a aucun serveur applicatif à
déployer, à réveiller ou à surveiller — la sécurité repose entièrement sur les
politiques RLS de Postgres.

---

## Ce qui change par rapport à Discord

**Des fils qui se referment.** Un fil porte un statut explicite : ouvert ou
résolu. Tant qu'il est ouvert, il remonte dans une barre latérale « À suivre ».
Une question posée dans un salon actif ne se perd donc plus dans le défilement.

**Une recherche qui trouve.** Index plein texte Postgres avec la configuration
française (racinisation, mots vides) et insensibilité aux accents : « reunion »
trouve « réunion ». Classement combinant pertinence `ts_rank_cd` et fraîcheur.
Filtres inline : `de:camille`, `dans:general`, `est:epingle`, `a:fichier`,
`avant:2026-01-01`.

**Des messages qu'on garde pour soi.** Discord n'a que l'épinglage, qui est
collectif. Ici chacun met un message de côté sans l'imposer au salon.

**Un historique des modifications.** Discord affiche « modifié » sans jamais dire
ce qui a changé. Les versions précédentes sont conservées.

**Des sondages qui sont des messages.** Ils s'épinglent, se citent et se
retrouvent par la recherche. Choix multiple, résultats masquables jusqu'à la
clôture, fermeture programmée.

**Une modération qui laisse une trace.** Quatre rangs, exclusion de parole,
bannissement temporaire, verrouillage de salon, mode lent, signalements et
journal d'audit complet.

**Léger côté livraison.** 168 ko gzippés pour le web, un seul aller-retour au
démarrage, pas de bibliothèque d'icônes. En version bureau, l'installateur pèse
1,3 Mo et l'exécutable 3,4 Mo, contre plusieurs dizaines de mégaoctets pour une
application Electron équivalente.

**Une interface qui se règle.** Thème monochrome clair et sombre, trois densités,
palette de commandes (`Ctrl+K`), respect de `prefers-reduced-motion`.

**Vocal en pair à pair.** WebRTC direct : l'audio ne transite jamais par un
serveur. Partage d'écran, détection de parole, indicateurs micro et casque.

---

## Mise en route

### 1. Dépendances

```bash
npm install
```

### 2. Configuration

```bash
cp .env.example .env.local
```

Renseignez `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY`, disponibles
dans **Project Settings → API**.

La clé publiable est faite pour vivre dans le navigateur : ce qui protège les
données, ce sont les politiques RLS, pas le secret de cette clé. **Ne mettez
jamais la clé `service_role` dans ce fichier.**

### 3. Appliquer le schéma

Sans cette étape, l'application se connecte mais ne trouve aucune table.

```bash
npx supabase link --project-ref VOTRE_REF_PROJET
```

```bash
npx supabase db push
```

Sans la CLI : collez tout [`supabase/schema.sql`](supabase/schema.sql) dans
l'éditeur SQL de Supabase. Le script est idempotent — **le rejouer après une
mise à jour est la façon normale de récupérer les nouvelles migrations.**

### 4. Authentification

Dans **Authentication → Providers → Email**, désactivez *Confirm email* pour
tester tout de suite ; laissez-le actif en production avec un expéditeur SMTP.

### 5. Lancer

```bash
npm run dev
```

---

## Application de bureau

L'enveloppe utilise **Tauri**, qui s'appuie sur le WebView2 déjà présent dans
Windows plutôt que d'embarquer sa propre copie de Chromium.

Ce que cela gagne, mesuré sur cette application : l'exécutable fait **3,4 Mo** et
l'installateur **1,3 Mo**, là où Electron en embarquerait plusieurs dizaines.

Ce que cela ne gagne pas : la mémoire vive. WebView2 lance un Chromium
multi-processus comme le ferait Electron. Orbit occupe **environ 390 Mo** au
repos — 26 Mo pour le processus Rust, le reste réparti sur six processus
WebView2. C'est nettement moins que Discord, qui dépasse couramment le
gigaoctet, mais ce n'est pas « la mémoire d'un onglet ».

Il faut la chaîne Rust, une seule fois :

```bash
winget install Rustlang.Rustup
```

Puis, dans un nouveau terminal :

```bash
npm run desktop
```

Et pour produire l'installateur `.exe` :

```bash
npm run desktop:build
```

Le résultat atterrit dans `src-tauri/target/release/bundle/nsis/`.

La version bureau ajoute une icône de barre des tâches, l'instance unique
(relancer l'application réveille la fenêtre au lieu d'en ouvrir une seconde), la
fermeture en veille plutôt que l'arrêt, et les notifications système.

---

## Structure

```
supabase/migrations/   Schéma, sécurité, fonctions, stockage, modération, features
supabase/schema.sql    Les migrations concaténées, pour l'éditeur SQL
src-tauri/             Enveloppe de bureau
src/types/db.ts        Formes exactes des lignes Postgres
src/lib/               Supabase, temps réel, texte enrichi, dates, envoi, notifications
src/store/             État : session, données, navigation, modération
src/features/          Écrans et panneaux
src/styles/            Jetons de design, réinitialisation, mise en page
```

### Le modèle

Ce que Discord appelle un « serveur » s'appelle ici un **space**, ce qui évite la
confusion entre l'infrastructure et la communauté.

Vingt tables, toutes protégées par RLS : profils, espaces, membres, catégories,
salons, fils, messages, pièces jointes, réactions, états de lecture,
bannissements, exclusions de parole, journal de modération, signalements,
sondages et leurs votes, signets, historique des modifications.

### Rangs

| Rang | Peut |
| --- | --- |
| `owner` | Tout, y compris nommer des administrateurs |
| `admin` | Gérer salons et catégories, nommer des modérateurs |
| `moderator` | Sanctionner, verrouiller, traiter les signalements |
| `member` | Écrire, réagir, ouvrir des fils |

**On n'agit jamais sur un rang égal ou supérieur au sien.** Sans cette règle,
deux modérateurs pourraient s'exclure mutuellement.

### Sécurité

Quatre points méritent d'être connus :

- **Récursion RLS.** Une politique sur `space_members` qui interroge
  `space_members` boucle à l'infini. Les fonctions d'appartenance sont donc
  `SECURITY DEFINER`, ce qui les exécute hors RLS.
- **Rejoindre un espace.** `space_members` n'a aucune politique d'insertion : la
  seule porte d'entrée est `join_space(code)`, qui refuse les bannis.
- **Épingler.** Ce geste modifie le message d'autrui, donc l'`UPDATE` sur
  `messages` reste limité à l'auteur et l'épinglage passe par une fonction.
- **Droit d'écrire.** `can_post_in_channel()` vérifie bannissement, exclusion de
  parole, verrou et mode lent côté base. Un client contourné ne permet pas de
  publier malgré une sanction.

---

## Raccourcis clavier

| Raccourci | Effet |
| --- | --- |
| `Ctrl+K` | Palette de commandes |
| `Ctrl+F` | Recherche |
| `Ctrl+,` | Préférences |
| `Entrée` | Envoyer (réglable) |
| `Maj+Entrée` | Retour à la ligne |
| `Échap` | Annuler une réponse ou une modification |

Dans le compositeur : `@` ouvre l'autocomplétion, `↑` `↓` naviguent, `Tab`
valide. On peut glisser un fichier ou coller une image directement.

---

## Mise en forme

`**gras**` · `*italique*` · `__souligné__` · `~~barré~~` · `` `code` `` ·
` ```bloc``` ` · `> citation` · `||spoiler||` · `@mention` · `#salon` ·
`[texte](url)`

Le rendu produit des éléments React, jamais du HTML injecté : un message
contenant du balisage s'affiche comme du texte au lieu de s'exécuter.

---

## Déploiement web

```bash
npm run build
```

`dist/` est un site statique. Définissez `VITE_SUPABASE_URL` et
`VITE_SUPABASE_PUBLISHABLE_KEY` dans les variables de build de l'hébergeur, et
ajoutez l'URL de production dans **Authentication → URL Configuration**.

---

## Limites connues

- **Le vocal est en maillage.** Le coût monte au carré du nombre de
  participants : confortable jusqu'à six ou huit, lourd au-delà. Aller plus loin
  demanderait un serveur de mélange (SFU), qui n'a pas sa place sans backend.
- **Les serveurs STUN sont ceux de Google.** Certains pare-feux d'entreprise
  imposent un relais TURN, qu'il faudra fournir.
- **Pas de messages privés.** Seuls les salons d'espace existent.
- **Le schéma n'a pas été exécuté par l'auteur** contre un Postgres de test : il
  est relu et vérifié structurellement, et les migrations 1 à 4 tournent en
  production. Les migrations 5 et 6 (modération, sondages) restent à valider à
  la première application.
- **Si les sondages manquent en base**, le client bascule automatiquement sur
  une requête sans eux plutôt que de ne plus afficher aucun message.
