/* =============================================================================
 * DUELMINDS — PROGRESSION PAR PERSONNAGE ET HAUTS FAITS
 * =============================================================================
 *
 * RÔLE DU FICHIER
 * Donner au joueur une raison de revenir, et à toi une lecture de ce qu'il
 * fait vraiment. Deux mécaniques distinctes vivent ici :
 *
 *   LES NIVEAUX     Chaque personnage gagne de l'expérience quand tu joues
 *                   AVEC lui. Volontairement RAPIDE : un niveau se prend en
 *                   deux ou trois duels au début. C'est une récompense de
 *                   présence, pas une barrière.
 *
 *   LES HAUTS FAITS Une liste d'objectifs concrets. Ils servent de tutoriel
 *                   déguisé — « gagne sans jamais te protéger » apprend plus
 *                   qu'un paragraphe d'aide — et de mesure : ce que personne
 *                   ne débloque signale une mécanique que personne ne trouve.
 *
 * CE QUE ÇA NE FAIT PAS
 * Aucun niveau ne donne le moindre avantage en duel. DuelMinds n'a pas de
 * types et n'en aura pas ici : monter le Berserker au niveau 10 ne change ni
 * ses balles, ni ses règles, ni ses chances. C'est un titre, rien d'autre.
 * La règle est simple et doit le rester : ce qui départage deux joueurs, c'est
 * la lecture de l'adversaire, jamais ce qu'ils ont accumulé avant.
 *
 * OÙ C'EST STOCKÉ
 * Dans le navigateur (`localStorage`), sous une clé à part de celle des
 * statistiques. Si le stockage est refusé — navigation privée — tout continue
 * de fonctionner en mémoire : le jeu ne doit jamais s'arrêter pour ça.
 *
 * COMMENT AJOUTER UN HAUT FAIT
 * Une entrée dans ACHIEVEMENTS. `check` reçoit les compteurs cumulés et
 * renvoie vrai quand c'est acquis. N'invente pas de compteur : sers-toi de
 * ceux de `emptyCounters()`, ou ajoute-le là ET dans `recordDuel`.
 *
 * DÉPENDANCES : rules.js
 * ========================================================================== */

