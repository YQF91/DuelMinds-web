"""
=============================================================================
DUELMINDS — PRÉPARATION DES PERSONNAGES
=============================================================================

À QUOI ÇA SERT
Transformer des images brutes (JPG ou PNG sur fond blanc) en PNG détourés,
prêts à être affichés par le jeu.

POURQUOI C'EST NÉCESSAIRE
Le JPEG ne gère pas la transparence : un personnage exporté en JPG traîne
toujours son fond. Dans le jeu, ça donne un rectangle blanc autour de chaque
duelliste. Ce script enlève le fond et enregistre en PNG.

UTILISATION
    1. dépose tes images dans   assets/characters/source/
       (n'importe quel nom, n'importe quel format : .jpg, .jpeg, .png)
    2. lance :
           python tools/prepare-characters.py
    3. les fichiers détourés apparaissent dans  assets/characters/

    Pour ne traiter qu'un fichier :
           python tools/prepare-characters.py cowboy.jpg

COMMENT LE DÉTOURAGE FONCTIONNE
On ne peut pas simplement « effacer tous les pixels blancs » : ça trouerait
les cheveux blancs de l'ingénieure, les ailes de l'ange et la chemise du
samouraï. On procède donc par PROPAGATION DEPUIS LES BORDS :

    1. les quatre bords de l'image sont forcément du fond ;
    2. on avance de proche en proche : un pixel rejoint le fond s'il ressemble
       à un voisin déjà classé comme fond ;
    3. on s'arrête au contour du personnage, dont la couleur tranche.

Le blanc ENFERMÉ à l'intérieur du dessin n'est jamais atteint : il est protégé
par le trait noir qui l'entoure. C'est exactement ce qu'on veut.

DÉPENDANCES : pygame et numpy (déjà présents dans le .venv du projet).
============================================================================="""

import os
import sys
import glob

os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
import pygame
import numpy as np


# --- Réglages ---------------------------------------------------------------

# Écart de couleur admis entre deux pixels voisins pendant la propagation.
# Trop bas  -> il reste un liseré de fond autour du personnage.
# Trop haut -> le détourage déborde et ronge le dessin.
# 14 tolère le bruit du JPEG sans mordre sur un trait franc.
TOLERANCE = 14

# Taille finale. Carré : le jeu centre et cale les pieds en bas.
OUTPUT_SIZE = 512

# Marge laissée autour du personnage après recadrage, en pourcentage.
MARGIN = 0.04

# Efface aussi les POCHES DE FOND ENFERMÉES : le petit triangle de blanc entre
# les jambes, cerné par les bottes et l'herbe, que la propagation depuis les
# bords ne peut pas atteindre.
# On ne supprime que les poches PETITES : une grande zone claire est presque
# toujours une partie du dessin (une aile, une cape, une chevelure blanche).
REMOVE_ENCLOSED_POCKETS = True
POCKET_MAX_SIZE = 0.02  # part de l'image au-delà de laquelle on ne touche à rien

SOURCE_DIR = os.path.join("assets", "characters", "source")
OUTPUT_DIR = os.path.join("assets", "characters")


# --- Détourage --------------------------------------------------------------

def background_mask(rgb, tolerance=TOLERANCE):
    """
    Repère le fond : tout ce qui communique avec les bords de l'image.

    Propagation par LIGNES ENTIÈRES et non pixel par pixel. On repère d'abord
    les ruptures de couleur, qui découpent chaque ligne en segments continus ;
    à l'intérieur d'un segment, si un pixel est du fond, ils le sont tous. On
    peut donc traverser une ligne d'un coup au lieu d'avancer d'un pixel par
    passe — sur une image de 512 pixels de côté, c'est la différence entre une
    seconde et plusieurs minutes.
    """
    width, height = rgb.shape[0], rgb.shape[1]

    is_bg = np.zeros((width, height), dtype=bool)
    is_bg[0, :] = is_bg[-1, :] = True
    is_bg[:, 0] = is_bg[:, -1] = True

    # Numérotation des segments : constante dans un segment, croissante le long
    # de l'axe. C'est ce qui rend valides les comparaisons min/max ci-dessous.
    segments = []
    for axis in (0, 1):
        if axis == 0:
            breaks = np.abs(rgb[1:, :, :] - rgb[:-1, :, :]).max(axis=2) > tolerance
            numbering = np.zeros((width, height), dtype=np.int32)
            numbering[1:, :] = np.cumsum(breaks, axis=0)
        else:
            breaks = np.abs(rgb[:, 1:, :] - rgb[:, :-1, :]).max(axis=2) > tolerance
            numbering = np.zeros((width, height), dtype=np.int32)
            numbering[:, 1:] = np.cumsum(breaks, axis=1)
        segments.append(numbering)

    VERY_LARGE = np.int32(2 ** 30)

    while True:
        before = is_bg.sum()
        for axis, numbering in enumerate(segments):
            # « Y a-t-il du fond AVANT moi dans mon segment ? »
            seen_before = np.maximum.accumulate(np.where(is_bg, numbering, -1), axis=axis)
            # « ... et APRÈS moi ? »
            seen_after = np.flip(
                np.minimum.accumulate(np.flip(np.where(is_bg, numbering, VERY_LARGE), axis=axis), axis=axis),
                axis=axis)
            is_bg |= (seen_before == numbering) | (seen_after == numbering)
        if is_bg.sum() == before:
            return is_bg


