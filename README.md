# DuelMinds — version web

Duel tactique à **actions simultanées**. Vous choisissez en même temps entre
charger, tirer et vous protéger. Il n'y a pas de points de vie : une balle
suffit.

Portage web du jeu Pygame, jouable au doigt sur téléphone, sans installation.

---

## 1. Jouer

**Sur ordinateur** — double-clique sur `index.html`.

**Sur téléphone, ou pour faire tester** — voir la section « Mettre en ligne ».

---

## 2. Les règles, en bref

Chaque manche commence avec **1 balle**. Le premier à **2 manches** remporte le duel.

| Action | Effet | Coût |
|---|---|---|
| **Charger** | +1 balle | gratuit, mais te laisse à découvert |
| **Tirer** | tue si l'adversaire ne s'est pas protégé | 1 balle |
| **Protéger** | immunise contre un tir ordinaire | les 2 premières d'affilée gratuites, puis 1 balle |

- **Super tir** — tirer avec **4 balles ou plus** traverse la protection.
- **Clash** — si vous tirez tous les deux, les balles se percutent : personne
  ne tombe, mais chacun a dépensé une balle.
- **Mort bête** — tenter une action impossible fait perdre la manche.
  L'interface désactive les boutons concernés, mais la règle existe.

### Deux modes

- **Duel** — un affrontement, puis retour à l'accueil.
- **Arcade** — les duels s'enchaînent. Chaque victoire prolonge la série, la
  première défaite y met fin. Le meilleur score est conservé **par niveau**.

---

## 3. Mettre en ligne pour les testeurs

Le jeu est une page statique : **n'importe quel hébergement fonctionne**, et
les visiteurs n'ont besoin d'aucun compte.

### Envoyer un seul fichier

```bash
node tools/build.mjs
```

Produit `dist/duelminds.html` : tout dedans, aucune dépendance. S'envoie par
message, s'ouvre hors ligne, y compris sur téléphone.

### Pour un vrai lien

| Où | Comment |
|---|---|
| **GitHub Pages** | Dépose le dossier dans un dépôt public, Settings → Pages → branche `main`, dossier `/ (root)` |
| **itch.io** | Nouveau projet type « HTML », téléverse `dist/duelminds.html` renommé `index.html`. Peut rester protégé par mot de passe. |
| **Cloudflare Pages / Netlify** | Glisse-dépose le dossier |

Pour GitHub Pages et Cloudflare, tu peux téléverser le dossier **tel quel** :
les fichiers séparés se chargent très bien une fois servis par un hébergeur.
Le fichier unique n'est obligatoire que pour l'ouverture directe depuis le disque.

---

## 4. Récupérer les retours des testeurs

Le jeu compte ce qui se passe : parties par mode et par difficulté, duels et
manches gagnés, répartition des actions, clashs, super tirs, et les **records
d'arcade par niveau**. Écran **Stats** depuis l'accueil.

**Sur l'appareil du joueur** — le testeur ouvre Stats, appuie sur **Copier**,
et te colle le résumé dans un message. Les chiffres sont stockés dans son
navigateur : ils sont **par appareil**, il n'y a pas de total commun.

**En centralisé** — `src/telemetry.js` peut envoyer chaque partie dans un
Google Sheets. C'est **désactivé par défaut** : il manque une adresse de
collecte. La marche à suivre complète est dans
[`tools/google-apps-script.gs`](tools/google-apps-script.gs).

La feuille reçoit une colonne **`mode`** : duel et arcade arrivent au même
endroit, et un tableau croisé dynamique suffit à les comparer.

---

## 5. Organisation du code

```
DuelMinds-web/
├── index.html            structure des écrans, rien d'autre
├── styles/main.css       apparence — aucune couleur en dur hors des jetons
├── src/
│   ├── rules.js          ★ RÈGLES ET ÉQUILIBRAGE — le seul fichier à régler
│   ├── combat.js         mécanique d'un tour (aucune interface)
│   ├── ai.js             les trois adversaires
│   ├── match.js          manches, duels et séries (aucune interface)
│   ├── sprites.js        duellistes en pixel art et effets
│   ├── audio.js          bruitages synthétisés
│   ├── stats.js          compteurs et records (localStorage)
│   ├── telemetry.js      remontée optionnelle vers un tableur
│   ├── ui.js             écrans et interactions — seul fichier qui touche au DOM
│   └── main.js           démarrage
├── tools/
│   ├── simulate.mjs      simulation d'équilibrage
│   ├── check.mjs         vérifications avant livraison
│   ├── build.mjs         assemble tout en un fichier unique
│   └── google-apps-script.gs   point de collecte des parties
└── dist/duelminds.html   GÉNÉRÉ — ne pas modifier à la main
```

**Le principe d'organisation** : le moteur (`combat.js`, `match.js`) ne connaît
ni l'écran ni le joueur. C'est ce qui permet de le faire tourner sans navigateur
et donc de le tester pour de vrai. Si tu ajoutes une ligne qui touche au DOM
dans ces fichiers, elle n'est pas à sa place.

