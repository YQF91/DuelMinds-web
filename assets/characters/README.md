# Personnages — dépose tes PNG ici

Ce dossier attend les douze duellistes. Le jeu les charge automatiquement dès
qu'ils sont présents ; tant qu'un fichier manque, il affiche à la place une
silhouette en pixel art, et **le jeu reste jouable**.

---

## Les fichiers attendus

Un PNG par personnage, nommé exactement comme la clé indiquée. Ce sont les
mêmes clés que dans `src/rules.js` — si tu renommes ici, renomme là-bas aussi.

| Fichier | Personnage de ta planche |
|---|---|
| `ingenieur.png` | cheveux blancs, lunettes de soudeur, bras mécanique |
| `cowboy.png` | chapeau brun, revolver, foulard |
| `capitaine.png` | grand bicorne à tête de mort, cheveux rouges |
| `mecano.png` | lunettes vertes, réacteur dorsal |
| `samourai.png` | chapeau de paille, katana |
| `bourreau.png` | armure sombre, deux haches |
| `plombier.png` | casquette rouge, salopette |
| `corsaire.png` | sabre, tricorne, cape brune |
| `pyromancienne.png` | cheveux rouges enflammés, fouet |
| `ange.png` | ailes blanches, robe claire |
| `archer.png` | capuche en tête de loup, arc, cheveux verts |
| `gobelin.png` | peau verte, oreilles pointues, dague |

---

## Le format

**Fond transparent.** C'est le seul point réellement important. Un PNG sur fond
blanc affichera un rectangle blanc autour du personnage.

Si tes images ont un fond blanc, dis-le-moi : j'ai déjà écrit un détourage
automatique pour l'autre projet, je peux le réutiliser pour préparer les
fichiers une fois pour toutes.

**Taille** — vise 512 × 512 pixels. Le jeu redimensionne tout seul, mais partir
grand évite le flou sur les écrans à forte densité. Carré de préférence : les
images non carrées sont recadrées au centre.

**Orientation** — dessine tous les personnages **tournés vers la droite**, ou
de face. Le jeu retourne automatiquement celui de gauche pour que les deux se
regardent, comme dans un duel Fire Emblem :

```
   ADVERSAIRE                              TOI
       🧍  ────────  se font face  ──────  🧍
   (retourné)                          (tel quel)
```

---

## Pour ajouter un personnage

1. Dépose son PNG ici.
2. Ajoute une entrée dans `CHARACTERS`, dans `src/rules.js` :

```js
{ key: "ninja", name: "Ninja", blurb: "Rapide et silencieux." },
```

La clé doit correspondre au nom du fichier, sans l'extension.

C'est tout — le sélecteur de personnage se met à jour tout seul.
