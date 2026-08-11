/* =============================================================================
 * DUELMINDS — LA PROGRESSION TIENT-ELLE ?
 * =============================================================================
 *
 * TROIS QUESTIONS, TROIS RÉPONSES CHIFFRÉES
 *
 *   1. LES NIVEAUX SONT-ILS RAPIDES ?
 *      Le barème est censé récompenser tout de suite. On compte combien de
 *      duels séparent chaque niveau, à chaque difficulté. Si le niveau 2
 *      demande dix duels, ce n'est pas « rapide ».
 *
 *   2. UN HAUT FAIT EST-IL INDÉBLOQUABLE ?
 *      C'est le vrai danger : une faute de frappe dans un `check` produit un
 *      objectif que personne n'atteindra jamais, et rien ne le signale en jeu.
 *      On joue donc un scénario qui coche TOUT, et on exige que les 24 hauts
 *      faits tombent. Ce test échoue bruyamment si l'un résiste.
 *
 *   3. QUE DÉBLOQUE UN JOUEUR ORDINAIRE ?
 *      Un joueur moyen ne doit ni tout obtenir en dix minutes, ni rester les
 *      mains vides. On simule une centaine de duels d'un joueur correct et on
 *      regarde ce qui tombe.
 *
 *     node tools/verify-progress.mjs
 * ========================================================================== */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/* progress.js écrit dans localStorage. En Node il n'y en a pas : on en fournit
 * un minimal, ce qui teste au passage que le module s'en accommode. */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
for (const file of ["i18n.js", "rules.js", "progress.js"]) {
  new Function(readFileSync(join(SRC, file), "utf8"))();
}
const D = globalThis.DUELMINDS;
const { progress, CHARACTERS, DIFFICULTIES } = D;

const line = (n) => "=".repeat(n);

console.log("\n" + line(74));
console.log("  LA PROGRESSION TIENT-ELLE ?");
console.log(line(74));

/* ---------------------------------------------------------------------------
 * 1. Vitesse des niveaux
 * ------------------------------------------------------------------------ */
console.log("\n1. COMBIEN DE DUELS GAGNÉS POUR CHAQUE NIVEAU ?\n");
console.log("   niveau  titre           " +
  DIFFICULTIES.map((d) => d.label.padStart(11)).join(""));

const duelsTo = {};
for (const difficulty of DIFFICULTIES) {
  let xp = 0, duels = 0;
  duelsTo[difficulty.key] = [];
  for (let level = 2; level <= progress.MAX_LEVEL; level++) {
    const target = progress.LEVELS[level - 1];
    // Un duel gagné hors série, à cette difficulté.
    const perDuel = progress.xpForDuel({ difficulty: difficulty.key, won: true, streak: 1 });
    while (xp < target) { xp += perDuel; duels++; }
    duelsTo[difficulty.key][level] = duels;
  }
}
for (let level = 2; level <= progress.MAX_LEVEL; level++) {
  console.log("   " + String(level).padStart(6) + "  " +
    progress.TITLES[level - 1].padEnd(15) +
    DIFFICULTIES.map((d) => String(duelsTo[d.key][level]).padStart(11)).join(""));
}
const secondLevel = duelsTo.facile[2];
console.log("\n   Le niveau 2 tombe au duel " + secondLevel + " en facile  ->  " +
  (secondLevel <= 3 ? "rapide, comme voulu" : "TROP LENT pour une récompense d'entrée"));

/* ---------------------------------------------------------------------------
 * 2. Un haut fait est-il indébloquable ?
 * ------------------------------------------------------------------------ */
console.log("\n2. TOUS LES HAUTS FAITS SONT-ILS ATTEIGNABLES ?\n");
progress.reset();

/* Scénario qui coche tout : on joue chaque personnage contre chaque adversaire,
 * dans chaque mode, en gagnant proprement, jusqu'aux longues séries. */
