/* =============================================================================
 * DUELMINDS — VÉRIFICATIONS AVANT LIVRAISON
 * =============================================================================
 *
 * À QUOI ÇA SERT
 * Attraper les erreurs qu'un navigateur ne signalerait qu'au moment du clic :
 * un `id` renommé dans le HTML mais pas dans le JS, un bouton pointant vers
 * une action inexistante, une faute de frappe dans un sprite.
 *
 * Ce sont exactement les pannes silencieuses d'un projet sans compilation.
 *
 * UTILISATION
 *     node tools/check.mjs
 *
 * Sort en code 1 si quelque chose ne va pas.
 * ========================================================================== */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SRC = join(ROOT, "src");

const SCRIPTS = ["i18n.js", "rules.js", "combat.js", "ai.js", "match.js", "sprites.js", "scene.js",
                 "audio.js", "stats.js", "progress.js", "telemetry.js", "net.js", "leaderboard.js", "pvp.js",
                 "ui.js", "main.js"];

const problems = [];
const ok = [];
const report = (condition, message) => (condition ? ok : problems).push(message);

/* --- 1. Chaque fichier est-il du JavaScript valide ? --- */
const sources = {};
for (const file of SCRIPTS) {
  const code = readFileSync(join(SRC, file), "utf8");
  sources[file] = code;
  try {
    new Function(code); // compile sans exécuter : suffisant pour la syntaxe
    ok.push("syntaxe correcte — src/" + file);
  } catch (e) {
    problems.push("SYNTAXE — src/" + file + " : " + e.message);
  }
}

const html = readFileSync(join(ROOT, "index.html"), "utf8");

