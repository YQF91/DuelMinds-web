/* =============================================================================
 * DUELMINDS — DUEL EN LIGNE
 * =============================================================================
 *
 * CE QUE C'EST
 * Deux joueurs, deux téléphones, un code à quatre lettres. Aucun compte, aucune
 * installation : celui qui crée la partie lit son code à l'autre, et le duel
 * commence.
 *
 * -----------------------------------------------------------------------------
 * LE SEUL PROBLÈME DIFFICILE, ET COMMENT IL EST RÉSOLU
 * -----------------------------------------------------------------------------
 * Dans DuelMinds les deux joueurs choisissent EN MÊME TEMPS, sans voir le coup
 * de l'autre. Si les deux navigateurs s'échangeaient directement leurs coups,
 * un joueur au programme modifié pourrait ATTENDRE de voir celui d'en face
 * avant d'envoyer le sien : il gagnerait à tous les coups.
 *
 * Tout passe donc par un ARBITRE — le script Google déjà en place — qui garde
 * les deux coups et ne les rend qu'une fois les DEUX arrivés. Voir la section
 * « ARBITRE DE DUEL EN LIGNE » de tools/google-apps-script.gs.
 *
 * -----------------------------------------------------------------------------
 * CE QUE L'ARBITRE NE FAIT PAS, ET POURQUOI C'EST VOULU
 * -----------------------------------------------------------------------------
 * Il ne connaît AUCUNE règle du jeu. Il retient deux mots et les rend ensemble.
 * Ce sont les deux navigateurs qui résolvent le tour, chacun de son côté, avec
 * `combat.js` — le même fichier que contre l'ordinateur.
 *
 * C'est possible parce que la résolution d'un tour n'a AUCUNE part de hasard :
 * même état de départ plus mêmes coups donne forcément le même résultat. Les
 * deux écrans ne peuvent pas diverger.
 *
 * L'autre raison est plus importante encore : les règles restent à UN SEUL
 * endroit. Les recopier dans l'arbitre créerait une deuxième version à
 * maintenir, et le jour où les deux divergent plus personne ne sait laquelle
 * fait foi.
 *
 * -----------------------------------------------------------------------------
 * CE QU'UN TRICHEUR PEUT ENCORE FAIRE
 * -----------------------------------------------------------------------------
 * Modifier SON propre affichage. Il ne peut pas voir le coup adverse à
 * l'avance, ni imposer un résultat à l'autre, qui recalcule de son côté. C'est
 * la propriété qui compte pour un classement honnête.
 *
 * -----------------------------------------------------------------------------
 * LES LIMITES, DITES FRANCHEMENT
 * -----------------------------------------------------------------------------
 * Chaque échange passe par Google : entre une demi-seconde et deux secondes.
 * Acceptable pour un jeu au tour par tour, impossible pour un jeu d'action.
 * C'est aussi pour ça que le duel en ligne laisse PLUS de temps par tour que le
 * mode Blitz : le réseau mange déjà une partie du délai.
 *
 * DÉPENDANCES : net.js, rules.js
 * ========================================================================== */

