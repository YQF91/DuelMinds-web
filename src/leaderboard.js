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
 * COMMENT ON PARLE AU SERVEUR
 * Par net.js, qui règle le problème des appels entre domaines. Le détail est
 * expliqué là-bas ; ici on ne s'occupe que du classement lui-même.
 *
 * TOLÉRANCE AUX PANNES — LE POINT IMPORTANT
 * Ce module ne doit JAMAIS empêcher de jouer. Point de collecte non déployé,
 * hors ligne, réponse illisible, script bloqué : dans tous les cas on renvoie
 * une erreur douce et le jeu continue. Le classement est un bonus, pas une
 * dépendance.
 *
 * DÉPENDANCES : net.js (le transport JSONP, partagé avec pvp.js)
 * ========================================================================== */

(function (root) {
  "use strict";

  const DUELMINDS = (root.DUELMINDS = root.DUELMINDS || {});

  /* Le classement change lentement : on garde la réponse quelques minutes
   * plutôt que de rappeler le serveur à chaque ouverture de l'écran. */
  const CACHE_MS = 3 * 60 * 1000;

  const NAME_KEY = "duelminds.name.v1";
  const MAX_NAME = 16;

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

  function isAvailable() { return DUELMINDS.net.isAvailable(); }

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

    return DUELMINDS.net.call({ mode: mode, difficulty: difficulty || undefined })
      .then(function (payload) {
        if (payload && payload.ok && payload.rows) {
          cache.set(key, { time: Date.now(), rows: payload.rows });
          return { ok: true, rows: payload.rows };
        }
        return {
          ok: false, rows: [],
          reason: (payload && (payload.reason || payload.error)) || "empty",
        };
      });
  }

  /** Oublie ce qui a été mis en cache — après avoir joué, par exemple. */
  function forget() { cache.clear(); }

  DUELMINDS.leaderboard = {
    fetchTop, forget, isAvailable, name, setName, cleanName, MAX_NAME,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
