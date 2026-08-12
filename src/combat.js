/* =============================================================================
 * DUELMINDS — MOTEUR DE COMBAT
 * =============================================================================
 *
 * RÔLE DU FICHIER
 * La mécanique d'un tour, et rien d'autre. Ce fichier ne connaît ni l'écran,
 * ni le son, ni le joueur : il prend deux duellistes et deux actions, et
 * renvoie ce qui s'est passé.
 *
 * Portage direct de `game/player.py` et de `_resolve_simultaneous_actions()`
 * dans `game/engine.py`.
 *
 * POURQUOI CETTE SÉPARATION
 * Un moteur sans interface est testable. C'est ce qui permet à
 * `tools/simulate.mjs` de rejouer des dizaines de milliers de duels en
 * quelques secondes en réutilisant EXACTEMENT le code du jeu — pas une copie
 * qui finirait par diverger.
 *
 * LE POINT LE PLUS IMPORTANT À COMPRENDRE
 * Il n'y a PAS de points de vie. Un tir qui touche tue immédiatement. Toute la
 * tension vient de là : chaque tour peut être le dernier, et comme les deux
 * camps choisissent en même temps, on joue autant contre l'adversaire que
 * contre ce qu'on croit qu'il va faire.
 *
 * DÉPENDANCES : rules.js
 * ========================================================================== */

