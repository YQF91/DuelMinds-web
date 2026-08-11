/* =============================================================================
 * DUELMINDS — APPELS AU POINT DE COLLECTE
 * =============================================================================
 *
 * RÔLE DU FICHIER
 * Le seul moyen de PARLER au serveur et d'en lire la réponse. Deux modules s'en
 * servent : le classement (leaderboard.js) et les duels en ligne (pvp.js).
 * Écrit une fois ici plutôt que deux fois là-bas.
 *
 * POURQUOI JSONP ET PAS fetch()
 * Un navigateur refuse de lire une réponse venant d'un autre domaine (CORS), et
 * Google Apps Script redirige les siennes vers googleusercontent.com, ce qui
 * rend le contournement propre impossible en pratique. Une balise <script>, en
 * revanche, n'est pas soumise à cette règle : on demande au serveur d'enrober
 * sa réponse dans un appel de fonction, qu'on récupère au vol.
 *
 * Technique ancienne, mais adaptée ici : la donnée est publique, sans secret,
 * et le serveur ne fait rien de dangereux.
 *
 * CE QUI N'ARRIVE JAMAIS
 * Un appel ne rejette pas. Toute panne — hors ligne, serveur muet, réponse
 * illisible — revient sous la forme `{ ok:false, reason:"…" }`. Un jeu ne doit
 * pas s'arrêter parce qu'un serveur tousse.
 *
 * DÉPENDANCES : telemetry.js (pour l'adresse)
 * ========================================================================== */

(function (root) {
  "use strict";

  const DUELMINDS = (root.DUELMINDS = root.DUELMINDS || {});

  /* Assez long pour un réveil de Google Apps Script — le premier appel après
   * une période d'inactivité est toujours le plus lent — assez court pour ne
   * pas laisser le joueur devant un écran figé. */
  const TIMEOUT_MS = 9000;

  let counter = 0;

  function endpoint() {
    return (DUELMINDS.telemetry && DUELMINDS.telemetry.endpoint &&
            DUELMINDS.telemetry.endpoint()) || "";
  }

  function isAvailable() { return !!endpoint(); }

  /**
   * Un appel au serveur.
   *
   * @param {object} params  paires clé/valeur ajoutées à l'adresse
   * @returns {Promise<object>} la réponse, ou `{ ok:false, reason }`.
   *          Ne rejette JAMAIS.
   *
   * Raisons possibles :
   *   no-endpoint  aucune adresse configurée
   *   timeout      le serveur n'a pas répondu à temps
   *   network      la balise n'a pas pu être chargée
   *   not-jsonp    le serveur a répondu autre chose que du JSONP — presque
   *                toujours : le script Apps Script n'a pas été re-déployé
   */
  function call(params) {
    const url = endpoint();
    if (!url) return Promise.resolve({ ok: false, reason: "no-endpoint" });

    return new Promise(function (resolve) {
      counter += 1;
      const fname = "DUELMINDS_CB_" + counter;
      const script = document.createElement("script");
      let done = false;

      /* Une seule sortie, appelée au plus une fois : sans ça, un serveur lent
       * qui finit par répondre après le délai laisserait derrière lui une
       * fonction globale et une balise orpheline. */
      function finish(result) {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        try { delete root[fname]; } catch (e) { root[fname] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
        resolve(result);
      }

      const timer = window.setTimeout(function () {
        finish({ ok: false, reason: "timeout" });
      }, TIMEOUT_MS);

      root[fname] = function (payload) {
        finish(payload && typeof payload === "object"
          ? payload : { ok: false, reason: "empty" });
      };

      script.onerror = function () { finish({ ok: false, reason: "network" }); };

      /* Le serveur a répondu, mais pas en JSONP : la balise se charge donc sans
       * erreur ET sans appeler notre fonction. C'est le cas le plus fréquent au
       * début — le script Apps Script n'a pas été re-déployé. Sans ce test on
       * attendrait le délai complet pour annoncer « pas de réseau », ce qui est
       * faux et n'aide personne. On laisse un tour d'horloge à la réponse pour
       * s'exécuter avant de conclure. */
      script.onload = function () {
        window.setTimeout(function () {
          finish({ ok: false, reason: "not-jsonp" });
        }, 0);
      };

      const query = ["callback=" + fname];
      for (const key of Object.keys(params || {})) {
        if (params[key] === undefined || params[key] === null) continue;
        query.push(encodeURIComponent(key) + "=" + encodeURIComponent(params[key]));
      }
      script.src = url + (url.indexOf("?") === -1 ? "?" : "&") + query.join("&");
      document.head.appendChild(script);
    });
  }

  DUELMINDS.net = { call, isAvailable, endpoint, TIMEOUT_MS };
})(typeof globalThis !== "undefined" ? globalThis : window);
