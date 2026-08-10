/* =============================================================================
 * DUELMINDS — INTERFACE
 * =============================================================================
 *
 * RÔLE DU FICHIER
 * Tout ce qui touche à l'écran : afficher l'état du duel, écouter les appuis,
 * enchaîner les écrans. C'est le SEUL fichier qui manipule le DOM.
 *
 * Il ne contient aucune règle. Quand il a besoin de savoir si une action est
 * permise ou qui gagne, il demande à combat.js et match.js.
 *
 * LES ÉCRANS
 *
 *     ACCUEIL ──(mode + difficulté)──> DUEL ──(manche jouée)──> ANNONCE
 *        ^                              ^                          │
 *        │                              └──(manche suivante)───────┤
 *        └────────(fin de partie)───────────────────────────────────┘
 *
 *     RÈGLES et STATS : accessibles depuis l'accueil.
 *
 * LE DÉROULÉ D'UN TOUR
 *   1. le joueur appuie sur une action
 *   2. on verrouille les boutons — plus aucun appui n'est accepté
 *   3. l'adversaire choisit, le moteur résout
 *   4. les deux choix apparaissent EN MÊME TEMPS au centre, avec l'effet
 *      correspondant : c'est la RÉVÉLATION
 *   5. après une pause, tour suivant ou fin de manche
 *
 * La pause n'est pas décorative : sans elle, le joueur ne verrait jamais ce
 * que l'adversaire a joué, et le jeu perdrait tout son sel.
 *
 * DÉPENDANCES : tous les autres modules
 * ========================================================================== */