const MODES_KEYS = D.MODES.map((m) => m.key);
let played = 0;
for (let round = 0; round < 60; round++) {
  for (const mine of CHARACTERS) {
    for (const foe of CHARACTERS) {
      const mode = MODES_KEYS[played % MODES_KEYS.length];
      /* On alterne les difficultés : un scénario qui ne joue qu'en extrême
       * laisserait « gagner en difficile » indébloquable et ferait croire à un
       * défaut du jeu. Les hauts faits comptés en extrême restent atteints, il
       * y a largement assez de tours. */
      const difficulty = played % 3 === 1 ? "difficile"
                       : played % 3 === 2 ? "facile" : "extreme";
      progress.recordDuel({
        character: mine.key,
        botCharacter: foe.key,
        mode,
        difficulty,
        won: true,
        playerManches: 2,
        botManches: 0,
        streak: (played % 12) + 1,   // atteint 10 en arcade comme en blitz
        turns: 5,                    // duel expéditif
        defends: 0,                  // gagné sans se protéger
        shots: 3,
        clashes: 1,
        blockedShots: 1,
        superShotWins: 1,
        wasBehind: true,
        hiddenBullets: true,
      });
      played++;
    }
  }
}
/* La remontée exige d'avoir été mené : impossible en même temps qu'un 2-0.
 * On joue donc quelques duels serrés à part, sinon le haut fait « Remontée »
 * ne pourrait jamais tomber en même temps que « Sans appel ». */
for (let i = 0; i < 5; i++) {
  progress.recordDuel({
    character: "cowboy", botCharacter: "gobelin", mode: "duel", difficulty: "facile",
    won: true, playerManches: 2, botManches: 1, streak: 0, turns: 12,
    defends: 3, shots: 4, clashes: 0, blockedShots: 2, superShotWins: 0,
    wasBehind: true, hiddenBullets: false,
  });
}

const after = progress.achievements();
const stuck = after.filter((a) => !a.done);
for (const feat of after) {
  console.log("   " + (feat.done ? "acquis " : "BLOQUÉ ") + feat.name.padEnd(24) + feat.hint);
}
console.log("\n   " + (stuck.length === 0
  ? "les " + after.length + " hauts faits sont atteignables"
  : stuck.length + " HAUT(S) FAIT(S) INDÉBLOQUABLE(S) : " + stuck.map((a) => a.id).join(", ")));

/* ---------------------------------------------------------------------------
 * 3. Ce que débloque un joueur ordinaire
 * ------------------------------------------------------------------------ */
console.log("\n3. UN JOUEUR ORDINAIRE, 100 DUELS\n");
progress.reset();

let rng = 12345;
const random = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

let streak = 0;
for (let i = 0; i < 100; i++) {
  const mode = random() < 0.5 ? "arcade" : "duel";
  const difficulty = random() < 0.6 ? "facile" : "difficile";
  const won = random() < 0.55;           // un joueur correct, pas un expert
  streak = won && mode === "arcade" ? streak + 1 : 0;
  progress.recordDuel({
    character: CHARACTERS[Math.floor(random() * 3)].key,   // il tourne peu
    botCharacter: CHARACTERS[Math.floor(random() * CHARACTERS.length)].key,
    mode, difficulty, won,
    playerManches: won ? 2 : random() < 0.5 ? 1 : 0,
    botManches: won ? (random() < 0.5 ? 0 : 1) : 2,
    streak,
    turns: 6 + Math.floor(random() * 14),
    defends: Math.floor(random() * 4),
    shots: 2 + Math.floor(random() * 4),
    clashes: random() < 0.15 ? 1 : 0,
    blockedShots: random() < 0.3 ? 1 : 0,
    superShotWins: random() < 0.1 ? 1 : 0,
    wasBehind: random() < 0.3,
    hiddenBullets: false,
  });
}
const ordinary = progress.summary();
console.log("   hauts faits obtenus : " + ordinary.done + " / " + ordinary.total);
console.log("   niveaux atteints    : " +
  progress.characterProgress().filter((c) => c.duels)
    .map((c) => c.name + " " + c.level).join(" · "));
console.log("\n   " + (ordinary.done > 3 && ordinary.done < ordinary.total
  ? "bon dosage : il en reste à viser"
  : ordinary.done <= 3 ? "TROP AVARE : un joueur régulier repart les mains vides"
                       : "TROP GÉNÉREUX : plus rien à viser après 100 duels"));

console.log("\n" + line(74));
console.log("  Le test 2 est le plus important : il attrape les hauts faits");
console.log("  qu'une faute de frappe rendrait impossibles, ce que le jeu");
console.log("  lui-même ne signalerait jamais.");
console.log(line(74) + "\n");

process.exit(stuck.length === 0 ? 0 : 1);
