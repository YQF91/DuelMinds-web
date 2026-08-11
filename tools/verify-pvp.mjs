/* =============================================================================
 * DUELMINDS — L'ARBITRE DU DUEL EN LIGNE TIENT-IL ?
 * =============================================================================
 *
 * CE QU'ON VÉRIFIE, ET POURQUOI ÇA COMPTE
 * Dans DuelMinds les deux joueurs choisissent EN MÊME TEMPS, sans voir le coup
 * de l'autre. Si l'un pouvait consulter le coup adverse avant d'envoyer le
 * sien, il gagnerait à tous les coups — et le mode en ligne ne vaudrait rien.
 *
 * C'est le rôle de l'arbitre : garder les deux coups et ne les rendre qu'une
 * fois les DEUX arrivés. Ce test s'assure que cette propriété tient, ainsi que
 * tout ce qui l'entoure : codes, tours, abandons.
 *
 * COMMENT ÇA TOURNE SANS GOOGLE
 * L'arbitre vit dans tools/google-apps-script.gs, mais c'est du JavaScript
 * ordinaire. On lui fournit ici un cache et un verrou simulés, et on le fait
 * jouer une partie complète. Ça évite de découvrir une faute de frappe après un
 * aller-retour de déploiement, qui prend plusieurs minutes.
 *
 *     node tools/verify-pvp.mjs
 *
 * Sort en code 1 si une seule vérification échoue.
 * ========================================================================== */

import { readFileSync } from "node:fs";

const store = new Map();
globalThis.CacheService = { getScriptCache: () => ({
  get: (k) => (store.has(k) ? store.get(k) : null),
  put: (k, v) => store.set(k, v),
})};
globalThis.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
globalThis.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getSheets: () => [{
  getLastRow: () => 0, getLastColumn: () => 0,
  appendRow: () => {}, setFrozenRows: () => {},
  getRange: () => ({ getValues: () => [[]], setValues: () => {} }),
}]})};
globalThis.ContentService = { MimeType: {}, createTextOutput: (t) => ({ t, setMimeType: () => ({ t }) }) };

/* Un module ES ne laisse pas eval() creer des fonctions globales : on demande
   donc explicitement au code de nous les rendre. */
const GS = readFileSync("./tools/google-apps-script.gs", "utf8");
const { pvpRoute } = new Function(GS + ";return { pvpRoute: pvpRoute };")();

const ok = [], ko = [];
const check = (label, cond) => (cond ? ok : ko).push(label);

/* --- Deux joueurs se trouvent --- */
const A = pvpRoute({ pvp: "create", player: "p1", name: "Jude", character: "cowboy" });
check("un code de 4 caracteres est cree", /^[A-Z2-9]{4}$/.test(A.code));
check("le createur est du cote A", A.side === "a");

const B = pvpRoute({ pvp: "join", code: A.code, player: "p2", name: "Lea", character: "gobelin" });
check("le second rejoint du cote B", B.side === "b");
check("chacun voit le personnage d'en face", B.opponent.character === "cowboy");

const refused = pvpRoute({ pvp: "join", code: A.code, player: "p3", name: "Max" });
check("un troisieme est refuse", refused.ok === false && refused.error === "match-full");
check("un code inconnu est refuse", pvpRoute({ pvp: "join", code: "ZZZZ", player: "p9" }).error === "unknown-code");

/* --- LE POINT CRITIQUE : le secret du coup simultane --- */
const afterFirst = pvpRoute({ pvp: "move", code: A.code, player: "p1", turn: 1, action: "shoot" });
check("apres UN seul coup, rien n'est revele", afterFirst.ready === false && afterFirst.moves === null);

const spy = pvpRoute({ pvp: "state", code: A.code, player: "p2" });
check("l'adversaire ne peut pas espionner le coup depose", spy.moves === null && spy.mine === null);
check("mais chacun revoit SON propre coup",
      pvpRoute({ pvp: "state", code: A.code, player: "p1" }).mine === "shoot");

const afterBoth = pvpRoute({ pvp: "move", code: A.code, player: "p2", turn: 1, action: "charge" });
check("les deux coups arrives, tout est revele", afterBoth.ready === true &&
      afterBoth.moves.a === "shoot" && afterBoth.moves.b === "charge");

/* --- On ne rejoue pas un coup deja depose --- */
pvpRoute({ pvp: "move", code: A.code, player: "p1", turn: 1, action: "defend" });
check("un coup deja depose ne se change pas",
      pvpRoute({ pvp: "state", code: A.code, player: "p1" }).moves.a === "shoot");

/* --- Enchainement des tours --- */
const t2 = pvpRoute({ pvp: "move", code: A.code, player: "p1", turn: 2, action: "charge" });
check("le tour 2 s'ouvre quand le tour 1 est complet", t2.turn === 2 && t2.ready === false);

const early = pvpRoute({ pvp: "move", code: A.code, player: "p1", turn: 4, action: "shoot" });
check("on ne peut pas sauter un tour", early.ok === false && early.error === "wrong-turn");

pvpRoute({ pvp: "move", code: A.code, player: "p2", turn: 2, action: "shoot" });
check("le tour 2 se resout normalement",
      pvpRoute({ pvp: "state", code: A.code, player: "p2" }).ready === true);

/* --- Abandon --- */
pvpRoute({ pvp: "leave", code: A.code, player: "p1" });
check("l'abandon est vu par l'autre", pvpRoute({ pvp: "state", code: A.code, player: "p2" }).over === true);

/* --- Ce qui n'est pas du PVP passe son chemin --- */
check("le classement reste accessible", pvpRoute({ pvp: "rien" }) === null);
check("un appel sans pvp passe son chemin", pvpRoute({ mode: "arcade" }) === null);

console.log("\n  ARBITRE PVP — " + (ok.length + ko.length) + " verifications\n");
for (const l of ok) console.log("    ok    " + l);
for (const l of ko) console.log("    ECHEC " + l);
console.log("");
process.exit(ko.length ? 1 : 0);