(function (root) {
  "use strict";

  const DUELMINDS = (root.DUELMINDS = root.DUELMINDS || {});

  /* Les verdicts sont des phrases lues par le joueur : elles passent par le
   * dictionnaire. Repli en français si i18n.js n'est pas chargé — c'est le cas
   * des outils de simulation, qui ne chargent que le moteur. */
  const t = (key, params) => (DUELMINDS.i18n ? DUELMINDS.i18n.t(key, params) : key);

  /* Le verdict d'un duelliste, conjugue selon qu'il s'agit du joueur ou de
   * l'adversaire. Sans ca on lit « Toi est touche » ou « You punches » : le
   * sujet impose sa conjugaison, il ne peut pas etre un simple trou. */
  const verdict = (base, duelist, params) =>
    t(base + (duelist.isBot ? "Foe" : "You"),
      Object.assign({ name: duelist.name }, params || {}));
  const { RULES } = DUELMINDS;

  /* ---------------------------------------------------------------------------
   * 1. UN DUELLISTE
   * ------------------------------------------------------------------------ */

  /**
   * Crée un duelliste prêt à combattre.
   * @param {string} name  nom affiché
   * @param {boolean} isBot  change le seuil de défense gratuite si
   *                         RULES.FREE_DEFENCES_BOT est renseigné
   */
  function makeDuelist(name, isBot) {
    return {
      name,
      isBot: !!isBot,

      bullets: RULES.START_BULLETS,

      /* Défenses ENCHAÎNÉES. Remis à zéro dès qu'on charge ou qu'on tire :
       * c'est le mécanisme qui rend le camping défensif coûteux. */
      consecutiveDefends: 0,

      /* Vrai seulement pendant le tour où l'on s'est protégé. C'est cette
       * valeur que consulte la résolution pour savoir si un tir touche. */
      isDefending: false,

      /* Les dernières actions jouées, dans l'ordre. Sert à l'IA adverse pour
       * deviner les habitudes. Tronqué à RULES.HISTORY_LENGTH. */
      history: [],

      /* Le dernier tir était-il un super tir ? Consulté par le verdict pour
       * expliquer pourquoi le barillet retombe à 2 après une interception. */
      firedSuperShot: false,

      // Statistiques de la partie en cours
      manchesWon: 0,
      totalShots: 0,
      totalCharges: 0,
      totalDefends: 0,
    };
  }

  /** Remet un duelliste à neuf pour une nouvelle manche. */
  function resetForManche(duelist) {
    duelist.bullets = RULES.START_BULLETS;
    duelist.consecutiveDefends = 0;
    duelist.isDefending = false;
    duelist.firedSuperShot = false;
    duelist.history.length = 0;
  }

  /* ---------------------------------------------------------------------------
   * 2. CE QU'UN DUELLISTE PEUT FAIRE MAINTENANT
   * ------------------------------------------------------------------------ */

  /** Seuil de défenses gratuites applicable à ce duelliste. */
  function freeDefenceRight(duelist) {
    if (duelist.isBot && RULES.FREE_DEFENCES_BOT !== null) {
      return RULES.FREE_DEFENCES_BOT;
    }
    return RULES.FREE_DEFENCE_RIGHT;
  }

  /**
   * Coût en balles de la PROCHAINE défense.
   *
   * Attention : ce seuil n'est volontairement pas le même que celui du droit
   * de se défendre (voir freeDefenceRight). C'est reproduit du code d'origine
   * et documenté dans rules.js.
   */
  function defenceCost(duelist) {
    return duelist.consecutiveDefends <= RULES.FREE_DEFENCE_COST ? 0 : RULES.DEFENCE_COST;
  }

  /** Le prochain tir traversera-t-il la protection adverse ? */
  function isSuperShot(duelist) {
    return duelist.bullets >= RULES.SUPER_SHOT_BULLETS;
  }

  /** Une action est-elle légale dans l'état actuel ? */
  function canDo(duelist, action) {
    switch (action) {
      case "charge":
        /* Impossible barillet plein : voir RULES.MAX_BULLETS. C'est la seule
         * situation où charger est interdit, et elle coïncide exactement avec
         * le seuil du super tir. */
        return duelist.bullets < RULES.MAX_BULLETS;
      case "shoot":
        return duelist.bullets >= RULES.SHOOT_COST;
      case "defend":
        // Gratuit tant qu'on est sous le seuil ; au-delà il faut de quoi payer.
        if (duelist.consecutiveDefends <= freeDefenceRight(duelist)) return true;
        return duelist.bullets >= RULES.DEFENCE_COST;
      default:
        return false;
    }
  }

  /** Les actions actuellement jouables. Jamais vide : charger l'est toujours. */
  function legalActions(duelist) {
    return DUELMINDS.ACTIONS.filter((a) => canDo(duelist, a));
  }

  /** Ajoute une action à l'historique en gardant celui-ci borné. */
  function remember(duelist, action) {
    duelist.history.push(action);
    if (duelist.history.length > RULES.HISTORY_LENGTH) duelist.history.shift();
  }

  /* ---------------------------------------------------------------------------
   * 3. EXÉCUTION D'UNE ACTION
   * ---------------------------------------------------------------------------
   * Renvoie un RÉSULTAT qui pilote toute la suite :
   *   "success"     action ordinaire
   *   "clash"       les deux ont tiré : les balles s'annulent en vol
   *   "super_shot"  tir à 4 balles ou plus : traverse la protection
   *   "death"       l'action était impossible : mort immédiate
   * ------------------------------------------------------------------------ */
  function executeAction(duelist, action, opponentAction) {
    if (!canDo(duelist, action)) return "death";

    if (action === "charge") {
      duelist.firedSuperShot = false;
      // Le plafond est déjà garanti par canDo ; on le borne quand même, pour
      // qu'aucun réglage futur ne puisse le contourner en silence.
      duelist.bullets = Math.min(RULES.MAX_BULLETS, duelist.bullets + 1);
      duelist.consecutiveDefends = 0; // charger casse la série de défenses
      duelist.isDefending = false;
      duelist.totalCharges += 1;
      remember(duelist, "charge");
      return "success";
    }

    if (action === "shoot") {
      // Le statut de super tir se juge AVANT de dépenser la balle.
      const superShot = isSuperShot(duelist);
      const intercepted = opponentAction === "shoot";

      /* Le tireur retient s'il vient de lâcher un super tir : le verdict s'en
       * sert pour l'annoncer. Sans ça, le joueur verrait son barillet passer de
       * 5 à 2 sans explication, et le prendrait pour un défaut. */
      duelist.firedSuperShot = superShot;

      if (superShot && intercepted) {
        /* SUPER TIR INTERCEPTÉ. On AFFECTE le reste au lieu de soustraire :
         * voir RULES.SUPER_SHOT_AFTER_CLASH pour le raisonnement. */
        duelist.bullets = RULES.SUPER_SHOT_AFTER_CLASH;
      } else {
        duelist.bullets -= RULES.SHOOT_COST;
      }

      duelist.consecutiveDefends = 0;
      duelist.isDefending = false;
      duelist.totalShots += 1;
      remember(duelist, "shoot");

      // Deux tirs au même tour : les balles se percutent, personne ne tombe.
      if (intercepted) return "clash";
      return superShot ? "super_shot" : "success";
    }

    if (action === "defend") {
      duelist.firedSuperShot = false;
      const cost = defenceCost(duelist);
      if (duelist.bullets < cost) return "death"; // incapable de payer
      duelist.bullets -= cost;
      duelist.consecutiveDefends += 1;
      duelist.isDefending = true;
      duelist.totalDefends += 1;
      remember(duelist, "defend");
      return "success";
    }

    return "success";
  }

  /* ---------------------------------------------------------------------------
   * 4. RÉSOLUTION D'UN TOUR
   * ---------------------------------------------------------------------------
   * Les deux camps choisissent sans voir le coup de l'autre. On exécute les
   * deux actions en passant à chacune l'action adverse — c'est comme ça que le
   * CLASH est détecté — puis on applique les règles de victoire.
   * ------------------------------------------------------------------------ */

  /**
   * Joue un tour complet. MODIFIE les deux duellistes.
   *
   * @returns {{resultA:string, resultB:string, winner:null|"a"|"b", reason:string}}
   *          `winner` vaut null si la manche continue.
   */
  function resolveTurn(a, b, actionA, actionB) {
    const resultA = executeAction(a, actionA, actionB);
    const resultB = executeAction(b, actionB, actionA);

    const verdict = judge(a, b, actionA, actionB, resultA, resultB);

    return { actionA, actionB, resultA, resultB, winner: verdict.winner, reason: verdict.reason };
  }

  /**
   * Applique les règles de victoire d'une manche.
   *
   * L'ORDRE DES TESTS EST LA RÈGLE DU JEU : le premier cas qui correspond
   * l'emporte. Le réordonner change le jeu.
   *
   *   1. mort par action impossible   (priorité absolue)
   *   2. clash                        (annule tout, la manche continue)
   *   3. super tir                    (traverse la protection)
   *   4. tir ordinaire sur cible non protégée
   */
  function judge(a, b, actionA, actionB, resultA, resultB) {
    // 1. Celui qui a tenté l'impossible perd sur-le-champ
    if (resultA === "death") return { winner: "b", reason: verdict("combat.impossible", a) };
    if (resultB === "death") return { winner: "a", reason: verdict("combat.impossible", b) };

    /* 2. Les deux ont tiré : les balles se percutent en vol.
     *
     * On distingue trois cas, parce que le barillet ne se vide pas pareil et
     * que le joueur doit comprendre pourquoi :
     *   - deux tirs ordinaires   -> chacun a dépensé une balle
     *   - un super intercepté    -> le tireur retombe à 2 balles
     *   - deux supers            -> les deux retombent à 2 */
    if (resultA === "clash" && resultB === "clash") {
      if (a.firedSuperShot && b.firedSuperShot) {
        return { winner: null, reason: t("combat.superClashBoth",
                                         { n: RULES.SUPER_SHOT_AFTER_CLASH }) };
      }
      if (a.firedSuperShot || b.firedSuperShot) {
        const shooter = a.firedSuperShot ? a : b;
        return { winner: null, reason: verdict("combat.superClash", shooter,
                                               { n: RULES.SUPER_SHOT_AFTER_CLASH }) };
      }
      return { winner: null, reason: t("combat.clash") };
    }

    // 3. Super tir : la protection ne sert à rien
    if (resultA === "super_shot") return { winner: "a", reason: verdict("combat.superShot", a) };
    if (resultB === "super_shot") return { winner: "b", reason: verdict("combat.superShot", b) };

    // 4. Tir ordinaire : ne touche que si la cible ne s'est pas protégée.
    //    `isDefending` vient d'être mis à jour par executeAction, il reflète
    //    donc bien l'action de CE tour.
    if (actionA === "shoot" && !b.isDefending) return { winner: "a", reason: verdict("combat.hit", b) };
    if (actionB === "shoot" && !a.isDefending) return { winner: "b", reason: verdict("combat.hit", a) };

    return { winner: null, reason: "" };
  }

  DUELMINDS.combat = {
    makeDuelist,
    resetForManche,
    defenceCost,
    freeDefenceRight,
    isSuperShot,
    canDo,
    legalActions,
    executeAction,
    resolveTurn,
    judge,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
