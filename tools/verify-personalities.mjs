/* =============================================================================
 * DUELMINDS — LES CARACTÈRES SE VALENT-ILS ?
 * =============================================================================
 *
 * LA QUESTION
 * En mode série, chaque adversaire tire un caractère au sort. Ça n'a de sens
 * que s'ils sont de FORCE ÉQUIVALENTE : sinon une série devient une loterie —
 * tomber trois fois sur le caractère faible vaudrait un bon score, et le
 * chiffre ne mesurerait plus rien.
 *
 * LA MÉTHODE
 * On fait jouer chaque caractère contre tous les autres, à difficulté égale, et
 * on regarde son taux de victoire global. Un écart de quelques points est sain
 * — il donne du relief. Un écart de vingt points est un défaut.
 *
 * On vérifie aussi qu'ils se COMPORTENT différemment : des caractères qui se
 * valent mais jouent pareil ne servent à rien.
 *
 *     node tools/verify-personalities.mjs
 * ========================================================================== */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
for (const f of ["rules.js", "combat.js", "ai.js"]) {
  new Function(readFileSync(join(SRC, f), "utf8"))();
}
const D = globalThis.DUELMINDS;
const { RULES, combat, ai, ACTIONS, ACTION_LABEL } = D;

const RUNS = Number(process.argv[2]) || 3000;
const DIFFICULTY = "difficile"; // le niveau où les caractères pèsent le plus

/** Un duel complet entre deux caractères, à difficulté égale. */
function duel(personalityA, personalityB) {
  const a = combat.makeDuelist("A", true);
  const b = combat.makeDuelist("B", true);
  const brainA = ai.makeBrain(DIFFICULTY, false, personalityA);
  const brainB = ai.makeBrain(DIFFICULTY, false, personalityB);

  while (a.manchesWon < RULES.MANCHES_TO_WIN && b.manchesWon < RULES.MANCHES_TO_WIN) {
    combat.resetForManche(a);
    combat.resetForManche(b);
    ai.resetBrainForManche(brainA);
    ai.resetBrainForManche(brainB);

    let decided = false;
    for (let guard = 0; guard < 200; guard++) {
      const r = combat.resolveTurn(a, b,
        ai.chooseAction(brainA, a, b), ai.chooseAction(brainB, b, a));
      if (r.winner) {
        decided = true;
        if (r.winner === "a") a.manchesWon++; else b.manchesWon++;
        break;
      }
    }
    if (!decided) { if (Math.random() < 0.5) a.manchesWon++; else b.manchesWon++; }
  }
  return a.manchesWon >= RULES.MANCHES_TO_WIN ? "a" : "b";
}

/** Répartition des actions d'un caractère face à un adversaire méthodique. */
function behaviour(personality) {
  const counts = { charge: 0, shoot: 0, defend: 0 };
  const neutral = ai.PERSONALITIES[0];

  for (let round = 0; round < RUNS; round++) {
    const self = combat.makeDuelist("IA", true);
    const foe = combat.makeDuelist("Autre", true);
    const brain = ai.makeBrain(DIFFICULTY, false, personality);
    const foeBrain = ai.makeBrain(DIFFICULTY, false, neutral);

    for (let turn = 0; turn < 8; turn++) {
      const action = ai.chooseAction(brain, self, foe);
      counts[action] += 1;
      const r = combat.resolveTurn(self, foe, action, ai.chooseAction(foeBrain, foe, self));
      if (r.winner) { combat.resetForManche(self); combat.resetForManche(foe); }
    }
  }
  const total = counts.charge + counts.shoot + counts.defend;
  return ACTIONS.map((a) => ({ action: a, share: (counts[a] / total) * 100 }));
}

const list = ai.PERSONALITIES;
const pct = (v) => v.toFixed(1).padStart(5) + " %";

console.log("\n" + "=".repeat(74));
console.log("  LES CARACTÈRES SE VALENT-ILS ?");
console.log("  " + RUNS.toLocaleString("fr-FR") + " duels par confrontation · difficulté " + DIFFICULTY);
console.log("=".repeat(74));

/* --- 1. Force --- */
console.log("\n1. TAUX DE VICTOIRE (ligne contre colonne)\n");
console.log("".padEnd(14) + list.map((p) => p.name.padStart(13)).join(""));

const overall = {};
for (const a of list) {
  let line = a.name.padEnd(14);
  let wins = 0, games = 0;
  for (const b of list) {
    let w = 0;
    for (let i = 0; i < RUNS; i++) if (duel(a, b) === "a") w++;
    line += pct((w / RUNS) * 100).padStart(13);
    if (a.key !== b.key) { wins += w; games += RUNS; }
  }
  overall[a.key] = (wins / games) * 100;
  console.log(line);
}

console.log("\n2. FORCE GLOBALE (contre les autres caractères)\n");
const values = Object.values(overall);
const spread = Math.max(...values) - Math.min(...values);
for (const p of list) {
  const gap = overall[p.key] - 50;
  const verdict = Math.abs(gap) < 6 ? "équilibré" : gap > 0 ? "trop fort" : "trop faible";
  console.log("   " + p.name.padEnd(14) + pct(overall[p.key]) + "   " + verdict);
}
console.log("\n   écart maximal : " + spread.toFixed(1) + " points  ->  " +
  (spread < 12 ? "les caractères se valent, une série reste comparable"
               : "ÉCART TROP GRAND : une série devient une loterie"));

/* --- 3. Comportement --- */
console.log("\n3. SE COMPORTENT-ILS VRAIMENT DIFFÉREMMENT ?\n");
console.log("   " + "caractère".padEnd(14) + ACTIONS.map((a) => ACTION_LABEL[a].padStart(11)).join("") + "   ce qu'on doit sentir");

const profiles = [];
for (const p of list) {
  const b = behaviour(p);
  profiles.push(b);
  console.log("   " + p.name.padEnd(14) +
    b.map((x) => pct(x.share).padStart(11)).join("") + "   " + p.tell);
}

let behaviourSpread = 0;
for (let i = 0; i < ACTIONS.length; i++) {
  const shares = profiles.map((p) => p[i].share);
  behaviourSpread = Math.max(behaviourSpread, Math.max(...shares) - Math.min(...shares));
}
console.log("\n   écart de comportement : " + behaviourSpread.toFixed(1) + " points  ->  " +
  (behaviourSpread > 12 ? "bien distincts, on ne peut pas réciter une recette"
                        : "TROP PROCHES : ils ne servent à rien"));

console.log("\n" + "=".repeat(74));
console.log("  L'objectif : une force serrée (colonne 2) ET des comportements");
console.log("  écartés (colonne 3). C'est ce qui rend le score comparable sans");
console.log("  qu'il devienne un exercice de mémoire.");
console.log("=".repeat(74) + "\n");
