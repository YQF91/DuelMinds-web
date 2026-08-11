# DuelMinds — le vrai jeu, et le PVP

Deux questions posées, deux réponses argumentées. Ce document n'est pas du code :
c'est de quoi décider. Rien n'y est engagé tant que tu n'as pas tranché.

---

## 1. Un « vrai » jeu, dans un langage mieux optimisé

### D'abord, le diagnostic honnête : ce n'est pas un problème de langage

L'instinct est compréhensible, mais il vise à côté. DuelMinds est un jeu **au tour
par tour, à trois actions possibles**. Une manche demande une poignée de
comparaisons. Le simulateur en joue **des dizaines de milliers en quelques
secondes** — et c'est du JavaScript, réputé lent.

La performance n'est pas, et ne sera jamais, ta contrainte. Passer à Rust ou à
C++ te coûterait des semaines pour accélérer un calcul qui prend déjà moins d'une
milliseconde.

**Ce que Pygame te coûte vraiment, c'est la distribution :**

| Ce que tu veux | Pygame | Web (aujourd'hui) |
|---|---|---|
| Jouer sur téléphone | non | oui |
| Envoyer un lien à un collègue | non | oui |
| Installer Python chez le joueur | obligatoire | jamais |
| Boutique d'applications | difficile | via un habillage |
| Manette, plein écran, achievements système | non | non |

Le vrai manque n'est donc pas la vitesse : c'est **d'exister ailleurs que dans un
onglet**.

### Ce que tu possèdes déjà, et qui vaut plus que le langage

Le point le plus important de tout ce document :

> **Les règles de DuelMinds tiennent dans un seul fichier sans aucune dépendance
> (`src/rules.js`), et le moteur qui les applique dans un autre (`src/combat.js`),
> lui aussi exécutable hors navigateur.**

C'est ce qui rend un portage bon marché. Réécrire une interface est un travail
mécanique ; réécrire des règles *et* les rééquilibrer, c'est repartir de zéro.
Quelle que soit ta décision, **protège cette séparation** : aucune règle dans
l'interface, aucun affichage dans le moteur.

### Les options, classées par ce qu'elles rapportent réellement

**A. Rester en JavaScript et l'emballer** — *le moins cher*

Capacitor ou Tauri enveloppent la page actuelle dans une vraie application
Android, iOS, Windows. Un seul code, celui qui tourne déjà. Tu gagnes l'icône sur
l'écran d'accueil, le hors-ligne, la présence en boutique.

Tu ne gagnes pas un « vrai moteur de jeu » : les animations resteront ce que le
navigateur sait faire.

**B. Godot 4** — *ma recommandation si tu veux un vrai jeu*

Gratuit, sans redevance, taillé pour la 2D, et il exporte vers Windows, Android,
iOS **et le web** depuis un seul projet. Tu récupères ce qui manque aujourd'hui :
un système d'animation digne de ce nom, des particules, des transitions, la
manette, un éditeur de scènes.

Le portage consiste à retranscrire `rules.js` et `combat.js` en GDScript — deux
fichiers, quelques centaines de lignes, sans aucune décision d'équilibrage à
reprendre puisqu'elles sont déjà mesurées et commentées. **Garde la version web
comme référence** : elle sert de test, et tu peux comparer les deux
implémentations en rejouant les mêmes duels.

**C. Unity** — *surdimensionné ici*

Excellent moteur, mais pour un duel 2D au tour par tour tu paies un
apprentissage, un poids et une incertitude de licence pour des fonctions que tu
n'utiliseras pas.

**D. Rust, C++, un langage « rapide »** — *le mauvais outil*

Aucun gain mesurable sur ce jeu, un coût de développement multiplié. À réserver
si un jour tu simules des millions de parties pour entraîner une IA — et même là,
le simulateur actuel suffirait sans doute.

### Recommandation

1. **Court terme** : reste sur le web. C'est ce qui te donne des testeurs, et des
   testeurs, c'est ce dont le jeu a besoin maintenant.
2. **Quand le jeu sera figé** : Godot 4, en portant les deux fichiers de règles.
3. **Ne touche pas** à Rust ou C++ pour ce projet.

---

## 2. Le PVP

### Bonne nouvelle : ton jeu est le cas le plus facile du réseau

Ce qui rend le multijoueur difficile, c'est le temps réel : synchroniser des
positions, corriger les décalages, prédire les mouvements. **DuelMinds n'a rien
de tout ça.** Deux joueurs choisissent parmi trois actions, puis on révèle.

C'est du tour par tour avec une phase de choix simultanée. Techniquement, c'est
plus proche d'une partie d'échecs par correspondance que d'un jeu de tir.

### La seule vraie difficulté, et il faut la traiter dès le départ

Les actions sont **simultanées et secrètes**. Si les deux joueurs s'échangent
directement leurs coups, celui dont le programme est modifié peut **attendre de
voir le coup adverse avant d'envoyer le sien**. Il gagne à tous les coups.

Il faut donc un **arbitre** : un tiers qui reçoit les deux coups et ne révèle
qu'une fois les deux arrivés. Ce n'est pas une option, c'est la condition pour
que le mode classé veuille dire quelque chose.

Et voici ce qui rend l'affaire simple chez toi : **`combat.js` tourne déjà hors
navigateur** — c'est ce que font `tools/simulate.mjs` et `tools/check.mjs`. Le
même fichier peut donc tourner sur l'arbitre. Pas deux versions des règles à
maintenir, pas de divergence possible entre le serveur et le client.

### Le chemin, du moins cher au plus complet

**Étape 1 — Le duel à deux sur le même téléphone** *(quelques heures)*

Aucun réseau. On se passe l'appareil : un écran « passe le téléphone » entre les
deux choix, ce qui préserve le secret.

Ne saute pas cette étape. Elle ne coûte presque rien et elle répond à la seule
question qui compte avant d'écrire la moindre ligne de réseau : **est-ce que le
jeu est bon à deux humains ?** L'IA ne bluffe pas, ne s'énerve pas, ne prend pas
de risque stupide. Un vrai adversaire, si.

**Étape 2 — L'arbitre** *(1 à 2 jours)*

Un petit programme dont le rôle tient en quatre lignes :

```
   apparier deux joueurs qui attendent
   recevoir un coup de chacun
   quand les deux sont là (ou que le chrono expire) : résoudre avec combat.js
   renvoyer le résultat aux deux en même temps
```

Hébergement possible sur une offre gratuite — Cloudflare Workers, Deno Deploy,
Fly.io. On parle d'environ deux cents lignes, pas d'une infrastructure.

Deux choses déjà en place te servent directement :

- **Le chronomètre du mode Blitz.** Une partie en réseau a de toute façon besoin
  d'une limite de temps par tour, sinon un joueur qui s'absente bloque l'autre.
  C'est fait, réglé et testé.
- **Les balles cachées.** Le mode Aveugle existe précisément pour vérifier que
  l'information cachée reste jouable. Regarde les scores de ce mode dans la
  feuille **avant** de lancer le classé : s'ils s'effondrent, il faudra revoir
  la règle, pas le réseau.

**Étape 3 — Le classé** *(une fois l'étape 2 stable)*

Le classement existe déjà et lit la feuille Google. Il suffira de lui donner des
parties PVP à afficher.

### Ce que je ne recommande pas

- **Le pair-à-pair direct** (WebRTC sans arbitre) : moins cher en serveur, mais
  il rouvre exactement la faille décrite plus haut, et il échoue derrière
  certains réseaux d'entreprise — c'est-à-dire chez tes collègues.
- **Le PVP par lien asynchrone** (chacun joue quand il veut) : séduisant sans
  serveur, mais un duel de DuelMinds dure une minute. L'attente tuerait le jeu.

### Recommandation

Fais l'**étape 1 maintenant** : c'est peu de travail, et c'est le seul moyen de
savoir si le PVP vaut le coup avant d'y investir. Ne construis l'arbitre que si
deux humains prennent du plaisir sur un même téléphone.

---

## Ce qui reste ouvert, indépendamment de ces deux choix

- **Six personnages sur douze.** Le renouvellement des adversaires en série
  gagnerait beaucoup à la série complète : un visage revient tous les 5 duels
  aujourd'hui, tous les 11 avec douze.
- **Les manches qui s'éternisent.** Environ 9 % des manches entre deux IA
  prudentes tournent en rond. Sans effet face à un humain, mais il faudra une
  limite de tours avant le PVP — deux joueurs peuvent se bloquer indéfiniment.
- **La défense est perdante par les règles.** Se protéger n'empêche que de
  perdre, ne fait jamais gagner, et coûte une balle à partir de la 3e
  consécutive. C'est probablement voulu — c'est ce qui interdit le camping. Mais
  si un jour tu veux un style défensif viable, ça passera par **une règle**
  (bloquer un tir rend une balle, par exemple), jamais par un personnage : il n'y
  a pas de types dans DuelMinds, et c'est une bonne chose.
