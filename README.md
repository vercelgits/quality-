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
Une question posée dans un salon actif ne se perd donc plus dans le défilement,
et on voit d'un coup d'œil ce qui attend encore une réponse.

**Une recherche qui trouve.** Index plein texte Postgres avec la configuration
française (racinisation, mots vides) et insensibilité aux accents : « reunion »
trouve « réunion ». Le classement combine la pertinence `ts_rank_cd` et la
fraîcheur. Filtres inline : `de:camille`, `dans:general`, `est:epingle`,
`a:fichier`, `avant:2026-01-01`.

**Léger.** 158 ko gzippés au total, pas de moteur de navigateur embarqué, pas de
bibliothèque d'icônes. Un seul aller-retour au démarrage (`bootstrap()`) suffit
à peindre toute l'interface.

**Une interface qui se règle.** Thème clair réellement conçu, pas une
arrière-pensée. Trois densités d'affichage. Sept teintes d'accent. Palette de
commandes au clavier (`Ctrl+K`). Respect de `prefers-reduced-motion`.

**Vocal en pair à pair.** WebRTC direct entre participants : l'audio ne transite
jamais par un serveur. Partage d'écran, détection de parole, indicateurs micro
et casque.

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
dans **Project Settings → API** de votre projet Supabase.

La clé publiable est faite pour vivre dans le navigateur : ce qui protège les
données, ce sont les politiques RLS, pas le secret de cette clé. **Ne mettez
jamais la clé `service_role` dans ce fichier.**

### 3. Appliquer le schéma

C'est l'étape indispensable : sans elle, l'application se connecte mais ne
trouve aucune table.

**Avec la CLI Supabase** (recommandé, garde l'historique des migrations) :

```bash
supabase link --project-ref VOTRE_REF_PROJET
```

```bash
supabase db push
```

**Sans la CLI** : ouvrez l'éditeur SQL de Supabase, collez tout le contenu de
[`supabase/schema.sql`](supabase/schema.sql), exécutez. Le script est idempotent :
le rejouer ne casse rien.

### 4. Réglage de l'authentification

Dans **Authentication → Providers → Email** :

- pour tester tout de suite, désactivez *Confirm email* ;
- en production, laissez-le actif et configurez un expéditeur SMTP.

### 5. Lancer

```bash
npm run dev
```

L'application démarre sur <http://localhost:5173>. À la création du compte, un
espace de démarrage est créé automatiquement avec `#general`, `#idees` et un
salon vocal.

---

## Structure

```
supabase/migrations/   Schéma, sécurité, fonctions applicatives, stockage
supabase/schema.sql    Les quatre migrations concaténées, pour l'éditeur SQL
src/types/db.ts        Formes exactes des lignes Postgres
src/lib/               Client Supabase, temps réel, texte enrichi, dates
src/store/             État : session, données, navigation
src/features/          Écrans et panneaux
src/styles/            Jetons de design, réinitialisation, mise en page
```

### Le modèle

Ce que Discord appelle un « serveur » s'appelle ici un **space**, ce qui évite la
confusion permanente entre l'infrastructure et la communauté.

| Table | Rôle |
| --- | --- |
| `profiles` | Profil public, lié à `auth.users` |
| `spaces` | Communauté, avec son code d'invitation |
| `space_members` | Appartenance et rôle |
| `categories`, `channels` | Organisation des salons |
| `threads`, `thread_participants` | Fils, avec statut de résolution |
| `messages` | Messages, avec colonne `tsvector` générée |
| `attachments`, `reactions` | Pièces jointes et réactions |
| `read_states` | Position de lecture et compteur de mentions |

### Sécurité

Toutes les tables ont RLS activée et aucune n'est lisible sans politique
explicite. Trois points méritent d'être connus :

- **Récursion RLS.** Une politique sur `space_members` qui interroge
  `space_members` boucle à l'infini. Les fonctions d'appartenance
  (`is_space_member`, `can_manage_space`…) sont donc `SECURITY DEFINER`, ce qui
  les fait s'exécuter hors RLS et coupe la récursion.
- **Rejoindre un espace.** `space_members` n'a *aucune* politique d'insertion :
  la seule porte d'entrée est `join_space(code)`. Connaître l'identifiant d'un
  espace ne suffit donc jamais à s'y inviter.
- **Épingler.** Ce geste modifie le message d'autrui. La politique `UPDATE` sur
  `messages` reste limitée à l'auteur, et l'épinglage passe par
  `set_message_pinned()`.

La visibilité des profils est limitée aux personnes avec qui on partage au moins
un espace : un compte ne peut pas énumérer tout l'annuaire.

---

## Raccourcis clavier

| Raccourci | Effet |
| --- | --- |
| `Ctrl+K` | Palette de commandes |
| `Ctrl+F` | Panneau de recherche |
| `Ctrl+,` | Préférences |
| `Entrée` | Envoyer (réglable) |
| `Maj+Entrée` | Retour à la ligne |
| `Échap` | Annuler une réponse ou une modification |

Dans le compositeur : `@` ouvre l'autocomplétion des mentions, `↑` `↓` naviguent,
`Tab` valide.

---

## Mise en forme des messages

`**gras**` · `*italique*` · `__souligné__` · `~~barré~~` · `` `code` `` ·
` ```bloc``` ` · `> citation` · `||spoiler||` · `@mention` · `#salon` ·
`[texte](url)`

Le rendu produit des éléments React, jamais du HTML injecté : un message
contenant du balisage s'affiche comme du texte au lieu de s'exécuter.

---

## Déploiement

Le résultat est un site statique — n'importe quel hébergeur convient.

```bash
npm run build
```

Le contenu de `dist/` est prêt à servir. Pensez à définir `VITE_SUPABASE_URL` et
`VITE_SUPABASE_PUBLISHABLE_KEY` dans les variables d'environnement de build de
l'hébergeur, et à ajouter l'URL de production dans **Authentication → URL
Configuration** de Supabase.

---

## Limites connues

- **Le vocal est en maillage.** Chacun envoie son flux à tous les autres, donc le
  coût monte au carré du nombre de participants. C'est confortable jusqu'à six ou
  huit personnes et devient lourd au-delà. Aller plus loin demanderait un serveur
  de mélange (SFU), qui n'a pas sa place dans une architecture sans backend.
- **Les serveurs STUN sont ceux de Google.** Ils suffisent à la plupart des
  réseaux domestiques, mais certains pare-feux d'entreprise imposent un relais
  TURN, qu'il faudra fournir.
- **Le téléversement de pièces jointes n'est pas branché.** Les compartiments de
  stockage, leurs politiques et la table `attachments` sont en place ; le bouton
  du compositeur reste à câbler.
- **Pas de messages privés.** Seuls les salons d'espace existent pour l'instant.
- **Le schéma n'a pas été exécuté contre un Postgres réel** au moment de
  l'écriture : il a été relu et vérifié structurellement, mais la première
  application peut demander un ajustement.
