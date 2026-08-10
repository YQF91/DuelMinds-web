/* =============================================================================
 * DUELMINDS — RÈGLES ET ÉQUILIBRAGE
 * =============================================================================
 *
 * RÔLE DU FICHIER
 * La traduction en JavaScript des règles du jeu Python (`game/player.py`,
 * `game/bot.py`, `game/engine.py`). C'est le SEUL endroit où se trouvent des
 * valeurs d'équilibrage : aucun autre fichier ne doit contenir de nombre lié
 * aux règles.
 *
 * LE JEU EN DEUX PHRASES
 * Deux duellistes choisissent EN MÊME TEMPS entre charger, tirer et se
 * protéger. Il n'y a pas de points de vie : un tir qui touche tue sur le coup.
 *
 * DEUX MODES
 *   DUEL    — un affrontement, au meilleur des 3 manches.
 *   ARCADE  — des duels enchaînés : on compte combien on en gagne d'affilée
 *             avant de tomber. C'est le mode de score.
 *
 * DIFFÉRENCE AVEC LA VERSION PYTHON — À LIRE
 * Le code Python fait payer les défenses différemment au joueur et à l'IA :
 *   Player.can_defend()  ->  gratuite tant que consecutive_defends <= 1
 *   Bot.can_defend()     ->  gratuite seulement si consecutive_defends == 0
 * L'IA est donc plus contrainte que le joueur, ce qui n'a pas l'air voulu.
 * Cette version applique LA MÊME RÈGLE AUX DEUX (celle du joueur). Pour
 * revenir au comportement d'origine, voir FREE_DEFENCES_BOT plus bas.
 *
 * DÉPENDANCES : aucune. Ce fichier doit rester chargeable en premier.
 * ========================================================================== */