def remove_enclosed_pockets(is_bg, rgb, tolerance=TOLERANCE):
    """
    Efface les petites poches de fond que la propagation n'a pas pu atteindre.

    On repère les pixels de la couleur du fond qui sont restés opaques, on les
    regroupe par voisinage, et on n'efface que les groupes assez petits pour
    être des interstices — jamais une aile ou une chevelure claire.
    """
    border = np.concatenate([rgb[0, :, :], rgb[-1, :, :], rgb[:, 0, :], rgb[:, -1, :]])
    background_color = np.median(border, axis=0).astype(np.int16)

    candidate = (np.abs(rgb - background_color).max(axis=2) <= tolerance) & ~is_bg
    if not candidate.any():
        return is_bg

    # Regroupement par propagation : on étend chaque poche jusqu'à stabilité.
    # Les poches sont minuscules, quelques passes suffisent.
    total_pixels = is_bg.size
    remaining = candidate.copy()
    guard = 0

    while remaining.any() and guard < 64:
        guard += 1
        # On part d'un pixel et on gonfle sa poche.
        seed = np.zeros_like(remaining)
        index = np.argwhere(remaining)[0]
        seed[index[0], index[1]] = True

        while True:
            grown = seed.copy()
            grown[1:, :] |= seed[:-1, :]
            grown[:-1, :] |= seed[1:, :]
            grown[:, 1:] |= seed[:, :-1]
            grown[:, :-1] |= seed[:, 1:]
            grown &= remaining
            if grown.sum() == seed.sum():
                break
            seed = grown

        if seed.sum() / total_pixels <= POCKET_MAX_SIZE:
            is_bg |= seed
        remaining &= ~seed

    return is_bg


def content_box(alpha):
    """Rectangle englobant les pixels visibles, ou None si l'image est vide."""
    columns = np.where(alpha.any(axis=1))[0]
    rows = np.where(alpha.any(axis=0))[0]
    if len(columns) == 0 or len(rows) == 0:
        return None
    return int(columns[0]), int(rows[0]), int(columns[-1]), int(rows[-1])


def prepare(path, output_path):
    """Détoure, recadre et met à la taille finale. Renvoie un compte-rendu."""
    source = pygame.image.load(path).convert_alpha()
    rgb = pygame.surfarray.array3d(source).astype(np.int16)

    mask = background_mask(rgb)
    if REMOVE_ENCLOSED_POCKETS:
        mask = remove_enclosed_pockets(mask, rgb)
    detoured = source.copy()
    alpha = pygame.surfarray.pixels_alpha(detoured)
    alpha[mask] = 0
    kept = float((alpha > 0).mean())
    del alpha  # libère le verrou posé sur la surface

    box = content_box(pygame.surfarray.array_alpha(detoured))
    if box is None:
        return None, "image entièrement effacée — fond trop proche du dessin"

    x0, y0, x1, y1 = box
    cropped_width = x1 - x0 + 1
    cropped_height = y1 - y0 + 1

    # On garde un carré, marge comprise : le jeu attend des images carrées.
    side = int(max(cropped_width, cropped_height) * (1 + MARGIN * 2))
    canvas = pygame.Surface((side, side), pygame.SRCALPHA)
    canvas.blit(detoured, ((side - cropped_width) // 2, (side - cropped_height) // 2),
                pygame.Rect(x0, y0, cropped_width, cropped_height))

    final = pygame.transform.smoothscale(canvas, (OUTPUT_SIZE, OUTPUT_SIZE))
    pygame.image.save(final, output_path)

    return kept, f"{cropped_width}x{cropped_height} -> {OUTPUT_SIZE}x{OUTPUT_SIZE}, {kept*100:.0f} % conservé"


# --- Programme --------------------------------------------------------------

def main():
    pygame.init()
    pygame.display.set_mode((1, 1))

    os.makedirs(SOURCE_DIR, exist_ok=True)
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    if len(sys.argv) > 1:
        files = [os.path.join(SOURCE_DIR, name) for name in sys.argv[1:]]
    else:
        # Windows ne distingue pas la casse : on dédoublonne, sinon chaque
        # fichier serait traité deux fois.
        found = set()
        for pattern in ("*.jpg", "*.jpeg", "*.png", "*.JPG", "*.JPEG", "*.PNG"):
            for path in glob.glob(os.path.join(SOURCE_DIR, pattern)):
                found.add(os.path.normcase(os.path.abspath(path)))
        files = sorted(found)

    if not files:
        print(f"Aucune image dans {SOURCE_DIR}/")
        print("Dépose-y tes personnages, puis relance la commande.")
        return

    print(f"{len(files)} image(s) à préparer\n")
    warnings = []

    for path in files:
        name = os.path.splitext(os.path.basename(path))[0]
        output_path = os.path.join(OUTPUT_DIR, name + ".png")
        try:
            kept, message = prepare(path, output_path)
        except Exception as error:
            print(f"  ECHEC  {os.path.basename(path):28s} {error}")
            continue

        if kept is None:
            print(f"  ECHEC  {os.path.basename(path):28s} {message}")
            continue

        print(f"  ok     {name + '.png':28s} {message}")

        # Un personnage qui occupe presque toute l'image, ou presque rien,
        # signale un détourage douteux qu'il vaut mieux aller regarder.
        if kept > 0.85:
            warnings.append(f"{name} : le fond n'a presque pas été enlevé — il n'est peut-être pas uni")
        elif kept < 0.06:
            warnings.append(f"{name} : presque tout a été effacé — vérifie le résultat")

    if warnings:
        print("\nÀ VÉRIFIER :")
        for warning in warnings:
            print("  - " + warning)

    print(f"\nFichiers écrits dans {OUTPUT_DIR}/")
    print("Ouvre-les pour contrôler le détourage, puis recharge le jeu.")


if __name__ == "__main__":
    main()
