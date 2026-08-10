/* =============================================================================
 * DUELMINDS — SPRITES ET EFFETS
 * =============================================================================
 *
 * RÔLE DU FICHIER
 * Dessiner les deux duellistes et les effets de leurs actions. Aucune image
 * n'est chargée : les sprites sont décrits en texte ici même puis peints sur
 * un canvas. Le projet reste donc entièrement en fichiers texte.
 *
 * COMMENT LIRE UN SPRITE
 * Une grille de 16 lignes de 16 caractères, une lettre par couleur :
 *
 *     .  vide (transparent)      p  peau
 *     o  contour sombre          j  jean
 *     c  chapeau                 b  botte / cuir
 *     v  veste / chemise         m  métal (arme, boucle)
 *
 * Les lignes plus courtes que 16 sont complétées automatiquement : une faute
 * de frappe ne casse jamais l'affichage.
 *
 * POUR REMPLACER PAR TES PROPRES SPRITES
 * Deux options, selon ce que tu as :
 *   - du pixel art simple : réécris les grilles ci-dessous, c'est immédiat ;
 *   - des fichiers PNG : remplace `drawDuelist` par un `ctx.drawImage`. Tout
 *     le reste du jeu passe par cette seule fonction, rien d'autre à toucher.
 *
 * DÉPENDANCES : aucune (volontairement — ce fichier est réutilisable tel quel)
 * ========================================================================== */

