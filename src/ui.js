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
    character: null,    // clé du personnage choisi par le joueur
    botCharacter: null, // retiré au sort à chaque duel — voir pickBotCharacter
    session: null,
    phase: "home",   // "home" | "choosing" | "revealing" | "announce"

    // Effet en cours, dessiné sur le canvas de scène
    effect: null,    // { kind, from, until }
    flash: { player: 0, bot: 0 },

    /* Pose de chaque duelliste. Chacune retourne d'elle-même au repos quand sa
     * durée est écoulée — sauf « hit », qui laisse le perdant au sol. */
    pose: {
      player: { kind: "idle", start: 0 },
      bot: { kind: "idle", start: 0 },
    },

    // Compteurs de la PARTIE en cours, pour la remontée
    log: null,

    // Compteurs du DUEL en cours, pour la progression et les hauts faits
    duelLog: null,

    /* Ce que le dernier duel a rapporté : expérience, montée de niveau,
     * hauts faits débloqués. Affiché sur l'écran suivant. */
    lastProgress: null,

    /* Mode blitz : instant limite pour choisir. `null` hors blitz. */
    deadline: null,
    timedOut: 0,   // nombre de fois où le temps a décidé à la place du joueur
  };

  /** Le barillet adverse est-il caché ? Le mode OU la difficulté peuvent l'exiger. */
  function bulletsHidden() {
    const mode = MODES.find((m) => m.key === state.mode);
    const difficulty = DIFFICULTIES.find((d) => d.key === state.difficulty);
    return !!((mode && mode.hidesBullets) || (difficulty && difficulty.hidesBullets));
  }

  /** Le mode impose-t-il un chronomètre ? */
  function isTimed() {
    const mode = MODES.find((m) => m.key === state.mode);
    return !!(mode && mode.timed);
  }

  /**
   * Secondes pour choisir en mode blitz — c'est la DIFFICULTÉ qui les fixe :
   * 5 s en facile, 3 s en difficile, 2 s en extrême. Repli sur la valeur
   * générale si une difficulté ne le précisait pas.
   */
  function blitzSeconds() {
    const difficulty = DIFFICULTIES.find((d) => d.key === state.difficulty);
    return (difficulty && difficulty.blitzSeconds) || RULES.BLITZ_SECONDS;
  }

  /** Le mode enchaîne-t-il les duels ? */
  function isStreakMode() {
    const mode = MODES.find((m) => m.key === state.mode);
    return !!(mode && mode.isStreak);
  }

  const $ = (id) => document.getElementById(id);

  function newLog() {
    return { turns: 0, clashes: 0, superShots: 0, duels: 0, manches: 0,
             actions: { charge: 0, shoot: 0, defend: 0 } };
  }

  /* Compteurs remis à zéro à CHAQUE duel, alors que newLog() cumule toute la
   * session. Les hauts faits en ont besoin : « gagner sans se protéger » se
   * juge sur un duel, pas sur une soirée. `wasBehind` retient si l'adversaire
   * a mené à un moment, ce qui ne se relit pas dans le score final. */
  function newDuelLog() {
    return { turns: 0, defends: 0, shots: 0, clashes: 0,
             blockedShots: 0, superShotWins: 0, wasBehind: false };
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

    buildRoster();
    refreshHome();
  }

  /**
   * Grille de portraits. Le personnage est purement esthétique : il ne change
   * aucune règle. Tant qu'un PNG manque dans assets/characters/, la case
   * affiche l'initiale — on voit donc d'un coup d'œil ce qui reste à dessiner.
   */
  function buildRoster() {
    const grid = $("roster");
    grid.innerHTML = "";

    for (const character of DUELMINDS.CHARACTERS) {
      const slot = document.createElement("button");
      slot.type = "button";
      slot.className = "roster-slot";
      slot.dataset.character = character.key;
      slot.title = character.name + " — " + character.blurb;

      // L'image se remplace toute seule par l'initiale si le fichier manque.
      const image = document.createElement("img");
      image.alt = character.name;
      image.src = "assets/characters/" + character.key + ".png";
      image.addEventListener("error", () => {
        image.remove();
        const initial = document.createElement("span");
        initial.className = "initial";
        initial.textContent = character.name.charAt(0);
        slot.prepend(initial);
      });
      slot.appendChild(image);

      const label = document.createElement("span");
      label.className = "roster-name";
      label.textContent = character.name;
      slot.appendChild(label);

      slot.addEventListener("click", () => {
        state.character = character.key;
        audio.play("click");
        refreshHome();
      });
      grid.appendChild(slot);
    }

    // Premier personnage sélectionné par défaut : on peut lancer une partie
    // sans avoir à choisir.
    if (!state.character && DUELMINDS.CHARACTERS.length) {
      state.character = DUELMINDS.CHARACTERS[0].key;
    }
    DUELMINDS.sprites.preload(DUELMINDS.CHARACTERS.map((c) => c.key));
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

    for (const slot of document.querySelectorAll("[data-character]")) {
      slot.classList.toggle("selected", slot.dataset.character === state.character);
    }

    $("btn-start").disabled = !(state.mode && state.difficulty && state.character);
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

  /** Le nom affiché d'un personnage, à partir de sa clé. */
  function characterName(key) {
    const character = DUELMINDS.CHARACTERS.find((c) => c.key === key);
    return character ? character.name : "Duelliste";
  }

  /* ---------------------------------------------------------------------------
   * L'APPARENCE DE L'ADVERSAIRE
   * ---------------------------------------------------------------------------
   * Tirée au sort À CHAQUE DUEL, pas une seule fois pour toute la série.
   * Le cerveau derrière est peut-être identique — c'est voulu, c'est ce qui
   * rend les scores comparables — mais enchaîner trois fois la même silhouette
   * donne l'impression de rejouer le même adversaire. Le joueur ne voit pas
   * les probabilités de l'IA ; il voit qui lui fait face.
   *
   * Deux exclusions :
   *   - TON personnage, sinon deux silhouettes identiques se font face et le
   *     duel devient illisible ;
   *   - le PRÉCÉDENT adversaire, pour qu'aucun ne revienne deux fois de suite.
   *     Sans cette exclusion, le hasard pur en recollerait deux d'affilée une
   *     fois sur cinq — et un joueur lit toujours ça comme un bug, jamais
   *     comme une coïncidence.
   *
   * Les six images sont préchargées au démarrage (voir `preload`), le
   * changement se fait donc sans clignotement.
   * ------------------------------------------------------------------------ */
  function pickBotCharacter(avoid) {
    const all = DUELMINDS.CHARACTERS;
    /* Replis successifs : si les exclusions ne laissent personne — cas
     * impossible avec six personnages, mais on n'écrit pas du code qui casse
     * si demain il n'en reste que deux — on relâche la plus faible d'abord. */
    let pool = all.filter((c) => c.key !== state.character && c.key !== avoid);
    if (!pool.length) pool = all.filter((c) => c.key !== state.character);
    if (!pool.length) pool = all;
    return pool[Math.floor(Math.random() * pool.length)].key;
  }

  function startSession() {
    // Début de série : aucun adversaire précédent à éviter.
    state.botCharacter = pickBotCharacter(null);

    state.session = DUELMINDS.match.createSession(state.mode, state.difficulty, {
      blind: bulletsHidden(),          // symétrie : elle ne voit pas plus que toi
      characterKey: state.botCharacter, // la silhouette d'en face annonce la couleur
    });
    DUELMINDS.match.startManche(state.session);
    state.phase = "choosing";
    state.log = newLog();
    state.duelLog = newDuelLog();
    state.effect = null;
    state.flash.player = 0;
    state.flash.bot = 0;
    setPose("player", "idle");
    setPose("bot", "idle");

    stats.recordSessionStart(state.mode, state.difficulty);

    const intro = [];
    if (isStreakMode()) intro.push("Chaque duel gagné prolonge la série.");
    else intro.push("Premier à " + RULES.MANCHES_TO_WIN + " manches remporte le duel.");
    if (isTimed()) intro.push(blitzSeconds() + " secondes pour choisir.");
    if (bulletsHidden()) intro.push("Les balles adverses sont cachées : compte-les.");
    setLog(intro.join(" "));

    renderDuel();
    startTimer();
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

    const arcade = isStreakMode();
    $("hud-streak").hidden = !arcade;
    if (arcade) {
      $("streak-value").textContent = s.streak;
      $("streak-best").textContent = stats.bestStreak(s.difficulty);
    }

    $("manche-number").textContent = s.mancheNumber;

    $("me-name").textContent = characterName(state.character);
    $("bot-name").textContent = characterName(state.botCharacter);
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
    const slot = $(prefix + "-bullets");
    slot.innerHTML = "";
    slot.classList.remove("hidden-count");

    /* Le barillet de l'ADVERSAIRE peut être masqué : c'est tout l'intérêt des
     * mode Aveugle et difficulté Extrême. On n'affiche pas un vide — des points
     * d'interrogation, pour que le joueur sache qu'il y a une information à
     * suivre plutôt que de croire à un bogue. */
    if (side === "bot" && bulletsHidden()) {
      slot.classList.add("hidden-count");
      slot.textContent = "? ? ? ?";
      $(prefix + "-guard").textContent =
        duelist.consecutiveDefends > 0 ? "protection ×" + duelist.consecutiveDefends : "";
      return;
    }

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

  /** Lance le compte à rebours du tour, en mode blitz uniquement. */
  function startTimer() {
    if (!isTimed()) { $("timer").hidden = true; state.deadline = null; return; }
    $("timer").hidden = false;
    state.deadline = performance.now() + blitzSeconds() * 1000;
  }

  function stopTimer() {
    state.deadline = null;
    $("timer").hidden = !isTimed();
    if (isTimed()) $("timer-bar").style.transform = "scaleX(1)";
    $("timer-bar").classList.remove("urgent");
  }

  /**
   * Le temps est écoulé : on joue à la place du joueur, au hasard parmi les
   * actions permises. Ne pas décider est une décision, et elle se paie.
   */
  function onTimeout() {
    const s = state.session;
    if (state.phase !== "choosing") return;
    const options = DUELMINDS.combat.legalActions(s.player);
    state.timedOut += 1;
    audio.play("clash", 0.35);
    onPlayerAction(options[Math.floor(Math.random() * options.length)]);
  }

  function onPlayerAction(action) {
    const s = state.session;
    if (state.phase !== "choosing" || !canDo(s.player, action)) return;
    stopTimer();

    // Verrou immédiat : plus rien n'est cliquable jusqu'à la fin de la révélation
    state.phase = "revealing";
    for (const button of document.querySelectorAll(".action")) button.disabled = true;

    const result = DUELMINDS.match.playTurn(s, action);
    const turn = result.turn;

    // Compteurs de la session entière
    state.log.turns += 1;
    state.log.actions[action] += 1;
    if (turn.resultA === "clash") state.log.clashes += 1;
    if (turn.resultA === "super_shot" || turn.resultB === "super_shot") state.log.superShots += 1;
    stats.recordTurn(action, turn);

    /* Compteurs du SEUL duel en cours, pour la progression et les hauts faits.
     * Séparés de state.log, qui cumule toute la session : « gagner un duel
     * sans se protéger » n'a de sens que remis à zéro à chaque duel. */
    const duel = state.duelLog;
    duel.turns += 1;
    if (action === "defend") duel.defends += 1;
    if (action === "shoot") duel.shots += 1;
    if (turn.resultA === "clash") duel.clashes += 1;
    // Tir adverse arrêté par ta protection : il a tiré, tu étais à couvert,
    // et personne n'est tombé.
    if (turn.actionB === "shoot" && action === "defend" && !turn.winner) duel.blockedShots += 1;
    if (turn.resultA === "super_shot") duel.superShotWins += 1;

    showReveal(turn);
    applyPoses(turn);
    playTurnSound(turn);
    renderDuel();
    setLog(describeTurn(turn));

    window.setTimeout(() => finishTurn(result), REVEAL_MS);
  }

  /** Affiche les deux choix côte à côte et déclenche l'effet visuel. */
  function showReveal(turn) {
    const band = $("reveal");
    band.innerHTML = "";
    band.appendChild(revealCard("Adversaire", turn.actionB, turn.resultB, "from-left"));
    band.appendChild(revealCard("Toi", turn.actionA, turn.resultA, "from-right"));

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

  /**
   * Met un duelliste dans une pose. Elle joue une fois puis revient au repos ;
   * seule « hit » reste, parce qu'un duelliste à terre ne se relève pas avant
   * la manche suivante.
   */
  function setPose(who, kind) {
    state.pose[who] = { kind, start: performance.now() };
  }

  /**
   * Donne à chaque duelliste la pose correspondant à son action.
   * Le perdant passe en « hit », quelle qu'ait été son action : c'est le
   * dernier mot du tour.
   */
  function applyPoses(turn) {
    const poseFor = (action, result) => {
      if (result === "super_shot") return "super";
      if (action === "shoot") return "shoot";
      if (action === "defend") return "defend";
      return "charge";
    };

    setPose("player", poseFor(turn.actionA, turn.resultA));
    setPose("bot", poseFor(turn.actionB, turn.resultB));

    // Le perdant s'effondre. Un court délai laisse voir son geste avant qu'il
    // ne tombe : sans ça, on ne comprend pas ce qui vient de se passer.
    if (turn.winner === "a") window.setTimeout(() => setPose("bot", "hit"), 260);
    if (turn.winner === "b") window.setTimeout(() => setPose("player", "hit"), 260);
  }

  /**
   * Un seul son marquant par tour, choisi selon ce qui s'est passé.
   * L'arme dépend du PERSONNAGE qui attaque : un coup de revolver quand le
   * samouraï dégaine casserait tout (voir ATTACK_BY_CHARACTER dans audio.js).
   */
  function playTurnSound(turn) {
    if (turn.resultA === "clash" && turn.resultB === "clash") {
      audio.play("clash"); audio.vibrate(25); return;
    }

    const superShot = turn.resultA === "super_shot" || turn.resultB === "super_shot";

    if (turn.actionA === "shoot" || turn.actionB === "shoot") {
      // Si les deux tirent sans clash, on entend celui qui a porté le coup.
      const shooterIsPlayer = turn.actionA === "shoot" &&
        (turn.actionB !== "shoot" || turn.winner === "a");
      audio.playAttack(shooterIsPlayer ? state.character : state.botCharacter, superShot);
      audio.vibrate(superShot ? [40, 40, 80] : 20);
      return;
    }

    if (turn.actionA === "defend" || turn.actionB === "defend") { audio.play("protection"); return; }
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
      startTimer();
      return;
    }

    state.log.manches += 1;
    const playerWonManche = result.turn.winner === "a";
    stats.recordManche(s.difficulty, playerWonManche);
    audio.play(playerWonManche ? "win" : "chute");

    // Mené au score à un moment du duel : c'est la seule occasion de le voir,
    // le score final ne le dit plus.
    if (s.bot.manchesWon > s.player.manchesWon) state.duelLog.wasBehind = true;

    if (!result.duelOver) {
      // Manche suivante du même duel
      announce(
        playerWonManche ? "Manche gagnée" : "Manche perdue",
        s.lastReason,
        "Manche " + (s.mancheNumber),
        () => {
          DUELMINDS.match.startManche(s);
          setPose("player", "idle");
          setPose("bot", "idle");
          state.phase = "choosing";
          renderDuel();
          startTimer();
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

    /* Progression et hauts faits. Le résultat est mémorisé pour être annoncé
     * sur l'écran suivant — celui de fin de duel ou de fin de série — plutôt
     * qu'affiché par-dessus l'action. */
    state.lastProgress = DUELMINDS.progress.recordDuel({
      character: state.character,
      botCharacter: state.botCharacter,
      mode: s.mode,
      difficulty: s.difficulty,
      won: playerWonDuel,
      playerManches: s.player.manchesWon,
      botManches: s.bot.manchesWon,
      streak: s.streak,
      turns: state.duelLog.turns,
      defends: state.duelLog.defends,
      shots: state.duelLog.shots,
      clashes: state.duelLog.clashes,
      blockedShots: state.duelLog.blockedShots,
      superShotWins: state.duelLog.superShotWins,
      wasBehind: state.duelLog.wasBehind,
      hiddenBullets: bulletsHidden(),
    });
    state.duelLog = newDuelLog();

    if (!result.sessionOver) {
      // Arcade : la série continue
      /* On tire le prochain adversaire MAINTENANT, pour pouvoir l'annoncer avec
       * son tempérament. Il n'est appliqué qu'au moment où le joueur lance le
       * duel suivant, pour ne pas changer la silhouette encore affichée
       * derrière l'annonce.
       *
       * On ANNONCE le tempérament au lieu de le faire deviner : le personnage
       * le détermine, donc l'information est de toute façon lisible sur la
       * silhouette. Autant l'apprendre au joueur — c'est ce qui transforme le
       * renouvellement des adversaires en compétence plutôt qu'en surprise. */
      const nextCharacter = pickBotCharacter(state.botCharacter);
      const next = DUELMINDS.ai.personalityForCharacter(nextCharacter);
      announce(
        "Duel remporté",
        "Série de " + s.streak + (s.streak > 1 ? " duels" : " duel") + ". " +
        characterName(nextCharacter) + " prend sa place — il " + next.tell + "." +
        progressLine(),
        "Duel " + (s.streak + 1),
        () => {
          state.botCharacter = nextCharacter;
          DUELMINDS.match.startNextDuel(s, nextCharacter);
          setPose("player", "idle");
          setPose("bot", "idle");
          state.phase = "choosing";
          renderDuel();
          startTimer();
          showScreen("screen-duel");
        }
      );
      return;
    }

    endSession(playerWonDuel);
  }

  /**
   * Ce que le duel qui vient de finir a rapporté, en une phrase.
   *
   * Volontairement bref et accolé au texte existant plutôt qu'affiché dans un
   * encart : une récompense doit se voir sans couper le rythme d'une série.
   * Les hauts faits, eux, sont nommés — c'est le moment où ça compte.
   */
  function progressLine() {
    const p = state.lastProgress;
    if (!p) return "";

    const parts = [];
    if (p.levelUp) {
      parts.push(characterName(state.character) + " passe niveau " +
                 p.level.level + " — " + p.level.title + ".");
    }
    if (p.unlocked.length) {
      parts.push((p.unlocked.length > 1 ? "Hauts faits : " : "Haut fait : ") +
                 p.unlocked.map((a) => a.name).join(", ") + ".");
    }
    return parts.length ? " " + parts.join(" ") : "";
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

    if (isStreakMode()) {
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

    /* Rappel du tempérament du dernier adversaire : sur une défaite, c'est
     * souvent là qu'on comprend ce qui nous a manqué. */
    if (isStreakMode()) {
      const last = DUELMINDS.ai.personalityOf(s.brain);
      detail += " Le dernier adversaire, " + characterName(state.botCharacter) +
                ", " + last.tell + ".";
    }

    detail += progressLine();

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
    if (isStreakMode()) rows.splice(2, 0, ["Série", s.streak]);
    if (isTimed()) rows.push(["Temps écoulé", state.timedOut + " fois"]);

    // Où en est le personnage joué : c'est l'écran qu'on regarde le plus, donc
    // celui où la progression a le plus de chances d'être vue.
    const mine = DUELMINDS.progress.characterProgress()
      .find((entry) => entry.key === state.character);
    if (mine) {
      rows.push([characterName(state.character),
                 "niv. " + mine.level + " · " + mine.title]);
    }
    for (const [label, value] of rows) {
      const row = document.createElement("div");
      row.className = "summary-row";
      row.innerHTML = "<span>" + label + "</span><b class='num'>" + value + "</b>";
      summary.appendChild(row);
    }

    reportSession(playerWonDuel);
    showScreen("screen-end");
  }

  /** Niveau atteint par le personnage que le joueur vient d'utiliser. */
  function playerLevel() {
    const mine = DUELMINDS.progress.characterProgress()
      .find((entry) => entry.key === state.character);
    return mine ? mine.level : 1;
  }

  /** Remonte la partie vers le point de collecte, s'il y en a un. */
  function reportSession(playerWonDuel) {
    if (!DUELMINDS.telemetry || !DUELMINDS.telemetry.isEnabled()) return;
    const s = state.session;
    DUELMINDS.telemetry.sendSession({
      mode: s.mode,
      difficulty: s.difficulty,
      result: isStreakMode() ? "serie" : (playerWonDuel ? "victoire" : "defaite"),
      streak: isStreakMode() ? s.streak : "",
      timedOut: state.timedOut,
      hiddenBullets: bulletsHidden() ? 1 : 0,
      lastPersonality: DUELMINDS.ai.personalityOf(s.brain).key,
      duels: state.log.duels,
      manches: state.log.manches,
      turns: state.log.turns,
      clashes: state.log.clashes,
      superShots: state.log.superShots,
      actions: state.log.actions,

      /* Progression : de quoi voir, dans la feuille, si les testeurs
       * s'accrochent. Un joueur qui reste au niveau 2 n'a joué qu'une fois ;
       * un haut fait que personne n'obtient signale une mécanique que
       * personne ne trouve. */
      character: state.character,
      level: playerLevel(),
      feats: DUELMINDS.progress.summary().done,
    });
  }

  /* =========================================================================
   * ÉCRAN DE PROGRESSION — niveaux et hauts faits
   * -------------------------------------------------------------------------
   * Deux onglets dans le même écran. Les hauts faits NON débloqués restent
   * visibles avec leur consigne : c'est ce qui donne quelque chose à viser.
   * Un objectif caché ne motive personne.
   * ====================================================================== */

  function showProgressTab(which) {
    const onLevels = which === "levels";
    $("tab-levels").classList.toggle("on", onLevels);
    $("tab-feats").classList.toggle("on", !onLevels);
    $("panel-levels").hidden = !onLevels;
    $("panel-feats").hidden = onLevels;
  }

  function renderProgress() {
    renderLevels();
    renderFeats();
  }

  function renderLevels() {
    const host = $("levels-list");
    host.innerHTML = "";

    for (const entry of DUELMINDS.progress.characterProgress()) {
      const row = document.createElement("div");
      row.className = "level-row" + (entry.duels ? "" : " untouched");

      const head = document.createElement("div");
      head.className = "level-head";

      const name = document.createElement("b");
      name.textContent = entry.name;

      const rank = document.createElement("span");
      rank.className = "level-rank";
      rank.textContent = "niv. " + entry.level + " · " + entry.title;

      head.appendChild(name);
      head.appendChild(rank);

      const bar = document.createElement("div");
      bar.className = "level-bar";
      const fill = document.createElement("i");
      fill.style.width = Math.round(entry.ratio * 100) + "%";
      bar.appendChild(fill);

      const note = document.createElement("span");
      note.className = "level-note";
      note.textContent = entry.isMax
        ? "niveau maximum · " + entry.duels + " duels"
        : entry.intoLevel + " / " + entry.needed + " points · " +
          entry.duels + " duels, " + entry.wins + " gagnés";

      row.appendChild(head);
      row.appendChild(bar);
      row.appendChild(note);
      host.appendChild(row);
    }
  }

  function renderFeats() {
    const host = $("feats-list");
    host.innerHTML = "";

    const all = DUELMINDS.progress.achievements();
    const summary = DUELMINDS.progress.summary();
    $("feat-count").textContent = summary.done + "/" + summary.total;

    // Regroupés dans l'ordre où ils apparaissent dans progress.js : les
    // premiers pas d'abord, ce qui donne un début de parcours lisible.
    const groups = [];
    for (const feat of all) {
      let group = groups.find((g) => g.name === feat.group);
      if (!group) { group = { name: feat.group, items: [] }; groups.push(group); }
      group.items.push(feat);
    }

    for (const group of groups) {
      const title = document.createElement("p");
      title.className = "section-label";
      title.textContent = group.name;
      host.appendChild(title);

      for (const feat of group.items) {
        const card = document.createElement("div");
        card.className = "feat" + (feat.done ? " done" : "");

        const mark = document.createElement("span");
        mark.className = "feat-mark";
        mark.textContent = feat.done ? "✓" : "·";

        const body = document.createElement("div");
        body.className = "feat-body";

        const name = document.createElement("b");
        name.textContent = feat.name;

        const hint = document.createElement("span");
        hint.className = "feat-hint";
        hint.textContent = feat.hint;

        body.appendChild(name);
        body.appendChild(hint);

        // Jauge chiffrée quand l'objectif se compte : « 12 / 25 » motive bien
        // mieux qu'un objectif binaire encore éteint.
        if (!feat.done && feat.goal) {
          const gauge = document.createElement("span");
          gauge.className = "feat-gauge";
          gauge.textContent = (feat.progress || 0) + " / " + feat.goal;
          body.appendChild(gauge);
        }

        card.appendChild(mark);
        card.appendChild(body);
        host.appendChild(card);
      }
    }
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

  /** Dessine un duelliste dans sa pose du moment. */
  function drawPose(who, canvas, character, position, timestamp) {
    const pose = state.pose[who];
    const duration = DUELMINDS.sprites.POSE_DURATION[pose.kind] || 0;

    let kind = pose.kind;
    let progress = 0;

    if (duration > 0) {
      progress = (performance.now() - pose.start) / duration;
      if (progress >= 1) {
        // « hit » ne se termine pas : le duelliste reste au sol.
        if (kind === "hit") progress = 1;
        else { kind = "idle"; state.pose[who] = { kind: "idle", start: 0 }; }
      }
    }

    drawDuelist(canvas, {
      character, side: who === "player" ? "player" : "bot",
      position, pose: kind, poseProgress: Math.min(1, progress),
      time: timestamp, flash: state.flash[who],
    });
  }

  function loop(timestamp) {
    if ($("screen-duel").classList.contains("on") && state.session) {
      // Chronomètre du blitz : la barre se vide, puis le hasard tranche.
      if (state.deadline && state.phase === "choosing") {
        const left = state.deadline - timestamp;
        const ratio = Math.max(0, left / (blitzSeconds() * 1000));
        $("timer-bar").style.transform = "scaleX(" + ratio + ")";
        /* L'alerte se déclenche sur un TEMPS restant, pas sur une proportion.
         * En proportion, un chrono de 2 s n'aurait alerté que pendant une
         * demi-seconde — trop court pour être vu. Une seconde partout. */
        $("timer-bar").classList.toggle("urgent", left < 1000);
        if (left <= 0) { state.deadline = null; onTimeout(); }
      }

      const s = state.session;

      // Respiration : un pixel de haut en bas, en opposition entre les deux
      /* Chaque duelliste joue sa pose, puis revient au repos de lui-même.
       * On décale légèrement l'horloge de l'adversaire pour que les deux ne
       * respirent pas exactement en même temps — sinon la scène paraît
       * mécanique. */
      drawPose("bot", $("bot-sprite"), state.botCharacter, "left", timestamp + 800);
      drawPose("player", $("me-sprite"), state.character, "right", timestamp);

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
    audio.loadFiles();
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

    $("btn-progress").addEventListener("click", () => {
      audio.play("click");
      renderProgress();
      showScreen("screen-progress");
    });
    $("btn-progress-back").addEventListener("click", () => showScreen("screen-home"));
    $("tab-levels").addEventListener("click", () => showProgressTab("levels"));
    $("tab-feats").addEventListener("click", () => showProgressTab("feats"));

    window.addEventListener("resize", resizeScene);
    resizeScene();
    requestAnimationFrame(loop);
  }

  DUELMINDS.ui = { init, state };
})(typeof globalThis !== "undefined" ? globalThis : window);
