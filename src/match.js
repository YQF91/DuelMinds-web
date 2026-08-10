/* =============================================================================
 * DUELMINDS — DÉROULEMENT DES PARTIES
 * =============================================================================
 *
 * RÔLE DU FICHIER
 * Orchestrer ce qui dépasse le tour : les manches d'un duel, et les duels
 * enchaînés d'une série arcade. Le tour lui-même est dans combat.js.
 *
 * LES DEUX NIVEAUX D'ORGANISATION
 *
 *   TOUR      les deux choisissent, on résout          -> combat.js
 *   MANCHE    des tours jusqu'à ce que quelqu'un tombe -> ici
 *   DUEL      des manches, premier à 2                 -> ici
 *   SÉRIE     des duels enchaînés (mode arcade)        -> ici
 *
 * En mode DUEL on s'arrête après le duel. En mode ARCADE, gagner relance un
 * duel contre un nouvel adversaire, et perdre met fin à la série : le score,
 * c'est le nombre de duels enchaînés.
 *
 * Comme combat.js, ce fichier ne touche pas à l'écran : il est pilotable par
 * l'interface comme par le simulateur.
 *
 * DÉPENDANCES : rules.js, combat.js, ai.js
 * ========================================================================== */

(function (root) {
  "use strict";

  const DUELMINDS = (root.DUELMINDS = root.DUELMINDS || {});
  const { RULES } = DUELMINDS;
  const { makeDuelist, resetForManche, resolveTurn } = DUELMINDS.combat;
  const { makeBrain, resetBrainForManche } = DUELMINDS.ai;

  /* ---------------------------------------------------------------------------
   * UNE PARTIE
   * ---------------------------------------------------------------------------
   * Un même objet sert aux deux modes. En mode duel, la partie s'arrête au
   * premier duel terminé ; en arcade, on enchaîne.
   * ------------------------------------------------------------------------ */

  /**
   * @param {"duel"|"arcade"} mode
   * @param {string} difficulty  "facile" | "difficile" | "extreme"
   */
  function createSession(mode, difficulty) {
    const session = {
      mode,
      difficulty,

      // Duel en cours
      player: makeDuelist("Toi", false),
      bot: makeDuelist("Adversaire", true),
      brain: makeBrain(difficulty),
      turn: 1,
      mancheNumber: 1,

      // Série (mode arcade) : nombre de duels gagnés d'affilée
      streak: 0,
      duelsPlayed: 0,

      // Compteurs de la session entière, pour les statistiques
      totals: { turns: 0, manches: 0, clashes: 0, superShots: 0,
                actions: { charge: 0, shoot: 0, defend: 0 } },

      over: false,      // la SESSION est terminée
      lastReason: "",
    };
    return session;
  }

  /** Prépare la manche suivante du duel en cours. */
  function startManche(session) {
    resetForManche(session.player);
    resetForManche(session.bot);
    resetBrainForManche(session.brain);
    session.turn = 1;
  }

  /** Remet tout à neuf pour un nouveau duel (mode arcade). */
  function startNextDuel(session) {
    session.player.manchesWon = 0;
    session.bot.manchesWon = 0;
    session.mancheNumber = 1;
    startManche(session);
  }

  /**
   * Joue un tour.
   *
   * @returns {{
   *   turn: object,          ce qu'a renvoyé combat.resolveTurn
   *   mancheOver: boolean,
   *   duelOver: boolean,
   *   duelWinner: null|"a"|"b",
   *   sessionOver: boolean
   * }}
   */
  function playTurn(session, playerAction) {
    const botAction = DUELMINDS.ai.chooseAction(session.brain, session.bot, session.player);
    const turnResult = resolveTurn(session.player, session.bot, playerAction, botAction);

    // Compteurs de session
    const t = session.totals;
    t.turns += 1;
    t.actions[playerAction] += 1;
    if (turnResult.resultA === "clash") t.clashes += 1;
    if (turnResult.resultA === "super_shot" || turnResult.resultB === "super_shot") t.superShots += 1;

    const out = {
      turn: turnResult,
      mancheOver: false,
      duelOver: false,
      duelWinner: null,
      sessionOver: false,
    };

    if (!turnResult.winner) {
      session.turn += 1;
      return out;
    }

    // --- La manche est jouée ---
    out.mancheOver = true;
    t.manches += 1;
    session.lastReason = turnResult.reason;

    if (turnResult.winner === "a") session.player.manchesWon += 1;
    else session.bot.manchesWon += 1;

    // --- Le duel est-il joué ? ---
    const playerWon = session.player.manchesWon >= RULES.MANCHES_TO_WIN;
    const botWon = session.bot.manchesWon >= RULES.MANCHES_TO_WIN;

    if (!playerWon && !botWon) {
      session.mancheNumber += 1;
      return out;
    }

    out.duelOver = true;
    out.duelWinner = playerWon ? "a" : "b";
    session.duelsPlayed += 1;

    // --- La session est-elle finie ? ---
    /* Un mode « série » (arcade, blitz, classé) enchaîne les duels tant qu'on
     * gagne ; les autres s'arrêtent après un seul affrontement. */
    const mode = DUELMINDS.MODES.find((m) => m.key === session.mode);
    const isStreak = !!(mode && mode.isStreak);

    if (!isStreak) {
      out.sessionOver = true;
      session.over = true;
    } else if (playerWon) {
      session.streak += 1;
    } else {
      out.sessionOver = true;
      session.over = true;
    }

    return out;
  }

  /** Score de la session, tel qu'il sera affiché et enregistré. */
  function sessionScore(session) {
    const mode = DUELMINDS.MODES.find((m) => m.key === session.mode);
    if (mode && mode.isStreak) return session.streak;
    return session.player.manchesWon >= RULES.MANCHES_TO_WIN ? 1 : 0;
  }

  DUELMINDS.match = { createSession, startManche, startNextDuel, playTurn, sessionScore };
})(typeof globalThis !== "undefined" ? globalThis : window);
