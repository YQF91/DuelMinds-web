/* =============================================================================
 * DUELMINDS — SPRITES ET EFFETS
 * =============================================================================
 *
 * RÔLE DU FICHIER
 * Dessiner les deux duellistes et les effets de leurs actions.
 *
 * DEUX SOURCES D'IMAGE, DANS CET ORDRE
 *
 *   1. UN PNG dans `assets/characters/<clé>.png` — les vrais personnages.
 *   2. À DÉFAUT, une silhouette en pixel art décrite en texte plus bas.
 *
 * Ce repli n'est pas un détail : il permet de jouer avant que tous les dessins
 * ne soient prêts, et évite qu'un fichier manquant ne casse la page. Un
 * personnage sans image reste parfaitement jouable, il est juste moins beau.
 *
 * ORIENTATION — comment les deux se font face
 * Les images sont toutes dessinées tournées vers la droite (ou de face). Le
 * duelliste de GAUCHE est donc retourné horizontalement à l'affichage :
 *
 *       ADVERSAIRE                              TOI
 *           🧍  ──────  se regardent  ──────  🧍
 *       (retourné)                        (tel quel)
 *
 * C'est la disposition d'un duel Fire Emblem, et elle rend le face-à-face
 * lisible sans avoir à dessiner deux versions de chaque personnage.
 *
 * COMMENT LIRE UNE SILHOUETTE DE SECOURS
 * Une grille de 16 lignes de 16 caractères, une lettre par couleur :
 *
 *     .  vide (transparent)      p  peau
 *     o  contour sombre          j  jean
 *     c  chapeau                 b  botte / cuir
 *     v  veste / chemise         m  métal
 *
 * Les lignes plus courtes que 16 sont complétées : une faute de frappe ne
 * casse jamais l'affichage.
 *
 * DÉPENDANCES : aucune
 * ========================================================================== */