**Ordre de lecture conseillé** : `src/rules.js` → `src/combat.js` → `src/ui.js`.

---

## 6. Deux corrections par rapport au code Python

Le portage est fidèle, à deux exceptions près. Les deux ont été **mesurées**,
pas supposées, et les deux sont réversibles en une ligne.

### Le niveau Extrême était le plus faible des trois

Dans `game/bot.py`, l'IA extrême exige `bullets >= 2` pour tirer sur une cible
à découvert. Elle refusait donc d'attaquer avec une seule balle — c'est-à-dire
pendant presque tout le début de chaque manche — pendant que le niveau
difficile, lui, tirait dès la première.

Victoires contre FACILE, mesurées sur 2 500 duels :

| Seuil | Facile | Difficile | Extrême |
|---|---:|---:|---:|
| `>= 2` (Python) | 50 % | 66 % | **61 %** ← inversé |
| `>= 1` (ici) | 50 % | 64 % | **87 %** ← correct |

En duel direct, Extrême passe de 26 % à 62 % de victoires contre Difficile.
C'est indispensable au mode arcade, dont le score n'a de sens que si les
niveaux sont réellement de plus en plus durs.

### La mémoire anti-répétition sabotait le bon coup

Toujours au niveau extrême, la mémoire des situations déjà vues passait
**avant** l'analyse tactique : dès qu'une situation se represente, l'IA jouait
« autre chose » sans regarder quel serait le bon coup. Ici l'ordre est inversé,
et elle ne renonce jamais à une occasion de tuer.

Pour revenir au comportement d'origine : `ANTI_REPEAT_BEFORE_ANALYSIS = true`
dans `src/ai.js`.

### Un troisième écart, celui-là non tranché

Le code Python fait payer les protections différemment au joueur et à l'IA
(`Player.can_defend` autorise deux protections gratuites, `Bot.can_defend` une
seule). Ça n'a pas l'air voulu. Cette version applique **la même règle aux
deux**. Pour restaurer l'asymétrie : `FREE_DEFENCES_BOT: 0` dans `src/rules.js`.

---

## 7. Mesurer l'équilibrage

```bash
node tools/simulate.mjs           # 2 000 duels par confrontation
node tools/simulate.mjs 20000     # chiffres plus stables
```

Le simulateur charge les **vrais** fichiers du jeu : il ne peut pas diverger
des règles réellement appliquées.

Il mesure le taux de victoire de chaque IA contre chaque autre, vérifie que la
difficulté est bien croissante, et donne le rythme des manches : durée, part de
clashs, fréquence des super tirs.

**Une observation à garder en tête** : le jeu n'impose aucune limite de tours à
une manche. Deux adversaires prudents peuvent donc tourner en rond
indéfiniment — le simulateur mesure environ 9 % de manches enlisées entre deux
IA difficiles. Face à un humain ça n'arrive pas, puisqu'il finit par tirer. Si
tu veux fermer cette porte, une limite de tours avec départage serait la
solution la plus simple.

---

## 8. Vérifier avant de livrer

```bash
node tools/check.mjs
```

Attrape les pannes silencieuses d'un projet sans compilation : un `id` renommé
dans le HTML mais pas dans le JS, un bouton pointant vers une action
inexistante, une lettre de sprite absente de sa palette — ou un caractère
cyrillique glissé dans une grille, ce qui est déjà arrivé. Rejoue aussi
360 parties complètes dans les deux modes et les trois difficultés.

---

## 9. Remplacer les sprites

Les duellistes sont décrits **en texte** dans `src/sprites.js` : une grille de
16 lignes de 16 caractères, une lettre par couleur.

```
.  vide       o  contour     c  chapeau    v  veste
p  peau       j  jean        b  botte      m  métal
```

Édite la grille, recharge la page. Une ligne trop courte est complétée
automatiquement : une faute de frappe ne casse jamais l'affichage.

**Pour passer à de vrais fichiers PNG** : remplace le corps de `drawDuelist`
par un `ctx.drawImage`. Tout le reste du jeu passe par cette seule fonction,
il n'y a rien d'autre à toucher.

---

## 10. Choix techniques, et pourquoi

**Une page web plutôt qu'une application.** Le prototype doit être testable par
des collègues, sur leur téléphone, sans installation. Un lien suffit.

**Aucune bibliothèque, aucune image, aucun fichier son.** Les sprites sont
dessinés par du code, les bruitages synthétisés par le navigateur. Le projet
reste intégralement en texte, versionnable, sans binaire à gérer.

**Thème unique.** Le jeu ne suit pas le réglage clair/sombre du téléphone :
c'est une décision. Un duel au crépuscule a une identité, et le pixel art
perdrait tout contraste sur fond clair.

**Scripts classiques plutôt que modules ES.** Les modules ES sont bloqués par
les navigateurs quand la page est ouverte depuis le disque. Avec des scripts
classiques, `index.html` fonctionne d'un simple double-clic.
