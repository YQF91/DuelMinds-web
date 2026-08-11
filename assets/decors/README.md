# Décors des duels

Trois lieux, tirés au sort à chaque duel — jamais le même deux fois de suite.

## Deux formats, et pourquoi

| format | poids des trois | rôle |
|---|---|---|
| **WebP** | **82 Ko** | servi à tout le monde |
| JPEG | 195 Ko | repli, presque jamais téléchargé |

Le jeu demande le `.webp`. Si le navigateur ne sait pas le lire — cas devenu
rare — il bascule tout seul sur le `.jpg`. Les autres ne le téléchargent
jamais : le repli ne coûte rien à l'usage.

L'écart est trop grand pour être ignoré : **26 Ko contre 125** pour un rendu que
l'œil ne distingue pas, même agrandi sur un ciel dégradé — la zone la plus
révélatrice, un dégradé lisse trahissant immédiatement une compression trop
forte.

Un PNG a aussi été essayé : **225 Ko, en palette 256 couleurs**. Plus lourd *et*
moins fidèle que le WebP. Retiré.

## Les originaux

Dans `source/`, à leur taille d'origine (1536 px). Jamais chargés par le jeu.
Repars toujours de là pour regénérer, jamais d'une version compressée.

## Ajouter un décor

1. Pose l'original dans `source/`.
2. Exporte un `.webp` **et** un `.jpg` de secours, 768 px de large.
3. Ajoute sa clé dans `DECORS`, en haut de `src/scene.js`.

`node tools/check.mjs` refuse un décor déclaré sans image : sans ce contrôle,
l'oubli passerait inaperçu, le jeu se repliant proprement sur son fond calculé.

## Pourquoi ils sont assombris en jeu

Ces décors sont lumineux — ciel bleu, sable clair. Les duellistes s'y
perdraient, et le jeu passerait du sombre au clair d'un écran à l'autre. Un
voile et un vignettage les ramènent dans l'ambiance, sans rien cacher de ce qui
est dessiné. Réglages en haut de `src/scene.js` : `SCRIM` et `VIGNETTE`.

## Si aucune image ne charge

Le jeu dessine un fond calculé — ciel, reliefs, sol. C'est aussi ce qui
s'affiche pendant le chargement : l'arène n'est jamais vide.
