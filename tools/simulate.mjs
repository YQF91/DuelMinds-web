/* =============================================================================
 * DUELMINDS — SIMULATEUR
 * =============================================================================
 *
 * À QUOI ÇA SERT
 * Rejouer des milliers de duels sans navigateur, pour deux raisons :
 *   - vérifier que le portage depuis Python ne s'est pas cassé quelque part ;
 *   - mesurer la difficulté réelle des trois IA plutôt que de la supposer.
 *
 * Le script charge les VRAIS fichiers du jeu : toute modification de
 * src/rules.js ou src/ai.js est mesurée immédiatement.
 *
 * UTILISATION
 *     node tools/simulate.mjs              2000 duels par niveau
 *     node tools/simulate.mjs 20000        chiffres plus stables
 *
 * CE QUE ÇA NE PROUVE PAS
 * L'adversaire simulé du côté « joueur » est une IA facile, pas un humain.
 * Les chiffres disent la tendance des IA entre elles, pas ta chance à toi.
 * ========================================================================== */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
for (const f of ["rules.js", "combat.js", "ai.js", "match.js"]) {
  new Function(readFileSync(join(SRC, f), "utf8"))();
}
const D = globalThis.DUELMINDS;
const { RULES, DIFFICULTIES, combat, ai } = D;

const RUNS = Number(process.argv[2]) || 2000;

/* ---------------------------------------------------------------------------
 * Un duel complet entre deux IA
 * ---------------------------------------------------------------------------
 * Chacune décide sans voir le coup de l'autre : on calcule les deux choix
 * AVANT de résoudre, sinon la seconde tricherait.
 * ------------------------------------------------------------------------ */
/* Le jeu n'impose AUCUNE limite de tours à une manche : elle dure jusqu'à ce
 * que quelqu'un tombe. Deux adversaires prudents peuvent donc tourner en rond
 * indéfiniment. Face à un humain ça n'arrive pas — il finit par tirer — mais
 * en simulation il faut une borne, sinon le programme ne s'arrête jamais.
 * Les manches qui l'atteignent sont comptées comme ENLISÉES. */
const STALL_LIMIT = 200;

function playDuel(difficultyA, difficultyB) {
  const a = combat.makeDuelist("A", true);
  const b = combat.makeDuelist("B", true);
  const brainA = ai.makeBrain(difficultyA);
  const brainB = ai.makeBrain(difficultyB);

  let manches = 0, turns = 0, clashes = 0, superShots = 0, deaths = 0, stalls = 0;

  while (a.manchesWon < RULES.MANCHES_TO_WIN && b.manchesWon < RULES.MANCHES_TO_WIN) {
    combat.resetForManche(a);
    combat.resetForManche(b);
    ai.resetBrainForManche(brainA);
    ai.resetBrainForManche(brainB);

    let decided = false;
    for (let guard = 0; guard < STALL_LIMIT; guard++) {
      const actionA = ai.chooseAction(brainA, a, b);
      const actionB = ai.chooseAction(brainB, b, a);
      const r = combat.resolveTurn(a, b, actionA, actionB);
      turns++;
      if (r.resultA === "clash") clashes++;
      if (r.resultA === "super_shot" || r.resultB === "super_shot") superShots++;
      if (r.resultA === "death" || r.resultB === "death") deaths++;

      if (r.winner) {
        manches++;
        decided = true;
        if (r.winner === "a") a.manchesWon++; else b.manchesWon++;
        break;
      }
    }

    if (!decided) {
      // Manche enlisée : on l'attribue au hasard pour que le duel avance,
      // et on la compte à part.
      stalls++;
      manches++;
      if (Math.random() < 0.5) a.manchesWon++; else b.manchesWon++;
    }
  }

  return {
    winner: a.manchesWon >= RULES.MANCHES_TO_WIN ? "a" : "b",
    manches, turns, clashes, superShots, deaths, stalls,
  };
}

const KEYS = DIFFICULTIES.map((d) => d.key);
const LABEL = Object.fromEntries(DIFFICULTIES.map((d) => [d.key, d.label.toUpperCase()]));
const pct = (v) => v.toFixed(1).padStart(5) + " %";

