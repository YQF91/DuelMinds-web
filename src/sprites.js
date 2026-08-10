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
 * Un seul dessin par personnage suffit : le jeu en retourne un des deux pour
 * que les duellistes se regardent.
 *
 *       ADVERSAIRE                              TOI
 *           🧍  ──────  se regardent  ──────  🧍
 *
 * Encore faut-il savoir de quel côté regarde le dessin d'origine. C'est le
 * rôle de ART_FACING, plus bas : les personnages livrés regardent vers la
 * GAUCHE, donc c'est celui de gauche qu'on retourne. Si tu redessines tout
 * dans l'autre sens, une seule ligne est à changer.
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
   * DE QUEL CÔTÉ REGARDENT LES DESSINS ?
   * ---------------------------------------------------------------------------
   * "left"  -> les personnages sont dessinés tournés vers la gauche
   * "right" -> vers la droite
   *
   * C'est LA valeur à corriger si les deux duellistes se tournent le dos.
   * Elle décide lequel des deux est retourné à l'affichage, rien d'autre.
   *
   * Les personnages livrés (archer, cowboy, enchanteresse, gobelin…) visent
   * tous vers la gauche : c'est donc celui placé À GAUCHE qu'on retourne, pour
   * qu'il fasse face à son adversaire.
   * ------------------------------------------------------------------------ */
  const ART_FACING = "left";

  /**
   * Faut-il retourner ce duelliste ?
   * @param {"left"|"right"} position  son côté de l'arène
   */
  function shouldFlip(position) {
    return ART_FACING === "left" ? position === "left" : position === "right";
  }

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
   * 3. POSES — l'animation procédurale
   * ---------------------------------------------------------------------------
   * POURQUOI PAS DES IMAGES SUPPLÉMENTAIRES
   * Chaque personnage n'a qu'UN dessin. Plutôt que d'exiger une planche
   * d'animation par duelliste, on anime l'image existante en la DÉFORMANT :
   * on la déplace, on l'incline, on l'écrase, on l'étire. C'est la technique
   * classique des jeux à personnages chibi, et elle rend bien parce que ces
   * silhouettes sont trapues et lisibles.
   *
   * Chaque pose est une fonction du temps : elle reçoit une progression de 0
   * (début) à 1 (fin) et renvoie la déformation à appliquer.
   *
   *   dx, dy   déplacement, en fraction de la taille du sprite
   *   scaleX   étirement horizontal   (1 = taille normale)
   *   scaleY   étirement vertical
   *   rotate   inclinaison, en radians
   *   alpha    opacité
   *
   * `facing` vaut +1 quand le personnage regarde vers la droite, -1 sinon :
   * multiplier les déplacements horizontaux par cette valeur suffit à ce que
   * les deux camps s'animent en miroir sans écrire le code deux fois.
   * ------------------------------------------------------------------------ */

  /** Durée de chaque pose, en millisecondes. 0 = en boucle, sans fin. */
  const POSE_DURATION = {
    idle: 0,
    shoot: 620,
    super: 820,
    defend: 700,
    charge: 620,
    hit: 900,
  };

  /* Courbes d'accélération : un mouvement linéaire paraît mécanique. */
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function easeIn(t) { return t * t; }

  /**
   * Déformation à appliquer pour une pose donnée.
   *
   * @param {string} pose      "idle" | "shoot" | "super" | "defend" | "charge" | "hit"
   * @param {number} progress  0 au début de la pose, 1 à la fin
   * @param {number} time      horodatage, pour les mouvements continus
   * @param {number} facing    +1 vers la droite, -1 vers la gauche
   */
  function poseTransform(pose, progress, time, facing) {
    const t = { dx: 0, dy: 0, scaleX: 1, scaleY: 1, rotate: 0, alpha: 1 };

    if (!pose || pose === "idle") {
      // RESPIRATION — le corps s'étire et s'écrase en conservant son volume,
      // ce qui donne l'illusion du souffle plutôt qu'un simple va-et-vient.
      const breath = Math.sin(time / 620);
      t.dy = -breath * 0.012;
      t.scaleY = 1 + breath * 0.018;
      t.scaleX = 1 - breath * 0.012;
      // Un très léger balancement : sans lui, la pose paraît figée.
      t.rotate = Math.sin(time / 1450) * 0.012;
      return t;
    }

    if (pose === "shoot" || pose === "super") {
      const big = pose === "super";
      // Trois temps : on se ramasse, on se détend, on encaisse le recul.
      if (progress < 0.22) {
        const k = easeIn(progress / 0.22);
        t.dx = -0.055 * k * facing;
        t.scaleX = 1 - 0.04 * k;
        t.scaleY = 1 + 0.05 * k;
        t.rotate = -0.05 * k * facing;
      } else if (progress < 0.4) {
        const k = easeOut((progress - 0.22) / 0.18);
        t.dx = (-0.055 + 0.14 * k) * facing;
        t.scaleX = 1 + 0.06 * k;
        t.scaleY = 1 - 0.05 * k;
        t.rotate = (-0.05 + 0.09 * k) * facing;
      } else {
        // Retour amorti : le corps oscille avant de se replacer.
        const k = (progress - 0.4) / 0.6;
        const damp = Math.exp(-k * 4) * Math.cos(k * (big ? 22 : 16));
        t.dx = 0.085 * damp * facing;
        t.rotate = 0.04 * damp * facing;
        t.scaleY = 1 + 0.03 * damp;
      }
      if (big) { t.scaleX *= 1.05; t.scaleY *= 1.05; }
      return t;
    }

    if (pose === "defend") {
      // On se ramasse et on recule : le corps se met derrière lui-même.
      const k = progress < 0.3 ? easeOut(progress / 0.3)
              : progress < 0.75 ? 1
              : 1 - easeIn((progress - 0.75) / 0.25);
      t.dx = -0.05 * k * facing;
      t.dy = 0.055 * k;
      t.scaleY = 1 - 0.13 * k;
      t.scaleX = 1 + 0.08 * k;
      t.rotate = -0.06 * k * facing;
      return t;
    }

    if (pose === "charge") {
      // Une inspiration : le corps se gonfle puis retombe.
      const k = Math.sin(progress * Math.PI);
      t.scaleY = 1 + 0.09 * k;
      t.scaleX = 1 + 0.03 * k;
      t.dy = -0.05 * k;
      return t;
    }

    if (pose === "hit") {
      // Projeté en arrière, bascule au sol, et y reste.
      const k = easeOut(Math.min(1, progress / 0.55));
      t.dx = -0.16 * k * facing;
      t.dy = 0.1 * k;
      t.rotate = -1.15 * k * facing;
      t.alpha = 1 - 0.25 * k;
      return t;
    }

    return t;
  }

  /* ---------------------------------------------------------------------------
   * 4. RENDU D'UN DUELLISTE
   * ------------------------------------------------------------------------ */

  /**
   * Peint un duelliste sur son canvas.
   *
   * @param {HTMLCanvasElement} canvas
   * @param {object} options
   * @param {string}  options.character  clé du personnage (nom du PNG)
   * @param {"player"|"bot"} options.side  sert au repli et à l'orientation
   * @param {"left"|"right"} options.position  côté de l'arène occupé
   * @param {string}  options.pose          pose en cours (voir poseTransform)
   * @param {number}  options.poseProgress  0 à 1 dans la pose
   * @param {number}  options.time          horodatage, pour la respiration
   * @param {number}  options.flash         0 à 1 : éclat blanc d'impact
   */
  function drawDuelist(canvas, options) {
    const opts = options || {};
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;

    const entry = getImage(opts.character);
    const useImage = entry && entry.ready && !entry.failed;

    // Retourné ou non selon le côté qu'il occupe et le sens du dessin.
    const flipped = shouldFlip(opts.position);
    // `facing` sert aux animations : +1 quand le personnage regarde à droite.
    const facing = flipped ? 1 : -1;
    const transform = poseTransform(opts.pose, opts.poseProgress || 0, opts.time || 0, facing);

    ctx.save();
    ctx.globalAlpha = transform.alpha;

    /* Tout se joue autour d'un point d'ancrage placé aux PIEDS du personnage :
     * c'est ce qui fait qu'un étirement le grandit vers le haut au lieu de le
     * faire flotter, et qu'une rotation le fait basculer plutôt que tourner
     * sur lui-même. */
    const anchorX = canvas.width / 2;
    const anchorY = canvas.height * 0.96;

    ctx.translate(anchorX + transform.dx * canvas.width,
                  anchorY + transform.dy * canvas.height);
    if (flipped) ctx.scale(-1, 1);
    ctx.rotate(transform.rotate);
    ctx.scale(transform.scaleX, transform.scaleY);
    ctx.translate(-anchorX, -anchorY);

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
    // Contenue sans déformation, calée en bas : les pieds restent au sol quelle
    // que soit la proportion de l'image d'origine.
    const ratio = Math.min(canvas.width / image.width, canvas.height / image.height);
    const width = image.width * ratio;
    const height = image.height * ratio;
    ctx.drawImage(image, (canvas.width - width) / 2, canvas.height - height, width, height);
  }

  /** Silhouette en pixel art, quand aucune image n'est disponible. */
  function drawPixelFallback(ctx, canvas, opts) {
    const grid = opts.pose === "hit" ? ART.down : ART.stand;
    const palette = PALETTES[opts.side] || PALETTES.player;
    const scale = canvas.width / GRID;

    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const ch = cellAt(grid, x, y);
        if (ch === "." || ch === " ") continue;
        ctx.fillStyle = palette[ch] || MISSING_COLOR;
        // +1 pour éviter les fentes entre carrés quand l'échelle n'est pas ronde
        ctx.fillRect(x * scale, y * scale, scale + 1, scale + 1);
      }
    }
  }

  /** Un personnage a-t-il son image ? Sert à signaler les fichiers manquants. */
  function hasImage(key) {
    const entry = cache.get(key);
    return !!(entry && entry.ready && !entry.failed);
  }

  /* ---------------------------------------------------------------------------
   * 5. EFFETS D'ACTION
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

  DUELMINDS.sprites = { ART, PALETTES, GRID, POSE_DURATION, ART_FACING,
                        poseTransform, shouldFlip, drawDuelist, drawEffect,
                        preload, hasImage };
})(typeof globalThis !== "undefined" ? globalThis : window);
