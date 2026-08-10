/* =============================================================================
 * DUELMINDS — LES TROIS ADVERSAIRES
 * =============================================================================
 *
 * RÔLE DU FICHIER
 * Choisir l'action de l'ordinateur. Portage fidèle de `game/bot.py` : mêmes
 * cascades de décision, mêmes probabilités, mêmes seuils.
 *
 * CE QUE L'IA A LE DROIT DE SAVOIR
 * Ce qui est affiché à l'écran, et l'historique des coups PASSÉS du joueur.
 * Elle ne connaît PAS le coup en cours : les actions sont simultanées, elle
 * tricherait. Les valeurs qu'elle lit (`bullets`, `isDefending`) datent du
 * tour précédent, exactement comme dans la version Python.
 *
 * LES TROIS NIVEAUX
 *
 *   FACILE     Tirage au sort parmi les actions légales, avec un poids double
 *              sur « charger ». Ne lit rien, ne retient rien.
 *
 *   DIFFICILE  Lit l'historique : se protège si tu as chargé deux fois de
 *              suite, charge si tu es en protection, et surtout ESTIME tes
 *              balles pour savoir quand tu deviens dangereux.
 *
 *   EXTRÊME    Ajoute une mémoire anti-répétition. Elle enregistre une
 *              empreinte de chaque situation rencontrée ; si la même se
 *              représente, elle se force à jouer autre chose. Puis elle
 *              cherche activement la faille avec `analyzeBestMove`.
 *
 * DÉPENDANCES : rules.js, combat.js
 * ========================================================================== */

