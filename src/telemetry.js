/* =============================================================================
 * DUELMINDS — REMONTÉE DES PARTIES (optionnelle, désactivée par défaut)
 * =============================================================================
 *
 * LE PROBLÈME QUE ÇA RÉSOUT
 * `stats.js` compte les parties dans le navigateur de chaque joueur. Parfait
 * pour qu'un testeur voie ses propres chiffres, mais ça ne remonte nulle part.
 * Ce fichier envoie un résumé À LA FIN DE CHAQUE PARTIE, pour que tu récupères
 * les données de tous tes testeurs au même endroit.
 *
 * POURQUOI C'EST DÉSACTIVÉ AU DÉPART
 * Il faut une adresse qui reçoive les données. GitHub Pages ne sait QUE servir
 * des fichiers : il n'exécute rien et ne stocke rien. Il faut donc un point de
 * collecte extérieur — voir tools/google-apps-script.gs.
 *
 * CE QUI EST ENVOYÉ
 *   - le MODE joué (duel ou arcade) et la DIFFICULTÉ
 *   - le résultat, et pour l'arcade la longueur de la série
 *   - le nombre de duels, manches, tours, clashs et super tirs
 *   - la répartition des actions (charger / tirer / protéger)
 *   - un identifiant ALÉATOIRE, tiré au sort au premier lancement, qui sert
 *     uniquement à distinguer deux testeurs l'un de l'autre
 *
 * Aucun nom, aucune adresse, aucune position. Quand la remontée est active, la
 * page l'annonce : on ne collecte pas de données sans le dire.
 *
 * DÉPENDANCES : rules.js
 * ========================================================================== */

(function (root) {
  "use strict";

  const DUELMINDS = (root.DUELMINDS = root.DUELMINDS || {});

  /* ---------------------------------------------------------------------------
   * ▼▼▼ LA SEULE LIGNE À MODIFIER ▼▼▼
   * Colle ici l'adresse de ton application web Google Apps Script.
   * Tant qu'elle est vide, rien n'est envoyé et la page n'annonce rien.
   *
   * Cette adresse est publique par nature (elle figure dans le code de la
   * page). Ce n'est pas un secret : elle ne permet QUE d'ajouter une ligne,
   * jamais de lire la feuille.
   * ------------------------------------------------------------------------ */
  const ENDPOINT = "";

  const TESTER_KEY = "duelminds.tester.v1";

  /** Identifiant de testeur : un nombre au hasard, généré une fois et gardé. */
  function testerId() {
    try {
      let id = root.localStorage.getItem(TESTER_KEY);
      if (!id) {
        id = Math.random().toString(36).slice(2, 10);
        root.localStorage.setItem(TESTER_KEY, id);
      }
      return id;
    } catch (e) {
      return "anonyme"; // navigation privée : on n'insiste pas
    }
  }

  function isEnabled() {
    return typeof ENDPOINT === "string" && ENDPOINT.length > 0;
  }

  /**
   * Envoie le résumé d'une partie terminée.
   *
   * `sendBeacon` est privilégié : le navigateur se charge de l'envoi même si
   * le joueur ferme l'onglet dans la seconde. En repli, un `fetch` en mode
   * "no-cors" — on ne lit pas la réponse, mais les données arrivent.
   *
   * Aucune erreur ne remonte : une collecte qui échoue ne doit jamais gêner
   * une partie.
   */
  function sendSession(payload) {
    if (!isEnabled()) return;

    const body = JSON.stringify(Object.assign({
      tester: testerId(),
      date: new Date().toISOString(),
      version: DUELMINDS.VERSION || "web",
    }, payload));

    try {
      if (root.navigator && root.navigator.sendBeacon) {
        const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
        if (root.navigator.sendBeacon(ENDPOINT, blob)) return;
      }
      fetch(ENDPOINT, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: body,
      }).catch(function () { /* sans importance */ });
    } catch (e) {
      /* la remontée est toujours facultative */
    }
  }

  DUELMINDS.telemetry = { isEnabled, sendSession, testerId };
})(typeof globalThis !== "undefined" ? globalThis : window);