(function (root) {
  "use strict";

  const DUELMINDS = (root.DUELMINDS = root.DUELMINDS || {});

  /* Intervalle entre deux demandes de nouvelles. Plus court, on sature le
   * serveur pour rien ; plus long, l'attente devient pénible. */
  const POLL_MS = 1400;

  /* Au-delà, on considère que l'autre est parti. Volontairement généreux : sur
   * un téléphone, changer d'application suspend la page quelques secondes. */
  const GIVE_UP_MS = 90000;

  const ID_KEY = "duelminds.player.v1";

  /** Identifiant de joueur, tiré une fois et conservé. Sert à l'arbitre à
   *  reconnaître qui parle, rien de plus. */
  function playerId() {
    try {
      let id = root.localStorage.getItem(ID_KEY);
      if (!id) {
        id = "p" + Math.random().toString(36).slice(2, 10);
        root.localStorage.setItem(ID_KEY, id);
      }
      return id;
    } catch (e) {
      // Navigation privée : un identifiant de séance suffit.
      return "p" + Math.random().toString(36).slice(2, 10);
    }
  }

  /* ---------------------------------------------------------------------------
   * L'ÉTAT D'UNE PARTIE EN LIGNE
   * ------------------------------------------------------------------------ */
  let match = null;

  function reset() { match = null; }

  function current() { return match; }

  /** Es-tu le joueur « a » ? Détermine de quel côté le moteur te place. */
  function isHost() { return !!match && match.side === "a"; }

  function isActive() { return !!match; }

  /* ---------------------------------------------------------------------------
   * OUVRIR ET REJOINDRE
   * ------------------------------------------------------------------------ */

  function adopt(payload) {
    match = {
      code: payload.code,
      side: payload.side,
      turn: payload.turn || 1,
      opponent: payload.opponent || null,
      over: !!payload.over,
    };
    return match;
  }

  /**
   * Ouvre une partie et renvoie son code.
   * @returns {Promise<{ok:boolean, code?:string, reason?:string}>}
   */
  function create(character) {
    const name = (DUELMINDS.leaderboard && DUELMINDS.leaderboard.name()) || "";
    return DUELMINDS.net.call({
      pvp: "create", player: playerId(), name: name, character: character,
    }).then(function (payload) {
      if (!payload || !payload.ok) return fail(payload);
      adopt(payload);
      return { ok: true, code: payload.code };
    });
  }

  /**
   * Rejoint une partie existante.
   * Le code est normalisé : les joueurs le recopient à la main, ils écriront en
   * minuscules et laisseront des espaces.
   */
  function join(code, character) {
    const name = (DUELMINDS.leaderboard && DUELMINDS.leaderboard.name()) || "";
    const clean = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (clean.length !== 4) return Promise.resolve({ ok: false, reason: "bad-code" });

    return DUELMINDS.net.call({
      pvp: "join", code: clean, player: playerId(), name: name, character: character,
    }).then(function (payload) {
      if (!payload || !payload.ok) return fail(payload);
      adopt(payload);
      return { ok: true, code: payload.code, opponent: payload.opponent };
    });
  }

  function fail(payload) {
    return {
      ok: false,
      reason: (payload && (payload.reason || payload.error)) || "empty",
    };
  }

  /* ---------------------------------------------------------------------------
   * ATTENDRE L'ADVERSAIRE
   * ------------------------------------------------------------------------ */

  /**
   * Attend que quelqu'un rejoigne la partie ouverte.
   *
   * @param {function} onTick appelé à chaque demande de nouvelles, pour
   *        pouvoir montrer que ça tourne encore
   * @returns {Promise<{ok:boolean, opponent?:object, reason?:string}>}
   */
  function waitForOpponent(onTick) {
    return poll(function (payload) {
      if (payload.opponent) {
        match.opponent = payload.opponent;
        return { ok: true, opponent: payload.opponent };
      }
      return null;   // rien de neuf, on repasse plus tard
    }, onTick);
  }

  /**
   * Dépose ton coup et attend celui d'en face.
   *
   * @param {string} action    "charge" | "shoot" | "defend"
   * @param {function} onTick  pour animer l'attente
   * @returns {Promise<{ok:boolean, mine?:string, theirs?:string, reason?:string}>}
   */
  function playMove(action, onTick) {
    if (!match) return Promise.resolve({ ok: false, reason: "no-match" });

    return DUELMINDS.net.call({
      pvp: "move", code: match.code, player: playerId(),
      turn: match.turn, action: action,
    }).then(function (payload) {
      /* Le tour a bougé sans nous — l'autre était en avance. On se recale sur
       * ce que dit l'arbitre et on redépose : sans ça la partie se fige. */
      if (payload && payload.ok === false && payload.error === "wrong-turn" && payload.turn) {
        match.turn = payload.turn;
        return DUELMINDS.net.call({
          pvp: "move", code: match.code, player: playerId(),
          turn: match.turn, action: action,
        });
      }
      return payload;
    }).then(function (payload) {
      if (!payload || payload.ok === false) return fail(payload);
      if (payload.ready) return resolved(payload);

      // Il manque encore le coup d'en face : on attend.
      return poll(function (state) {
        return state.ready ? resolved(state) : null;
      }, onTick);
    });
  }

  function resolved(payload) {
    const mySide = match.side;
    const other = mySide === "a" ? "b" : "a";

    /* ON AVANCE D'UN TOUR, et c'est essentiel.
     *
     * `payload.turn` est le tour qui vient d'être JOUÉ. Y rester ferait
     * redéposer le coup suivant sur ce même tour : l'arbitre le verrait déjà
     * complet, renverrait les deux anciens coups, et le jeu rejouerait le tour
     * indéfiniment. C'est aussi ce numéro qui déclenche le passage au tour
     * suivant côté arbitre — voir pvpMove(). */
    match.turn = payload.turn + 1;

    return {
      ok: true,
      mine: payload.moves[mySide],
      theirs: payload.moves[other],
      turn: payload.turn,
    };
  }

  /** Prévient l'arbitre qu'on s'en va, pour que l'autre ne poireaute pas. */
  function leave() {
    if (!match) return Promise.resolve({ ok: true });
    const code = match.code;
    reset();
    return DUELMINDS.net.call({ pvp: "leave", code: code, player: playerId() });
  }

  /* ---------------------------------------------------------------------------
   * LA BOUCLE D'ATTENTE
   * ---------------------------------------------------------------------------
   * Redemande des nouvelles à intervalle régulier jusqu'à ce que `accept`
   * renvoie autre chose que null.
   *
   * Deux protections indispensables :
   *   - un ABANDON au bout d'un moment, sinon un joueur parti laisse l'autre
   *     tourner indéfiniment ;
   *   - la tolérance aux échecs isolés : un appel raté ne doit pas couper la
   *     partie, les réseaux mobiles en ratent tout le temps.
   * ------------------------------------------------------------------------ */
  function poll(accept, onTick) {
    const started = Date.now();
    let failures = 0;

    return new Promise(function (resolve) {
      function tick() {
        if (!match) return resolve({ ok: false, reason: "cancelled" });

        DUELMINDS.net.call({
          pvp: "state", code: match.code, player: playerId(),
        }).then(function (payload) {
          if (!match) return resolve({ ok: false, reason: "cancelled" });

          if (payload && payload.ok) {
            failures = 0;
            if (payload.over) return resolve({ ok: false, reason: "opponent-left" });

            const outcome = accept(payload);
            if (outcome) return resolve(outcome);
          } else {
            failures += 1;
            // Un code disparu du cache ne reviendra pas : inutile d'insister.
            if (payload && payload.error === "unknown-code") {
              return resolve({ ok: false, reason: "expired" });
            }
            if (failures >= 6) return resolve({ ok: false, reason: "offline" });
          }

          if (Date.now() - started > GIVE_UP_MS) {
            return resolve({ ok: false, reason: "timeout" });
          }
          if (onTick) onTick(Math.round((Date.now() - started) / 1000));
          root.setTimeout(tick, POLL_MS);
        });
      }
      tick();
    });
  }

  DUELMINDS.pvp = {
    create, join, waitForOpponent, playMove, leave, reset,
    current, isHost, isActive, playerId,
    POLL_MS, GIVE_UP_MS,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