(function (root) {
  "use strict";

  const DUELMINDS = (root.DUELMINDS = root.DUELMINDS || {});

  /* ---------------------------------------------------------------------------
   * 1. RÈGLES DU DUEL
   * ------------------------------------------------------------------------ */
  const RULES = {
    // --- Structure ---
    MANCHES_TO_WIN: 2,     // premier à 2 manches remporte le duel
    START_BULLETS: 1,      // chaque manche commence avec 1 balle

    // --- Coûts ---
    SHOOT_COST: 1,

    /* Défense : les premières d'affilée sont gratuites, ensuite elles coûtent
     * une balle. Le compteur repart à zéro dès qu'on charge ou qu'on tire.
     * C'est ce qui empêche de camper indéfiniment derrière sa protection.
     *
     * Attention à la subtilité du code d'origine, reproduite ici : le DROIT de
     * se défendre et le COÛT de la défense n'utilisent pas le même seuil.
     *   - droit  : gratuit tant que defenses_enchainees <= 1
     *   - coût   : nul     tant que defenses_enchainees <= 2
     * Résultat : à la 3e défense d'affilée il faut POSSÉDER une balle, mais
     * elle n'est pas facturée. La 4e, elle, se paie vraiment. */
    FREE_DEFENCE_RIGHT: 1, // seuil du droit de se défendre gratuitement
    FREE_DEFENCE_COST: 2,  // seuil au-delà duquel la défense se paie
    DEFENCE_COST: 1,

    /* Mets 0 ici pour retrouver l'asymétrie du Python, où l'IA payait dès sa
     * 2e défense enchaînée. `null` = l'IA suit exactement la règle du joueur. */
    FREE_DEFENCES_BOT: null,

    // --- Super tir ---
    /* À partir de ce nombre de balles, le tir TRAVERSE la protection adverse.
     * C'est la récompense de qui prend le risque d'accumuler au lieu de tirer,
     * et le principal levier d'équilibrage du jeu. */
    SUPER_SHOT_BULLETS: 4,

    // --- Mémoire ---
    HISTORY_LENGTH: 10,    // nombre d'actions conservées pour l'analyse de l'IA

    /* --- Mode arcade ---
     * Nombre de duels à enchaîner avant que le compteur ne s'affole. Purement
     * indicatif : il n'y a pas de limite réelle, on joue jusqu'à la défaite. */
    ARCADE_MILESTONE: 10,
  };

  /* ---------------------------------------------------------------------------
   * 2. LES TROIS ACTIONS
   * ------------------------------------------------------------------------ */
  const ACTIONS = ["charge", "shoot", "defend"];
  const ACTION_LABEL = { charge: "Charger", shoot: "Tirer", defend: "Protéger" };

  /* ---------------------------------------------------------------------------
   * 3. NIVEAUX DE DIFFICULTÉ
   * ---------------------------------------------------------------------------
   * Les clés sont celles du code Python (`facile`, `difficile`, `extreme`) :
   * il ne faut pas les renommer sans changer aussi ai.js.
   * ------------------------------------------------------------------------ */
  const DIFFICULTIES = [
    {
      key: "facile",
      label: "Facile",
      accent: "--easy",
      blurb: "Joue au hasard, avec un penchant pour la charge. Idéal pour comprendre le jeu.",
    },
    {
      key: "difficile",
      label: "Difficile",
      accent: "--medium",
      blurb: "Lit ton historique, estime tes balles et se protège quand tu deviens dangereux.",
    },
    {
      key: "extreme",
      label: "Extrême",
      accent: "--hard",
      blurb: "Cherche la faille, refuse de se répéter et punit la moindre habitude.",
    },
  ];

  /* ---------------------------------------------------------------------------
   * 4. MODES DE JEU
   * ---------------------------------------------------------------------------
   * La clé `key` est ce qui part dans la colonne « mode » des statistiques :
   * ne la change pas sans prévenir la feuille de collecte.
   * ------------------------------------------------------------------------ */
  const MODES = [
    {
      key: "duel",
      label: "Duel",
      blurb: "Un affrontement au meilleur des 3 manches.",
    },
    {
      key: "arcade",
      label: "Arcade",
      blurb: "Enchaîne les duels. Combien en gagnes-tu d'affilée avant de tomber ?",
    },
  ];

  /* ---------------------------------------------------------------------------
   * 5. LES DUELLISTES
   * ---------------------------------------------------------------------------
   * Le choix du personnage est PUREMENT ESTHÉTIQUE : dans DuelMinds, tout le
   * monde a les mêmes règles, les mêmes balles et les mêmes actions. Ce qui
   * départage, c'est la lecture de l'adversaire, jamais la fiche du perso.
   *
   * `key` sert à deux choses à la fois :
   *   - le nom du fichier image, `assets/characters/<key>.png`
   *   - l'identifiant enregistré dans les statistiques
   * Renommer une clé impose donc de renommer le fichier correspondant.
   *
   * Tant qu'un PNG est absent, le jeu affiche une silhouette en pixel art :
   * on peut donc jouer avant d'avoir tous les dessins.
   * ------------------------------------------------------------------------ */
  const CHARACTERS = [
    { key: "ingenieur",     name: "Ingénieure",    blurb: "Lunettes de soudeur, bras mécanique." },
    { key: "cowboy",        name: "Cowboy",        blurb: "Chapeau brun, revolver, foulard." },
    { key: "capitaine",     name: "Capitaine",     blurb: "Bicorne à tête de mort, crinière rouge." },
    { key: "mecano",        name: "Mécano",        blurb: "Réacteur dorsal et lunettes vertes." },
    { key: "samourai",      name: "Samouraï",      blurb: "Chapeau de paille, katana au côté." },
    { key: "bourreau",      name: "Bourreau",      blurb: "Armure sombre, deux haches." },
    { key: "plombier",      name: "Plombier",      blurb: "Casquette rouge, salopette." },
    { key: "corsaire",      name: "Corsaire",      blurb: "Sabre au clair, cape brune." },
    { key: "pyromancienne", name: "Pyromancienne", blurb: "Cheveux de flammes, fouet ardent." },
    { key: "ange",          name: "Ange",          blurb: "Ailes blanches, robe claire." },
    { key: "archer",        name: "Archer",        blurb: "Capuche de loup, arc tendu." },
    { key: "gobelin",       name: "Gobelin",       blurb: "Petit, vert, mauvais." },
  ];

  DUELMINDS.RULES = RULES;
  DUELMINDS.CHARACTERS = CHARACTERS;
  DUELMINDS.ACTIONS = ACTIONS;
  DUELMINDS.ACTION_LABEL = ACTION_LABEL;
  DUELMINDS.DIFFICULTIES = DIFFICULTIES;
  DUELMINDS.MODES = MODES;
  DUELMINDS.VERSION = "web-1.0";
})(typeof globalThis !== "undefined" ? globalThis : window);