(function (root) {
  "use strict";

  const DUELMINDS = (root.DUELMINDS = root.DUELMINDS || {});
  const { CHARACTERS, MODES, DIFFICULTIES } = DUELMINDS;

  const STORAGE_KEY = "duelminds.progress.v1";

  /* ---------------------------------------------------------------------------
   * 1. LES NIVEAUX
   * ---------------------------------------------------------------------------
   * Barème d'expérience. Les valeurs sont volontairement généreuses : l'idée
   * est qu'un joueur qui essaie le jeu dix minutes voie plusieurs montées de
   * niveau, pas qu'il entrevoie une longue grille à remplir.
   * ------------------------------------------------------------------------ */
  const XP = {
    DUEL_PLAYED: 10,   // simplement aller au bout d'un duel
    DUEL_WON: 25,      // le gagner
    STREAK_STEP: 5,    // par duel déjà enchaîné dans la série en cours
    STREAK_CAP: 10,    // au-delà, le bonus de série cesse de grossir
  };

  /* Un duel en extrême rapporte le double d'un duel en facile : monter un
   * personnage en jouant difficile est plus court, ce qui pousse dans le bon
   * sens sans jamais l'imposer. */
  const DIFFICULTY_XP = { facile: 1, difficile: 1.5, extreme: 2 };

  /* Expérience CUMULÉE nécessaire pour atteindre chaque niveau.
   * Une victoire en facile rapporte 35 : le niveau 2 tombe au deuxième duel
   * gagné, le niveau 5 vers le neuvième. En extrême, deux fois plus vite. */
  const LEVELS = [0, 40, 100, 190, 320, 500, 740, 1050, 1440, 1920];

  const TITLES = [
    "Novice", "Recrue", "Duelliste", "Vétéran", "Tireur",
    "Bretteur", "Maître", "Virtuose", "Légende", "Mythe",
  ];
  const TITLES_EN = [
    "Novice", "Recruit", "Duelist", "Veteran", "Gunhand",
    "Blade", "Master", "Virtuoso", "Legend", "Myth",
  ];

  /** Le titre d'un niveau dans la langue courante. Voir i18n.js. */
  function titleFor(level) {
    const english = DUELMINDS.i18n && DUELMINDS.i18n.lang() !== "fr";
    return (english ? TITLES_EN : TITLES)[level - 1];
  }

  const MAX_LEVEL = LEVELS.length;

  /** Niveau atteint avec cette expérience. Toujours entre 1 et MAX_LEVEL. */
  function levelFromXp(xp) {
    let level = 1;
    for (let i = 1; i < LEVELS.length; i++) if (xp >= LEVELS[i]) level = i + 1;
    return level;
  }

  /**
   * De quoi dessiner une barre de progression.
   * Au niveau maximum, la barre est pleine et `next` vaut null.
   */
  function levelInfo(xp) {
    const level = levelFromXp(xp);
    const floor = LEVELS[level - 1];
    const next = level < MAX_LEVEL ? LEVELS[level] : null;
    return {
      level,
      title: titleFor(level),
      xp,
      intoLevel: xp - floor,
      needed: next === null ? 0 : next - floor,
      ratio: next === null ? 1 : (xp - floor) / (next - floor),
      isMax: next === null,
    };
  }

  /** Expérience gagnée sur un duel. Voir XP ci-dessus pour le barème. */
  function xpForDuel(context) {
    const multiplier = DIFFICULTY_XP[context.difficulty] || 1;
    const streakBonus = XP.STREAK_STEP *
      Math.min(XP.STREAK_CAP, Math.max(0, (context.streak || 0) - 1));
    const base = XP.DUEL_PLAYED + (context.won ? XP.DUEL_WON : 0);
    return Math.round(base * multiplier + streakBonus);
  }

  /* ---------------------------------------------------------------------------
   * 2. LES COMPTEURS
   * ---------------------------------------------------------------------------
   * Tout ce sur quoi les hauts faits peuvent s'appuyer. Un seul endroit : si un
   * haut fait a besoin d'autre chose, il faut l'ajouter ici ET l'alimenter dans
   * `recordDuel`, sans quoi il resterait indébloquable en silence.
   * ------------------------------------------------------------------------ */
  function emptyCounters() {
    return {
      duelsPlayed: 0,
      duelsWon: 0,

      modesPlayed: [],       // clés de modes déjà joués
      charactersPlayed: [],  // personnages déjà incarnés
      botsBeaten: [],        // personnages adverses déjà battus

      perfectWins: 0,        // duels gagnés 2-0
      comebacks: 0,          // duels gagnés après avoir été mené
      noDefenceWins: 0,      // duels gagnés sans se protéger une seule fois
      fastWins: 0,           // duels gagnés en 6 tours ou moins
      blockedShots: 0,       // tirs adverses arrêtés par ta protection
      superShotWins: 0,      // manches emportées par un super tir
      clashes: 0,            // balles percutées en vol
      shotsFired: 0,

      winsByDifficulty: {},  // clé de difficulté -> nombre de duels gagnés
      bestStreakByMode: {},  // clé de mode -> plus longue série
      blitzExtremeWins: 0,   // duels gagnés en blitz extrême (2 s, balles cachées)
    };
  }

  /* Les six familles de hauts faits. Rangées ici plutôt que traduites dans
   * chaque entrée : elles se répètent, une seule table évite d'avoir à les
   * retraduire vingt-quatre fois. */
  const GROUPS_EN = {
    "Premiers pas": "First steps",
    "Maîtrise":     "Mastery",
    "Difficulté":   "Difficulty",
    "Séries":       "Streaks",
    "Progression":  "Progression",
    "Adversaires":  "Opponents",
  };

  function groupName(group) {
    const english = DUELMINDS.i18n && DUELMINDS.i18n.lang() !== "fr";
    return english ? (GROUPS_EN[group] || group) : group;
  }

  /* ---------------------------------------------------------------------------
   * 3. LES HAUTS FAITS
   * ---------------------------------------------------------------------------
   * `hint` est affiché tant que ce n'est pas débloqué : il doit dire quoi faire,
   * pas seulement ce que c'est. Un objectif qu'on ne comprend pas ne motive
   * personne.
   * `goal` et `progress`, quand ils sont donnés, permettent d'afficher une
   * jauge « 12 / 25 » plutôt qu'un simple oui/non.
   * ------------------------------------------------------------------------ */
  const ACHIEVEMENTS = [
    /* --- Premiers pas --- */
    { id: "premier-duel", group: "Premiers pas", name: "Sur le pré",
      hint: "Jouer un duel jusqu'au bout.",
      en: { name: "First Steps",
            hint: "Play a duel through to the end." },
      check: (c) => c.duelsPlayed >= 1 },

    { id: "premiere-victoire", group: "Premiers pas", name: "Premier sang",
      hint: "Remporter un duel.",
      en: { name: "First Blood",
            hint: "Win a duel." },
      check: (c) => c.duelsWon >= 1 },

    { id: "tous-modes", group: "Premiers pas", name: "Touche-à-tout",
      hint: "Essayer les quatre modes de jeu.",
      en: { name: "Jack of All",
            hint: "Try all four game modes." },
      goal: () => MODES.length, progress: (c) => c.modesPlayed.length,
      check: (c) => c.modesPlayed.length >= MODES.length },

    { id: "tous-personnages", group: "Premiers pas", name: "Garde-robe",
      hint: "Jouer une fois chaque personnage.",
      en: { name: "Full Wardrobe",
            hint: "Play every character once." },
      goal: () => CHARACTERS.length, progress: (c) => c.charactersPlayed.length,
      check: (c) => c.charactersPlayed.length >= CHARACTERS.length },

    /* --- Maîtrise --- */
    { id: "sans-appel", group: "Maîtrise", name: "Sans appel",
      hint: "Gagner un duel deux manches à zéro.",
      en: { name: "Flawless",
            hint: "Win a duel two rounds to nil." },
      check: (c) => c.perfectWins >= 1 },

    { id: "remontee", group: "Maîtrise", name: "Remontée",
      hint: "Gagner un duel après avoir été mené.",
      en: { name: "Comeback",
            hint: "Win a duel after falling behind." },
      check: (c) => c.comebacks >= 1 },

    { id: "sang-froid", group: "Maîtrise", name: "Sang-froid",
      hint: "Gagner un duel sans te protéger une seule fois.",
      en: { name: "Cold Blood",
            hint: "Win a duel without guarding once." },
      check: (c) => c.noDefenceWins >= 1 },

    { id: "expeditif", group: "Maîtrise", name: "Expéditif",
      hint: "Gagner un duel en six tours ou moins.",
      en: { name: "Swift",
            hint: "Win a duel in six turns or fewer." },
      check: (c) => c.fastWins >= 1 },

    { id: "mur", group: "Maîtrise", name: "Mur",
      hint: "Arrêter 25 tirs adverses avec ta protection.",
      en: { name: "Wall",
            hint: "Stop 25 enemy shots with your guard." },
      goal: () => 25, progress: (c) => c.blockedShots,
      check: (c) => c.blockedShots >= 25 },

    { id: "perce-muraille", group: "Maîtrise", name: "Perce-muraille",
      hint: "Emporter une manche d'un super tir, à travers la protection.",
      en: { name: "Wallbreaker",
            hint: "Take a round with a super shot, straight through the guard." },
      check: (c) => c.superShotWins >= 1 },

    { id: "etincelles", group: "Maîtrise", name: "Étincelles",
      hint: "Percuter 20 balles en plein vol.",
      en: { name: "Sparks",
            hint: "Collide 20 bullets in mid-air." },
      goal: () => 20, progress: (c) => c.clashes,
      check: (c) => c.clashes >= 20 },

    /* --- Difficulté --- */
    { id: "victoire-difficile", group: "Difficulté", name: "Elle lit ton jeu",
      hint: "Gagner un duel en Difficile.",
      en: { name: "It Reads You",
            hint: "Win a duel on Hard." },
      check: (c) => (c.winsByDifficulty.difficile || 0) >= 1 },

    { id: "victoire-extreme", group: "Difficulté", name: "Elle cherche la faille",
      hint: "Gagner un duel en Extrême.",
      en: { name: "It Hunts You",
            hint: "Win a duel on Extreme." },
      check: (c) => (c.winsByDifficulty.extreme || 0) >= 1 },

    { id: "extreme-dix", group: "Difficulté", name: "Habitué de l'Extrême",
      hint: "Gagner dix duels en Extrême.",
      en: { name: "Extreme Regular",
            hint: "Win ten duels on Extreme." },
      goal: () => 10, progress: (c) => c.winsByDifficulty.extreme || 0,
      check: (c) => (c.winsByDifficulty.extreme || 0) >= 10 },

    /* --- Séries --- */
    { id: "serie-3", group: "Séries", name: "Trois d'affilée",
      hint: "Enchaîner 3 duels gagnés en Arcade.",
      en: { name: "Three in a Row",
            hint: "Chain 3 wins in Arcade." },
      goal: () => 3, progress: (c) => c.bestStreakByMode.arcade || 0,
      check: (c) => (c.bestStreakByMode.arcade || 0) >= 3 },

    { id: "serie-5", group: "Séries", name: "En forme",
      hint: "Enchaîner 5 duels gagnés en Arcade.",
      en: { name: "On Form",
            hint: "Chain 5 wins in Arcade." },
      goal: () => 5, progress: (c) => c.bestStreakByMode.arcade || 0,
      check: (c) => (c.bestStreakByMode.arcade || 0) >= 5 },

    { id: "serie-10", group: "Séries", name: "Intouchable",
      hint: "Enchaîner 10 duels gagnés en Arcade.",
      en: { name: "Untouchable",
            hint: "Chain 10 wins in Arcade." },
      goal: () => 10, progress: (c) => c.bestStreakByMode.arcade || 0,
      check: (c) => (c.bestStreakByMode.arcade || 0) >= 10 },

    { id: "blitz-5", group: "Séries", name: "Réflexes",
      hint: "Enchaîner 5 duels gagnés en Blitz, chrono en main.",
      en: { name: "Reflexes",
            hint: "Chain 5 wins in Blitz, clock running." },
      goal: () => 5, progress: (c) => c.bestStreakByMode.blitz || 0,
      check: (c) => (c.bestStreakByMode.blitz || 0) >= 5 },

    { id: "aveugle-3", group: "Séries", name: "De tête",
      hint: "Enchaîner 3 duels gagnés en Aveugle, sans voir les balles adverses.",
      en: { name: "From Memory",
            hint: "Chain 3 wins in Blind, without seeing enemy bullets." },
      goal: () => 3, progress: (c) => c.bestStreakByMode.aveugle || 0,
      check: (c) => (c.bestStreakByMode.aveugle || 0) >= 3 },

    { id: "blitz-extreme", group: "Séries", name: "Deux secondes",
      hint: "Gagner un duel en Blitz extrême : 2 secondes par choix, balles cachées.",
      en: { name: "Two Seconds",
            hint: "Win a duel in Blitz extreme: 2 seconds per choice, bullets hidden." },
      check: (c) => c.blitzExtremeWins >= 1 },

    /* --- Progression --- */
    { id: "niveau-5", group: "Progression", name: "Tireur confirmé",
      hint: "Amener un personnage au niveau 5.",
      en: { name: "Seasoned",
            hint: "Take a character to level 5." },
      check: (c, p) => bestLevel(p) >= 5 },

    { id: "niveau-max", group: "Progression", name: "Jusqu'au bout",
      hint: "Amener un personnage au niveau " + MAX_LEVEL + ".",
      check: (c, p) => bestLevel(p) >= MAX_LEVEL },

    { id: "tous-niveau-3", group: "Progression", name: "Écurie complète",
      hint: "Amener chaque personnage au niveau 3.",
      en: { name: "Full Stable",
            hint: "Take every character to level 3." },
      en: { name: "All the Way",
            hint: "Take a character to level 10." },
      goal: () => CHARACTERS.length,
      progress: (c, p) => CHARACTERS.filter((ch) => levelFromXp(xpOf(p, ch.key)) >= 3).length,
      check: (c, p) => CHARACTERS.every((ch) => levelFromXp(xpOf(p, ch.key)) >= 3) },

    /* --- Adversaires --- */
    { id: "battre-tous", group: "Adversaires", name: "Tous au tapis",
      hint: "Battre au moins une fois chacun des adversaires possibles.",
      en: { name: "All Comers",
            hint: "Beat each possible opponent at least once." },
      goal: () => CHARACTERS.length, progress: (c) => c.botsBeaten.length,
      check: (c) => c.botsBeaten.length >= CHARACTERS.length },
  ];

  /* ---------------------------------------------------------------------------
   * 4. L'ÉTAT
   * ------------------------------------------------------------------------ */
  function emptyState() {
    return {
      characters: {},   // clé de personnage -> { xp, duels, wins }
      unlocked: {},     // identifiant de haut fait -> date ISO du déblocage
      counters: emptyCounters(),
    };
  }

  let state = emptyState();
  let storageWorks = true;

  function xpOf(st, characterKey) {
    const entry = st.characters[characterKey];
    return entry ? entry.xp : 0;
  }

  function bestLevel(st) {
    let best = 1;
    for (const character of CHARACTERS) {
      const level = levelFromXp(xpOf(st, character.key));
      if (level > best) best = level;
    }
    return best;
  }

  function load() {
    try {
      const raw = root.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      const fresh = emptyState();

      if (saved.characters) {
        for (const key of Object.keys(saved.characters)) {
          const entry = saved.characters[key];
          if (entry && typeof entry.xp === "number") {
            fresh.characters[key] = {
              xp: entry.xp, duels: entry.duels || 0, wins: entry.wins || 0,
            };
          }
        }
      }
      if (saved.unlocked) Object.assign(fresh.unlocked, saved.unlocked);
      if (saved.counters) {
        // Reprise prudente : on garde la forme neuve et on ne recopie que les
        // champs encore connus. Un compteur ajouté plus tard part de zéro
        // plutôt que de rendre la lecture impossible.
        for (const key of Object.keys(fresh.counters)) {
          if (saved.counters[key] !== undefined) fresh.counters[key] = saved.counters[key];
        }
      }
      state = fresh;
    } catch (e) {
      storageWorks = false;
    }
  }

  function save() {
    if (!storageWorks) return;
    try {
      root.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      storageWorks = false;
    }
  }

  /* ---------------------------------------------------------------------------
   * 5. ENREGISTREMENT D'UN DUEL
   * ------------------------------------------------------------------------ */

  function addToSet(list, value) {
    if (value && list.indexOf(value) === -1) list.push(value);
  }

  /**
   * À appeler quand un duel vient de se terminer.
   *
   * @param {object} context
   * @param {string}  context.character      ton personnage
   * @param {string}  context.botCharacter   celui d'en face
   * @param {string}  context.mode
   * @param {string}  context.difficulty
   * @param {boolean} context.won
   * @param {number}  context.playerManches  manches gagnées par toi
   * @param {number}  context.botManches
   * @param {number}  context.streak         série en cours après ce duel
   * @param {number}  context.turns          tours joués dans ce duel
   * @param {number}  context.defends        fois où tu t'es protégé
   * @param {number}  context.blockedShots   tirs adverses arrêtés
   * @param {number}  context.superShotWins  manches prises d'un super tir
   * @param {number}  context.clashes
   * @param {number}  context.shots
   * @param {boolean} context.wasBehind      as-tu été mené au cours du duel
   * @param {boolean} context.hiddenBullets  les balles adverses étaient cachées
   *
   * @returns {{xpGained:number, level:object, levelUp:boolean,
   *            unlocked:Array<object>}}
   *          De quoi féliciter le joueur immédiatement : c'est le moment où la
   *          récompense a le plus d'effet.
   */
  function recordDuel(context) {
    const c = state.counters;

    /* --- expérience du personnage joué --- */
    const key = context.character;
    if (!state.characters[key]) state.characters[key] = { xp: 0, duels: 0, wins: 0 };
    const entry = state.characters[key];
    const levelBefore = levelFromXp(entry.xp);

    const gained = xpForDuel(context);
    entry.xp += gained;
    entry.duels += 1;
    if (context.won) entry.wins += 1;

    const info = levelInfo(entry.xp);

    /* --- compteurs --- */
    c.duelsPlayed += 1;
    addToSet(c.modesPlayed, context.mode);
    addToSet(c.charactersPlayed, context.character);

    c.blockedShots += context.blockedShots || 0;
    c.superShotWins += context.superShotWins || 0;
    c.clashes += context.clashes || 0;
    c.shotsFired += context.shots || 0;

    if (context.won) {
      c.duelsWon += 1;
      addToSet(c.botsBeaten, context.botCharacter);
      c.winsByDifficulty[context.difficulty] =
        (c.winsByDifficulty[context.difficulty] || 0) + 1;

      if (context.botManches === 0) c.perfectWins += 1;
      if (context.wasBehind) c.comebacks += 1;
      if (!context.defends) c.noDefenceWins += 1;
      if (context.turns && context.turns <= 6) c.fastWins += 1;
      if (context.mode === "blitz" && context.difficulty === "extreme") {
        c.blitzExtremeWins += 1;
      }
    }

    const streak = context.streak || 0;
    if (streak > (c.bestStreakByMode[context.mode] || 0)) {
      c.bestStreakByMode[context.mode] = streak;
    }

    const unlocked = checkAchievements();
    save();

    return {
      xpGained: gained,
      level: info,
      levelUp: info.level > levelBefore,
      unlocked,
    };
  }

  /**
   * Passe la liste en revue et débloque ce qui est acquis.
   * @returns {Array<object>} uniquement les hauts faits débloqués À L'INSTANT
   */
  function checkAchievements() {
    const fresh = [];
    for (const achievement of ACHIEVEMENTS) {
      if (state.unlocked[achievement.id]) continue;
      let ok = false;
      try {
        ok = achievement.check(state.counters, state);
      } catch (e) {
        ok = false; // un haut fait cassé ne doit jamais interrompre une partie
      }
      if (ok) {
        state.unlocked[achievement.id] = new Date().toISOString();
        fresh.push(achievement);
      }
    }
    return fresh;
  }

  /* ---------------------------------------------------------------------------
   * 6. LECTURE, POUR L'AFFICHAGE
   * ------------------------------------------------------------------------ */

  /** Les personnages avec leur niveau, du plus avancé au moins joué. */
  function characterProgress() {
    return CHARACTERS.map((character) => {
      const entry = state.characters[character.key] || { xp: 0, duels: 0, wins: 0 };
      const name = DUELMINDS.i18n ? DUELMINDS.i18n.L(character, "name") : character.name;
      return Object.assign({ key: character.key, name: name,
                             duels: entry.duels, wins: entry.wins },
                           levelInfo(entry.xp));
    }).sort((a, b) => b.xp - a.xp);
  }

  /** Tous les hauts faits, débloqués ou non, dans l'ordre d'affichage. */
  function achievements() {
    return ACHIEVEMENTS.map((achievement) => {
      const done = !!state.unlocked[achievement.id];
      const goal = achievement.goal ? achievement.goal() : null;
      let progress = null;
      if (achievement.progress) {
        try { progress = achievement.progress(state.counters, state); }
        catch (e) { progress = null; }
      }
      const tr = (field) => (DUELMINDS.i18n
        ? DUELMINDS.i18n.L(achievement, field) : achievement[field]);
      return {
        id: achievement.id,
        group: groupName(achievement.group),
        name: tr("name"),
        hint: tr("hint"),
        done,
        date: done ? state.unlocked[achievement.id] : null,
        goal,
        progress: progress === null ? null : Math.min(progress, goal === null ? progress : goal),
      };
    });
  }

  function summary() {
    const all = achievements();
    return { done: all.filter((a) => a.done).length, total: all.length };
  }

  function reset() {
    state = emptyState();
    try { root.localStorage.removeItem(STORAGE_KEY); } catch (e) { /* sans importance */ }
  }

  function isPersistent() { return storageWorks; }

  load();

  DUELMINDS.progress = {
    recordDuel, characterProgress, achievements, summary, reset, isPersistent,
    levelInfo, levelFromXp, xpForDuel, titleFor,
    LEVELS, TITLES, TITLES_EN, MAX_LEVEL, XP, DIFFICULTY_XP, ACHIEVEMENTS,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
