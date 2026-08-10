/* =============================================================================
 * DUELMINDS — DÉMARRAGE
 * =============================================================================
 *
 * RÔLE DU FICHIER
 * Le point d'entrée, et rien d'autre. Il vérifie que tous les modules sont
 * chargés, puis lance l'interface.
 *
 * Ce fichier doit rester le dernier chargé par index.html.
 *
 * DÉPENDANCES : tous les autres modules
 * ========================================================================== */

(function (root) {
  "use strict";

  const DUELMINDS = root.DUELMINDS;

  /* Un oubli dans l'ordre des <script> d'index.html produirait sinon une
   * erreur obscure au premier clic. Mieux vaut échouer tout de suite, en
   * expliquant ce qui manque. */
  const REQUIRED = ["RULES", "ACTIONS", "DIFFICULTIES", "MODES",
                    "combat", "ai", "match", "sprites", "audio", "stats", "telemetry", "ui"];

  function start() {
    if (!DUELMINDS) {
      throw new Error("DuelMinds : aucun module chargé. Vérifie les <script> d'index.html.");
    }

    const missing = REQUIRED.filter((name) => !DUELMINDS[name]);
    if (missing.length) {
      throw new Error(
        "DuelMinds : module(s) manquant(s) — " + missing.join(", ") +
        ". Vérifie l'ordre des <script> dans index.html."
      );
    }

    DUELMINDS.ui.init();
  }

  // Nos scripts sont classiques, pas différés : on attend que le DOM soit prêt
  // avant de chercher les éléments par leur id.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