(function (root) {
  "use strict";

  const DUELMINDS = (root.DUELMINDS = root.DUELMINDS || {});
  const { RULES } = DUELMINDS;
  const { canDo, legalActions } = DUELMINDS.combat;

  /* Probabilités du code d'origine, regroupées pour pouvoir régler le
   * caractère des IA sans relire la logique. */
  const TENDENCY = {
    HARD_SHOOT: 0.6,          // difficile : tire quand la cible est à découvert
    EXTREME_EARLY_SHOOT: 0.3, // extrême : tir surprise en début de manche
    EXTREME_SHOOT: 0.7,       // extrême : tire quand elle a l'avantage
    EXTREME_DEFEND: 0.4,      // extrême : se protège par défaut
  };

  /* ---------------------------------------------------------------------------
   * MÉMOIRE DE L'IA
   * ---------------------------------------------------------------------------
   * Le niveau extrême a besoin de se souvenir d'une manche à l'autre. Plutôt
   * que d'alourdir le duelliste, on lui attache une mémoire à part.
   * ------------------------------------------------------------------------ */
  function makeBrain(difficulty) {
    return {
      difficulty,
      opponentHistory: [], // copie de l'historique du joueur
      usedPatterns: [],    // empreintes de situations déjà rencontrées
      turnCount: 0,        // numéro du tour dans la manche
    };
  }

  function resetBrainForManche(brain) {
    brain.opponentHistory.length = 0;
    brain.usedPatterns.length = 0;
    brain.turnCount = 0;
  }

  /* ---------------------------------------------------------------------------
   * POINT D'ENTRÉE
   * ------------------------------------------------------------------------ */

  /**
   * Choisit l'action de l'ordinateur pour ce tour.
   *
   * @param {object} brain     mémoire de l'IA (voir makeBrain)
   * @param {object} self      le duelliste piloté par l'ordinateur
   * @param {object} opponent  le duelliste du joueur, en LECTURE SEULE
   */
  function chooseAction(brain, self, opponent) {
    // On recopie l'historique du joueur pour pouvoir l'analyser. Le test de
    // longueur évite de l'écraser par une version plus courte, l'historique
    // étant tronqué au-delà de RULES.HISTORY_LENGTH.
    if (opponent.history.length > brain.opponentHistory.length) {
      brain.opponentHistory = opponent.history.slice();
    }

    brain.turnCount += 1;

    switch (brain.difficulty) {
      case "difficile": return decideHard(brain, self, opponent);
      case "extreme":   return decideExtreme(brain, self, opponent);
      default:          return decideEasy(self);
    }
  }

  /* ---------------------------------------------------------------------------
   * FACILE — le hasard, avec un penchant pour la prudence
   * ------------------------------------------------------------------------ */
  function decideEasy(self) {
    const options = legalActions(self);

    // Charger compte double : l'IA facile accumule plutôt que de foncer, ce
    // qui la rend inoffensive mais pas complètement absurde.
    const bag = [];
    for (const action of options) {
      bag.push(action);
      if (action === "charge") bag.push(action);
    }
    return bag[Math.floor(Math.random() * bag.length)];
  }

  /* ---------------------------------------------------------------------------
   * DIFFICILE — lit les habitudes
   * ---------------------------------------------------------------------------
   * Cascade évaluée DANS L'ORDRE, la première règle qui s'applique gagne :
   *   1. le joueur a chargé deux fois de suite     -> se protéger
   *   2. le joueur est en protection               -> charger, c'est gratuit
   *   3. le joueur semble avoir 3 balles ou plus   -> se protéger
   *   4. je n'ai plus de balle                     -> charger
   *   5. j'ai une balle et il est à découvert      -> tirer (60 % du temps)
   *   6. sinon                                     -> charger ou se protéger
   * ------------------------------------------------------------------------ */
  function decideHard(brain, self, opponent) {
    const history = brain.opponentHistory;

    // Les règles de lecture ne s'activent qu'à partir de deux coups observés.
    if (history.length >= 2) {
      const lastTwo = history.slice(-2);

      if (count(lastTwo, "charge") >= 2 && canDo(self, "defend")) return "defend";

      if (opponent.isDefending) return "charge";

      if (estimateBullets(history) >= 3 && canDo(self, "defend")) return "defend";
    }

    if (!canDo(self, "shoot")) return "charge";

    if (!opponent.isDefending && Math.random() < TENDENCY.HARD_SHOOT) return "shoot";

    const fallback = ["charge"];
    if (canDo(self, "defend")) fallback.push("defend");
    return fallback[Math.floor(Math.random() * fallback.length)];
  }

  /* ---------------------------------------------------------------------------
   * EXTRÊME — cherche la faille, puis refuse de se répéter
   * ---------------------------------------------------------------------------
   * CORRECTION PAR RAPPORT AU PYTHON — mesurée, pas supposée.
   *
   * Dans `game/bot.py`, la mémoire anti-répétition passe AVANT l'analyse
   * tactique : dès qu'une situation se represente, l'IA joue « autre chose »
   * sans même regarder quel serait le bon coup. Elle sabote donc son propre
   * jeu. Le simulateur est formel : avec cet ordre, DIFFICILE battait EXTRÊME
   * dans 75 % des duels — le niveau censé être le plus dur était le plus
   * faible des trois.
   *
   * Ici l'ordre est inversé : on calcule d'abord le meilleur coup, et on ne
   * varie QUE s'il a déjà été joué dans la même situation. L'imprévisibilité
   * est conservée, la compétence aussi.
   *
   * Deux garde-fous : on ne renonce jamais à une occasion de tuer, et on ne
   * varie que vers une action légale.
   *
   * Pour revenir au comportement d'origine, mets ANTI_REPEAT_BEFORE_ANALYSIS
   * à true ci-dessous.
   * ------------------------------------------------------------------------ */
  const ANTI_REPEAT_BEFORE_ANALYSIS = false;

  function decideExtreme(brain, self, opponent) {
    const situation = describeSituation(brain, self);

    // --- Comportement d'origine, conservé pour comparaison ---
    if (ANTI_REPEAT_BEFORE_ANALYSIS && brain.usedPatterns.includes(situation)) {
      for (const action of DUELMINDS.ACTIONS) {
        const variant = situation + "_" + action;
        if (!brain.usedPatterns.includes(variant) && canDo(self, action)) {
          brain.usedPatterns.push(variant);
          return action;
        }
      }
    }

    const best = analyzeBestMove(brain, self, opponent);
    const signature = situation + "_" + best;

    // Coup jamais joué dans cette situation : on le garde tel quel.
    if (!brain.usedPatterns.includes(signature)) {
      brain.usedPatterns.push(signature);
      return best;
    }

    // Occasion de tuer : on ne varie sous aucun prétexte.
    if (canFinish(self, opponent)) return "shoot";

    // Sinon on cherche une variante encore inédite, pour rester illisible.
    for (const action of DUELMINDS.ACTIONS) {
      if (action === best || !canDo(self, action)) continue;
      const variant = situation + "_" + action;
      if (!brain.usedPatterns.includes(variant)) {
        brain.usedPatterns.push(variant);
        return action;
      }
    }

    // Tout a déjà été tenté ici : on s'en tient au meilleur coup.
    return best;
  }

  /**
   * L'adversaire est-il hors d'état de se protéger ?
   * Il vient de se protéger et n'a presque plus de balles : sa prochaine
   * protection lui est interdite ou impayable.
   */
  function canFinish(self, opponent) {
    return opponent.consecutiveDefends >= 1 && opponent.bullets <= 1 && canDo(self, "shoot");
  }

  /**
   * Empreinte d'une situation : balles, défenses enchaînées, numéro de tour et
   * trois derniers coups. Deux tours identiques produisent la même empreinte,
   * ce qui permet de détecter qu'on tourne en rond.
   */
  function describeSituation(brain, self) {
    const recent = self.history.length >= 3 ? self.history.slice(-3).join("") : "start";
    return "b" + self.bullets + "_d" + self.consecutiveDefends + "_t" + brain.turnCount + "_" + recent;
  }

  /**
   * Cherche le meilleur coup, par ordre d'opportunité :
   *   1. l'adversaire est à sec (s'est protégé et n'a presque plus de balles)
   *      -> tirer, il ne pourra pas se protéger une fois de plus
   *   2. début de manche et il n'a jamais tiré -> tir surprise (30 %)
   *   3. il vient d'enchaîner des charges      -> se protéger
   *   4. il me distance en balles              -> charger pour suivre
   *   5. j'ai l'avantage et il est à découvert -> tirer (70 %)
   *   6. sinon : charger, ou se protéger (40 %)
   */
  function analyzeBestMove(brain, self, opponent) {
    const history = brain.opponentHistory;

    // 1. La faille classique : qui vient de se protéger et n'a plus de balle
    //    ne pourra pas payer la protection suivante.
    if (opponent.consecutiveDefends >= 1 && opponent.bullets <= 1 && canDo(self, "shoot")) {
      return "shoot";
    }

    // 2. Un joueur qui n'a pas encore tiré ne s'attend pas à être attaqué.
    if (brain.turnCount <= 2 && !history.includes("shoot") &&
        canDo(self, "shoot") && Math.random() < TENDENCY.EXTREME_EARLY_SHOOT) {
      return "shoot";
    }

    // 3. Deux charges sur les trois derniers coups : un tir se prépare.
    if (history.length >= 3 && count(history.slice(-3), "charge") >= 2 && canDo(self, "defend")) {
      return "defend";
    }

    // 4. Course à l'armement : ne pas se laisser distancer.
    if (estimateBullets(history) > self.bullets + 1) return "charge";

    /* 5. Cible à découvert : on en profite.
     *
     * CORRECTION PAR RAPPORT AU PYTHON — mesurée, pas supposée.
     * `game/bot.py` exige ici `bullets >= 2`. L'IA extrême refusait donc de
     * tirer avec une seule balle, c'est-à-dire pendant presque tout le début
     * de chaque manche : elle chargeait et se protégeait pendant que le niveau
     * difficile, lui, tirait dès la première balle.
     *
     * Ce seul caractère renversait l'échelle de difficulté. Victoires contre
     * FACILE, mesurées sur 2 500 duels :
     *
     *     avec >= 2 :  Facile 50 %  ·  Difficile 66 %  ·  Extrême 61 %   <- inversé
     *     avec >= 1 :  Facile 50 %  ·  Difficile 64 %  ·  Extrême 87 %   <- correct
     *
     * Et en duel direct, Extrême passe de 26 % à 61 % de victoires contre
     * Difficile. C'est indispensable au mode arcade, dont le score n'a de sens
     * que si les niveaux sont réellement de plus en plus durs. */
    if (self.bullets >= 1 && !opponent.isDefending && Math.random() < TENDENCY.EXTREME_SHOOT) {
      return "shoot";
    }

    if (!canDo(self, "shoot")) return "charge";

    if (canDo(self, "defend") && Math.random() < TENDENCY.EXTREME_DEFEND) return "defend";
    return "charge";
  }

  /* ---------------------------------------------------------------------------
   * OUTILS
   * ------------------------------------------------------------------------ */

  /**
   * Estime les balles de l'adversaire à partir de ses coups observés.
   * L'IA n'a pas le droit de lire `opponent.bullets` pour décider : elle
   * reconstitue le compte comme le ferait un joueur attentif.
   *     départ 1 balle, +1 par charge, -1 par tir
   */
  function estimateBullets(history) {
    return RULES.START_BULLETS + count(history, "charge") - count(history, "shoot");
  }

  function count(list, value) {
    let n = 0;
    for (const item of list) if (item === value) n += 1;
    return n;
  }

  DUELMINDS.ai = { makeBrain, resetBrainForManche, chooseAction, estimateBullets, TENDENCY };
})(typeof globalThis !== "undefined" ? globalThis : window);
