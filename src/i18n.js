/* =============================================================================
 * DUELMINDS — FRANÇAIS ET ANGLAIS
 * =============================================================================
 *
 * POURQUOI
 * Le jeu part en test chez des joueurs qui ne lisent pas le français. Un
 * prototype qu'on ne comprend pas ne renvoie aucun retour exploitable : on
 * mesurerait la barrière de la langue, pas la qualité du jeu.
 *
 * TROIS MÉCANISMES, CHACUN LÀ OÙ IL EST NATUREL
 *
 *   1. LES PHRASES DU CODE      `t("cle", { n: 3 })`
 *      Le dictionnaire ci-dessous. Chaque entrée porte ses deux versions côte
 *      à côte, ce qui rend une traduction manquante visible à l'œil nu.
 *      Les phrases sont ENTIÈRES, avec des trous `{comme_ceci}`. Surtout ne
 *      pas traduire des morceaux à recoller : l'ordre des mots change d'une
 *      langue à l'autre et on obtient du charabia.
 *
 *   2. LES DONNÉES DU JEU       `L(objet, "label")`
 *      Modes, difficultés, personnages, tempéraments. Leur traduction vit
 *      DANS l'objet, sous une clé `en`, juste à côté du texte français : on
 *      voit immédiatement ce qui manque en ajoutant un mode.
 *
 *   3. LES TEXTES DU HTML       attribut `data-en`
 *      L'aide, les titres, les boutons. Le français reste dans la page — elle
 *      est lisible telle quelle — et l'anglais l'accompagne. Aucun
 *      dictionnaire à tenir en parallèle, donc rien à désynchroniser.
 *
 * CHOIX DE LA LANGUE
 * Ce que le joueur a choisi, sinon la langue du navigateur, sinon le français.
 * Un joueur anglophone tombe donc sur un jeu en anglais sans rien faire.
 *
 * VÉRIFICATION
 * `node tools/check.mjs` signale les clés utilisées mais absentes du
 * dictionnaire, et les textes du HTML sans `data-en`.
 *
 * DÉPENDANCES : aucune. Ce fichier se charge en PREMIER.
 * ========================================================================== */

