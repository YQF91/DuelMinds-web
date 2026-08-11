/* =============================================================================
 * DUELMINDS — CLASSEMENT DES SÉRIES
 * =============================================================================
 *
 * LA QUESTION À LAQUELLE ÇA RÉPOND
 * « On envoie déjà les parties vers Google Sheets ; peut-on faire l'inverse ? »
 * Oui. Le même programme Apps Script qui reçoit les parties sait aussi relire
 * les meilleures séries. GitHub Pages ne peut rien enregistrer, mais rien ne
 * l'empêche d'ALLER CHERCHER des données ailleurs.
 *
 * CE N'EST PAS DU TEMPS RÉEL, ET C'EST VOULU
 * On lit ce qui a déjà été enregistré. Un joueur qui bat le record le verra
 * apparaître à son prochain passage, pas pendant sa partie. Pour comparer des
 * scores entre testeurs, ça suffit largement, et ça évite tout serveur.
 *
 * POURQUOI JSONP PLUTÔT QUE fetch()
 * Un navigateur refuse de lire une réponse venant d'un autre domaine (CORS), et
 * Apps Script redirige ses réponses vers googleusercontent.com, ce qui rend le
 * contournement propre difficile. Une balise <script>, elle, n'est pas soumise
 * à cette règle : on demande donc au serveur d'enrober sa réponse dans un appel
 * de fonction, qu'on récupère au vol. Technique ancienne, mais adaptée ici : la
 * donnée est publique, en lecture seule, et sans aucun secret.
 *
 * TOLÉRANCE AUX PANNES — LE POINT IMPORTANT
 * Ce module ne doit JAMAIS empêcher de jouer. Point de collecte non déployé,
 * hors ligne, réponse illisible, script bloqué : dans tous les cas on renvoie
 * une erreur douce et le jeu continue. Le classement est un bonus, pas une
 * dépendance.
 *
 * DÉPENDANCES : telemetry.js (pour l'adresse du point de collecte)
 * ========================================================================== */

(function (root) {
  "use strict";

  const DUELMINDS = (root.DUELMINDS = root.DUELMINDS || {});

  /* Au-delà, on considère que le point de collecte ne répondra pas. Assez long
   * pour un réveil de Google Apps Script, assez court pour ne pas laisser le
   * joueur devant un écran vide. */
  const TIMEOUT_MS = 8000;

  /* Le classement change lentement : on garde la réponse quelques minutes
   * plutôt que de rappeler le serveur à chaque ouverture de l'écran. */
  const CACHE_MS = 3 * 60 * 1000;

  const NAME_KEY = "duelminds.name.v1";
  const MAX_NAME = 16;

  let counter = 0;
  const cache = new Map();   // "mode|difficulté" -> { time, rows }

  /* ---------------------------------------------------------------------------
   * LE PSEUDONYME
   * ---------------------------------------------------------------------------
   * Sans nom, un classement n'affiche que des identifiants aléatoires et ne
   * donne envie à personne. Il est FACULTATIF, choisi par le joueur, et vit
   * dans son navigateur.
   * ------------------------------------------------------------------------ */

  /** Nettoie un pseudonyme : longueur bornée, pas de chevrons ni de retours. */
  function cleanName(raw) {
    return String(raw || "")
      .replace(/[<>\r\n\t]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_NAME);
  }

  function name() {
    try { return cleanName(root.localStorage.getItem(NAME_KEY)); }
    catch (e) { return ""; }
  }

  function setName(value) {
    const clean = cleanName(value);
    try { root.localStorage.setItem(NAME_KEY, clean); } catch (e) { /* tant pis */ }
    return clean;
  }

  /* ---------------------------------------------------------------------------
   * LA LECTURE
   * ------------------------------------------------------------------------ */

  function endpoint() {
    return (DUELMINDS.telemetry && DUELMINDS.telemetry.endpoint &&
            DUELMINDS.telemetry.endpoint()) || "";
  }

  function isAvailable() { return !!endpoint(); }

  /**
   * Demande le classement d'un mode.
   *
   * @param {string} mode        clé de mode : arcade, blitz, aveugle
   * @param {string} [difficulty] pour ne classer qu'un niveau
   * @returns {Promise<{ok:boolean, rows:Array, reason?:string}>}
   *          Ne rejette JAMAIS : une panne se lit dans `ok`.
   */
  function fetchTop(mode, difficulty) {
    const key = mode + "|" + (difficulty || "");
    const cached = cache.get(key);
    if (cached && Date.now() - cached.time < CACHE_MS) {
      return Promise.resolve({ ok: true, rows: cached.rows, cached: true });
    }

    const url = endpoint();
    if (!url) return Promise.resolve({ ok: false, rows: [], reason: "no-endpoint" });

    return new Promise(function (resolve) {
      counter += 1;
      const fname = "DUELMINDS_LB_" + counter;
      const script = document.createElement("script");
      let done = false;

      /* Un seul chemin de sortie, appelé au plus une fois : sans ça, un
       * serveur lent qui finit par répondre après le délai laisserait une
       * fonction globale et une balise derrière lui. */
      function finish(result) {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        try { delete root[fname]; } catch (e) { root[fname] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
        resolve(result);
      }

      const timer = window.setTimeout(function () {
        finish({ ok: false, rows: [], reason: "timeout" });
      }, TIMEOUT_MS);

      root[fname] = function (payload) {
        if (payload && payload.ok && payload.rows) {
          cache.set(key, { time: Date.now(), rows: payload.rows });
          finish({ ok: true, rows: payload.rows });
        } else {
          finish({ ok: false, rows: [], reason: (payload && payload.error) || "empty" });
        }
      };

      script.onerror = function () {
        finish({ ok: false, rows: [], reason: "network" });
      };

      /* Cas le plus fréquent au début : le point de collecte répond, mais avec
       * l'ancienne version du script — du texte au lieu de JSONP. La balise se
       * charge donc sans erreur ET sans appeler notre fonction. Sans ce test,
       * on attendrait les 8 secondes du délai pour annoncer « pas de réseau »,
       * ce qui est faux et n'aide pas : le vrai remède est de re-déployer.
       * On laisse un tour d'horloge à la réponse pour s'exécuter avant de
       * conclure. */
      script.onload = function () {
        window.setTimeout(function () {
          finish({ ok: false, rows: [], reason: "not-jsonp" });
        }, 0);
      };

      script.src = url +
        (url.indexOf("?") === -1 ? "?" : "&") +
        "mode=" + encodeURIComponent(mode) +
        (difficulty ? "&difficulty=" + encodeURIComponent(difficulty) : "") +
        "&callback=" + fname;
      document.head.appendChild(script);
    });
  }

  /** Oublie ce qui a été mis en cache — après avoir joué, par exemple. */
  function forget() { cache.clear(); }

  DUELMINDS.leaderboard = {
    fetchTop, forget, isAvailable, name, setName, cleanName, MAX_NAME,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