(function (root) {
  "use strict";

  const DUELMINDS = (root.DUELMINDS = root.DUELMINDS || {});
  const GRID = 16;

  /* ---------------------------------------------------------------------------
   * 1. LES SILHOUETTES
   * ---------------------------------------------------------------------------
   * Le joueur est vu DE DOS, en bas de l'écran ; l'adversaire DE FACE, en
   * haut. C'est la disposition d'un duel : on regarde par-dessus son épaule.
   * ------------------------------------------------------------------------ */
  const ART = {
    // Adversaire — de face, chapeau baissé, main près du holster
    front: [
      "................",
      ".....oooooo.....",
      "....occcccco....",
      "...oooooooooo...",
      "....o pppp o....",
      "....opmppmpo....",
      "....o pppp o....",
      ".....ovvvvo.....",
      "...oovvvvvvoo...",
      "..ovvvvvvvvvvo..",
      "..ovvpo vv opvo.",
      "..o jjo  ojj o..",
      "...ojjo  ojjo...",
      "...ojjo  ojjo...",
      "..obbbo  obbbo..",
      "..ooooo  ooooo..",
    ],
    // Joueur — de dos, on voit le dos du chapeau et la nuque
    back: [
      "................",
      "....oooooooo....",
      "...occcccccco...",
      "..oooooooooooo..",
      "....occcccco....",
      ".....o pp o.....",
      ".....ovvvvo.....",
      "...oovvvvvvoo...",
      "..ovvvvvvvvvvo..",
      "..ovvvvvvvvvvo..",
      "..opvo vv ovpo..",
      "..o jjo  ojj o..",
      "...ojjo  ojjo...",
      "...ojjo  ojjo...",
      "..obbbo  obbbo..",
      "..ooooo  ooooo..",
    ],
    // Au sol — utilisé pour les deux, le chapeau roule à côté
    down: [
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
      "......oooo......",
      ".....occcco.....",
      "....oooooooo....",
      "..oovvvvvvvvoo..",
      ".ovvvvvvjjjjjvo.",
      "obbovvvjjjjjjjbo",
      "ooooooooooooooo.",
      "................",
    ],
  };

  /* ---------------------------------------------------------------------------
   * 2. PALETTES
   * ---------------------------------------------------------------------------
   * Deux tenues pour distinguer les duellistes d'un coup d'œil, sans avoir à
   * lire les étiquettes.
   * ------------------------------------------------------------------------ */
  const PALETTES = {
    player: { o: "#241a14", c: "#6b4a2f", v: "#c08a4a", p: "#e8b48a", j: "#33507a", b: "#4a3220", m: "#d6d2c4" },
    bot:    { o: "#1e1620", c: "#5a3540", v: "#a35a5a", p: "#e0a880", j: "#3a3550", b: "#3d2630", m: "#d6d2c4" },
  };

  const MISSING_COLOR = "#ff00ff"; // magenta : impossible à rater

  /* ---------------------------------------------------------------------------
   * 3. RENDU DU DUELLISTE
   * ------------------------------------------------------------------------ */

  function cellAt(grid, x, y) {
    const row = grid[y];
    if (!row || x < 0 || x >= GRID || y < 0 || y >= GRID) return ".";
    return row.length > x ? row[x] : ".";
  }

  /**
   * Peint un duelliste. Le canvas doit être carré et de côté multiple de 16 :
   * chaque pixel du sprite devient alors un carré net, sans flou.
   *
   * @param {HTMLCanvasElement} canvas
   * @param {"player"|"bot"} side
   * @param {object} [options]
   * @param {boolean} [options.down]   duelliste à terre
   * @param {number}  [options.bob]    décalage vertical en pixels de grille
   * @param {number}  [options.flash]  0 à 1 : éclat blanc (impact)
   */
  function drawDuelist(canvas, side, options) {
    const opts = options || {};
    const grid = opts.down ? ART.down : (side === "player" ? ART.back : ART.front);
    const palette = PALETTES[side] || PALETTES.player;

    const ctx = canvas.getContext("2d");
    const scale = Math.floor(canvas.width / GRID);
    const bob = opts.bob || 0;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;

    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const ch = cellAt(grid, x, y);
        if (ch === "." || ch === " ") continue;
        ctx.fillStyle = palette[ch] || MISSING_COLOR;
        ctx.fillRect(x * scale, (y + bob) * scale, scale, scale);
      }
    }

    // Éclat blanc au moment de l'impact : plus lisible qu'un simple
    // clignotement, et ça ne demande pas un second jeu de sprites.
    if (opts.flash > 0) {
      ctx.globalAlpha = Math.min(1, opts.flash) * 0.75;
      ctx.globalCompositeOperation = "source-atop";
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
    }
  }

  /* ---------------------------------------------------------------------------
   * 4. EFFETS D'ACTION
   * ---------------------------------------------------------------------------
   * Dessinés par-dessus la scène, dans un canvas qui couvre toute la zone de
   * duel. Chaque effet a une durée de vie exprimée de 1 (début) à 0 (fin) :
   * c'est l'interface qui fait descendre cette valeur.
   * ------------------------------------------------------------------------ */

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} kind   "shoot" | "defend" | "charge" | "clash" | "super"
   * @param {number} life   1 au déclenchement, 0 à la fin
   * @param {object} zone   {x, y, width, height} de la zone de duel
   * @param {"player"|"bot"} from  qui déclenche l'effet
   */
  function drawEffect(ctx, kind, life, zone, from) {
    if (life <= 0) return;
    const cx = zone.x + zone.width / 2;
    const topY = zone.y + zone.height * 0.28;
    const bottomY = zone.y + zone.height * 0.74;
    const shooterY = from === "player" ? bottomY : topY;
    const targetY = from === "player" ? topY : bottomY;

    ctx.save();

    if (kind === "shoot" || kind === "super") {
      // La balle parcourt la distance : on la place selon le temps écoulé.
      const progress = 1 - life;
      const y = shooterY + (targetY - shooterY) * progress;
      const big = kind === "super";

      // Traînée
      ctx.strokeStyle = big ? "rgba(255,180,60,.55)" : "rgba(255,230,170,.35)";
      ctx.lineWidth = big ? 5 : 2;
      ctx.beginPath();
      ctx.moveTo(cx, shooterY);
      ctx.lineTo(cx, y);
      ctx.stroke();

      // Projectile
      ctx.fillStyle = big ? "#ffd166" : "#fff3d0";
      ctx.beginPath();
      ctx.arc(cx, y, big ? 7 : 4, 0, Math.PI * 2);
      ctx.fill();

      // Éclair au départ, seulement au tout début
      if (life > 0.75) {
        ctx.fillStyle = "rgba(255,220,120," + (life - 0.75) * 4 + ")";
        ctx.beginPath();
        ctx.arc(cx, shooterY, big ? 26 : 16, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (kind === "defend") {
      // Arc de protection devant le duelliste
      ctx.strokeStyle = "rgba(120,200,255," + life * 0.9 + ")";
      ctx.lineWidth = 3;
      const radius = 34 + (1 - life) * 10;
      ctx.beginPath();
      ctx.arc(cx, shooterY, radius,
        from === "player" ? Math.PI : 0,
        from === "player" ? Math.PI * 2 : Math.PI);
      ctx.stroke();
    }

    if (kind === "charge") {
      // Étincelles qui convergent vers le duelliste
      ctx.fillStyle = "rgba(255,214,102," + life + ")";
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const distance = 12 + life * 30;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(angle) * distance, shooterY + Math.sin(angle) * distance, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (kind === "clash") {
      // Les deux balles se percutent à mi-chemin
      const midY = (topY + bottomY) / 2;
      ctx.strokeStyle = "rgba(255,240,180," + life + ")";
      ctx.lineWidth = 3;
      for (let i = 0; i < 10; i++) {
        const angle = (i / 10) * Math.PI * 2;
        const inner = 6, outer = 10 + (1 - life) * 34;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * inner, midY + Math.sin(angle) * inner);
        ctx.lineTo(cx + Math.cos(angle) * outer, midY + Math.sin(angle) * outer);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  DUELMINDS.sprites = { ART, PALETTES, GRID, drawDuelist, drawEffect };
})(typeof globalThis !== "undefined" ? globalThis : window);