console.log("\n" + "=".repeat(70));
console.log("  DUELMINDS — SIMULATION");
console.log("  " + RUNS.toLocaleString("fr-FR") + " duels par confrontation");
console.log("=".repeat(70));

/* ---------------------------------------------------------------------------
 * 1. Matrice des confrontations
 * ------------------------------------------------------------------------ */
console.log("\n1. TAUX DE VICTOIRE (ligne contre colonne)\n");
console.log("".padEnd(12) + KEYS.map((k) => LABEL[k].padStart(12)).join(""));

const stats = {};
for (const a of KEYS) {
  let line = LABEL[a].padEnd(12);
  for (const b of KEYS) {
    let wins = 0, manches = 0, turns = 0, clashes = 0, supers = 0, deaths = 0, stalls = 0;
    for (let i = 0; i < RUNS; i++) {
      const r = playDuel(a, b);
      if (r.winner === "a") wins++;
      manches += r.manches; turns += r.turns;
      clashes += r.clashes; supers += r.superShots; deaths += r.deaths; stalls += r.stalls;
    }
    stats[a + ">" + b] = {
      winRate: (wins / RUNS) * 100,
      manchesPerDuel: manches / RUNS,
      turnsPerManche: turns / manches,
      clashRate: (clashes / turns) * 100,
      superRate: (supers / manches) * 100,
      deathRate: (deaths / manches) * 100,
      stallRate: (stalls / manches) * 100,
    };
    line += pct(stats[a + ">" + b].winRate).padStart(12);
  }
  console.log(line);
}

/* ---------------------------------------------------------------------------
 * 2. La difficulté est-elle croissante ?
 * ---------------------------------------------------------------------------
 * C'est LA vérification qui compte : un joueur qui monte d'un cran doit
 * réellement affronter plus fort. On confronte chaque niveau au niveau facile,
 * qui sert d'étalon.
 * ------------------------------------------------------------------------ */
console.log("\n2. PROGRESSION DE LA DIFFICULTÉ (chacun contre FACILE)\n");
let previous = -1;
let increasing = true;
for (const key of KEYS) {
  const rate = stats[key + ">facile"].winRate;
  if (rate < previous - 1) increasing = false;
  previous = rate;
  console.log("   " + LABEL[key].padEnd(12) + pct(rate) + " de victoires contre FACILE");
}
console.log("\n   => " + (increasing
  ? "La difficulté est bien croissante."
  : "ATTENTION : un niveau censé être plus dur ne l'est pas."));

/* ---------------------------------------------------------------------------
 * 3. Rythme et mécaniques
 * ---------------------------------------------------------------------------
 * Sert à voir si les règles produisent le jeu attendu : des manches courtes,
 * des clashs réguliers, et des super tirs rares mais présents.
 * ------------------------------------------------------------------------ */
console.log("\n3. RYTHME ET MÉCANIQUES\n");
console.log("   " + "confrontation".padEnd(26) + "manches  tours/manche  clashs  super tirs  morts betes   enlisees");
for (const a of KEYS) {
  for (const b of KEYS) {
    if (KEYS.indexOf(b) < KEYS.indexOf(a)) continue;
    const s = stats[a + ">" + b];
    console.log(
      "   " + (LABEL[a] + " vs " + LABEL[b]).padEnd(26) +
      s.manchesPerDuel.toFixed(2).padStart(6) +
      s.turnsPerManche.toFixed(1).padStart(13) +
      pct(s.clashRate).padStart(9) +
      pct(s.superRate).padStart(12) +
      pct(s.deathRate).padStart(13) +
      pct(s.stallRate).padStart(11)
    );
  }
}
console.log("\n   « morts bêtes » = manches perdues en tentant une action impossible.");
console.log("   « super tirs »  = manches où un tir à " + RULES.SUPER_SHOT_BULLETS +
            " balles ou plus a traversé la protection.\n");
console.log("=".repeat(70) + "\n");
