# Décors des duels

Trois lieux, tirés au sort à chaque duel — jamais le même deux fois de suite.

## Ce qui est servi au joueur

Les `.jpg` de ce dossier : **1024 px de large, environ 130 Ko chacun**.

Les originaux font 1536 px et 2 Mo pièce. Sur un téléphone en 4G, c'est
plusieurs secondes d'attente avant le premier duel — le moment précis où un
testeur abandonne. Ils sont donc redimensionnés et compressés :

| | avant | après |
|---|---|---|
| les trois décors | 6,4 Mo | **372 Ko** |

Le JPEG est le bon format ici : ce sont des illustrations continues, sans
transparence. Le PNG y est le pire choix possible.

## Les originaux

Dans `source/`, à leur taille d'origine. Ils ne sont jamais chargés par le jeu.
Repars toujours de là pour regénérer, jamais du JPEG.

## Ajouter un décor

1. Pose l'original dans `source/`.
2. Régénère les versions servies (1024 px de large, JPEG qualité 82).
3. Ajoute sa clé dans `DECORS`, en haut de `src/scene.js`.

## Pourquoi ils sont assombris en jeu

Ces décors sont lumineux — ciel bleu, sable clair. Les duellistes s'y
perdraient, et le jeu passerait du sombre au clair d'un écran à l'autre. Un
voile et un vignettage les ramènent dans l'ambiance, sans rien cacher de ce qui
est dessiné. Les deux réglages sont en haut de `src/scene.js` : `SCRIM` et
`VIGNETTE`.

## Si une image ne charge pas

Le jeu dessine un fond calculé à la place — ciel, reliefs, sol. C'est aussi ce
qui s'affiche pendant le chargement : l'arène n'est jamais vide.
