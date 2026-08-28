# Orbit natif

Réécriture du client de bureau **sans moteur web**. L'interface est décrite en
[Slint](https://slint.dev) et rendue directement par le système : aucun
WebView2, aucun HTML, aucun CSS.

Ce dossier est une **étape 1**, pas une application utilisable. Il prouve que la
chaîne technique tient et donne une base mesurable. Le client web reste
l'application de référence tant que la parité n'est pas atteinte.

## Ce qui est fait

- Fenêtre native, barre de titre dessinée par l'application
- Disposition en quatre colonnes : rail, salons, conversation, membres
- Thème repris du client web — mêmes couleurs, mêmes mesures, mêmes rayons
- Survols et transitions animés
- **Authentification complète** : connexion, lecture du profil à travers les
  politiques RLS, rafraîchissement du jeton, session conservée entre deux
  lancements
- Écran de connexion, avec les erreurs traduites en français
- **Vos vraies données** : espaces, salons et messages, chargés par la même
  fonction SQL `bootstrap()` que le client web
- Navigation entre espaces et salons
- **Envoi de messages**
- **Temps réel** : les messages des autres arrivent sans rechargement, avec une
  pastille d'état dans la barre de titre
- Messages groupés par auteur, comme sur le web
- Compile et s'exécute sur Windows

### Vérification

`cargo test` ouvre une vraie session contre le projet Supabase et lit le profil.
Les identifiants viennent de `.env.e2e`, le même fichier que la suite Playwright,
et ne sont jamais écrits dans le dépôt. Sans eux, les tests s'ignorent au lieu
d'échouer.

Un second test vérifie qu'un refus est annoncé lisiblement — « Identifiants
incorrects. » plutôt que l'anglais du serveur.

### Réserve connue

La session est rangée dans un fichier du dossier de l'application, comme le
navigateur le fait avec son stockage local. Ce n'est pas un coffre : quiconque a
accès au compte Windows peut le lire. La porter dans le gestionnaire
d'identifiants du système reste à faire.

## Mesures relevées

Comparaison avec le client actuel, sur la même machine.

| | Tauri + WebView2 | Natif (Slint) |
|---|---|---|
| Binaire | 3,4 Mo | 7,5 Mo |
| Installateur | 1,3 Mo | à faire |
| Mémoire, coquille seule | ~407 Mo | **74 Mo** |
| Processus | 1 + 6 WebView2 | 1 |
| Première compilation | ~90 s | ~3 min 40 |

La mémoire est le gain réel : plus de cinq fois moins pour la coquille. Le
binaire est plus gros parce que le moteur de rendu est embarqué au lieu d'être
emprunté au système — c'est le même compromis qu'Electron, à une échelle bien
moindre.

## Ce qui reste, par ordre de difficulté

### 1. Données — fait

Authentification, lecture, écriture et temps réel : tout passe, et c'est
vérifié contre le vrai projet. Toute la logique métier — le SQL, les politiques
RLS, les fonctions — est réutilisée sans une ligne réécrite.

Le temps réel parle le protocole de Phoenix : on rejoint un sujet, puis on
envoie un battement toutes les vingt-cinq secondes. Sans lui le serveur coupe
au bout d'une minute — et un salon calme est précisément inactif. Une coupure
relance la connexion en espaçant les tentatives.

### 2. Interface — long mais sans piège

Une trentaine d'écrans à reconstruire : paramètres, profil, amis, modération,
recherche, sondages, fils. Chacun est un travail de dessin, pas de recherche.
C'est la partie la plus volumineuse et la plus prévisible.

### 3. Voix et vidéo — le vrai risque

Le navigateur fournit gratuitement ce qu'il faudra assembler à la main :

- `webrtc-rs` remplace l'implémentation du navigateur, mais elle est bien moins
  éprouvée que celle de Chromium ;
- l'annulation d'écho, la réduction de bruit et le contrôle de gain n'existent
  pas dans la pile Rust — il faut les porter depuis `libwebrtc` ou s'en passer ;
- la capture audio passe par `cpal`, la capture d'écran par `windows-capture` ;
- l'encodage matériel demande d'appeler les API du système directement.

C'est là que se joue la réussite ou l'échec de la réécriture. Le partage
d'écran en 1080p60 avec son, qui fonctionne aujourd'hui, demanderait plusieurs
semaines à lui seul.

## Suivre l'avancée

Depuis la racine du dépôt :

```
npm run natif
```

La première compilation prend deux à trois minutes ; les suivantes quelques
secondes. La fenêtre s'ouvre sur l'écran de connexion, puis affiche vos espaces
et vos salons réels — c'est le même compte et la même base que le client web.

Pour vérifier que l'accès aux données tient sans lancer l'interface :

```
npm run natif:test
```

Cinq tests ouvrent une vraie session, lisent le profil à travers les politiques
RLS, chargent l'amorce et les messages, **envoient un message puis le relisent**,
et vérifient que le flux temps réel s'annonce connecté. Ils s'ignorent proprement
si `.env.e2e` est absent.

```
amorce : 6 espace(s), 15 salon(s), 20 message(s) dans #general
connexion, profil et rafraichissement : verifies
envoi et relecture : verifies dans #general
flux temps reel : connecte
refus annonce : Identifiants incorrects.
```
