/* =============================================================================
 * DUELMINDS — L'IA LIT-ELLE VRAIMENT L'HISTORIQUE ?
 * =============================================================================
 *
 * LA QUESTION
 * `ai.js` prétend que les niveaux DIFFICILE et EXTRÊME analysent les coups
 * passés du joueur. Facile à écrire, difficile à croire sur parole. Ce script
 * le met à l'épreuve.
 *
 * LA MÉTHODE
 * On confronte l'IA à des adversaires au comportement CONNU et invariable, puis
 * on regarde si sa réponse change. Une IA qui ignore l'historique répondrait la
 * même chose à tout le monde.
 *
 *     node tools/verify-ai.mjs
 *
 * CE QU'ON DOIT OBSERVER
 *   - contre un joueur qui CHARGE sans arrêt : l'IA doit se protéger beaucoup
 *     (il accumule des balles, il va tirer)
 *   - contre un joueur qui SE PROTÈGE sans arrêt : l'IA doit charger, puisque
 *     attaquer ne sert à rien
 *   - le niveau FACILE, lui, ne doit PAS varier : il joue au hasard
 * ========================================================================== */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
for (const f of ["rules.js", "combat.js", "ai.js"]) {
  new Function(readFileSync(join(SRC, f), "utf8"))();
}
const D = globalThis.DUELMINDS;
const { combat, ai, ACTIONS, ACTION_LABEL } = D;

const ROUNDS = 4000;

/* Adversaires au comportement fixe, pour isoler la réaction de l'IA. */
const BEHAVIOURS = {
  "charge sans arrêt": () => "charge",
  "se protège sans arrêt": () => "defend",
  "tire dès qu'il peut": (self) => (combat.canDo(self, "shoot") ? "shoot" : "charge"),
  "joue au hasard": (self) => {
    const options = combat.legalActions(self);
    return options[Math.floor(Math.random() * options.length)];
  },
};

/**
 * Fait jouer l'IA contre un comportement donné et compte ses actions.
 * On rejoue des manches entières : l'historique doit avoir le temps de se
 * remplir pour peser sur les décisions.
 */
function profile(difficulty, behaviour) {
  const counts = { charge: 0, shoot: 0, defend: 0 };

  for (let round = 0; round < ROUNDS; round++) {
    const bot = combat.makeDuelist("IA", true);
    const human = combat.makeDuelist("Joueur", false);
    const brain = ai.makeBrain(difficulty);

    // Une dizaine de tours : assez pour que l'historique existe.
    for (let turn = 0; turn < 10; turn++) {
      const botAction = ai.chooseAction(brain, bot, human);
      const humanAction = behaviour(human);
      counts[botAction] += 1;
      combat.resolveTurn(human, bot, humanAction, botAction);
      if (human.bullets < 0 || bot.bullets < 0) break;
      // On relance la manche si quelqu'un est tombé, pour continuer à mesurer.
      if (combat.judge(human, bot, humanAction, botAction, "success", "success").winner) {
        combat.resetForManche(human);
        combat.resetForManche(bot);
      }
    }
  }

  const total = counts.charge + counts.shoot + counts.defend;
  return ACTIONS.map((a) => ({ action: a, share: (counts[a] / total) * 100 }));
}

console.log("\n" + "=".repeat(72));
console.log("  L'IA RÉAGIT-ELLE À CE QUE FAIT LE JOUEUR ?");
console.log("  " + ROUNDS.toLocaleString("fr-FR") + " manches par situation");
console.log("=".repeat(72));

const names = Object.keys(BEHAVIOURS);

for (const difficulty of D.DIFFICULTIES) {
  console.log("\n" + difficulty.label.toUpperCase());
  console.log("   " + "en face, un joueur qui...".padEnd(26) +
              ACTIONS.map((a) => ACTION_LABEL[a].padStart(11)).join(""));

  const profiles = [];
  for (const name of names) {
    const p = profile(difficulty.key, BEHAVIOURS[name]);
    profiles.push(p);
    console.log("   " + name.padEnd(26) +
                p.map((x) => (x.share.toFixed(1) + " %").padStart(11)).join(""));
  }

  // Écart maximal observé sur une même action entre deux comportements :
  // c'est la mesure de l'adaptation.
  let spread = 0;
  for (let i = 0; i < ACTIONS.length; i++) {
    const shares = profiles.map((p) => p[i].share);
    spread = Math.max(spread, Math.max(...shares) - Math.min(...shares));
  }

  const adapts = spread > 8;
  console.log("   " + "-".repeat(59));
  console.log("   écart maximal : " + spread.toFixed(1) + " points  ->  " +
    (adapts ? "L'IA S'ADAPTE au joueur"
            : "aucune adaptation notable (attendu au niveau facile)"));
}

console.log("\n" + "=".repeat(72));
console.log("  Lecture : si une ligne diffère nettement des autres, c'est que");
console.log("  l'IA a changé de comportement en fonction du passé du joueur.");
console.log("=".repeat(72) + "\n");
