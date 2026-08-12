/* =============================================================================
 * DUELMINDS — LE SUPER TIR SE COMPORTE-T-IL COMME ANNONCÉ ?
 * =============================================================================
 *
 * POURQUOI UN OUTIL À PART
 * Le super tir est la seule mécanique du jeu où le barillet ne se vide pas de
 * façon régulière : après une interception, on ne SOUSTRAIT pas une balle, on
 * AFFECTE ce qu'il reste. Une règle qui sort du lot est exactement le genre de
 * chose qu'une modification ultérieure casse sans qu'on s'en aperçoive — et en
 * jeu, ça ne se voit qu'en atteignant quatre balles ET en tombant sur un tir
 * adverse au même tour. Autant dire jamais pendant un test.
 *
 * CE QUI EST VÉRIFIÉ
 *   1. il traverse la protection ET la charge
 *   2. sa seule parade est un tir adverse
 *   3. après interception, le tireur conserve exactement 2 balles
 *   4. l'intercepteur, lui, a dépensé une balle normalement
 *   5. super contre super : les deux retombent à 2
 *   6. un adversaire sans balle face à un super tir est condamné,
 *      quelle que soit son action — conséquence assumée de la règle
 *
 *     node tools/verify-supershot.mjs
 *
 * Sort en code 1 si une seule vérification échoue.
 * ========================================================================== */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
for (const file of ["i18n.js", "rules.js", "combat.js"]) {
  new Function(readFileSync(join(SRC, file), "utf8"))();
}
const D = globalThis.DUELMINDS;
const { RULES, combat } = D;

const ok = [], ko = [];
const check = (label, condition) => (condition ? ok : ko).push(label);

/** Un tour joué entre deux duellistes dont on fixe le barillet. */
function turn(bulletsA, actionA, bulletsB, actionB) {
  const a = combat.makeDuelist("Toi", false);
  const b = combat.makeDuelist("Adversaire", true);
  a.bullets = bulletsA;
  b.bullets = bulletsB;
  const result = combat.resolveTurn(a, b, actionA, actionB);
  return { a, b, result };
}

const SUPER = RULES.SUPER_SHOT_BULLETS;      // 4
const KEPT = RULES.SUPER_SHOT_AFTER_CLASH;   // 2

/* --- 1. Il traverse tout --- */
check("le super tir tue face à Protéger",
      turn(SUPER, "shoot", 3, "defend").result.winner === "a");
check("le super tir tue face à Charger",
      turn(SUPER, "shoot", 3, "charge").result.winner === "a");
check("un tir ORDINAIRE ne passe pas la protection",
      turn(1, "shoot", 3, "defend").result.winner === null);

/* --- 2. Sa seule parade --- */
const parried = turn(SUPER, "shoot", 1, "shoot");
check("un tir adverse au même tour l'annule", parried.result.winner === null);

/* --- 3 et 4. Le barillet après interception --- */
check("le tireur conserve exactement " + KEPT + " balles", parried.a.bullets === KEPT);
check("l'intercepteur a dépensé une balle normalement", parried.b.bullets === 0);

/* --- Le plafond du barillet ---
 * Attention à la nuance, elle est essentielle : charger reste PERMIS barillet
 * plein. C'est le GAIN qui est nul, pas l'action qui est interdite — et une
 * action interdite, elle, tue celui qui la tente. */
check("charger reste PERMIS barillet plein : ce n'est pas une condamnation",
      combat.canDo(Object.assign(combat.makeDuelist("X", false),
                                 { bullets: RULES.MAX_BULLETS }), "charge") === true);

const capped = combat.makeDuelist("X", false);
capped.bullets = RULES.MAX_BULLETS;
const wasted = combat.resolveTurn(capped, combat.makeDuelist("Y", true), "charge", "defend");
check("mais le barillet ne dépasse pas " + RULES.MAX_BULLETS,
      capped.bullets === RULES.MAX_BULLETS);
check("et charger plein ne tue pas — c'est un tour perdu, rien de plus",
      wasted.winner === null);

/* Ce que charger plein rapporte QUAND MÊME : le compteur de défenses
 * enchaînées repart à zéro. C'est la raison pour laquelle on ne l'interdit
 * pas au joueur. */
const camper = combat.makeDuelist("X", false);
camper.bullets = RULES.MAX_BULLETS;
camper.consecutiveDefends = 3;
combat.resolveTurn(camper, combat.makeDuelist("Y", true), "charge", "defend");
check("charger plein remet à zéro les défenses enchaînées — c'est son usage",
      camper.consecutiveDefends === 0);

check("le plafond coïncide avec le seuil du super tir",
      RULES.MAX_BULLETS === RULES.SUPER_SHOT_BULLETS);

/* --- 5. Super contre super --- */
/* Les deux au maximum : c'est le seul cas atteignable en jeu depuis que le
 * barillet plafonne. */
const both = turn(SUPER, "shoot", SUPER, "shoot");
check("super contre super : personne ne tombe", both.result.winner === null);
check("super contre super : les deux retombent à " + KEPT,
      both.a.bullets === KEPT && both.b.bullets === KEPT);

/* --- 6. La conséquence assumée --- */
const doomed = ["charge", "defend"].every(
  (action) => turn(SUPER, "shoot", 0, action).result.winner === "a");
check("sans balle face à un super tir, aucune action ne sauve", doomed);
check("et Tirer lui est bien interdit, ce que l'interface doit montrer",
      combat.canDo(Object.assign(combat.makeDuelist("X", true), { bullets: 0 }),
                   "shoot") === false);

/* --- Le message explique la perte --- */
const explained = parried.result.reason;
check("le verdict annonce l'interception et ce qu'il reste — sinon le joueur " +
      "croit à un défaut : « " + explained + " »",
      explained.indexOf(String(KEPT)) !== -1);

console.log("\n  LE SUPER TIR — " + (ok.length + ko.length) + " vérifications\n");
for (const label of ok) console.log("    ok    " + label);
for (const label of ko) console.log("    ÉCHEC " + label);
console.log("");

process.exit(ko.length ? 1 : 0);
