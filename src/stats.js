/* =============================================================================
 * DUELMINDS — STATISTIQUES ET RECORDS
 * =============================================================================
 *
 * RÔLE DU FICHIER
 * Compter ce qui se passe pendant les parties et le conserver d'une session à
 * l'autre, pour savoir comment le jeu est réellement joué.
 *
 * DEUX CHOSES DIFFÉRENTES SONT SUIVIES ICI
 *
 *   LES COMPTEURS   cumulés sur toutes les parties, ventilés PAR MODE et PAR
 *                   DIFFICULTÉ. C'est ce qui répond à « le mode arcade est-il
 *                   plus joué que le duel ? », « les gens montent-ils en
 *                   difficulté ? », « à quoi servent les protections ? ».
 *
 *   LES RECORDS     la meilleure série d'arcade par difficulté. C'est le score
 *                   du joueur, ce qu'il a envie de battre et de comparer.
 *
 * OÙ C'EST STOCKÉ
 * Dans le navigateur du joueur (`localStorage`), pas sur un serveur. Les
 * chiffres sont donc PAR APPAREIL. La remontée centralisée, elle, est dans
 * telemetry.js.
 *
 * TOLÉRANCE AUX PANNES
 * En navigation privée, ou si le stockage est refusé, tout continue de
 * fonctionner : les compteurs vivent en mémoire et disparaissent en fermant
 * l'onglet. Le jeu ne doit jamais s'arrêter à cause des statistiques.
 *
 * DÉPENDANCES : rules.js
 * ========================================================================== */