(function (root) {
  "use strict";

  const DUELMINDS = (root.DUELMINDS = root.DUELMINDS || {});
  const { RULES, ACTIONS, ACTION_LABEL, MODES, DIFFICULTIES } = DUELMINDS;
  const { canDo, defenceCost, isSuperShot } = DUELMINDS.combat;
  const { drawDuelist, drawEffect } = DUELMINDS.sprites;
  const audio = DUELMINDS.audio;
  const stats = DUELMINDS.stats;

  /* Durées, en millisecondes. Assez long pour lire le coup adverse, assez
   * court pour ne pas casser le rythme. */
  const REVEAL_MS = 1250;
  const EFFECT_MS = 620;

  const state = {
    mode: null,
    difficulty: null,
    session: null,
    phase: "home",   // "home" | "choosing" | "revealing" | "announce"

    // Effet en cours, dessiné sur le canvas de scène
    effect: null,    // { kind, from, until }
    flash: { player: 0, bot: 0 },

    // Compteurs de la PARTIE en cours, pour la remontée
    log: null,
  };

  const $ = (id) => document.getElementById(id);

  function newLog() {
    return { turns: 0, clashes: 0, superShots: 0, duels: 0, manches: 0,
             actions: { charge: 0, shoot: 0, defend: 0 } };
  }

  /* =========================================================================
   * NAVIGATION
   * ====================================================================== */
  function showScreen(id) {
    for (const section of document.querySelectorAll(".screen")) {
      section.classList.toggle("on", section.id === id);
    }
  }

  /* =========================================================================
   * ÉCRAN D'ACCUEIL — choix du mode puis de la difficulté
   * ====================================================================== */

  function buildHome() {
    const modeList = $("modes");
    modeList.innerHTML = "";
    for (const mode of MODES) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "choice";
      button.dataset.mode = mode.key;
      button.innerHTML =
        "<span class='choice-title'>" + mode.label + "</span>" +
        "<span class='choice-desc'>" + mode.blurb + "</span>";
      button.addEventListener("click", () => selectMode(mode.key));
      modeList.appendChild(button);
    }

    const difficultyList = $("difficulties");
    difficultyList.innerHTML = "";
    for (const difficulty of DIFFICULTIES) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "choice";
      button.dataset.difficulty = difficulty.key;
      button.style.setProperty("--accent", "var(" + difficulty.accent + ")");
      button.innerHTML =
        "<span class='choice-title'>" + difficulty.label + "</span>" +
        "<span class='choice-desc'>" + difficulty.blurb + "</span>" +
        "<span class='choice-record' data-record='" + difficulty.key + "'></span>";
      button.addEventListener("click", () => selectDifficulty(difficulty.key));
      difficultyList.appendChild(button);
    }

    refreshHome();
  }

  function selectMode(key) {
    state.mode = key;
    audio.play("click");
    refreshHome();
  }

  function selectDifficulty(key) {
    state.difficulty = key;
    audio.play("click");
    refreshHome();
  }

  /** Met à jour la sélection, les records affichés et le bouton de départ. */
  function refreshHome() {
    for (const button of document.querySelectorAll("[data-mode]")) {
      button.classList.toggle("selected", button.dataset.mode === state.mode);
    }
    for (const button of document.querySelectorAll("[data-difficulty]")) {
      button.classList.toggle("selected", button.dataset.difficulty === state.difficulty);
    }

    // Le record d'arcade ne veut rien dire en mode duel : on ne l'affiche
    // que là où il a un sens.
    for (const span of document.querySelectorAll("[data-record]")) {
      const best = stats.bestStreak(span.dataset.record);
      const show = state.mode === "arcade" && best > 0;
      span.textContent = show ? "record " + best : "";
    }

    $("btn-start").disabled = !(state.mode && state.difficulty);
  }

  /* =========================================================================
   * ÉCRAN DE RÈGLES — chiffres injectés depuis rules.js
   * ====================================================================== */
  function buildRules() {
    $("rules-super").textContent = RULES.SUPER_SHOT_BULLETS;
    $("rules-manches").textContent = RULES.MANCHES_TO_WIN;
    $("rules-start").textContent = RULES.START_BULLETS;
    $("rules-free").textContent = RULES.FREE_DEFENCE_RIGHT + 1;
  }

  /* =========================================================================
   * LE DUEL
   * ====================================================================== */

  function startSession() {
    state.session = DUELMINDS.match.createSession(state.mode, state.difficulty);
    DUELMINDS.match.startManche(state.session);
    state.phase = "choosing";
    state.log = newLog();
    state.effect = null;
    state.flash.player = 0;
    state.flash.bot = 0;

    stats.recordSessionStart(state.mode, state.difficulty);

    setLog(state.mode === "arcade"
      ? "Mode arcade. Chaque duel gagné prolonge la série."
      : "Premier à " + RULES.MANCHES_TO_WIN + " manches remporte le duel.");

    renderDuel();
    showScreen("screen-duel");
  }

  function setLog(text) { $("log").textContent = text; }

  function renderDuel() {
    const s = state.session;

    // Bandeau : mode, difficulté, et série en cours si on est en arcade
    const difficulty = DIFFICULTIES.find((d) => d.key === s.difficulty);
    $("hud-mode").textContent = MODES.find((m) => m.key === s.mode).label;
    $("hud-difficulty").textContent = difficulty.label;
    $("hud-difficulty").style.setProperty("--accent", "var(" + difficulty.accent + ")");

    const arcade = s.mode === "arcade";
    $("hud-streak").hidden = !arcade;
    if (arcade) {
      $("streak-value").textContent = s.streak;
      $("streak-best").textContent = stats.bestStreak(s.difficulty);
    }

    $("manche-number").textContent = s.mancheNumber;
    renderScore($("score-me"), s.player.manchesWon);
    renderScore($("score-bot"), s.bot.manchesWon);

    renderDuelist("me", s.player);
    renderDuelist("bot", s.bot);

    // On DÉSACTIVE les actions interdites au lieu de les masquer : le joueur
    // doit voir qu'il lui manque une balle, pas chercher le bouton.
    const canAct = state.phase === "choosing";
    for (const button of document.querySelectorAll(".action")) {
      button.disabled = !canAct || !canDo(s.player, button.dataset.action);
    }

    // Le bouton de tir annonce quand le coup traversera la protection.
    $("shoot-note").textContent = isSuperShot(s.player) ? "SUPER TIR" : "coûte 1 balle";
    $("btn-shoot").classList.toggle("super", isSuperShot(s.player));

    const cost = defenceCost(s.player);
    $("defend-note").textContent = cost === 0 ? "gratuit" : "coûte " + cost + " balle";
  }

  function renderScore(container, won) {
    container.innerHTML = "";
    for (let i = 0; i < RULES.MANCHES_TO_WIN; i++) {
      const pip = document.createElement("span");
      pip.className = "pip" + (i < won ? " won" : "");
      container.appendChild(pip);
    }
  }

  /** Barillet : une pastille par balle. Bien plus lisible qu'un nombre. */
  function renderDuelist(side, duelist) {
    const prefix = side === "me" ? "me" : "bot";
    $(prefix + "-bullets").innerHTML = "";

    // On affiche au moins 4 emplacements pour que le seuil de super tir soit
    // visible même quand le barillet est presque vide.
    const slots = Math.max(RULES.SUPER_SHOT_BULLETS, duelist.bullets);
    for (let i = 0; i < slots; i++) {
      const bullet = document.createElement("span");
      bullet.className = "bullet" + (i < duelist.bullets ? " loaded" : "") +
        (i === RULES.SUPER_SHOT_BULLETS - 1 ? " threshold" : "");
      $(prefix + "-bullets").appendChild(bullet);
    }

    const defends = duelist.consecutiveDefends;
    $(prefix + "-guard").textContent = defends > 0 ? "protection ×" + defends : "";
  }

  /* ---------------------------------------------------------------------------
   * LA SCÈNE — deux duellistes et les effets, sur des canvas
   * ------------------------------------------------------------------------ */

  function sceneZone() {
    const canvas = $("effects");
    return { x: 0, y: 0, width: canvas.width, height: canvas.height };
  }

  /** Redimensionne le canvas d'effets à la taille réelle de la scène. */
  function resizeScene() {
    const canvas = $("effects");
    const box = canvas.parentElement.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(box.width));
    canvas.height = Math.max(1, Math.round(box.height));
  }

  /* ---------------------------------------------------------------------------
   * UN TOUR
   * ------------------------------------------------------------------------ */

  function onPlayerAction(action) {
    const s = state.session;
    if (state.phase !== "choosing" || !canDo(s.player, action)) return;

    // Verrou immédiat : plus rien n'est cliquable jusqu'à la fin de la révélation
    state.phase = "revealing";
    for (const button of document.querySelectorAll(".action")) button.disabled = true;

    const result = DUELMINDS.match.playTurn(s, action);
    const turn = result.turn;

    // Compteurs
    state.log.turns += 1;
    state.log.actions[action] += 1;
    if (turn.resultA === "clash") state.log.clashes += 1;
    if (turn.resultA === "super_shot" || turn.resultB === "super_shot") state.log.superShots += 1;
    stats.recordTurn(action, turn);

    showReveal(turn);
    playTurnSound(turn);
    renderDuel();
    setLog(describeTurn(turn));

    window.setTimeout(() => finishTurn(result), REVEAL_MS);
  }

  /** Affiche les deux choix côte à côte et déclenche l'effet visuel. */
  function showReveal(turn) {
    const band = $("reveal");
    band.innerHTML = "";
    band.appendChild(revealCard("Adversaire", turn.actionB, turn.resultB, "from-top"));
    band.appendChild(revealCard("Toi", turn.actionA, turn.resultA, "from-bottom"));

    // Un seul effet par tour : le plus marquant.
    if (turn.resultA === "clash" && turn.resultB === "clash") {
      triggerEffect("clash", "player");
    } else if (turn.resultA === "super_shot") {
      triggerEffect("super", "player");
    } else if (turn.resultB === "super_shot") {
      triggerEffect("super", "bot");
    } else if (turn.actionA === "shoot") {
      triggerEffect("shoot", "player");
    } else if (turn.actionB === "shoot") {
      triggerEffect("shoot", "bot");
    } else if (turn.actionA === "defend" || turn.actionB === "defend") {
      triggerEffect("defend", turn.actionA === "defend" ? "player" : "bot");
    } else {
      triggerEffect("charge", "player");
    }

    // L'éclat blanc marque qui vient d'être touché.
    if (turn.winner === "a") state.flash.bot = 1;
    if (turn.winner === "b") state.flash.player = 1;
  }

  function revealCard(who, action, result, animation) {
    const card = document.createElement("div");
    card.className = "reveal-card " + animation +
      (result === "super_shot" ? " super" : "") +
      (result === "clash" ? " clash" : "");
    card.innerHTML =
      "<span class='reveal-who'>" + who + "</span>" +
      "<span class='reveal-action'>" + ACTION_LABEL[action] + "</span>" +
      (result === "super_shot" ? "<span class='reveal-tag'>super tir</span>" : "") +
      (result === "death" ? "<span class='reveal-tag'>impossible</span>" : "");
    return card;
  }

  function triggerEffect(kind, from) {
    state.effect = { kind, from, until: performance.now() + EFFECT_MS };
  }

  function playTurnSound(turn) {
    if (turn.resultA === "clash" && turn.resultB === "clash") {
      audio.play("clash"); audio.vibrate(25); return;
    }
    if (turn.resultA === "super_shot" || turn.resultB === "super_shot") {
      audio.play("super"); audio.vibrate([40, 40, 80]); return;
    }
    if (turn.actionA === "shoot" || turn.actionB === "shoot") {
      audio.play("shoot"); audio.vibrate(20); return;
    }
    if (turn.actionA === "defend" || turn.actionB === "defend") { audio.play("defend"); return; }
    audio.play("charge");
  }

  function describeTurn(turn) {
    const lines = ["Toi : " + ACTION_LABEL[turn.actionA] +
                   "  ·  Adversaire : " + ACTION_LABEL[turn.actionB] + "."];
    if (turn.reason) lines.push(turn.reason);
    return lines.join(" ");
  }

  /* ---------------------------------------------------------------------------
   * FIN DE TOUR : manche suivante, duel suivant, ou fin de partie
   * ------------------------------------------------------------------------ */

  function finishTurn(result) {
    const s = state.session;

    if (!result.mancheOver) {
      state.phase = "choosing";
      renderDuel();
      return;
    }

    state.log.manches += 1;
    const playerWonManche = result.turn.winner === "a";
    stats.recordManche(s.difficulty, playerWonManche);
    audio.play(playerWonManche ? "win" : "down");

    if (!result.duelOver) {
      // Manche suivante du même duel
      announce(
        playerWonManche ? "Manche gagnée" : "Manche perdue",
        s.lastReason,
        "Manche " + (s.mancheNumber),
        () => {
          DUELMINDS.match.startManche(s);
          state.phase = "choosing";
          renderDuel();
          showScreen("screen-duel");
        }
      );
      return;
    }

    // --- Le duel est joué ---
    state.log.duels += 1;
    const playerWonDuel = result.duelWinner === "a";
    stats.recordDuel(s.mode, s.difficulty, playerWonDuel);
    if (playerWonDuel) audio.play("victory");

    if (!result.sessionOver) {
      // Arcade : la série continue
      announce(
        "Duel remporté",
        "Série de " + s.streak + (s.streak > 1 ? " duels" : " duel") + ". L'adversaire suivant arrive.",
        "Duel " + (s.streak + 1),
        () => {
          DUELMINDS.match.startNextDuel(s);
          state.phase = "choosing";
          renderDuel();
          showScreen("screen-duel");
        }
      );
      return;
    }

    endSession(playerWonDuel);
  }

  /** Écran intermédiaire entre deux manches ou deux duels. */
  function announce(title, detail, buttonLabel, onContinue) {
    state.phase = "announce";
    $("announce-title").textContent = title;
    $("announce-detail").textContent = detail;
    $("btn-announce").textContent = buttonLabel;
    $("btn-announce").onclick = () => { audio.play("click"); onContinue(); };
    showScreen("screen-announce");
  }

  /* ---------------------------------------------------------------------------
   * FIN DE PARTIE
   * ------------------------------------------------------------------------ */

  function endSession(playerWonDuel) {
    const s = state.session;
    state.phase = "announce";

    let title, detail;

    if (s.mode === "arcade") {
      const isRecord = stats.recordStreak(s.difficulty, s.streak);
      title = s.streak === 0 ? "Série terminée" : "Série de " + s.streak;
      detail = s.lastReason + " " +
        (isRecord && s.streak > 0
          ? "Nouveau record sur ce niveau."
          : "Ton record ici est de " + stats.bestStreak(s.difficulty) + ".");
    } else {
      title = playerWonDuel ? "Duel remporté" : "Duel perdu";
      detail = s.lastReason;
    }

    $("end-title").textContent = title;
    $("end-detail").textContent = detail;

    // Résumé chiffré de la partie
    const summary = $("end-summary");
    summary.innerHTML = "";
    const rows = [
      ["Mode", MODES.find((m) => m.key === s.mode).label],
      ["Difficulté", DIFFICULTIES.find((d) => d.key === s.difficulty).label],
      ["Duels joués", state.log.duels],
      ["Manches", state.log.manches],
      ["Tours", state.log.turns],
      ["Clashs", state.log.clashes],
      ["Super tirs", state.log.superShots],
    ];
    if (s.mode === "arcade") rows.splice(2, 0, ["Série", s.streak]);
    for (const [label, value] of rows) {
      const row = document.createElement("div");
      row.className = "summary-row";
      row.innerHTML = "<span>" + label + "</span><b class='num'>" + value + "</b>";
      summary.appendChild(row);
    }

    reportSession(playerWonDuel);
    showScreen("screen-end");
  }

  /** Remonte la partie vers le point de collecte, s'il y en a un. */
  function reportSession(playerWonDuel) {
    if (!DUELMINDS.telemetry || !DUELMINDS.telemetry.isEnabled()) return;
    const s = state.session;
    DUELMINDS.telemetry.sendSession({
      mode: s.mode,
      difficulty: s.difficulty,
      result: s.mode === "arcade" ? "serie" : (playerWonDuel ? "victoire" : "defaite"),
      streak: s.mode === "arcade" ? s.streak : "",
      duels: state.log.duels,
      manches: state.log.manches,
      turns: state.log.turns,
      clashes: state.log.clashes,
      superShots: state.log.superShots,
      actions: state.log.actions,
    });
  }

  /* =========================================================================
   * ÉCRAN DES STATISTIQUES
   * ====================================================================== */

  function renderStats() {
    const s = stats.get();
    const body = $("stats-body");

    if (!stats.hasData()) {
      body.innerHTML = "<p>Aucune partie jouée pour l'instant. Les compteurs se " +
        "remplissent au fil des duels.</p>";
      return;
    }

    const pct = stats.percent;

    const modeRows = MODES.map((mode) => {
      const m = s.byMode[mode.key];
      return "<tr><td>" + mode.label + "</td><td class='n'>" + m.sessions + "</td>" +
        "<td class='n'>" + m.duelsPlayed + "</td>" +
        "<td class='n'>" + pct(m.duelsWon, m.duelsPlayed) + " %</td></tr>";
    }).join("");

    const difficultyRows = DIFFICULTIES.map((difficulty) => {
      const d = s.byDifficulty[difficulty.key];
      return "<tr><td>" + difficulty.label + "</td>" +
        "<td class='n'>" + pct(d.duelsWon, d.duelsPlayed) + " %</td>" +
        "<td class='n'>" + pct(d.manchesWon, d.manchesPlayed) + " %</td>" +
        "<td class='n'>" + d.bestStreak + "</td></tr>";
    }).join("");

    const actionRows = ACTIONS.map((action) =>
      "<tr><td>" + ACTION_LABEL[action] + "</td>" +
      "<td class='n'>" + s.byAction[action] + "</td>" +
      "<td class='n'>" + pct(s.byAction[action], s.turns) + " %</td></tr>").join("");

    body.innerHTML =
      "<h3>Modes</h3><div class='table-wrap'><table>" +
        "<thead><tr><th>Mode</th><th class='n'>Parties</th><th class='n'>Duels</th>" +
        "<th class='n'>Gagnés</th></tr></thead><tbody>" + modeRows + "</tbody></table></div>" +

      "<h3>Difficultés</h3><div class='table-wrap'><table>" +
        "<thead><tr><th>Niveau</th><th class='n'>Duels</th><th class='n'>Manches</th>" +
        "<th class='n'>Record</th></tr></thead><tbody>" + difficultyRows + "</tbody></table></div>" +

      "<h3>Tes actions</h3><div class='table-wrap'><table>" +
        "<thead><tr><th>Action</th><th class='n'>Fois</th><th class='n'>Part</th></tr></thead>" +
        "<tbody>" + actionRows + "</tbody></table></div>" +

      "<h3>Mécaniques</h3><ul>" +
        "<li><b>" + s.turns + "</b> tours joués</li>" +
        "<li>" + pct(s.clashes, s.turns) + " % de clashs</li>" +
        "<li><b>" + s.superShots + "</b> super tirs</li>" +
      "</ul>" +

      (stats.isPersistent()
        ? "<p>Ces chiffres ne concernent que cet appareil et sont conservés entre deux sessions.</p>"
        : "<p>Le stockage du navigateur est indisponible : ces chiffres seront perdus " +
          "en fermant l'onglet.</p>");
  }

  /** `navigator.clipboard` n'existe pas partout : on prévoit un repli. */
  function copyStats(button) {
    const text = stats.toText();
    const done = () => {
      const original = button.textContent;
      button.textContent = "Copié";
      window.setTimeout(() => { button.textContent = original; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try { document.execCommand("copy"); done(); } catch (e) { /* rien à faire */ }
    document.body.removeChild(area);
  }

  /* =========================================================================
   * BOUCLE D'ANIMATION
   * -------------------------------------------------------------------------
   * Une seule boucle pour tout : la respiration des duellistes, l'effet en
   * cours et l'éclat d'impact. Redessiner en continu coûte moins cher que de
   * jongler avec des minuteurs, et reste fluide sur téléphone.
   * ====================================================================== */

  function loop(timestamp) {
    if ($("screen-duel").classList.contains("on") && state.session) {
      const s = state.session;

      // Respiration : un pixel de haut en bas, en opposition entre les deux
      const bob = Math.sin(timestamp / 520) > 0 ? 0 : 1;
      drawDuelist($("me-sprite"), "player",
        { bob, flash: state.flash.player, down: state.flash.player > 0.85 });
      drawDuelist($("bot-sprite"), "bot",
        { bob: 1 - bob, flash: state.flash.bot, down: state.flash.bot > 0.85 });

      // L'éclat s'estompe tout seul
      state.flash.player = Math.max(0, state.flash.player - 0.02);
      state.flash.bot = Math.max(0, state.flash.bot - 0.02);

      // Effet en cours
      const canvas = $("effects");
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (state.effect) {
        const life = (state.effect.until - timestamp) / EFFECT_MS;
        if (life <= 0) state.effect = null;
        else drawEffect(ctx, state.effect.kind, life, sceneZone(), state.effect.from);
      }
    }
    requestAnimationFrame(loop);
  }

  /* =========================================================================
   * DÉMARRAGE
   * ====================================================================== */
  function init() {
    buildHome();
    buildRules();

    // On ne collecte jamais de données sans le dire.
    if (DUELMINDS.telemetry && DUELMINDS.telemetry.isEnabled()) {
      $("privacy-note").hidden = false;
    }

    for (const button of document.querySelectorAll(".action")) {
      button.addEventListener("click", () => onPlayerAction(button.dataset.action));
    }

    $("btn-start").addEventListener("click", () => { audio.play("click"); startSession(); });
    $("btn-quit").addEventListener("click", () => { audio.play("click"); showScreen("screen-home"); refreshHome(); });
    $("btn-again").addEventListener("click", () => { audio.play("click"); startSession(); });
    $("btn-home").addEventListener("click", () => { audio.play("click"); showScreen("screen-home"); refreshHome(); });

    $("btn-rules").addEventListener("click", () => showScreen("screen-rules"));
    $("btn-rules-back").addEventListener("click", () => showScreen("screen-home"));
    $("btn-stats").addEventListener("click", () => { renderStats(); showScreen("screen-stats"); });
    $("btn-stats-back").addEventListener("click", () => showScreen("screen-home"));
    $("btn-stats-copy").addEventListener("click", (e) => copyStats(e.currentTarget));
    $("btn-stats-reset").addEventListener("click", () => { stats.reset(); renderStats(); refreshHome(); });

    window.addEventListener("resize", resizeScene);
    resizeScene();
    requestAnimationFrame(loop);
  }

  DUELMINDS.ui = { init, state };
})(typeof globalThis !== "undefined" ? globalThis : window);
