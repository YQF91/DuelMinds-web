/* =============================================================================
 * DUELMINDS — DÉCOR ET VIE DE L'ARÈNE
 * =============================================================================
 *
 * LE PROBLÈME QUE ÇA RÉSOUT
 * L'arène était un dégradé vide : deux silhouettes flottant dans le brun. Rien
 * ne bougeait entre deux coups, et un duel où il ne se passe visuellement rien
 * pendant qu'on réfléchit paraît figé, presque cassé.
 *
 * TOUT EST DESSINÉ PAR LE CODE, AUCUNE IMAGE
 * Pas un seul fichier en plus : le décor est calculé. Ça garde le jeu à
 * quelques centaines de kilo-octets, ça marche hors ligne, et ça se re-teinte
 * en changeant trois couleurs.
 *
 * TROIS COUCHES, DU FOND VERS L'AVANT
 *   1. LE CIEL      un halo de crépuscule, et un astre bas sur l'horizon.
 *   2. LES RELIEFS  deux rangées de silhouettes. Celle du fond est plus pâle
 *                   et plus basse : c'est ce simple écart qui donne la
 *                   profondeur, bien plus qu'un dessin détaillé.
 *   3. LE SOL       une bande sombre, une ligne d'horizon, et de la poussière
 *                   qui monte lentement.
 *
 * CE QUI DONNE VRAIMENT L'IMPRESSION DE VIE
 * Moins le décor que ce qui RÉAGIT : la poussière soulevée à l'impact et la
 * secousse de l'arène. Un décor immobile reste un fond d'écran ; un décor qui
 * encaisse les coups fait partie du duel.
 *
 * DÉTERMINISME
 * Les reliefs sont tirés une seule fois par taille d'écran, avec un générateur
 * à graine fixe. Sans ça, ils grouilleraient à chaque image — recalculer un
 * paysage soixante fois par seconde le fait danser.
 *
 * DÉPENDANCES : aucune.
 * ========================================================================== */