/* --- 2. Tous les `id` cherchés par l'interface existent-ils ? ---
 * C'est la panne la plus courante : getElementById renvoie null et le jeu
 * casse au premier clic, sans message clair. */
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const wantedIds = new Set([...sources["ui.js"].matchAll(/\$\("([^"]+)"\)/g)].map((m) => m[1]));
const missingIds = [...wantedIds].filter((id) => !htmlIds.has(id));
report(missingIds.length === 0,
  missingIds.length === 0
    ? `les ${wantedIds.size} identifiants utilisés par ui.js existent dans index.html`
    : "IDENTIFIANTS ABSENTS du HTML : " + missingIds.join(", "));

/* --- 3. Les actions des boutons correspondent-elles au moteur ? --- */
for (const file of ["i18n.js", "rules.js", "combat.js", "ai.js", "match.js"]) new Function(sources[file])();
const D = globalThis.DUELMINDS;

const buttonActions = [...html.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]);
const unknown = buttonActions.filter((a) => !D.ACTIONS.includes(a));
report(unknown.length === 0,
  unknown.length === 0
    ? `les ${buttonActions.length} boutons d'action pointent vers des actions connues`
    : "ACTIONS INCONNUES dans le HTML : " + unknown.join(", "));

const noButton = D.ACTIONS.filter((a) => !buttonActions.includes(a));
report(noButton.length === 0,
  noButton.length === 0 ? "chaque action du moteur a son bouton"
                        : "ACTIONS SANS BOUTON : " + noButton.join(", "));

/* --- 4. Les grilles de sprites sont-elles bien formées ? ---
 * Le rendu tolère les lignes trop courtes, mais une ligne TROP LONGUE ou une
 * lettre absente de la palette sont des fautes de frappe à corriger. */
new Function(sources["sprites.js"])();
const { ART, PALETTES, GRID } = globalThis.DUELMINDS.sprites;
const knownLetters = new Set(Object.keys(PALETTES.player));

for (const [name, grid] of Object.entries(ART)) {
  report(grid.length === GRID,
    grid.length === GRID ? `sprite ${name} : ${GRID} lignes`
                         : `SPRITE ${name} : ${grid.length} lignes au lieu de ${GRID}`);

  const tooLong = grid.filter((row) => row.length > GRID).length;
  report(tooLong === 0,
    tooLong === 0 ? `sprite ${name} : aucune ligne trop longue`
                  : `SPRITE ${name} : ${tooLong} ligne(s) dépassent ${GRID} caractères`);

  const strays = new Set();
  for (const row of grid) {
    for (const ch of row) {
      if (ch === "." || ch === " ") continue;
      if (!knownLetters.has(ch)) strays.add(ch + " (U+" + ch.codePointAt(0).toString(16).toUpperCase() + ")");
    }
  }
  report(strays.size === 0,
    strays.size === 0 ? `sprite ${name} : toutes les lettres sont dans la palette`
                      : `SPRITE ${name} : lettres inconnues — ${[...strays].join(" ")}`);
}

/* Les deux palettes doivent définir les mêmes lettres, sinon un duelliste
 * afficherait du magenta là où l'autre est correct. */
const botLetters = new Set(Object.keys(PALETTES.bot));
const mismatch = [...knownLetters].filter((l) => !botLetters.has(l));
report(mismatch.length === 0,
  mismatch.length === 0 ? "les deux palettes définissent les mêmes lettres"
                        : "PALETTES DÉSACCORDÉES : " + mismatch.join(", ") + " manquent côté adversaire");

/* --- 5. Le HTML charge-t-il tous les scripts, dans le bon ordre ? --- */
const loaded = [...html.matchAll(/<script src="src\/([^"]+)"><\/script>/g)].map((m) => m[1]);
report(loaded.join(",") === SCRIPTS.join(","),
  loaded.join(",") === SCRIPTS.join(",")
    ? "index.html charge les " + SCRIPTS.length + " modules dans l'ordre attendu"
    : "ORDRE DES SCRIPTS inattendu : " + loaded.join(", "));

/* --- 6. Une partie complète se joue-t-elle sans erreur ? ---
 * On rejoue des sessions entières avec l'IA des deux côtés : c'est le meilleur
 * test du moteur sans navigateur. */
try {
  let sessions = 0, turns = 0, duels = 0;
  const difficulties = D.DIFFICULTIES.map((d) => d.key);

  for (const mode of ["duel", "arcade"]) {
    for (const difficulty of difficulties) {
      for (let i = 0; i < 60; i++) {
        const session = D.match.createSession(mode, difficulty);
        D.match.startManche(session);

        let guard = 0;
        while (!session.over && guard++ < 3000) {
          // Le « joueur » est simulé par une IA facile.
          const options = D.combat.legalActions(session.player);
          const action = options[Math.floor(Math.random() * options.length)];
          const result = D.match.playTurn(session, action);
          turns++;
          if (result.duelOver) duels++;
          if (result.mancheOver && !result.sessionOver) {
            if (result.duelOver) D.match.startNextDuel(session);
            else D.match.startManche(session);
          }
        }
        if (!session.over) throw new Error("une session ne s'est jamais terminée (" + mode + "/" + difficulty + ")");
        sessions++;
      }
    }
  }
  ok.push(`${sessions} sessions complètes jouées (${duels} duels, ${turns} tours) sans erreur`);
} catch (e) {
  problems.push("MOTEUR — " + e.message);
}

/* -----------------------------------------------------------------------------
 * LA TRADUCTION EST-ELLE COMPLÈTE ?
 * -----------------------------------------------------------------------------
 * Trois trous possibles, invisibles en jeu si on ne les cherche pas :
 *   1. une clé `t("…")` que le dictionnaire ne connaît pas — l'écran affiche
 *      alors la clé brute ;
 *   2. une entrée du dictionnaire sans version anglaise — l'anglophone lit du
 *      français sans comprendre pourquoi ;
 *   3. une donnée de jeu (mode, difficulté, personnage) sans bloc `en`.
 * -------------------------------------------------------------------------- */
try {
  const i18n = globalThis.DUELMINDS.i18n;

  // 1. Clés appelées mais absentes du dictionnaire.
  const used = new Set();
  for (const file of ["ui.js", "stats.js", "combat.js", "match.js"]) {
    for (const m of sources[file].matchAll(/\bt\(\s*"([^"]+)"/g)) used.add(m[1]);
  }
  const unknown = [...used].filter((key) => !i18n.TEXT[key]);
  report(unknown.length === 0,
    unknown.length === 0
      ? used.size + " clés de traduction utilisées, toutes connues du dictionnaire"
      : "CLÉS DE TRADUCTION INCONNUES : " + unknown.join(", "));

  // 2. Entrées sans anglais.
  const untranslated = Object.keys(i18n.TEXT).filter((key) => !i18n.TEXT[key].en);
  report(untranslated.length === 0,
    untranslated.length === 0
      ? "les " + Object.keys(i18n.TEXT).length + " entrées du dictionnaire ont leur version anglaise"
      : "ENTRÉES SANS ANGLAIS : " + untranslated.join(", "));

  // 3. Données de jeu sans bloc `en`.
  const D = globalThis.DUELMINDS;
  const missing = [];
  for (const mode of D.MODES) if (!mode.en) missing.push("mode " + mode.key);
  for (const d of D.DIFFICULTIES) if (!d.en) missing.push("difficulté " + d.key);
  for (const c of D.CHARACTERS) if (!c.en) missing.push("personnage " + c.key);
  for (const p of D.ai.PERSONALITIES) if (!p.en) missing.push("tempérament " + p.key);
  report(missing.length === 0,
    missing.length === 0
      ? "modes, difficultés, personnages et tempéraments sont tous traduits"
      : "DONNÉES SANS TRADUCTION : " + missing.join(", "));

  // 4. Textes du HTML sans version anglaise.
  const plain = [...html.matchAll(/<(h2|h3)(?![^>]*data-en)[^>]*>([^<]{3,})</g)]
    .map((m) => m[2].trim());
  report(plain.length === 0,
    plain.length === 0
      ? "les titres du HTML portent tous leur data-en"
      : "TITRES HTML SANS ANGLAIS : " + plain.join(" | "));
} catch (e) {
  problems.push("TRADUCTION — " + e.message);
}

/* -----------------------------------------------------------------------------
 * LA MISE EN PAGE DE L'ARÈNE TIENT-ELLE ?
 * -----------------------------------------------------------------------------
 * Une régression déjà arrivée, et invisible tant qu'on n'ouvre pas le jeu : une
 * règle balayante sur les enfants de l'arène a remis `position: relative` sur
 * des éléments qui doivent rester `absolute`. Les deux duellistes se sont
 * retrouvés EMPILÉS au lieu de se faire face, et le second débordait.
 *
 * Aucun test JavaScript ne peut l'attraper — c'est du CSS pur — mais une
 * lecture du fichier, si.
 * -------------------------------------------------------------------------- */
try {
  const css = readFileSync(join(ROOT, "styles", "main.css"), "utf8");

  // 1. Les pièces de l'arène se placent librement : elles DOIVENT être absolues.
  //    Recherche littérale plutôt qu'expression régulière : la règle cherchée
  //    est toujours écrite « .nom { … } », et un motif construit par
  //    concaténation s'était déjà trompé d'un niveau d'échappement.
  const declarationOf = (name) => {
    const at = css.indexOf("." + name + " {");
    if (at === -1) return null;
    const close = css.indexOf("}", at);
    return close === -1 ? null : css.slice(at, close);
  };

  const mustBeAbsolute = ["fighter", "nameplate", "manche-badge", "reveal", "timer",
                          "backdrop", "effects"];
  const notAbsolute = mustBeAbsolute.filter((name) => {
    const body = declarationOf(name);
    return !body || body.indexOf("position: absolute") === -1;
  });
  report(notAbsolute.length === 0,
    notAbsolute.length === 0
      ? "les " + mustBeAbsolute.length + " pièces de l'arène sont bien en position absolue"
      : "MISE EN PAGE — ces pièces ne sont plus absolues : " + notAbsolute.join(", "));

  // 2. Aucune règle balayante ne doit redéfinir leur position.
  const sweeping = [...css.matchAll(/\.arena\s*>\s*\*[^{]*\{([^}]*)\}/g)]
    .filter((m) => /position\s*:/.test(m[1]));
  report(sweeping.length === 0,
    sweeping.length === 0
      ? "aucune règle balayante ne redéfinit la position des enfants de l'arène"
      : "MISE EN PAGE — une règle « .arena > * » impose une position : elle " +
        "remettrait les duellistes dans le flux, empilés au lieu de se faire face");
} catch (e) {
  problems.push("MISE EN PAGE — " + e.message);
}

/* --- Résultat --- */
console.log("\nVérifications DuelMinds\n" + "-".repeat(62));
for (const line of ok) console.log("  ok   " + line);
for (const line of problems) console.log("  FAUX " + line);
console.log("-".repeat(62));

if (problems.length) {
  console.log(problems.length + " problème(s) à corriger.\n");
  process.exit(1);
}
console.log("Tout est conforme.\n");
