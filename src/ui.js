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
  const { RULES, ACTIONS, MODES, DIFFICULTIES } = DUELMINDS;

  /* Raccourcis de traduction, voir i18n.js.
   *   t(cle, params) une phrase du dictionnaire
   *   L(objet, champ) un champ traduit d'une donnee de jeu
   *   actionLabel(a)  le nom d'une action dans la langue courante */
  const { t, L } = DUELMINDS.i18n;
  const actionLabel = DUELMINDS.actionLabel;
  const { canDo, defenceCost, isSuperShot } = DUELMINDS.combat;
  const { drawDuelist, drawEffect } = DUELMINDS.sprites;
  const audio = DUELMINDS.audio;
  const stats = DUELMINDS.stats;

  /* Durées, en millisecondes. Assez long pour lire le coup adverse, assez
   * court pour ne pas casser le rythme. */
  const REVEAL_MS = 1250;
  const EFFECT_MS = 620;

  /* Durée des écrans intermédiaires EN LIGNE. Assez pour lire le verdict d'une
   * manche, assez court pour que les deux joueurs repartent quasi ensemble —
   * indispensable avec un chronomètre de 4 secondes. Voir `announce`. */
  const ONLINE_ANNOUNCE_MS = 2600;

  /* Horodatage de l'image précédente, pour calculer le temps écoulé que le
   * décor utilise. Mis à zéro tant qu'on n'a pas dessiné une première fois. */
  let lastFrame = 0;

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

    /* Duel en ligne : le coup adverse vient de l'arbitre, pas de l'IA.
     * Voir la section DUEL EN LIGNE et src/pvp.js. */
    online: false,
    opponentName: "",

    /* Mode blitz : instant limite pour choisir. `null` hors blitz. */
    deadline: null,
    timedOut: 0,   // nombre de fois où le temps a décidé à la place du joueur
  };

  /* Le barillet adverse est-il caché ? Et l'IA est-elle privée du tien ?
   * La règle vit dans rules.js — c'est une règle du jeu, pas un choix
   * d'affichage — et l'interface se contente de la lire. */
  function bulletsHidden() {
    return DUELMINDS.bulletsHidden(state.mode, state.difficulty, state.online);
  }

  function aiIsBlind() {
    return DUELMINDS.aiIsBlind(state.mode, state.difficulty, state.online);
  }

  /** Le mode impose-t-il un chronomètre ? */
  function isTimed() {
    // En ligne, TOUJOURS : sans chronomètre, un joueur qui pose son téléphone
    // bloque l'autre pour de bon.
    if (state.online) return true;
    const mode = MODES.find((m) => m.key === state.mode);
    return !!(mode && mode.timed);
  }

  /**
   * Secondes pour choisir en mode blitz — c'est la DIFFICULTÉ qui les fixe :
   * 5 s en facile, 3 s en difficile, 2 s en extrême. Repli sur la valeur
   * générale si une difficulté ne le précisait pas.
   */
  function blitzSeconds() {
    /* En ligne, un délai unique et plus généreux : le chronomètre de chaque
     * joueur tourne chez lui, et son coup doit encore traverser le réseau.
     * Voir RULES.PVP_SECONDS. */
    if (state.online) return RULES.PVP_SECONDS;
    const difficulty = DIFFICULTIES.find((d) => d.key === state.difficulty);
    return (difficulty && difficulty.blitzSeconds) || RULES.BLITZ_SECONDS;
  }

  /** Le mode enchaîne-t-il les duels ? */
  function isStreakMode() {
    const mode = MODES.find((m) => m.key === state.mode);
    return !!(mode && mode.isStreak);
  }

  const $ = (id) => document.getElementById(id);

  /* ---------------------------------------------------------------------------
   * EFFETS RÉDUITS
   * ---------------------------------------------------------------------------
   * POURQUOI CE RÉGLAGE EXISTE
   * Les éclats lumineux répétés peuvent déclencher une crise chez une personne
   * photosensible. Le seuil reconnu est de trois clignotements par seconde ;
   * plus rien ici ne s'en approche, mais la quantité d'éclats reste une gêne
   * réelle pour beaucoup de gens, y compris sans diagnostic.
   *
   * POURQUOI PAS SEULEMENT `prefers-reduced-motion`
   * Ce réglage système ne couvre pas tout le monde : la plupart des gens gênés
   * ne l'ont jamais activé, et sur téléphone il est enfoui dans les menus. Le
   * jeu offre donc son propre interrupteur — coché d'office si le système le
   * demande déjà.
   *
   * CE QUE ÇA COUPE
   * L'éclat d'impact, la secousse de l'arène, la poussière projetée et toutes
   * les animations. Le jeu reste entièrement lisible : rien d'important n'est
   * porté par un effet.
   * ------------------------------------------------------------------------ */
  const EFFECTS_KEY = "duelminds.effects.v1";
  let reduced = false;

  function systemPrefersCalm() {
    return !!(window.matchMedia &&
              window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function loadEffectSetting() {
    let saved = null;
    try { saved = window.localStorage.getItem(EFFECTS_KEY); } catch (e) { /* tant pis */ }
    // Jamais choisi : on suit le système.
    reduced = saved === null ? systemPrefersCalm() : saved === "1";
    document.body.classList.toggle("reduced-effects", reduced);
    return reduced;
  }

  function setReducedEffects(on) {
    reduced = !!on;
    try { window.localStorage.setItem(EFFECTS_KEY, reduced ? "1" : "0"); }
    catch (e) { /* tant pis */ }
    document.body.classList.toggle("reduced-effects", reduced);
  }

  function effectsReduced() { return reduced; }

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
        "<span class='choice-title'>" + L(mode, "label") + "</span>" +
        "<span class='choice-desc'>" + L(mode, "blurb") + "</span>";
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
        "<span class='choice-title'>" + L(difficulty, "label") + "</span>" +
        "<span class='choice-desc'>" + L(difficulty, "blurb") + "</span>" +
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
      slot.title = L(character, "name") + " — " + L(character, "blurb");

      // L'image se remplace toute seule par l'initiale si le fichier manque.
      const image = document.createElement("img");
      image.alt = L(character, "name");
      image.src = "assets/characters/" + character.key + ".png";
      image.addEventListener("error", () => {
        image.remove();
        const initial = document.createElement("span");
        initial.className = "initial";
        initial.textContent = L(character, "name").charAt(0);
        slot.prepend(initial);
      });
      slot.appendChild(image);

      const label = document.createElement("span");
      label.className = "roster-name";
      label.textContent = L(character, "name");
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
    DUELMINDS.scene.preloadDecors();
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
      span.textContent = show ? t("home.record", { n: best }) : "";
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
    return character ? L(character, "name") : t("duelist.default");
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
    // Une partie locale n'est jamais en ligne : on coupe l'éventuel duel resté
    // ouvert, sinon on continuerait de parler à un arbitre pour rien.
    if (state.online) { DUELMINDS.pvp.leave(); state.online = false; }

    // Début de série : aucun adversaire précédent à éviter.
    state.botCharacter = pickBotCharacter(null);

    DUELMINDS.scene.pickDecor();     // un lieu différent à chaque partie

    state.session = DUELMINDS.match.createSession(state.mode, state.difficulty, {
      blind: aiIsBlind(),              // réciprocité, sauf en blitz extrême
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
    if (isStreakMode()) intro.push(t("intro.streak"));
    else intro.push(t("intro.duel", { n: RULES.MANCHES_TO_WIN }));
    if (isTimed()) intro.push(t("intro.timer", { n: blitzSeconds() }));
    if (bulletsHidden()) intro.push(t("intro.hidden"));
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
    $("hud-mode").textContent = state.online
      ? t("pvp.mode") : L(MODES.find((m) => m.key === s.mode), "label");
    $("hud-difficulty").textContent = L(difficulty, "label");
    $("hud-difficulty").style.setProperty("--accent", "var(" + difficulty.accent + ")");

    const arcade = isStreakMode();
    $("hud-streak").hidden = !arcade;
    if (arcade) {
      $("streak-value").textContent = s.streak;
      $("streak-best").textContent = stats.bestStreak(s.difficulty);
    }

    $("manche-number").textContent = s.mancheNumber;

    $("me-name").textContent = characterName(state.character);
    /* En ligne, le bandeau porte le NOM DU JOUEUR d'en face : c'est ce qu'on
     * veut lire quand on affronte quelqu'un, pas le nom de son personnage. */
    $("bot-name").textContent = state.online && state.opponentName
      ? state.opponentName : characterName(state.botCharacter);
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

    /* Le bouton de tir annonce quand le coup traversera la protection — et,
     * plus important, quand il est HORS DE PORTÉE.
     *
     * POURQUOI CE DÉTAIL COMPTE
     * Un super tir traverse la protection ET la charge : face à lui, un
     * duelliste sans balle est condamné quoi qu'il fasse. C'est assumé, mais
     * ça ne doit pas se lire comme une mort arbitraire. En affichant « plus de
     * balle » au lieu du coût habituel, le joueur comprend que la partie
     * s'est jouée AVANT, quand il a laissé son barillet se vider. */
    /* Charger est impossible barillet plein. On le DIT, au lieu de laisser un
     * bouton éteint sans raison apparente : à 4 balles le joueur est au
     * maximum, il doit comprendre qu'il n'a plus qu'à tirer ou se protéger.
     * C'est aussi le moment où son tir traverse les protections. */
    const full = !canDo(s.player, "charge");
    $("charge-note").textContent = full ? t("action.full") : t("action.gain");
    $("btn-charge").classList.toggle("empty", full);

    const armed = canDo(s.player, "shoot");
    $("shoot-note").textContent =
      !armed ? t("action.empty")
      : isSuperShot(s.player) ? t("action.super")
      : t("action.costOne");
    $("btn-shoot").classList.toggle("super", armed && isSuperShot(s.player));
    $("btn-shoot").classList.toggle("empty", !armed);

    const cost = defenceCost(s.player);
    $("defend-note").textContent =
      cost === 0 ? t("action.free")
      : cost === 1 ? t("action.costOne")
      : t("action.costMany", { n: cost });
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
    // Les deux toiles couvrent l'arène : le décor derrière, les effets devant.
    for (const id of ["effects", "backdrop"]) {
      const canvas = $(id);
      const box = canvas.parentElement.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(box.width));
      canvas.height = Math.max(1, Math.round(box.height));
    }
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

    /* EN LIGNE, le coup part vers l'arbitre et le tour ne se résout qu'au
     * retour du coup adverse. Tout ce qui suit — comptage, révélation,
     * animations — est ensuite RIGOUREUSEMENT identique : voir afterTurn. */
    if (state.online) return onOnlineAction(action);

    // Verrou immédiat : plus rien n'est cliquable jusqu'à la fin de la révélation
    state.phase = "revealing";
    for (const button of document.querySelectorAll(".action")) button.disabled = true;

    afterTurn(DUELMINDS.match.playTurn(s, action), action);
  }

  /**
   * Tout ce qui suit la résolution d'un tour, quelle qu'en soit l'origine :
   * l'ordinateur en local, l'arbitre en ligne.
   *
   * Ce partage n'est pas cosmétique — c'est lui qui garantit qu'un duel en
   * ligne compte les hauts faits, joue les mêmes sons et affiche les mêmes
   * animations qu'un duel hors ligne, sans qu'on ait à y penser.
   */
  function afterTurn(result, action) {
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
    // Même ordre que l'arène : toi à gauche, l'adversaire à droite.
    band.appendChild(revealCard(t("duelist.you"), turn.actionA, turn.resultA, "from-left"));
    band.appendChild(revealCard(t("duelist.opponent"), turn.actionB, turn.resultB, "from-right"));

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

    // L'éclat blanc marque qui vient d'être touché — sauf en effets réduits,
    // où la pose de chute et le bandeau de révélation le disent déjà.
    if (!effectsReduced()) {
      if (turn.winner === "a") state.flash.bot = 1;
      if (turn.winner === "b") state.flash.player = 1;
    }

    reactScene(turn);
  }

  /**
   * Le décor encaisse le coup : secousse et poussière soulevée.
   *
   * C'est le retour le plus rentable de tout l'habillage. Un décor immobile
   * reste un fond d'écran ; un décor qui bouge quand ça tape fait partie du
   * duel. L'intensité suit l'importance de ce qui vient d'arriver — sinon tout
   * se vaut, et plus rien ne marque.
   */
  function reactScene(turn) {
    if (effectsReduced()) return;   // ni secousse ni poussière projetée
    const scene = DUELMINDS.scene;
    const zone = sceneZone();
    const groundY = scene.groundLine(zone.height);
    const leftX = zone.width * 0.24;    // sous toi
    const rightX = zone.width * 0.76;   // sous l'adversaire

    // Une mort secoue franchement, un clash à peine.
    if (turn.winner) {
      scene.shake(turn.resultA === "super_shot" || turn.resultB === "super_shot" ? 9 : 6);
      // Le perdant soulève la poussière en tombant : « a » c'est toi, à gauche.
      scene.burst(turn.winner === "a" ? rightX : leftX, groundY);
    } else if (turn.resultA === "clash") {
      scene.shake(3);
      scene.burst(zone.width * 0.5, groundY);
    }

    // Charger tasse le sol sous ses pieds : un peu de poussière, sans secousse.
    if (turn.actionA === "charge") scene.burst(leftX, groundY);
    if (turn.actionB === "charge") scene.burst(rightX, groundY);
  }

  function revealCard(who, action, result, animation) {
    const card = document.createElement("div");
    card.className = "reveal-card " + animation +
      (result === "super_shot" ? " super" : "") +
      (result === "clash" ? " clash" : "");
    card.innerHTML =
      "<span class='reveal-who'>" + who + "</span>" +
      "<span class='reveal-action'>" + actionLabel(action) + "</span>" +
      (result === "super_shot" ? "<span class='reveal-tag'>" + t("reveal.super") + "</span>" : "") +
      (result === "death" ? "<span class='reveal-tag'>" + t("reveal.impossible") + "</span>" : "");
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
    const lines = [t("reveal.log", { you: actionLabel(turn.actionA),
                                    foe: actionLabel(turn.actionB) }) + "."];
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
        t(playerWonManche ? "manche.won" : "manche.lost"),
        s.lastReason,
        t("manche.next", { n: s.mancheNumber }),
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
        t("duel.won"),
        t(s.streak > 1 ? "streak.countMany" : "streak.countOne", { n: s.streak }) + " " +
        t("opponent.next", { name: characterName(nextCharacter), tell: L(next, "tell") }) +
        progressLine(),
        t("duel.next", { n: s.streak + 1 }),
        () => {
          state.botCharacter = nextCharacter;
          DUELMINDS.scene.pickDecor();   // on change aussi de lieu
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
      parts.push(t("progress.levelUp", {
        name: characterName(state.character),
        level: p.level.level,
        title: p.level.title,
      }));
    }
    if (p.unlocked.length) {
      parts.push(t(p.unlocked.length > 1 ? "progress.featMany" : "progress.featOne",
                   { names: p.unlocked.map((a) => a.name).join(", ") }));
    }
    return parts.length ? " " + parts.join(" ") : "";
  }

  /** Écran intermédiaire entre deux manches ou deux duels. */
  function announce(title, detail, buttonLabel, onContinue) {
    state.phase = "announce";
    $("announce-title").textContent = title;
    $("announce-detail").textContent = detail;
    $("btn-announce").textContent = buttonLabel;

    let taken = false;
    const go = () => {
      if (taken) return;          // le bouton ET la minuterie visent la même sortie
      taken = true;
      window.clearTimeout(autoContinue);
      onContinue();
    };

    $("btn-announce").onclick = () => { audio.play("click"); go(); };

    /* EN LIGNE, l'écran repart TOUT SEUL après un court délai.
     *
     * Sans ça, le chronomètre de 4 secondes devient injuste : si l'un appuie
     * sur « Continuer » pendant que l'autre lit encore, son compte à rebours
     * démarre en avance et il joue au hasard faute de temps — puni pour la
     * lenteur d'en face, pas pour son jeu.
     *
     * Le bouton reste actif : qui a déjà lu peut passer sans attendre. */
    const autoContinue = state.online
      ? window.setTimeout(go, ONLINE_ANNOUNCE_MS)
      : null;

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
      title = s.streak === 0 ? t("streak.ended") : t("streak.title", { n: s.streak });
      detail = s.lastReason + " " +
        (isRecord && s.streak > 0
          ? t("streak.recordNew")
          : t("streak.recordOld", { n: stats.bestStreak(s.difficulty) }));
    } else {
      title = t(playerWonDuel ? "duel.won" : "duel.lost");
      detail = s.lastReason;
    }

    /* Rappel du tempérament du dernier adversaire : sur une défaite, c'est
     * souvent là qu'on comprend ce qui nous a manqué. */
    if (isStreakMode()) {
      const last = DUELMINDS.ai.personalityOf(s.brain);
      detail += " " + t("opponent.last", {
        name: characterName(state.botCharacter), tell: L(last, "tell"),
      });
    }

    detail += progressLine();

    $("end-title").textContent = title;
    $("end-detail").textContent = detail;

    // Résumé chiffré de la partie
    const summary = $("end-summary");
    summary.innerHTML = "";
    const rows = [
      [t("end.mode"), L(MODES.find((m) => m.key === s.mode), "label")],
      [t("end.difficulty"), L(DIFFICULTIES.find((d) => d.key === s.difficulty), "label")],
      [t("end.duels"), state.log.duels],
      [t("end.manches"), state.log.manches],
      [t("end.turns"), state.log.turns],
      [t("end.clashes"), state.log.clashes],
      [t("end.superShots"), state.log.superShots],
    ];
    if (isStreakMode()) rows.splice(2, 0, [t("end.streak"), s.streak]);
    if (isTimed()) rows.push([t("end.timedOut"), t("end.times", { n: state.timedOut })]);

    // Où en est le personnage joué : c'est l'écran qu'on regarde le plus, donc
    // celui où la progression a le plus de chances d'être vue.
    const mine = DUELMINDS.progress.characterProgress()
      .find((entry) => entry.key === state.character);
    if (mine) {
      rows.push([characterName(state.character),
                 t("progress.rank", { level: mine.level, title: mine.title })]);
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

    /* La partie qu'on vient d'envoyer peut changer le classement : on jette le
     * cache pour que le joueur voie son score s'il y va tout de suite. */
    if (DUELMINDS.leaderboard) DUELMINDS.leaderboard.forget();
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
   * DUEL EN LIGNE
   * -------------------------------------------------------------------------
   * L'écran de duel est le MÊME que contre l'ordinateur : mêmes boutons, mêmes
   * animations, mêmes règles. Une seule chose change — d'où vient le coup d'en
   * face. C'est ce qui permet d'ajouter le jeu en ligne sans dupliquer quoi que
   * ce soit.
   *
   * Voir src/pvp.js pour le protocole, et pourquoi un arbitre est indispensable
   * quand les actions sont simultanées et secrètes.
   * ====================================================================== */

  /** Message d'erreur du salon, choisi selon la panne. Voir i18n.js. */
  function pvpReason(reason) {
    switch (reason) {
      case "bad-code":      return t("pvp.badCode");
      case "unknown-code":  return t("pvp.unknownCode");
      case "match-full":    return t("pvp.full");
      case "opponent-left": return t("pvp.left");
      case "expired":       return t("pvp.expired");
      case "not-jsonp":     return t("pvp.notDeployed");
      case "no-endpoint":   return t("pvp.noEndpoint");
      case "timeout":       return t("pvp.timeout");
      default:              return t("pvp.offline");
    }
  }

  function lobbyError(reason) {
    const box = $("lobby-error");
    box.textContent = pvpReason(reason);
    box.hidden = false;
    $("lobby-choice").hidden = false;
    $("lobby-waiting").hidden = true;
  }

  /* ---------------------------------------------------------------------------
   * LE LIEN D'INVITATION
   * ---------------------------------------------------------------------------
   * Dicter quatre lettres marche, mais envoyer un lien marche mieux : l'autre
   * n'a rien à saisir, et rien à mal recopier. Le code reste affiché en gros
   * pour ceux qui sont dans la même pièce.
   * ------------------------------------------------------------------------ */

  /** L'adresse du jeu, avec le code de la partie accroché. */
  function inviteLink(code) {
    const url = location.origin + location.pathname;
    return url + "?duel=" + encodeURIComponent(code);
  }

  /** Le code éventuellement présent dans l'adresse, sinon une chaîne vide. */
  function codeFromUrl() {
    const found = /[?&]duel=([A-Za-z0-9]{1,8})/.exec(location.search || "");
    return found ? found[1].toUpperCase() : "";
  }

  function shareInvite(button) {
    const code = $("lobby-code-shown").textContent;
    const link = inviteLink(code);
    const done = () => {
      const original = button.textContent;
      button.textContent = t("pvp.linkCopied");
      window.setTimeout(() => { button.textContent = original; }, 1600);
    };

    /* Sur téléphone, le partage natif ouvre directement la liste des
     * applications : c'est le geste que le joueur attend. Ailleurs, on se
     * rabat sur le presse-papier. */
    if (navigator.share) {
      navigator.share({ title: "DuelMinds", text: "Duel " + code, url: link })
        .then(done, () => copyText(link, done));
    } else {
      copyText(link, done);
    }
  }

  function copyText(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }

  function openLobby() {
    $("lobby-choice").hidden = false;
    $("lobby-waiting").hidden = true;
    $("lobby-share-row").hidden = true;
    $("lobby-error").hidden = true;
    $("lobby-code").value = "";
    showScreen("screen-lobby");
  }

  /** Ouvre une partie et attend que quelqu'un vienne. */
  function lobbyCreate() {
    audio.play("click");
    $("lobby-error").hidden = true;
    $("lobby-choice").hidden = true;
    $("lobby-waiting").hidden = false;
    $("lobby-code-shown").textContent = "····";
    $("lobby-status").textContent = t("pvp.opening");

    DUELMINDS.pvp.create(state.character).then(function (result) {
      if (!result.ok) return lobbyError(result.reason);

      $("lobby-code-shown").textContent = result.code;
      $("lobby-share-row").hidden = false;
      $("lobby-status").textContent = t("pvp.waiting", { n: 0 });

      return DUELMINDS.pvp.waitForOpponent(function (seconds) {
        $("lobby-status").textContent = t("pvp.waiting", { n: seconds });
      }).then(function (arrival) {
        if (!arrival.ok) return lobbyError(arrival.reason);
        startOnlineDuel(arrival.opponent);
      });
    });
  }

  /** Rejoint la partie d'un ami. */
  function lobbyJoin() {
    audio.play("click");
    $("lobby-error").hidden = true;
    $("lobby-choice").hidden = true;
    $("lobby-waiting").hidden = false;
    $("lobby-code-shown").textContent = $("lobby-code").value.toUpperCase() || "····";
    $("lobby-status").textContent = t("pvp.joining");

    DUELMINDS.pvp.join($("lobby-code").value, state.character).then(function (result) {
      if (!result.ok) return lobbyError(result.reason);
      startOnlineDuel(result.opponent);
    });
  }

  /**
   * Démarre le duel en ligne.
   *
   * Le moteur place TOUJOURS le joueur local du côté « a » : c'est ce qui
   * permet de réutiliser tout l'affichage sans condition. Chacun se voit donc à
   * droite, et voit l'autre à gauche — ce qui est exactement ce qu'on veut, les
   * deux écrans n'ont pas à être identiques.
   */
  function startOnlineDuel(opponent) {
    state.mode = "duel";                 // structure de duel classique
    state.difficulty = "difficile";      // sert seulement d'étiquette à l'écran
    state.online = true;
    state.botCharacter = (opponent && opponent.character) || pickBotCharacter(null);
    state.opponentName = (opponent && opponent.name) || "";

    DUELMINDS.scene.pickDecor();
    state.session = DUELMINDS.match.createSession("duel", state.difficulty, {});
    DUELMINDS.match.startManche(state.session);
    state.phase = "choosing";
    state.log = newLog();
    state.duelLog = newDuelLog();
    state.effect = null;
    state.flash.player = 0;
    state.flash.bot = 0;
    setPose("player", "idle");
    setPose("bot", "idle");

    setLog(t("pvp.joined", { name: state.opponentName || t("pvp.opponent") }) +
           " " + t("intro.timer", { n: blitzSeconds() }));
    renderDuel();
    showScreen("screen-duel");
    // Le compte à rebours démarre dès que l'écran s'affiche, comme en blitz.
    startTimer();
  }

  /**
   * Un tour en ligne : on dépose son coup, puis on attend celui d'en face.
   *
   * Le verrouillage des boutons est le même que hors ligne — sauf que l'attente
   * dure le temps du réseau. On le DIT dans le journal : un écran qui ne
   * répond pas sans explication passe pour un plantage.
   */
  function onOnlineAction(action) {
    state.phase = "revealing";
    for (const button of document.querySelectorAll(".action")) button.disabled = true;
    setLog(t("pvp.theirTurn"));
    stopTimer();

    DUELMINDS.pvp.playMove(action, function () { /* l'attente s'affiche déjà */ })
      .then(function (result) {
        if (!result.ok) {
          // L'adversaire est parti ou le réseau a lâché : on ne laisse pas le
          // joueur dans un écran mort.
          announce(t("pvp.opponent"), pvpReason(result.reason), t("nav.back"), () => {
            DUELMINDS.pvp.leave();
            state.online = false;
            showScreen("screen-home");
            refreshHome();
          });
          return;
        }
        resolveTurnLocally(result.mine, result.theirs);
      });
  }

  /**
   * Rejoue le tour avec les deux coups, exactement comme contre l'ordinateur.
   * `playTurnWith` est le même moteur : aucune règle n'est dupliquée pour le
   * jeu en ligne.
   */
  function resolveTurnLocally(mine, theirs) {
    const s = state.session;
    const result = DUELMINDS.match.playTurnWith(s, mine, theirs);
    afterTurn(result, mine);
  }

  /* =========================================================================
   * ÉCRAN DU CLASSEMENT
   * -------------------------------------------------------------------------
   * Les meilleures séries de tous les testeurs, relues depuis la feuille
   * Google. Ce n'est pas du temps réel — voir src/leaderboard.js.
   *
   * TROIS ÉTATS À TRAITER, ET AUCUN NE DOIT RESSEMBLER À UN BUG :
   *   - chargement    on le dit, sinon l'écran paraît cassé ;
   *   - indisponible  point de collecte absent ou pas encore redéployé ;
   *   - vide          personne n'a encore joué ce mode.
   * ====================================================================== */

  const BOARD_MODES = ["arcade", "blitz", "aveugle"];
  let boardMode = "arcade";

  function showBoardTab(mode) {
    boardMode = mode;
    for (const key of BOARD_MODES) {
      $("board-" + key).classList.toggle("on", key === mode);
    }
    renderBoard();
  }

  function boardMessage(text) {
    const host = $("board-body");
    host.innerHTML = "";
    const p = document.createElement("p");
    p.className = "board-message";
    p.textContent = text;
    host.appendChild(p);
  }

  function renderBoard() {
    const board = DUELMINDS.leaderboard;

    if (!board.isAvailable()) {
      boardMessage(t("board.noEndpoint"));
      return;
    }

    boardMessage(t("board.loading"));
    const asked = boardMode;

    board.fetchTop(asked).then(function (result) {
      // L'utilisateur a pu changer d'onglet entre-temps : on ne réécrit pas
      // par-dessus une demande plus récente.
      if (asked !== boardMode) return;

      if (!result.ok) {
        // Chaque panne a son message : « pas de réseau » et « pas encore
        // déployé » n'appellent pas du tout la même réaction.
        boardMessage(
          result.reason === "not-jsonp" ? t("board.notDeployed")
          : result.reason === "no-endpoint" ? t("board.noEndpoint")
          : t("board.offline"));
        return;
      }
      if (!result.rows.length) {
        boardMessage(t("board.empty"));
        return;
      }

      const host = $("board-body");
      host.innerHTML = "";
      const mine = board.name();

      result.rows.forEach(function (row, index) {
        const line = document.createElement("div");
        // On met en valeur la ligne du joueur : c'est la première qu'il cherche.
        line.className = "board-row" +
          (mine && row.name === mine ? " mine" : "") +
          (index < 3 ? " podium" : "");

        const rank = document.createElement("span");
        rank.className = "board-rank";
        rank.textContent = String(index + 1);

        const who = document.createElement("span");
        who.className = "board-who";
        // textContent, jamais innerHTML : ce nom vient d'un autre joueur.
        who.textContent = row.name || t("board.anonymous", { id: row.tester });

        const score = document.createElement("b");
        score.className = "board-score num";
        score.textContent = row.streak;

        const level = document.createElement("span");
        level.className = "board-level";
        const difficulty = DIFFICULTIES.find((d) => d.key === row.difficulty);
        level.textContent = difficulty ? L(difficulty, "label") : "";

        line.appendChild(rank);
        line.appendChild(who);
        line.appendChild(level);
        line.appendChild(score);
        host.appendChild(line);
      });
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
      name.textContent = entry.name;   // deja traduit par progress.js

      const rank = document.createElement("span");
      rank.className = "level-rank";
      rank.textContent = t("progress.rank", { level: entry.level, title: entry.title });

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
        ? t("progress.maxNote", { duels: entry.duels })
        : t("progress.note", { into: entry.intoLevel, needed: entry.needed,
                               duels: entry.duels, wins: entry.wins });

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
      body.innerHTML = "<p>" + t("stats.empty") + "</p>";
      return;
    }

    const pct = stats.percent;

    const modeRows = MODES.map((mode) => {
      const m = s.byMode[mode.key];
      return "<tr><td>" + L(mode, "label") + "</td><td class='n'>" + m.sessions + "</td>" +
        "<td class='n'>" + m.duelsPlayed + "</td>" +
        "<td class='n'>" + pct(m.duelsWon, m.duelsPlayed) + " %</td></tr>";
    }).join("");

    const difficultyRows = DIFFICULTIES.map((difficulty) => {
      const d = s.byDifficulty[difficulty.key];
      return "<tr><td>" + L(difficulty, "label") + "</td>" +
        "<td class='n'>" + pct(d.duelsWon, d.duelsPlayed) + " %</td>" +
        "<td class='n'>" + pct(d.manchesWon, d.manchesPlayed) + " %</td>" +
        "<td class='n'>" + d.bestStreak + "</td></tr>";
    }).join("");

    const actionRows = ACTIONS.map((action) =>
      "<tr><td>" + actionLabel(action) + "</td>" +
      "<td class='n'>" + s.byAction[action] + "</td>" +
      "<td class='n'>" + pct(s.byAction[action], s.turns) + " %</td></tr>").join("");

    const th = (key, numeric) =>
      "<th" + (numeric ? " class='n'" : "") + ">" + t(key) + "</th>";

    body.innerHTML =
      "<h3>" + t("stats.modes") + "</h3><div class='table-wrap'><table><thead><tr>" +
        th("stats.colMode") + th("stats.colGames", 1) + th("stats.colDuels", 1) +
        th("stats.colWon", 1) +
        "</tr></thead><tbody>" + modeRows + "</tbody></table></div>" +

      "<h3>" + t("stats.difficulties") + "</h3><div class='table-wrap'><table><thead><tr>" +
        th("stats.colLevel") + th("stats.colDuels", 1) + th("stats.colManches", 1) +
        th("stats.colRecord", 1) +
        "</tr></thead><tbody>" + difficultyRows + "</tbody></table></div>" +

      "<h3>" + t("stats.actions") + "</h3><div class='table-wrap'><table><thead><tr>" +
        th("stats.colAction") + th("stats.colTimes", 1) + th("stats.colShare", 1) +
        "</tr></thead><tbody>" + actionRows + "</tbody></table></div>" +

      "<h3>" + t("stats.mechanics") + "</h3><ul>" +
        "<li>" + t("stats.turnsPlayed", { n: "<b>" + s.turns + "</b>" }) + "</li>" +
        "<li>" + t("stats.clashShare", { n: pct(s.clashes, s.turns) }) + "</li>" +
        "<li>" + t("stats.superShots", { n: "<b>" + s.superShots + "</b>" }) + "</li>" +
      "</ul>" +

      "<p>" + t(stats.isPersistent() ? "stats.deviceOnly" : "stats.noStorage") + "</p>";
  }

  /** `navigator.clipboard` n'existe pas partout : on prévoit un repli. */
  function copyStats(button) {
    const text = stats.toText();
    const done = () => {
      const original = button.textContent;
      button.textContent = t("stats.copied");
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
      // TOI À GAUCHE, l'adversaire à droite. Voir la disposition en tête
      // d'index.html : on se cherche du côté où commence la lecture.
      drawPose("player", $("me-sprite"), state.character, "left", timestamp);
      drawPose("bot", $("bot-sprite"), state.botCharacter, "right", timestamp + 800);

      // L'éclat s'estompe tout seul
      state.flash.player = Math.max(0, state.flash.player - 0.02);
      state.flash.bot = Math.max(0, state.flash.bot - 0.02);

      /* LE DÉCOR. Repeint à chaque image parce qu'il vit : la poussière monte
       * et les gerbes d'impact retombent. `dt` est borné à 1/20 s pour qu'un
       * retour d'onglet après plusieurs secondes ne projette pas la poussière
       * à l'autre bout de l'écran d'un seul coup. */
      const dt = Math.min(0.05, (timestamp - lastFrame) / 1000) || 0;
      lastFrame = timestamp;

      const backdrop = $("backdrop");
      const back = backdrop.getContext("2d");
      DUELMINDS.scene.draw(back, backdrop.width, backdrop.height, timestamp, dt);

      /* La secousse déplace le CONTENU de l'arène — décor, duellistes, effets —
       * mais jamais son cadre : déplacer la boîte elle-même ferait apparaître
       * un liseré de fond le long des bords à chaque impact. Deux variables
       * CSS suffisent, le style s'occupe de qui bouge. */
      const jolt = DUELMINDS.scene.shakeOffset(timestamp);
      const arena = $("arena").style;
      arena.setProperty("--shake-x", jolt.x.toFixed(1) + "px");
      arena.setProperty("--shake-y", jolt.y.toFixed(1) + "px");

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
  /**
   * Applique la langue à toute l'interface.
   *
   * Deux temps, et l'ordre compte :
   *   1. i18n remplace les textes écrits dans le HTML ;
   *   2. on RECONSTRUIT ce que le JavaScript avait fabriqué — listes de modes,
   *      règles, écrans de progression — car ces éléments-là ne portent pas
   *      d'attribut `data-en` : ils sont créés à la volée.
   *
   * `buildRules` doit repasser après `applyDom` : la version anglaise de l'aide
   * réinstalle les `<span id="rules-super">` vides, qu'il faut re-remplir.
   */
  function applyLanguage() {
    DUELMINDS.i18n.applyDom(document);
    buildHome();
    buildRules();
    if ($("screen-progress").classList.contains("on")) renderProgress();
    if ($("screen-stats").classList.contains("on")) renderStats();
    if (state.session) renderDuel();
    $("btn-lang").textContent = DUELMINDS.i18n.lang() === "fr" ? "English" : "Français";
  }

  function init() {
    audio.loadFiles();
    buildHome();
    buildRules();
    document.documentElement.setAttribute("lang", DUELMINDS.i18n.lang());
    applyLanguage();

    // On ne collecte jamais de données sans le dire.
    if (DUELMINDS.telemetry && DUELMINDS.telemetry.isEnabled()) {
      $("privacy-note").hidden = false;
    }

    for (const button of document.querySelectorAll(".action")) {
      button.addEventListener("click", () => onPlayerAction(button.dataset.action));
    }

    $("btn-start").addEventListener("click", () => { audio.play("click"); startSession(); });
    $("btn-quit").addEventListener("click", () => {
      audio.play("click");
      // Prévenir l'arbitre, sinon l'autre joueur attend un coup qui ne
      // viendra jamais.
      if (state.online) { DUELMINDS.pvp.leave(); state.online = false; }
      showScreen("screen-home");
      refreshHome();
    });
    $("btn-again").addEventListener("click", () => { audio.play("click"); startSession(); });
    $("btn-home").addEventListener("click", () => { audio.play("click"); showScreen("screen-home"); refreshHome(); });

    /* --- Duel en ligne --- */
    $("btn-pvp").addEventListener("click", () => { audio.play("click"); openLobby(); });
    $("btn-lobby-create").addEventListener("click", lobbyCreate);
    $("btn-lobby-join").addEventListener("click", lobbyJoin);
    $("btn-lobby-share").addEventListener("click", (e) => shareInvite(e.currentTarget));
    $("btn-lobby-back").addEventListener("click", () => {
      DUELMINDS.pvp.leave();          // annule l'attente en cours
      state.online = false;
      showScreen("screen-home");
    });
    // Un code se recopie a la main : on met en majuscules a la volee.
    $("lobby-code").addEventListener("input", (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
    });

    /* --- Classement --- */
    $("btn-board").addEventListener("click", () => {
      audio.play("click");
      showBoardTab(boardMode);
      showScreen("screen-board");
    });
    $("btn-board-back").addEventListener("click", () => showScreen("screen-home"));
    $("btn-board-refresh").addEventListener("click", () => {
      DUELMINDS.leaderboard.forget();   // sinon on relit le cache
      renderBoard();
    });
    for (const key of BOARD_MODES) {
      $("board-" + key).addEventListener("click", () => showBoardTab(key));
    }

    /* --- Pseudonyme --- */
    const nameInput = $("player-name");
    /* Sans point de collecte, ni classement ni duel en ligne : on masque
     * plutot que d'offrir un bouton qui echouerait. */
    const online = DUELMINDS.net.isAvailable();
    $("name-block").hidden = !online;
    $("btn-pvp").hidden = !online;
    $("btn-board").hidden = !online;
    nameInput.value = DUELMINDS.leaderboard.name();
    // À chaque frappe : il n'y a pas de bouton « valider », et un nom perdu
    // parce qu'on a lancé la partie trop vite serait agaçant.
    nameInput.addEventListener("input", () => {
      DUELMINDS.leaderboard.setName(nameInput.value);
    });
    nameInput.addEventListener("blur", () => {
      nameInput.value = DUELMINDS.leaderboard.name();
    });

    /* --- Effets réduits --- */
    $("opt-effects").checked = loadEffectSetting();
    $("opt-effects").addEventListener("change", (e) => {
      setReducedEffects(e.target.checked);
    });

    $("btn-lang").addEventListener("click", () => {
      audio.play("click");
      DUELMINDS.i18n.setLang(DUELMINDS.i18n.lang() === "fr" ? "en" : "fr");
      applyLanguage();
    });

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

    /* INVITATION PAR LIEN. Si l'adresse porte un code, on rejoint sans rien
     * demander : c'est tout l'intérêt du lien, l'autre n'a rien à saisir. */
    const invited = codeFromUrl();
    if (invited && DUELMINDS.net.isAvailable()) {
      openLobby();
      $("lobby-code").value = invited;
      $("lobby-choice").hidden = true;
      $("lobby-waiting").hidden = false;
      $("lobby-code-shown").textContent = invited;
      $("lobby-status").textContent = t("pvp.invited", { code: invited });
      lobbyJoin();
    }

    window.addEventListener("resize", resizeScene);
    resizeScene();
    requestAnimationFrame(loop);
  }

  DUELMINDS.ui = { init, state };
})(typeof globalThis !== "undefined" ? globalThis : window);