(function (root) {
  "use strict";

  const DUELMINDS = (root.DUELMINDS = root.DUELMINDS || {});

  /* ---------------------------------------------------------------------------
   * PALETTE
   * ---------------------------------------------------------------------------
   * Les mêmes bruns que le reste du jeu (voir styles/main.css). Réunis ici pour
   * pouvoir changer l'ambiance d'un seul endroit.
   * ------------------------------------------------------------------------ */
  const SKY = {
    high:     "#241b15",
    low:      "#3b2a1c",
    sun:      "rgba(224,161,60,.30)",
    farHill:  "#2c2119",
    nearHill: "#221a14",
    ground:   "#15100d",
    horizon:  "rgba(224,161,60,.16)",
    dust:     "rgba(224,190,140,",
  };

  /* HAUTEUR DU SOL — en PIXELS depuis le bas, pas en proportion.
   *
   * C'est important : les duellistes sont posés par le CSS à une distance fixe
   * du bas de l'arène (`.fighter { bottom: 10px }` plus l'épaisseur de leur
   * plateforme). Une ligne d'horizon exprimée en pourcentage se décalerait
   * donc à chaque hauteur d'écran, et on verrait les personnages flotter
   * au-dessus du sol sur un téléphone, s'y enfoncer sur un grand écran.
   * En pixels depuis le bas, ils gardent les pieds sur terre partout. */
  const GROUND_FROM_BOTTOM = 18;

  /** Ordonnée du sol pour une arène de cette hauteur. */
  function groundLine(height) {
    // Sur une arène très basse, on garde malgré tout du ciel visible.
    return Math.max(height * 0.45, height - GROUND_FROM_BOTTOM);
  }

  /* ---------------------------------------------------------------------------
   * GÉNÉRATEUR À GRAINE
   * ---------------------------------------------------------------------------
   * Math.random() redonnerait un paysage différent à chaque image. Il faut donc
   * une suite reproductible : même graine, même horizon.
   * ------------------------------------------------------------------------ */
  function seeded(seed) {
    let value = seed >>> 0;
    return function () {
      value = (value * 1664525 + 1013904223) >>> 0;
      return value / 4294967296;
    };
  }

  /* ---------------------------------------------------------------------------
   * LES RELIEFS
   * ------------------------------------------------------------------------ */
  let skyline = null;   // { width, height, far: [...], near: [...] }

  /**
   * Prépare les deux rangées de silhouettes pour une taille donnée.
   * Appelé au redimensionnement seulement, jamais dans la boucle de dessin.
   */
  function buildSkyline(width, height) {
    const random = seeded(20260811);       // graine fixe : toujours le même lieu
    const groundY = groundLine(height);

    function row(count, minH, maxH, spread) {
      const points = [];
      for (let i = 0; i < count; i++) {
        const x = (i / (count - 1)) * width * 1.1 - width * 0.05;
        points.push({
          x: x + (random() - 0.5) * spread,
          w: width * (0.10 + random() * 0.14),
          h: minH + random() * (maxH - minH),
        });
      }
      return points;
    }

    skyline = {
      width, height, groundY,
      // Le fond : plus bas, plus large, plus pâle.
      far:  row(7, height * 0.10, height * 0.20, width * 0.05),
      // L'avant : plus haut et plus sombre, ce qui creuse la profondeur.
      near: row(5, height * 0.16, height * 0.30, width * 0.08),
    };
  }

  function drawRow(ctx, points, groundY, colour) {
    ctx.fillStyle = colour;
    for (const p of points) {
      // Un mamelon plutôt qu'un rectangle : une courbe suffit à évoquer une
      // butte, et se lit mieux qu'un dessin détaillé à cette taille.
      ctx.beginPath();
      ctx.moveTo(p.x - p.w / 2, groundY);
      ctx.quadraticCurveTo(p.x, groundY - p.h * 2, p.x + p.w / 2, groundY);
      ctx.closePath();
      ctx.fill();
    }
  }

  /* ---------------------------------------------------------------------------
   * LA POUSSIÈRE
   * ---------------------------------------------------------------------------
   * Deux usages du même système :
   *   - AMBIANTE, quelques grains qui montent en permanence, pour que l'écran
   *     ne soit jamais complètement immobile ;
   *   - D'IMPACT, une gerbe projetée au point touché.
   * ------------------------------------------------------------------------ */
  const particles = [];
  const MAX_PARTICLES = 90;   // au-delà, on ne voit pas la différence

  function spawn(x, y, count, force) {
    for (let i = 0; i < count && particles.length < MAX_PARTICLES; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * (force ? 2.4 : 0.8);
      const speed = (force ? 40 + Math.random() * 110 : 4 + Math.random() * 10);
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        fade: force ? 1.1 + Math.random() : 0.28 + Math.random() * 0.25,
        size: (force ? 1.4 : 0.9) + Math.random() * 1.6,
      });
    }
  }

  /** Gerbe de poussière à l'endroit d'un impact. */
  function burst(x, y) { spawn(x, y, 16, true); }

  function updateParticles(dt, width, height) {
    // Renouvellement ambiant : quelques grains par seconde, répartis au sol.
    if (Math.random() < dt * 6 && particles.length < MAX_PARTICLES - 20) {
      const ground = groundLine(height);
      spawn(Math.random() * width, ground - Math.random() * 6, 1, false);
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 34 * dt;          // la gravité ramène les gerbes vers le sol
      p.vx *= 1 - 1.6 * dt;     // et l'air les freine
      p.life -= p.fade * dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function drawParticles(ctx) {
    for (const p of particles) {
      ctx.fillStyle = SKY.dust + (Math.max(0, p.life) * 0.5).toFixed(3) + ")";
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
  }

  /* ---------------------------------------------------------------------------
   * LA SECOUSSE
   * ---------------------------------------------------------------------------
   * Une amplitude qui décroît, lue par l'interface pour décaler l'arène. C'est
   * le retour le plus rentable du lot : trois lignes, et un tir cesse d'être un
   * simple changement d'image.
   * ------------------------------------------------------------------------ */
  let shakeAmount = 0;

  function shake(strength) {
    shakeAmount = Math.max(shakeAmount, strength);
  }

  /** Décalage à appliquer maintenant, en pixels. */
  function shakeOffset(time) {
    if (shakeAmount <= 0.05) return { x: 0, y: 0 };
    return {
      x: Math.sin(time / 18) * shakeAmount,
      y: Math.cos(time / 13) * shakeAmount * 0.6,
    };
  }

  /* ---------------------------------------------------------------------------
   * DESSIN COMPLET
   * ------------------------------------------------------------------------ */

  /**
   * Repeint le décor et fait avancer la vie de l'arène.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} width
   * @param {number} height
   * @param {number} time  horloge de l'animation, en millisecondes
   * @param {number} dt    secondes écoulées depuis l'image précédente
   */
  function draw(ctx, width, height, time, dt) {
    if (!skyline || skyline.width !== width || skyline.height !== height) {
      buildSkyline(width, height);
    }
    const groundY = skyline.groundY;

    ctx.clearRect(0, 0, width, height);

    // 1. Le ciel, et l'astre bas sur l'horizon.
    const sky = ctx.createLinearGradient(0, 0, 0, groundY);
    sky.addColorStop(0, SKY.high);
    sky.addColorStop(1, SKY.low);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, groundY);

    const glow = ctx.createRadialGradient(
      width * 0.5, groundY, 0, width * 0.5, groundY, height * 0.55);
    glow.addColorStop(0, SKY.sun);
    glow.addColorStop(1, "transparent");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, groundY);

    // 2. Les reliefs, du plus lointain au plus proche.
    drawRow(ctx, skyline.far, groundY, SKY.farHill);
    drawRow(ctx, skyline.near, groundY, SKY.nearHill);

    // 3. Le sol, et la ligne d'horizon qui l'accroche au ciel.
    ctx.fillStyle = SKY.ground;
    ctx.fillRect(0, groundY, width, height - groundY);
    ctx.fillStyle = SKY.horizon;
    ctx.fillRect(0, groundY - 1, width, 2);

    // 4. La poussière, par-dessus tout le reste.
    updateParticles(dt, width, height);
    drawParticles(ctx);

    // La secousse s'éteint d'elle-même.
    if (shakeAmount > 0) shakeAmount = Math.max(0, shakeAmount - dt * 26);
  }

  DUELMINDS.scene = { draw, burst, shake, shakeOffset, groundLine };
})(typeof globalThis !== "undefined" ? globalThis : window);