(function (root) {
  "use strict";

  const DUELMINDS = (root.DUELMINDS = root.DUELMINDS || {});
  const GRID = 16;
  const ASSET_PATH = "assets/characters/";

  /* ---------------------------------------------------------------------------
   * 1. CHARGEMENT DES IMAGES
   * ---------------------------------------------------------------------------
   * On demande une image une seule fois et on retient le résultat, succès ou
   * échec. Un fichier absent ne doit pas provoquer une nouvelle tentative à
   * chaque image de l'animation — soit 60 requêtes par seconde.
   * ------------------------------------------------------------------------ */
  const cache = new Map(); // clé -> { image, ready, failed }

  function getImage(key) {
    if (!key) return null;
    if (cache.has(key)) return cache.get(key);

    const entry = { image: new Image(), ready: false, failed: false };
    entry.image.onload = () => { entry.ready = true; };
    entry.image.onerror = () => { entry.failed = true; };
    entry.image.src = ASSET_PATH + key + ".png";
    cache.set(key, entry);
    return entry;
  }

  /** Précharge toute la distribution, pour éviter un clignotement au premier duel. */
  function preload(keys) {
    for (const key of keys) getImage(key);
  }

  /* ---------------------------------------------------------------------------
   * 2. SILHOUETTES DE SECOURS
   * ------------------------------------------------------------------------ */
  const ART = {
    // Duelliste debout, de trois quarts, tourné vers la droite
    stand: [
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
    // À terre, le chapeau roulé à côté
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

  /* Deux tenues pour distinguer les duellistes quand aucune image n'est
   * disponible. Avec les vraies images, ces palettes ne servent plus. */
  const PALETTES = {
    player: { o: "#241a14", c: "#6b4a2f", v: "#c08a4a", p: "#e8b48a", j: "#33507a", b: "#4a3220", m: "#d6d2c4" },
    bot:    { o: "#1e1620", c: "#5a3540", v: "#a35a5a", p: "#e0a880", j: "#3a3550", b: "#3d2630", m: "#d6d2c4" },
  };

  const MISSING_COLOR = "#ff00ff"; // magenta : impossible à rater

  function cellAt(grid, x, y) {
    const row = grid[y];
    if (!row || x < 0 || x >= GRID || y < 0 || y >= GRID) return ".";
    return row.length > x ? row[x] : ".";
  }

  /* ---------------------------------------------------------------------------
   * 3. RENDU D'UN DUELLISTE
   * ------------------------------------------------------------------------ */

  /**
   * Peint un duelliste sur son canvas.
   *
   * @param {HTMLCanvasElement} canvas
   * @param {object} options
   * @param {string}  options.character  clé du personnage (nom du PNG)
   * @param {"player"|"bot"} options.side  sert au repli et à l'orientation
   * @param {boolean} options.faceLeft   retourne l'image (duelliste de gauche)
   * @param {boolean} options.down       duelliste à terre
   * @param {number}  options.bob        respiration, en pixels de grille
   * @param {number}  options.flash      0 à 1 : éclat blanc d'impact
   */
  function drawDuelist(canvas, options) {
    const opts = options || {};
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;

    const entry = getImage(opts.character);
    const useImage = entry && entry.ready && !entry.failed;

    ctx.save();

    // Le retournement se fait sur le contexte entier : c'est ce qui permet de
    // n'avoir qu'un seul dessin par personnage.
    if (opts.faceLeft) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }

    if (useImage) {
      drawImageContained(ctx, entry.image, canvas, opts);
    } else {
      drawPixelFallback(ctx, canvas, opts);
    }

    ctx.restore();

    // L'éclat marque qui vient d'être touché. Plus lisible qu'un clignotement,
    // et ça ne demande pas un second jeu d'images.
    if (opts.flash > 0) {
      ctx.globalAlpha = Math.min(1, opts.flash) * 0.7;
      ctx.globalCompositeOperation = "source-atop";
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
    }
  }

  /**
   * Dessine l'image en la contenant dans le canvas, sans la déformer.
   * Le personnage est calé sur le BAS : ses pieds restent au sol même si
   * l'image n'est pas carrée.
   */
  function drawImageContained(ctx, image, canvas, opts) {
    const bobPixels = (opts.bob || 0) * (canvas.height / GRID);
    const ratio = Math.min(canvas.width / image.width, canvas.height / image.height);
    const width = image.width * ratio;
    const height = image.height * ratio;
    const x = (canvas.width - width) / 2;
    const y = canvas.height - height + bobPixels;

    if (opts.down) {
      // À terre : on couche le personnage plutôt que de demander un second
      // dessin. Rotation d'un quart de tour, calée en bas.
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height * 0.82);
      ctx.rotate(-Math.PI / 2);
      ctx.globalAlpha = 0.75;
      ctx.drawImage(image, -height / 2, -width / 2, height, width);
      ctx.restore();
      return;
    }

    ctx.drawImage(image, x, y, width, height);
  }

  /** Silhouette en pixel art, quand aucune image n'est disponible. */
  function drawPixelFallback(ctx, canvas, opts) {
    const grid = opts.down ? ART.down : ART.stand;
    const palette = PALETTES[opts.side] || PALETTES.player;
    const scale = Math.floor(canvas.width / GRID);
    const bob = opts.bob || 0;

    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const ch = cellAt(grid, x, y);
        if (ch === "." || ch === " ") continue;
        ctx.fillStyle = palette[ch] || MISSING_COLOR;
        ctx.fillRect(x * scale, (y + bob) * scale, scale, scale);
      }
    }
  }

  /** Un personnage a-t-il son image ? Sert à signaler les fichiers manquants. */
  function hasImage(key) {
    const entry = cache.get(key);
    return !!(entry && entry.ready && !entry.failed);
  }

  /* ---------------------------------------------------------------------------
   * 4. EFFETS D'ACTION
   * ---------------------------------------------------------------------------
   * Dessinés dans un canvas qui couvre toute la scène. Les duellistes se font
   * face HORIZONTALEMENT : les projectiles vont donc de gauche à droite ou
   * l'inverse, jamais de haut en bas.
   *
   * Chaque effet a une durée de vie de 1 (début) à 0 (fin) ; c'est l'interface
   * qui fait descendre cette valeur.
   * ------------------------------------------------------------------------ */

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} kind  "shoot" | "super" | "defend" | "charge" | "clash"
   * @param {number} life  1 au déclenchement, 0 à la fin
   * @param {object} zone  {width, height} de la scène
   * @param {"player"|"bot"} from  qui déclenche
   */
  function drawEffect(ctx, kind, life, zone, from) {
    if (life <= 0) return;

    // Le joueur est à DROITE, l'adversaire à GAUCHE.
    const leftX = zone.width * 0.24;
    const rightX = zone.width * 0.76;
    const lineY = zone.height * 0.52;

    const originX = from === "player" ? rightX : leftX;
    const targetX = from === "player" ? leftX : rightX;

    ctx.save();

    if (kind === "shoot" || kind === "super") {
      const progress = 1 - life;
      const x = originX + (targetX - originX) * progress;
      const big = kind === "super";

      // Traînée derrière le projectile
      ctx.strokeStyle = big ? "rgba(209,87,63,.55)" : "rgba(255,230,170,.4)";
      ctx.lineWidth = big ? 6 : 2.5;
      ctx.beginPath();
      ctx.moveTo(originX, lineY);
      ctx.lineTo(x, lineY);
      ctx.stroke();

      ctx.fillStyle = big ? "#e0a13c" : "#fff3d0";
      ctx.beginPath();
      ctx.arc(x, lineY, big ? 8 : 4.5, 0, Math.PI * 2);
      ctx.fill();

      // Éclair de bouche, au tout début seulement
      if (life > 0.72) {
        const intensity = (life - 0.72) / 0.28;
        ctx.fillStyle = "rgba(255,220,120," + intensity + ")";
        ctx.beginPath();
        ctx.arc(originX, lineY, big ? 30 : 18, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (kind === "defend") {
      // Bouclier vertical devant le duelliste, tourné vers l'adversaire
      const facing = from === "player" ? -1 : 1;
      ctx.strokeStyle = "rgba(111,168,201," + life * 0.95 + ")";
      ctx.lineWidth = 3.5;
      const radius = 40 + (1 - life) * 12;
      ctx.beginPath();
      ctx.arc(originX + facing * 14, lineY, radius,
        facing < 0 ? Math.PI * 0.55 : Math.PI * 1.55,
        facing < 0 ? Math.PI * 1.45 : Math.PI * 0.45);
      ctx.stroke();
    }

    if (kind === "charge") {
      // Balles qui convergent vers le barillet
      ctx.fillStyle = "rgba(224,161,60," + life + ")";
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const distance = 14 + life * 34;
        ctx.beginPath();
        ctx.arc(originX + Math.cos(angle) * distance, lineY + Math.sin(angle) * distance,
                2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (kind === "clash") {
      // Les deux balles se percutent au milieu du terrain
      const midX = (leftX + rightX) / 2;
      ctx.strokeStyle = "rgba(255,240,180," + life + ")";
      ctx.lineWidth = 3;
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        const inner = 7;
        const outer = 12 + (1 - life) * 40;
        ctx.beginPath();
        ctx.moveTo(midX + Math.cos(angle) * inner, lineY + Math.sin(angle) * inner);
        ctx.lineTo(midX + Math.cos(angle) * outer, lineY + Math.sin(angle) * outer);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  DUELMINDS.sprites = { ART, PALETTES, GRID, drawDuelist, drawEffect, preload, hasImage };
})(typeof globalThis !== "undefined" ? globalThis : window);
