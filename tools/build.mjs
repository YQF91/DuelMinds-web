/* =============================================================================
 * DUELMINDS — CONSTRUCTION DU FICHIER UNIQUE
 * =============================================================================
 *
 * À QUOI ÇA SERT
 * Assembler index.html, la feuille de style et les dix modules en UN SEUL
 * fichier, `dist/duelminds.html`.
 *
 * POURQUOI
 * Le projet est découpé pour rester lisible. Mais un fichier unique se partage
 * mieux : il s'ouvre d'un double-clic sans serveur, s'envoie par message, et
 * fonctionne hors ligne — y compris là où les règles de sécurité du navigateur
 * bloqueraient le chargement des fichiers voisins.
 *
 * UTILISATION
 *     node tools/build.mjs
 *
 * ATTENTION : `dist/duelminds.html` est GÉNÉRÉ. Ne le modifie jamais à la
 * main — modifie `src/` puis relance cette commande.
 * ========================================================================== */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const SCRIPTS = ["rules.js", "combat.js", "ai.js", "match.js", "sprites.js",
                 "audio.js", "stats.js", "telemetry.js", "ui.js", "main.js"];

let html = readFileSync(join(ROOT, "index.html"), "utf8");
const css = readFileSync(join(ROOT, "styles", "main.css"), "utf8");

// 1. La feuille de style prend la place de sa balise <link>
html = html.replace(
  /<link rel="stylesheet" href="styles\/main\.css">/,
  "<style>\n" + css + "\n</style>"
);

// 2. Les dix <script src> deviennent un seul bloc de code
const bundle = SCRIPTS.map((file) =>
  "/* ---------- src/" + file + " ---------- */\n" +
  readFileSync(join(ROOT, "src", file), "utf8")
).join("\n");

const firstTag = '<script src="src/' + SCRIPTS[0] + '"></script>';
const lastTag = '<script src="src/' + SCRIPTS[SCRIPTS.length - 1] + '"></script>';
const from = html.indexOf(firstTag);
const to = html.indexOf(lastTag) + lastTag.length;

if (from === -1 || to < from) {
  throw new Error("Les balises <script> attendues sont introuvables dans index.html.");
}

html = html.slice(0, from) + "<script>\n" + bundle + "\n</script>" + html.slice(to);

// 3. Un avertissement en tête, pour qui ouvrirait le fichier généré
html = html.replace("<!DOCTYPE html>",
  "<!DOCTYPE html>\n" +
  "<!--\n" +
  "  FICHIER GÉNÉRÉ — NE PAS MODIFIER À LA MAIN.\n" +
  "  Produit par tools/build.mjs à partir de index.html, styles/ et src/.\n" +
  "  Pour changer quoi que ce soit : modifie les sources, puis relance\n" +
  "      node tools/build.mjs\n" +
  "-->\n");

mkdirSync(join(ROOT, "dist"), { recursive: true });
writeFileSync(join(ROOT, "dist", "duelminds.html"), html, "utf8");

console.log("dist/duelminds.html écrit — " + (html.length / 1024).toFixed(0) +
            " Ko, un seul fichier, aucune dépendance.");
