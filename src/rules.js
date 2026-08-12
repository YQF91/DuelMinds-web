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

    /* PLAFOND DU BARILLET. Volontairement ÉGAL au seuil du super tir.
     *
     * ATTENTION À LA NUANCE : charger reste TOUJOURS permis, même plein. Ça ne
     * rapporte simplement plus rien. Ce n'est pas une action interdite, c'est
     * une action sans effet — et la différence est de taille, puisque tenter
     * une action interdite tue sur-le-champ.
     *
     * Les seules actions qui peuvent être interdites sont donc celles qui
     * COÛTENT une balle : tirer, et se protéger au-delà du seuil gratuit.
     *
     * Charger plein reste utile dans un cas : ça remet à zéro le compteur de
     * défenses enchaînées, sans rien dépenser. C'est aussi une façon de
     * temporiser sans se découvrir. */
    MAX_BULLETS: 4,

    /* CE QU'IL RESTE APRÈS UN SUPER TIR INTERCEPTÉ.
     *
     * Un super tir traverse tout — protection comme charge. Sa SEULE parade est
     * un tir adverse au même tour : les deux balles se percutent.
     *
     * Quand ça arrive, le tireur ne retombe pas à zéro : il conserve ce nombre
     * de balles. Ce n'est pas un cadeau, c'est ce qui garde le pari jouable.
     * Retomber à zéro rendrait l'accumulation suicidaire — on aurait misé
     * quatre tours pour finir désarmé face à quelqu'un d'armé. À 2, on perd la
     * mise sans perdre la partie, et on peut relancer.
     *
     * C'est une AFFECTATION, pas une soustraction — et depuis que le barillet
     * plafonne à MAX_BULLETS, cela revient toujours à retomber de 4 à 2. La
     * formulation reste une affectation pour rester juste si le plafond
     * changeait un jour. */
    SUPER_SHOT_AFTER_CLASH: 2,

    // --- Mémoire ---
    HISTORY_LENGTH: 10,    // nombre d'actions conservées pour l'analyse de l'IA

    /* --- Mode arcade ---
     * Nombre de duels à enchaîner avant que le compteur ne s'affole. Purement
     * indicatif : il n'y a pas de limite réelle, on joue jusqu'à la défaite. */
    ARCADE_MILESTONE: 10,

    /* --- Mode blitz ---
     * Secondes pour choisir, quand la difficulté n'en impose pas d'autre.
     * Passé ce délai, une action est jouée au hasard parmi celles qui sont
     * permises : ne rien décider est aussi une décision, et elle se paie.
     *
     * Le vrai délai vient de la difficulté (`blitzSeconds` plus bas) : 5 s en
     * facile, 3 s en difficile, 2 s en extrême. Cette valeur ne sert que de
     * repli si une difficulté oubliait de le préciser. */
    BLITZ_SECONDS: 5,

    /* --- Duel en ligne ---
     * Secondes pour choisir face à un autre joueur.
     *
     * POURQUOI PLUS QUE LE BLITZ EXTRÊME (2 s)
     * Le chronomètre de chaque joueur tourne CHEZ LUI, et son coup doit encore
     * traverser le réseau : entre une demi-seconde et deux secondes par
     * échange. Un délai trop court ferait perdre sur la latence plutôt que sur
     * le jeu.
     *
     * POURQUOI UN CHRONOMÈTRE TOUT COURT
     * Sans lui, un joueur qui pose son téléphone bloque l'autre indéfiniment.
     * Passé le délai, une action permise est jouée au hasard : ne rien décider
     * reste une décision. */
    PVP_SECONDS: 4,
  };

  /* ---------------------------------------------------------------------------
   * 2. LES TROIS ACTIONS
   * ------------------------------------------------------------------------ */
  const ACTIONS = ["charge", "shoot", "defend"];
  const ACTION_LABEL = { charge: "Charger", shoot: "Tirer", defend: "Protéger" };
  const ACTION_LABEL_EN = { charge: "Charge", shoot: "Shoot", defend: "Guard" };

  /** Le nom d'une action dans la langue courante. Voir i18n.js. */
  function actionLabel(action) {
    const english = DUELMINDS.i18n && DUELMINDS.i18n.lang() !== "fr";
    return (english ? ACTION_LABEL_EN : ACTION_LABEL)[action] || action;
  }

  /* ---------------------------------------------------------------------------
   * 3. NIVEAUX DE DIFFICULTÉ
   * ---------------------------------------------------------------------------
   * Les clés sont celles du code Python (`facile`, `difficile`, `extreme`) :
   * il ne faut pas les renommer sans changer aussi ai.js.
   * ------------------------------------------------------------------------ */
  /* En mode blitz, la difficulté serre aussi le CHRONOMÈTRE (`blitzSeconds`).
   * Ce n'est pas qu'un habillage : à 5 secondes on a le temps de recompter les
   * balles adverses, à 2 secondes il faut les avoir suivies au fur et à mesure.
   * Le temps de réflexion est donc une vraie dimension de difficulté, au même
   * titre que l'intelligence de l'IA. */
  const DIFFICULTIES = [
    {
      key: "facile",
      label: "Facile",
      accent: "--easy",
      blurb: "Joue au hasard, avec un penchant pour la charge. Idéal pour comprendre le jeu.",
      en: { label: "Easy",
            blurb: "Plays at random, with a taste for charging. Ideal for learning the game." },
      blitzSeconds: 5,
    },
    {
      key: "difficile",
      label: "Difficile",
      accent: "--medium",
      blurb: "Lit ton historique, estime tes balles et se protège quand tu deviens dangereux.",
      en: { label: "Hard",
            blurb: "Reads your history, counts your bullets and guards when you turn dangerous." },
      blitzSeconds: 3,
    },
    {
      key: "extreme",
      label: "Extrême",
      accent: "--hard",
      blurb: "Cherche la faille, punit la moindre habitude — et tu ne vois plus ses balles.",
      en: { label: "Extreme",
            blurb: "Hunts for the opening, punishes any habit — and its bullets are hidden from you." },
      blitzSeconds: 2,
      /* À ce niveau, le compteur de l'adversaire disparaît : il faut suivre
       * ses balles de tête. C'est la préparation du futur mode classé, où
       * personne ne verra le barillet d'en face. */
      hidesBullets: true,
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
      en: { label: "Duel", blurb: "A single confrontation, best of 3 rounds." },
    },
    {
      key: "arcade",
      label: "Arcade",
      blurb: "Enchaîne les duels. Combien en gagnes-tu d'affilée avant de tomber ?",
      en: { label: "Arcade",
            blurb: "One duel after another. How many in a row before you fall?" },
    },
    {
      key: "blitz",
      label: "Blitz",
      blurb: "Le chrono tourne : 5 s en facile, 3 s en difficile, 2 s en extrême. Sinon le hasard décide.",
      en: { label: "Blitz",
            blurb: "The clock runs: 5 s on easy, 3 s on hard, 2 s on extreme. Miss it and chance decides." },
      /* Le blitz est une série, comme l'arcade : c'est le nombre de duels
       * enchaînés qui fait le score. */
      isStreak: true,
      timed: true,
    },
    {
      key: "aveugle",
      label: "Aveugle",
      blurb: "Tu ne vois plus les balles adverses : compte-les de tête. Duels enchaînés.",
      en: { label: "Blind",
            blurb: "Enemy bullets are hidden — count them in your head. Duels back to back." },
      isStreak: true,
      hidesBullets: true,
    },
  ];

  /* Le mode arcade est aussi une série : on le marque ici plutôt que de tester
   * son nom un peu partout dans le code. */
  MODES[1].isStreak = true;

  /* ---------------------------------------------------------------------------
   * 5. LES DUELLISTES
   * ---------------------------------------------------------------------------
   * Le choix du personnage est PUREMENT ESTHÉTIQUE : dans DuelMinds, tout le
   * monde a les mêmes règles, les mêmes balles et les mêmes actions. Ce qui
   * départage, c'est la lecture de l'adversaire, jamais la fiche du perso.
   * IL N'Y A PAS DE TYPES. Prendre le Berserker ne donne aucun bonus.
   *
   * MAIS LE PERSONNAGE ADVERSE EST UN INDICE.
   * Quand c'est l'IA qui joue un personnage, celui-ci détermine son CARACTÈRE
   * (champ `ai` ci-dessous) : le Gobelin fonce, l'Archer réfléchit. Ce ne sont
   * toujours pas des statistiques — mêmes règles, mêmes balles — seulement des
   * inclinaisons, et les quatre caractères sont réglés pour se valoir en force
   * (voir tools/verify-personalities.mjs). Le score d'une série reste donc
   * comparable : tomber sur le Berserker n'est ni plus dur ni plus facile.
   *
   * Ce que ça apporte : la silhouette d'en face devient une INFORMATION
   * lisible. Le joueur apprend « le Gobelin tire tôt » et anticipe — c'est une
   * compétence, pas une loterie.
   *
   * `faces` — DE QUEL CÔTÉ REGARDE LE DESSIN D'ORIGINE
   * Ce n'est pas une valeur globale : les images n'ont pas toutes été dessinées
   * dans le même sens. L'Archer, le Berserker, le Gobelin et le Samouraï
   * regardent vers la DROITE ; le Cowboy et l'Enchanteresse vers la GAUCHE.
   *
   * Le jeu place TOI à droite (tu dois donc regarder à gauche) et l'ADVERSAIRE
   * à gauche (il doit regarder à droite). Il retourne l'image quand son sens
   * d'origine ne correspond pas à la place occupée — voir `shouldFlip` dans
   * sprites.js. Avec une valeur unique pour tout le monde, la moitié du casting
   * tournait forcément le dos.
   *
   * En ajoutant un personnage, regarde son image et renseigne ce champ : c'est
   * la seule chose à ne pas oublier.
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
    /* `ai` = le CARACTÈRE que prend ce personnage QUAND C'EST L'ADVERSAIRE qui
     * le joue. Voir le commentaire au-dessus : ça ne change rien à tes règles
     * quand c'est toi qui le choisis. */
    { key: "archer",        name: "Archer",        blurb: "Capuche de loup, arc tendu.",        ai: "prudent",  faces: "right",
      en: { name: "Archer",      blurb: "Wolf hood, bow drawn." } },
    { key: "berserker",     name: "Berserker",     blurb: "Deux haches, aucune patience.",      ai: "agressif", faces: "right",
      en: { name: "Berserker",   blurb: "Two axes, no patience whatsoever." } },
    { key: "cowboy",        name: "Cowboy",        blurb: "Revolver au poing, chapeau vissé.",  ai: "neutre",   faces: "left",
      en: { name: "Cowboy",      blurb: "Revolver in hand, hat pulled down." } },
    { key: "enchanteresse", name: "Enchanteresse", blurb: "Cheveux de flammes, fouet ardent.",  ai: "joueur",   faces: "left",
      en: { name: "Enchantress", blurb: "Hair of flame, whip of fire." } },
    { key: "gobelin",       name: "Gobelin",       blurb: "Petit, vert, deux dagues.",          ai: "agressif", faces: "right",
      en: { name: "Goblin",      blurb: "Small, green, two daggers." } },
    { key: "samourai",      name: "Samouraï",      blurb: "Chapeau de paille, katana au dos.",  ai: "neutre",   faces: "right",
      en: { name: "Samurai",     blurb: "Straw hat, katana across the back." } },
  ];

  /* ---------------------------------------------------------------------------
   * 6. QUI VOIT LE BARILLET DE QUI
   * ---------------------------------------------------------------------------
   * Deux questions distinctes, et il ne faut pas les confondre :
   *   - le JOUEUR voit-il les balles adverses ?
   *   - l'IA voit-elle celles du joueur ?
   *
   * La réponse est presque toujours la même des deux côtés : quand on cache
   * quelque chose au joueur, on le cache aussi à la machine, sans quoi la
   * difficulté ne viendrait pas du jeu mais d'un avantage déguisé.
   *
   * Une exception, assumée : le BLITZ EXTRÊME. Là, l'IA voit et pas toi. C'est
   * le seul endroit du jeu où elle joue avec un avantage, et c'est le sens même
   * de ce mode — deux secondes pour décider, à l'aveugle, contre quelqu'un qui
   * sait. Il est fait pour être injuste.
   *
   * Ces deux fonctions vivent ICI, avec les autres règles, plutôt que dans
   * l'interface : c'est une règle du jeu, pas une question d'affichage. Elle
   * doit se lire d'un seul endroit.
   * ------------------------------------------------------------------------ */

  /**
   * Le joueur voit-il le barillet adverse ?
   * @param {string} mode        clé de mode
   * @param {string} difficulty  clé de difficulté
   * @param {boolean} [online]   duel entre deux joueurs
   */
  function bulletsHidden(mode, difficulty, online) {
    // En ligne, TOUJOURS caché, des deux côtés : c'est ce qui prépare le classé.
    if (online) return true;

    const m = MODES.find((x) => x.key === mode);
    const d = DIFFICULTIES.find((x) => x.key === difficulty);
    if (m && m.hidesBullets) return true;      // mode Aveugle
    if (d && d.hidesBullets) return true;      // adversaire Extrême

    /* Le blitz cache aussi le barillet dès la difficulté « difficile » : à
     * trois secondes par coup, compter de tête devient la vraie épreuve. */
    return mode === "blitz" && (difficulty === "difficile" || difficulty === "extreme");
  }

  /**
   * L'IA est-elle privée du barillet du joueur ?
   * Vrai partout où le joueur est lui-même privé — SAUF en blitz extrême, où
   * l'avantage lui est laissé volontairement. Voir le commentaire ci-dessus.
   */
  function aiIsBlind(mode, difficulty, online) {
    if (!bulletsHidden(mode, difficulty, online)) return false;
    if (mode === "blitz" && difficulty === "extreme") return false;
    return true;
  }

  DUELMINDS.bulletsHidden = bulletsHidden;
  DUELMINDS.aiIsBlind = aiIsBlind;

  DUELMINDS.RULES = RULES;
  DUELMINDS.CHARACTERS = CHARACTERS;
  DUELMINDS.ACTIONS = ACTIONS;
  DUELMINDS.ACTION_LABEL = ACTION_LABEL;
  DUELMINDS.ACTION_LABEL_EN = ACTION_LABEL_EN;
  DUELMINDS.actionLabel = actionLabel;
  DUELMINDS.DIFFICULTIES = DIFFICULTIES;
  DUELMINDS.MODES = MODES;
  DUELMINDS.VERSION = "web-1.0";
})(typeof globalThis !== "undefined" ? globalThis : window);