(function (root) {
  "use strict";

  const DUELMINDS = (root.DUELMINDS = root.DUELMINDS || {});
  const { MODES, DIFFICULTIES, ACTIONS } = DUELMINDS;
  const { t, L } = DUELMINDS.i18n;
  const actionLabel = DUELMINDS.actionLabel;

  // Le numéro de version fait partie de la clé : le jour où la forme des
  // données changera, les anciennes seront ignorées plutôt que de faire
  // planter la lecture.
  const STORAGE_KEY = "duelminds.stats.v1";

  /** Compteurs vierges. Sert aussi de référence de forme à la lecture. */
  function emptyStats() {
    const byMode = {};
    for (const mode of MODES) {
      byMode[mode.key] = { sessions: 0, duelsPlayed: 0, duelsWon: 0 };
    }

    const byDifficulty = {};
    for (const difficulty of DIFFICULTIES) {
      byDifficulty[difficulty.key] = {
        sessions: 0, duelsPlayed: 0, duelsWon: 0,
        manchesPlayed: 0, manchesWon: 0,
        bestStreak: 0,   // record d'arcade sur ce niveau
      };
    }

    const byAction = {};
    for (const action of ACTIONS) byAction[action] = 0;

    return {
      turns: 0,
      clashes: 0,
      superShots: 0,
      byMode,
      byDifficulty,
      byAction,
      firstPlayed: null,
      lastPlayed: null,
    };
  }

  let stats = emptyStats();
  let storageWorks = true;

  /* ---------------------------------------------------------------------------
   * Lecture et écriture
   * ------------------------------------------------------------------------ */

  function load() {
    try {
      const raw = root.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);

      // Fusion prudente : on part de compteurs vierges et on ne reprend que ce
      // qui existe encore. Un mode ou une difficulté ajoutés plus tard
      // démarrent proprement à zéro.
      const fresh = emptyStats();
      for (const key of ["turns", "clashes", "superShots", "firstPlayed", "lastPlayed"]) {
        if (saved[key] !== undefined) fresh[key] = saved[key];
      }
      mergeGroup(fresh.byMode, saved.byMode);
      mergeGroup(fresh.byDifficulty, saved.byDifficulty);
      for (const key of Object.keys(fresh.byAction)) {
        if (saved.byAction && typeof saved.byAction[key] === "number") {
          fresh.byAction[key] = saved.byAction[key];
        }
      }
      stats = fresh;
    } catch (e) {
      storageWorks = false;
    }
  }

  function mergeGroup(target, saved) {
    if (!saved) return;
    for (const key of Object.keys(target)) {
      if (saved[key]) Object.assign(target[key], saved[key]);
    }
  }

  function save() {
    if (!storageWorks) return;
    try {
      root.localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
    } catch (e) {
      storageWorks = false;
    }
  }

  /* ---------------------------------------------------------------------------
   * Enregistrement des événements
   * ---------------------------------------------------------------------------
   * L'interface appelle ces fonctions au fil de la partie. Elles ne renvoient
   * rien et ne doivent jamais lever d'erreur.
   * ------------------------------------------------------------------------ */

  function recordSessionStart(mode, difficulty) {
    const now = new Date().toISOString();
    if (!stats.firstPlayed) stats.firstPlayed = now;
    stats.lastPlayed = now;
    if (stats.byMode[mode]) stats.byMode[mode].sessions += 1;
    if (stats.byDifficulty[difficulty]) stats.byDifficulty[difficulty].sessions += 1;
    save();
  }

  function recordTurn(action, turnResult) {
    stats.turns += 1;
    if (stats.byAction[action] !== undefined) stats.byAction[action] += 1;
    if (turnResult.resultA === "clash") stats.clashes += 1;
    if (turnResult.resultA === "super_shot" || turnResult.resultB === "super_shot") {
      stats.superShots += 1;
    }
    save();
  }

  function recordManche(difficulty, playerWon) {
    const d = stats.byDifficulty[difficulty];
    if (d) {
      d.manchesPlayed += 1;
      if (playerWon) d.manchesWon += 1;
    }
    save();
  }

  function recordDuel(mode, difficulty, playerWon) {
    const m = stats.byMode[mode];
    if (m) {
      m.duelsPlayed += 1;
      if (playerWon) m.duelsWon += 1;
    }
    const d = stats.byDifficulty[difficulty];
    if (d) {
      d.duelsPlayed += 1;
      if (playerWon) d.duelsWon += 1;
    }
    save();
  }

  /**
   * Enregistre une série d'arcade terminée.
   * @returns {boolean} vrai s'il s'agit d'un nouveau record sur ce niveau
   */
  function recordStreak(difficulty, streak) {
    const d = stats.byDifficulty[difficulty];
    if (!d) return false;
    const isRecord = streak > d.bestStreak;
    if (isRecord) d.bestStreak = streak;
    save();
    return isRecord;
  }

  function bestStreak(difficulty) {
    const d = stats.byDifficulty[difficulty];
    return d ? d.bestStreak : 0;
  }

  function reset() {
    stats = emptyStats();
    try { root.localStorage.removeItem(STORAGE_KEY); } catch (e) { /* sans importance */ }
  }

  /* ---------------------------------------------------------------------------
   * Lecture
   * ------------------------------------------------------------------------ */

  function get() { return stats; }
  function hasData() { return stats.turns > 0; }
  function isPersistent() { return storageWorks; }

  function percent(part, total) {
    return total ? Math.round((part / total) * 100) : 0;
  }

  /** Résumé en texte brut, prêt à être collé dans un message. */
  function toText() {
    const s = stats;
    const lines = [];
    lines.push(t("text.title"));
    if (s.firstPlayed) {
      lines.push(t("text.period", {
        from: s.firstPlayed.slice(0, 10),
        to: (s.lastPlayed || "").slice(0, 10),
      }));
    }
    lines.push("");
    lines.push(t("text.modes"));
    for (const mode of MODES) {
      const m = s.byMode[mode.key];
      lines.push("  " + L(mode, "label").padEnd(9) + t("text.modeLine", {
        games: m.sessions, duels: m.duelsPlayed,
        percent: percent(m.duelsWon, m.duelsPlayed),
      }));
    }
    lines.push("");
    lines.push(t("text.difficulties"));
    for (const difficulty of DIFFICULTIES) {
      const d = s.byDifficulty[difficulty.key];
      lines.push("  " + L(difficulty, "label").padEnd(10) + t("text.difficultyLine", {
        duels: percent(d.duelsWon, d.duelsPlayed),
        manches: percent(d.manchesWon, d.manchesPlayed),
        record: d.bestStreak,
      }));
    }
    lines.push("");
    lines.push(t("text.actionsHeader", { n: s.turns }));
    for (const action of ACTIONS) {
      lines.push("  " + actionLabel(action).padEnd(10) +
        String(s.byAction[action]).padStart(5) +
        "  (" + percent(s.byAction[action], s.turns) + " %)");
    }
    lines.push("");
    lines.push("  " + t("text.clashes", { n: percent(s.clashes, s.turns) }));
    lines.push("  " + t("text.superShots", { n: s.superShots }));
    if (!storageWorks) {
      lines.push("");
      lines.push(t("text.noStorage"));
    }
    return lines.join("\n");
  }

  load();

  DUELMINDS.stats = {
    recordSessionStart, recordTurn, recordManche, recordDuel, recordStreak,
    bestStreak, reset, get, hasData, isPersistent, percent, toText,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
