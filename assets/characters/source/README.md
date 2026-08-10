# Dépose ici tes images brutes

N'importe quel format (`.jpg`, `.jpeg`, `.png`), n'importe quel fond.

Nomme chaque fichier comme la clé du personnage — `cowboy.jpg`, `archer.jpg`… —
puis lance depuis la racine du projet :

```bash
python tools/prepare-characters.py
```

Le script détoure, recadre, met au carré en 512 × 512 et écrit le PNG
transparent dans le dossier parent. Ce dossier `source/` n'est pas utilisé par
le jeu : il ne sert qu'à garder tes originaux.