(function (root) {
  "use strict";

  const DUELMINDS = (root.DUELMINDS = root.DUELMINDS || {});

  const STORAGE_KEY = "duelminds.lang.v1";
  const LANGS = ["fr", "en"];

  /* ---------------------------------------------------------------------------
   * LE DICTIONNAIRE
   * ---------------------------------------------------------------------------
   * Les trous s'écrivent {nom} et sont remplacés par `t(cle, { nom: valeur })`.
   * Quand une phrase change au pluriel, on met deux clés (`...One`, `...Many`)
   * plutôt qu'une règle générale : DuelMinds n'a que des petits nombres, et
   * une règle de pluriel serait plus de code que de service.
   * ------------------------------------------------------------------------ */
  const TEXT = {
    /* --- Écran d'accueil et navigation --- */
    "home.play":            { fr: "Commencer",  en: "Start" },
    "home.record":          { fr: "record {n}", en: "record {n}" },
    "nav.back":             { fr: "Retour",     en: "Back" },

    /* --- Introduction d'une partie --- */
    "intro.streak":         { fr: "Chaque duel gagné prolonge la série.",
                              en: "Every duel you win extends the streak." },
    "intro.duel":           { fr: "Premier à {n} manches remporte le duel.",
                              en: "First to {n} rounds wins the duel." },
    "intro.timer":          { fr: "{n} secondes pour choisir.",
                              en: "{n} seconds to choose." },
    "intro.hidden":         { fr: "Les balles adverses sont cachées : compte-les.",
                              en: "Enemy bullets are hidden — keep count yourself." },

    /* --- Duellistes --- */
    "duelist.you":          { fr: "Toi",        en: "You" },
    "duelist.opponent":     { fr: "Adversaire", en: "Opponent" },
    "duelist.default":      { fr: "Duelliste",  en: "Duelist" },

    /* --- Résolution d'un tour (combat.js) ---
     * Chaque verdict existe en DEUX versions, selon qu'il parle de toi ou de
     * l'adversaire. Ce n'est pas un luxe : avec une seule phrase à trou, on
     * obtenait « Toi est touché » en français et « You punches » en anglais.
     * Le sujet impose sa conjugaison, il ne peut pas être un simple trou. */
    "combat.impossibleYou": { fr: "Tu tentes l'impossible et t'effondres.",
                              en: "You attempt the impossible and collapse." },
    "combat.impossibleFoe": { fr: "{name} tente l'impossible et s'effondre.",
                              en: "{name} attempts the impossible and collapses." },
    "combat.clash":         { fr: "Les balles se percutent en plein vol.",
                              en: "The bullets collide in mid-air." },

    /* Interception d'un super tir. Le message est INDISPENSABLE : sans lui, le
     * joueur voit son barillet passer de 5 à 2 sans explication et croit à un
     * défaut. Il faut dire ce qui a été perdu, et pourquoi. */
    "combat.superClashYou": { fr: "Ton super tir est intercepté en plein vol. Il te reste {n} balles.",
                              en: "Your super shot is knocked out of the air. You keep {n} bullets." },
    "combat.superClashFoe": { fr: "Le super tir de {name} est intercepté en plein vol. Il lui reste {n} balles.",
                              en: "{name}'s super shot is knocked out of the air, leaving {n} bullets." },
    "combat.superClashBoth":{ fr: "Deux super tirs s'annulent en plein vol. Chacun retombe à {n} balles.",
                              en: "Two super shots cancel out in mid-air. Both drop to {n} bullets." },
    "combat.superShotYou":  { fr: "Tu traverses la protection.",
                              en: "You punch straight through the guard." },
    "combat.superShotFoe":  { fr: "{name} traverse la protection.",
                              en: "{name} punches straight through the guard." },
    "combat.hitYou":        { fr: "Tu es touché.",
                              en: "You are hit." },
    "combat.hitFoe":        { fr: "{name} est touché.",
                              en: "{name} is hit." },

    /* --- Bandeau de révélation --- */
    "reveal.super":         { fr: "super tir",  en: "super shot" },
    "reveal.impossible":    { fr: "impossible", en: "impossible" },
    "reveal.log":           { fr: "Toi : {you}  ·  Adversaire : {foe}",
                              en: "You: {you}  ·  Opponent: {foe}" },

    /* --- Boutons d'action --- */
    "action.super":         { fr: "SUPER TIR",  en: "SUPER SHOT" },
    "action.free":          { fr: "gratuit",       en: "free" },
    "action.costOne":       { fr: "coûte 1 balle", en: "costs 1 bullet" },
    "action.costMany":      { fr: "coûte {n} balles", en: "costs {n} bullets" },
    "action.empty":         { fr: "plus de balle",  en: "no bullet left" },

    /* --- Annonces entre manches et duels --- */
    "manche.won":           { fr: "Manche gagnée", en: "Round won" },
    "manche.lost":          { fr: "Manche perdue", en: "Round lost" },
    "manche.next":          { fr: "Manche {n}",    en: "Round {n}" },
    "duel.won":             { fr: "Duel remporté", en: "Duel won" },
    "duel.lost":            { fr: "Duel perdu",    en: "Duel lost" },
    "duel.next":            { fr: "Duel {n}",      en: "Duel {n}" },

    "streak.ended":         { fr: "Série terminée", en: "Streak over" },
    "streak.title":         { fr: "Série de {n}",   en: "Streak of {n}" },
    "streak.countOne":      { fr: "Série de {n} duel.",  en: "Streak of {n} duel." },
    "streak.countMany":     { fr: "Série de {n} duels.", en: "Streak of {n} duels." },
    "streak.recordNew":     { fr: "Nouveau record sur ce niveau.",
                              en: "New record at this level." },
    "streak.recordOld":     { fr: "Ton record ici est de {n}.",
                              en: "Your record here is {n}." },

    "opponent.next":        { fr: "{name} prend sa place — il {tell}.",
                              en: "{name} steps up — {tell}." },
    "opponent.last":        { fr: "Le dernier adversaire, {name}, {tell}.",
                              en: "Your last opponent, {name}, {tell}." },

    /* --- Progression --- */
    "progress.levelUp":     { fr: "{name} passe niveau {level} — {title}.",
                              en: "{name} reaches level {level} — {title}." },
    "progress.featOne":     { fr: "Haut fait : {names}.",
                              en: "Achievement unlocked: {names}." },
    "progress.featMany":    { fr: "Hauts faits : {names}.",
                              en: "Achievements unlocked: {names}." },
    "progress.rank":        { fr: "niv. {level} · {title}",
                              en: "lv. {level} · {title}" },
    "progress.maxNote":     { fr: "niveau maximum · {duels} duels",
                              en: "max level · {duels} duels" },
    "progress.note":        { fr: "{into} / {needed} points · {duels} duels, {wins} gagnés",
                              en: "{into} / {needed} points · {duels} duels, {wins} won" },

    /* --- Classement ---
     * Chaque panne a son message : « indisponible » ne dit pas au joueur s'il
     * doit réessayer, alors que « pas de réseau » et « pas encore déployé »
     * lui disent quoi faire. */
    "board.loading":        { fr: "Chargement du classement…",
                              en: "Loading the ranking…" },
    "board.empty":          { fr: "Personne n'a encore joué ce mode. À toi de l'ouvrir.",
                              en: "Nobody has played this mode yet. Be the first." },
    "board.offline":        { fr: "Classement injoignable — vérifie ta connexion.",
                              en: "Ranking unreachable — check your connection." },
    "board.notDeployed":    { fr: "Le classement n'est pas encore activé côté serveur.",
                              en: "The ranking is not switched on server-side yet." },
    "board.noEndpoint":     { fr: "Aucun point de collecte n'est configuré : pas de classement.",
                              en: "No collection endpoint configured: no ranking." },
    "board.anonymous":      { fr: "joueur {id}", en: "player {id}" },

    /* --- Duel en ligne ---
     * Chaque panne a son message : le joueur doit savoir s'il faut réessayer,
     * corriger son code, ou aller chercher son adversaire. */
    "pvp.opening":          { fr: "Ouverture de la partie…", en: "Opening the duel…" },
    "pvp.waiting":          { fr: "En attente d'un adversaire… ({n} s)",
                              en: "Waiting for an opponent… ({n} s)" },
    "pvp.joined":           { fr: "{name} a rejoint. Le duel commence.",
                              en: "{name} has joined. The duel begins." },
    "pvp.joining":          { fr: "Connexion à la partie…", en: "Joining the duel…" },
    "pvp.theirTurn":        { fr: "Coup enregistré. On attend l'adversaire…",
                              en: "Move locked in. Waiting for your opponent…" },
    "pvp.badCode":          { fr: "Un code fait quatre caractères.",
                              en: "A code is four characters long." },
    "pvp.unknownCode":      { fr: "Aucune partie sous ce code. Vérifie-le, ou il a expiré.",
                              en: "No duel under that code. Check it, or it has expired." },
    "pvp.full":             { fr: "Cette partie a déjà deux joueurs.",
                              en: "That duel already has two players." },
    "pvp.left":             { fr: "Ton adversaire a quitté la partie.",
                              en: "Your opponent has left." },
    "pvp.expired":          { fr: "La partie a expiré. Ouvres-en une nouvelle.",
                              en: "The duel has expired. Open a new one." },
    "pvp.offline":          { fr: "Serveur injoignable — vérifie ta connexion.",
                              en: "Server unreachable — check your connection." },
    "pvp.notDeployed":      { fr: "Le duel en ligne n'est pas encore activé côté serveur.",
                              en: "Online duels are not switched on server-side yet." },
    "pvp.noEndpoint":       { fr: "Aucun serveur configuré : pas de duel en ligne.",
                              en: "No server configured: no online duel." },
    "pvp.timeout":          { fr: "Personne n'est venu. Réessaie avec un nouveau code.",
                              en: "Nobody showed up. Try again with a new code." },
    "pvp.opponent":         { fr: "Adversaire", en: "Opponent" },
    "pvp.linkCopied":       { fr: "Lien copié", en: "Link copied" },
    "pvp.invited":          { fr: "Duel {code} — on rejoint la partie…",
                              en: "Duel {code} — joining…" },
    "pvp.mode":             { fr: "En ligne", en: "Online" },

    /* --- Écran de fin --- */
    "end.mode":             { fr: "Mode",        en: "Mode" },
    "end.difficulty":       { fr: "Difficulté",  en: "Difficulty" },
    "end.duels":            { fr: "Duels joués", en: "Duels played" },
    "end.manches":          { fr: "Manches",     en: "Rounds" },
    "end.turns":            { fr: "Tours",       en: "Turns" },
    "end.clashes":          { fr: "Clashs",      en: "Clashes" },
    "end.superShots":       { fr: "Super tirs",  en: "Super shots" },
    "end.streak":           { fr: "Série",       en: "Streak" },
    "end.timedOut":         { fr: "Temps écoulé", en: "Ran out of time" },
    "end.times":            { fr: "{n} fois",    en: "{n} times" },

    /* --- Écran des statistiques --- */
    "stats.empty":          { fr: "Aucune partie jouée pour l'instant. Les compteurs se remplissent au fil des duels.",
                              en: "No games played yet. The counters fill up as you duel." },
    "stats.modes":          { fr: "Modes",        en: "Modes" },
    "stats.difficulties":   { fr: "Difficultés",  en: "Difficulties" },
    "stats.actions":        { fr: "Tes actions",  en: "Your actions" },
    "stats.mechanics":      { fr: "Mécaniques",   en: "Mechanics" },
    "stats.colMode":        { fr: "Mode",     en: "Mode" },
    "stats.colGames":       { fr: "Parties",  en: "Games" },
    "stats.colDuels":       { fr: "Duels",    en: "Duels" },
    "stats.colWon":         { fr: "Gagnés",   en: "Won" },
    "stats.colLevel":       { fr: "Niveau",   en: "Level" },
    "stats.colManches":     { fr: "Manches",  en: "Rounds" },
    "stats.colRecord":      { fr: "Record",   en: "Record" },
    "stats.colAction":      { fr: "Action",   en: "Action" },
    "stats.colTimes":       { fr: "Fois",     en: "Times" },
    "stats.colShare":       { fr: "Part",     en: "Share" },
    "stats.turnsPlayed":    { fr: "{n} tours joués",   en: "{n} turns played" },
    "stats.clashShare":     { fr: "{n} % de clashs",   en: "{n} % clashes" },
    "stats.superShots":     { fr: "{n} super tirs",    en: "{n} super shots" },
    "stats.deviceOnly":     { fr: "Ces chiffres ne concernent que cet appareil et sont conservés entre deux sessions.",
                              en: "These figures cover this device only, and are kept between sessions." },
    "stats.noStorage":      { fr: "Le stockage du navigateur est indisponible : ces chiffres seront perdus en fermant l'onglet.",
                              en: "Browser storage is unavailable: these figures will be lost when you close the tab." },
    "stats.copied":         { fr: "Copié",    en: "Copied" },

    /* --- Résumé en texte brut (stats.js) --- */
    "text.title":           { fr: "DUELMINDS — statistiques de test",
                              en: "DUELMINDS — test statistics" },
    "text.period":          { fr: "Du {from} au {to}", en: "From {from} to {to}" },
    "text.modeLine":        { fr: "{games} parties · {duels} duels · {percent} % gagnés",
                              en: "{games} games · {duels} duels · {percent} % won" },
    "text.difficultyLine":  { fr: "{duels} % de duels gagnés · {manches} % de manches · record arcade {record}",
                              en: "{duels} % of duels won · {manches} % of rounds · arcade record {record}" },
    "text.actionsHeader":   { fr: "ACTIONS   ({n} tours joués)",
                              en: "ACTIONS   ({n} turns played)" },
    "text.clashes":         { fr: "clashs      {n} % des tours",
                              en: "clashes     {n} % of turns" },
    "text.superShots":      { fr: "super tirs  {n}", en: "super shots {n}" },
    "text.noStorage":       { fr: "(stockage indisponible : ces chiffres ne survivront pas à la fermeture)",
                              en: "(storage unavailable: these figures will not survive closing the tab)" },
    "text.modes":           { fr: "MODES",        en: "MODES" },
    "text.difficulties":    { fr: "DIFFICULTÉS",  en: "DIFFICULTIES" },
  };

  /* ---------------------------------------------------------------------------
   * CHOIX ET MÉMORISATION DE LA LANGUE
   * ------------------------------------------------------------------------ */

  function detect() {
    try {
      const saved = root.localStorage.getItem(STORAGE_KEY);
      if (LANGS.indexOf(saved) !== -1) return saved;
    } catch (e) { /* navigation privée : on se rabat sur le navigateur */ }

    const nav = (root.navigator && (root.navigator.language ||
                 (root.navigator.languages || [])[0])) || "";
    // Tout ce qui n'est pas explicitement français part en anglais : c'est le
    // choix qui laisse le moins de testeurs devant une langue inconnue.
    return String(nav).toLowerCase().indexOf("fr") === 0 ? "fr" : "en";
  }

  let current = detect();

  function lang() { return current; }

  function setLang(next) {
    if (LANGS.indexOf(next) === -1) return;
    current = next;
    try { root.localStorage.setItem(STORAGE_KEY, next); } catch (e) { /* tant pis */ }
    if (root.document) {
      root.document.documentElement.setAttribute("lang", next);
      applyDom(root.document);
    }
  }

  function toggle() { setLang(current === "fr" ? "en" : "fr"); }

  /* ---------------------------------------------------------------------------
   * LES TROIS ACCÈS
   * ------------------------------------------------------------------------ */

  /**
   * Une phrase du dictionnaire, trous remplis.
   * Clé inconnue : on renvoie la clé elle-même. C'est volontairement laid, et
   * donc repérable en un coup d'œil — bien mieux qu'un texte vide.
   */
  function t(key, params) {
    const entry = TEXT[key];
    if (!entry) return key;
    let out = entry[current] || entry.fr || key;
    if (params) {
      for (const name of Object.keys(params)) {
        out = out.split("{" + name + "}").join(String(params[name]));
      }
    }
    return out;
  }

  /**
   * Un champ d'un objet de données (mode, difficulté, personnage, tempérament).
   * L'anglais vit sous `obj.en`; à défaut, on garde le français, ce qui vaut
   * toujours mieux qu'un trou dans l'interface.
   */
  function L(object, field) {
    if (!object) return "";
    if (current !== "fr" && object.en && object.en[field] !== undefined) {
      return object.en[field];
    }
    return object[field];
  }

  /**
   * Applique la langue aux textes écrits dans le HTML.
   *   data-en      remplace le texte de l'élément
   *   data-en-html remplace son contenu HTML (pour les textes avec du gras)
   * Le français d'origine est mémorisé au premier passage, sinon revenir en
   * arrière serait impossible.
   */
  function applyDom(scope) {
    if (!scope || !scope.querySelectorAll) return;

    for (const node of scope.querySelectorAll("[data-en]")) {
      if (node.dataset.fr === undefined) node.dataset.fr = node.textContent;
      node.textContent = current === "fr" ? node.dataset.fr : node.dataset.en;
    }
    for (const node of scope.querySelectorAll("[data-en-html]")) {
      if (node.dataset.frHtml === undefined) node.dataset.frHtml = node.innerHTML;
      node.innerHTML = current === "fr" ? node.dataset.frHtml : node.dataset.enHtml;
    }
    // Les champs de saisie n'ont pas de texte : c'est leur invite qui se traduit.
    for (const node of scope.querySelectorAll("[data-en-placeholder]")) {
      if (node.dataset.frPlaceholder === undefined) {
        node.dataset.frPlaceholder = node.getAttribute("placeholder") || "";
      }
      node.setAttribute("placeholder", current === "fr"
        ? node.dataset.frPlaceholder : node.dataset.enPlaceholder);
    }
  }

  DUELMINDS.i18n = { t, L, lang, setLang, toggle, applyDom, LANGS, TEXT };
})(typeof globalThis !== "undefined" ? globalThis : window);
