/**
 * =============================================================================
 * DUELMINDS — POINT DE COLLECTE DES PARTIES
 * =============================================================================
 *
 * CE QUE C'EST
 * Un petit programme hébergé gratuitement par Google, qui reçoit le résumé de
 * chaque partie et l'écrit dans une feuille de calcul. C'est ce qui manque à
 * GitHub Pages, incapable d'enregistrer quoi que ce soit.
 *
 * Les joueurs n'ont besoin d'aucun compte : c'est TOI qui héberges le point de
 * collecte, eux ne font que jouer.
 *
 * LA COLONNE QUI COMPTE : `mode`
 * Duel et arcade arrivent dans la MÊME feuille, distingués par cette colonne.
 * Tu peux ensuite filtrer ou faire un tableau croisé dynamique pour comparer
 * les deux, sans avoir à gérer deux tableurs.
 *
 * -----------------------------------------------------------------------------
 * INSTALLATION — une seule fois, environ dix minutes
 * -----------------------------------------------------------------------------
 * L'interface Apps Script peut être en français ou en anglais. Les libellés
 * anglais sont donnés entre crochets [comme ceci].
 *
 * 1. https://sheets.google.com -> nouvelle feuille vide, nommée par exemple
 *    « DuelMinds — parties ».
 *
 * 2. Extensions -> Apps Script.  [ Extensions -> Apps Script ]
 *
 * 3. Efface tout et colle L'INTÉGRALITÉ de ce fichier. Enregistre (Ctrl+S).
 *
 * 4. AVANT DE DÉPLOYER, restreins la portée du script pour qu'il ne puisse pas
 *    toucher à tes autres documents :
 *      - engrenage « Paramètres du projet »   [ ⚙ Project Settings ]
 *      - coche « Afficher le fichier manifeste appsscript.json »
 *        [ Show "appsscript.json" manifest file in editor ]
 *      - retourne à l'éditeur  [ < > Editor ], ouvre appsscript.json et mets :
 *
 *          {
 *            "timeZone": "Europe/Paris",
 *            "exceptionLogging": "STACKDRIVER",
 *            "runtimeVersion": "V8",
 *            "oauthScopes": [
 *              "https://www.googleapis.com/auth/spreadsheets.currentonly"
 *            ]
 *          }
 *
 *    `spreadsheets.currentonly` veut dire « uniquement la feuille à laquelle ce
 *    script est rattaché ». Si après déploiement aucune ligne n'arrive, retire
 *    cette portée, re-déploie, et préfère créer la feuille sur un COMPTE GOOGLE
 *    DÉDIÉ : c'est la protection la plus sûre, et elle prend deux minutes.
 *
 * 5. Déployer -> Nouveau déploiement.   [ Deploy -> New deployment ]
 *      - type : Application Web          [ Select type -> Web app ]
 *      - Exécuter en tant que : MOI      [ Execute as: Me ]
 *      - Qui a accès : TOUT LE MONDE     [ Who has access: Anyone ]  <-- requis
 *      - Déployer                        [ Deploy ]
 *
 *    « Tout le monde » désigne QUI PEUT APPELER L'ADRESSE, pas qui voit tes
 *    données. Le code ci-dessous ne sait qu'ajouter une ligne : personne ne
 *    peut lire ta feuille par cette adresse.
 *
 * 6. Autorise le script.  [ Authorize access ]
 *    L'avertissement « Google n'a pas validé cette application » est normal :
 *    tu en es l'auteur.  [ Advanced -> Go to … (unsafe) -> Allow ]
 *
 * 7. Copie l'URL sous « URL de l'application Web »  [ Web app URL ], qui se
 *    termine par /exec, et colle-la dans src/telemetry.js à la ligne :
 *        const ENDPOINT = "";
 *    Puis relance   node tools/build.mjs   et pousse sur GitHub.
 *
 * -----------------------------------------------------------------------------
 * VÉRIFIER
 * -----------------------------------------------------------------------------
 * 1. Ouvre l'URL dans un navigateur : tu dois lire « Point de collecte
 *    DuelMinds actif ».
 * 2. Joue une partie entière, puis recharge le tableur : une ligne apparaît.
 * 3. Sinon, Apps Script -> « Exécutions »  [ Executions ] montre les appels
 *    reçus et l'erreur éventuelle.
 *
 * LE CLASSEMENT
 * Ce script sait aussi RELIRE les meilleures séries, ce qui donne un classement
 * au jeu (voir « LECTURE DU CLASSEMENT » plus bas). Rien à configurer : il
 * suffit de re-déployer une fois ce fichier collé.
 *
 * Si tu modifies ce script plus tard, il faut RE-DÉPLOYER :
 *   Déployer -> Gérer les déploiements -> crayon -> Version : Nouvelle
 *   [ Deploy -> Manage deployments -> ✏ -> Version: New version -> Deploy ]
 * L'URL, elle, ne change pas.
 * =============================================================================
 */

/**
 * Colonnes attendues, dans l'ordre — pour une feuille NEUVE uniquement.
 *
 * ATTENTION, LEÇON APPRISE À LA DURE
 * Ne te sers JAMAIS de cette liste pour lire une feuille existante. Ajouter une
 * colonne au milieu décale tout ce qui a déjà été écrit : les anciennes lignes
 * se retrouvent lues de travers, et un classement rend une liste vide sans la
 * moindre erreur. C'est exactement ce qui est arrivé en insérant « pseudo ».
 *
 * Tout passe donc par `headerOf()`, qui lit les VRAIS en-têtes de la feuille et
 * ajoute à la FIN celles qui manquent. Les anciennes lignes restent lisibles,
 * les nouvelles s'alignent, et l'ordre ci-dessous ne sert plus qu'au premier
 * jour.
 */
var COLUMNS = [
  "date", "testeur", "pseudo", "version",
  "mode", "difficulte", "resultat", "serie",
  "ballesCachees",   // 1 si le joueur ne voyait pas le barillet adverse
  "tempsEcoule",     // mode blitz : nombre de fois où le chrono a decide
  "dernierCaractere", // caractere du dernier adversaire affronte
  "personnage",      // duelliste choisi par le joueur
  "niveau",          // niveau atteint par ce duelliste
  "hautsFaits",      // nombre de hauts faits debloques, tous confondus
  "duels", "manches", "tours", "toursParManche",
  "clashs", "superTirs",
  "charger", "tirer", "proteger",
];

/**
 * Les en-têtes RÉELS de la feuille, complétés si besoin.
 *
 * Feuille vide      -> on écrit COLUMNS et on fige la ligne.
 * Feuille existante -> on lit ses en-têtes tels quels et on ajoute à la FIN
 *                      celles de COLUMNS qui manquent.
 *
 * C'est ce qui permet d'ajouter une colonne au jeu sans casser l'historique :
 * les anciennes lignes gardent leur sens, les nouvelles se rangent au bon
 * endroit, et personne n'a à retoucher le tableur à la main.
 */
function headerOf(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMNS);
    sheet.setFrozenRows(1);
    return COLUMNS.slice();
  }

  var width = Math.max(1, sheet.getLastColumn());
  var header = sheet.getRange(1, 1, 1, width).getValues()[0].map(function (v) {
    return String(v);
  });

  var missing = [];
  for (var i = 0; i < COLUMNS.length; i++) {
    if (header.indexOf(COLUMNS[i]) === -1) missing.push(COLUMNS[i]);
  }
  if (missing.length) {
    sheet.getRange(1, header.length + 1, 1, missing.length).setValues([missing]);
    header = header.concat(missing);
  }
  return header;
}

/**
 * Appelée automatiquement par Google à chaque partie terminée.
 * Le jeu envoie un JSON ; on l'ajoute en bas de la feuille.
 */
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    var header = headerOf(sheet);

    var actions = data.actions || {};

    // Valeurs par NOM de colonne, jamais par position : voir headerOf().
    var byName = {
      date: data.date || new Date().toISOString(),
      testeur: data.tester || "",
      pseudo: String(data.name || "").slice(0, 16),
      version: data.version || "",
      mode: data.mode || "",
      difficulte: data.difficulty || "",
      resultat: data.result || "",
      serie: data.streak === "" || data.streak === undefined ? "" : data.streak,
      ballesCachees: data.hiddenBullets === undefined ? "" : data.hiddenBullets,
      tempsEcoule: data.timedOut === undefined ? "" : data.timedOut,
      dernierCaractere: data.lastPersonality || "",
      personnage: data.character || "",
      niveau: data.level === undefined ? "" : data.level,
      hautsFaits: data.feats === undefined ? "" : data.feats,
      duels: data.duels,
      manches: data.manches,
      tours: data.turns,
      toursParManche: data.manches ? Math.round((data.turns / data.manches) * 10) / 10 : "",
      clashs: data.clashes,
      superTirs: data.superShots,
      charger: actions.charge || 0,
      tirer: actions.shoot || 0,
      proteger: actions.defend || 0,
    };

    var row = [];
    for (var c = 0; c < header.length; c++) {
      row.push(byName[header[c]] === undefined ? "" : byName[header[c]]);
    }
    sheet.appendRow(row);

    return ContentService.createTextOutput("ok");
  } catch (err) {
    // On enregistre l'erreur plutôt que de perdre la ligne en silence.
    try {
      SpreadsheetApp.getActiveSpreadsheet().getSheets()[0]
        .appendRow([new Date().toISOString(), "ERREUR", String(err)]);
    } catch (ignored) {}
    return ContentService.createTextOutput("erreur");
  }
}

/**
 * =============================================================================
 * LECTURE DU CLASSEMENT
 * =============================================================================
 *
 * OUI, ÇA MARCHE DANS LES DEUX SENS
 * Le même programme qui reçoit les parties peut aussi les relire. GitHub Pages
 * ne sait servir que des fichiers, mais rien ne l'empêche d'ALLER CHERCHER des
 * données ailleurs : c'est ce qui donne un classement à un jeu hébergé sur un
 * site sans serveur.
 *
 * POURQUOI JSONP ET PAS UN SIMPLE fetch()
 * Un navigateur refuse par défaut de lire une réponse venant d'un autre domaine
 * (CORS). Apps Script redirige ses réponses vers googleusercontent.com, ce qui
 * rend ce blocage difficile à contourner proprement. La méthode JSONP, elle,
 * passe par une balise <script>, à laquelle la règle ne s'applique pas. C'est
 * une vieille technique, mais ici elle est parfaitement adaptée : la donnée est
 * publique, en lecture seule, et sans aucun secret.
 *
 * CE QUI SORT D'ICI, ET RIEN D'AUTRE
 * Uniquement le meilleur score de chaque joueur pour un mode donné : pseudonyme,
 * série, difficulté, date. Jamais la feuille entière, jamais les colonnes de
 * détail. Un curieux qui appelle l'adresse ne récupère pas tes données de test.
 *
 * ATTENTION — IL FAUT RE-DÉPLOYER
 * Ajouter ce code ne suffit pas : Apps Script sert toujours la version
 * déployée. Déployer -> Gérer les déploiements -> crayon -> Version : Nouvelle
 * [ Deploy -> Manage deployments -> pencil -> Version: New version -> Deploy ].
 * L'URL ne change pas. Tant que ce n'est pas fait, le jeu affiche simplement
 * « classement indisponible » : il continue de fonctionner.
 * =============================================================================
 */

/** Nombre de joueurs renvoyés au maximum. */
var LEADERBOARD_SIZE = 20;

/** Lignes lues au plus, en partant de la fin : borne le temps d'exécution. */
var LEADERBOARD_SCAN = 4000;

function doGet(e) {
  var params = (e && e.parameter) || {};
  var callback = String(params.callback || "");

  // Sans paramètre : la page de vérification d'origine, ouverte au navigateur.
  if (!params.mode && !params.pvp && !callback) {
    return ContentService.createTextOutput(
      "Point de collecte DuelMinds actif. Les parties arrivent par POST, " +
      "le classement se lit avec ?mode=arcade, les duels en ligne avec ?pvp=..."
    );
  }

  var payload;
  try {
    /* Les duels en ligne passent par la même adresse : un seul déploiement à
     * maintenir, et rien de plus à configurer pour toi. */
    payload = pvpRoute(params);
    if (!payload) {
      payload = { ok: true, mode: params.mode || "arcade",
                  difficulty: params.difficulty || "",
                  rows: leaderboard(params.mode || "arcade", params.difficulty || "") };
    }
  } catch (err) {
    payload = { ok: false, error: String(err), rows: [] };
  }

  var body = JSON.stringify(payload);

  // Appel JSONP : on enrobe la réponse dans la fonction demandée par la page.
  if (callback) {
    // Le nom de la fonction vient de l'extérieur : on n'accepte que des
    // identifiants simples, pour ne rien pouvoir injecter d'autre.
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(callback)) callback = "DUELMINDS_LB";
    return ContentService
      .createTextOutput(callback + "(" + body + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(body)
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Meilleure série de chaque joueur pour un mode.
 * Un joueur n'apparaît qu'une fois, avec son record — sinon un habitué
 * occuperait tout le tableau avec ses vingt meilleures parties.
 */
function leaderboard(mode, difficulty) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var header = headerOf(sheet);
  var first = Math.max(2, lastRow - LEADERBOARD_SCAN + 1);
  var values = sheet.getRange(first, 1, lastRow - first + 1, header.length).getValues();

  // Positions lues dans la feuille, pas devinées : c'est tout l'objet de
  // headerOf(). Une colonne absente vaut -1 et se lit comme vide.
  var iDate   = header.indexOf("date");
  var iTester = header.indexOf("testeur");
  var iName   = header.indexOf("pseudo");
  var iMode   = header.indexOf("mode");
  var iDiff   = header.indexOf("difficulte");
  var iStreak = header.indexOf("serie");
  if (iMode === -1 || iStreak === -1) return [];

  var best = {};
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    if (String(row[iMode]) !== String(mode)) continue;
    if (difficulty && String(row[iDiff]) !== String(difficulty)) continue;

    var streak = Number(row[iStreak]);
    if (!streak || streak <= 0) continue;

    var key = String((iTester === -1 ? "" : row[iTester]) || "?");
    if (!best[key] || streak > best[key].streak) {
      best[key] = {
        name: iName === -1 ? "" : String(row[iName] || "").slice(0, 16),
        tester: key.slice(0, 4),        // de quoi se reconnaitre, sans plus
        streak: streak,
        difficulty: iDiff === -1 ? "" : String(row[iDiff] || ""),
        date: iDate === -1 ? "" : String(row[iDate] || "").slice(0, 10),
      };
    }
  }

  var list = [];
  for (var k in best) if (best.hasOwnProperty(k)) list.push(best[k]);
  list.sort(function (a, b) { return b.streak - a.streak; });
  return list.slice(0, LEADERBOARD_SIZE);
}

/**
 * =============================================================================
 * ARBITRE DE DUEL EN LIGNE (PVP)
 * =============================================================================
 *
 * LE PROBLÈME, ET IL N'Y EN A QU'UN
 * Dans DuelMinds les deux joueurs choisissent EN MÊME TEMPS, sans voir le coup
 * de l'autre. Si les deux navigateurs s'échangeaient directement leurs coups,
 * un joueur au programme modifié pourrait ATTENDRE de voir celui d'en face
 * avant d'envoyer le sien. Il gagnerait à tous les coups.
 *
 * Il faut donc un tiers qui reçoit les deux coups et ne les révèle qu'une fois
 * les DEUX arrivés. C'est tout le rôle de ce qui suit.
 *
 * CE QUE CET ARBITRE NE FAIT PAS, ET C'EST VOULU
 * Il ne connaît AUCUNE règle du jeu. Il ne sait pas ce qu'est une balle, ni
 * qui gagne. Il retient deux mots et les rend ensemble.
 *
 * Pourquoi c'est le bon choix : les règles de DuelMinds vivent dans un seul
 * fichier (`src/combat.js`) et la résolution d'un tour n'a aucune part de
 * hasard. Les deux navigateurs, partant du même état et recevant les mêmes
 * coups, aboutissent forcément au même résultat. Dupliquer les règles ici, ce
 * serait créer une deuxième version à maintenir — et le jour où les deux
 * divergent, plus personne ne sait laquelle a raison.
 *
 * CE QU'UN TRICHEUR PEUT ENCORE FAIRE
 * Modifier SON propre affichage. Il ne peut pas voir le coup adverse à l'avance,
 * ni forcer un résultat chez l'autre : le navigateur d'en face recalcule de son
 * côté. C'est la propriété qui compte pour un classement honnête.
 *
 * OÙ VIT UNE PARTIE
 * Dans le cache du script, pas dans la feuille : c'est cent fois plus rapide et
 * ça s'efface tout seul. Une partie abandonnée disparaît au bout de deux heures
 * sans laisser de trace.
 *
 * LES LIMITES, DITES FRANCHEMENT
 * Chaque échange passe par Google et prend entre une demi-seconde et deux
 * secondes. C'est acceptable pour un jeu au tour par tour, ce ne le serait pas
 * pour un jeu d'action. Et le nombre d'appels n'est pas illimité : bon pour une
 * poignée de testeurs, à remplacer par un vrai relais si le jeu marche.
 * =============================================================================
 */

/** Durée de vie d'une partie inactive, en secondes. */
var PVP_TTL = 7200;

/* Alphabet du code de partie : ni O ni 0, ni I ni 1. Un code se lit à voix
 * haute ou se recopie depuis un message — les caractères ambigus font perdre
 * plus de temps qu'ils n'apportent de combinaisons. */
var PVP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function pvpCache() { return CacheService.getScriptCache(); }
function pvpKey(code) { return "pvp_" + String(code).toUpperCase(); }

function pvpLoad(code) {
  var raw = pvpCache().get(pvpKey(code));
  return raw ? JSON.parse(raw) : null;
}

function pvpSave(match) {
  pvpCache().put(pvpKey(match.code), JSON.stringify(match), PVP_TTL);
}

function pvpNewCode() {
  var code = "";
  for (var i = 0; i < 4; i++) {
    code += PVP_ALPHABET.charAt(Math.floor(Math.random() * PVP_ALPHABET.length));
  }
  return code;
}

/** De quel côté joue ce joueur ? "a", "b", ou null s'il n'est pas de la partie. */
function pvpSideOf(match, player) {
  if (match.a && match.a.id === player) return "a";
  if (match.b && match.b.id === player) return "b";
  return null;
}

/** Ce qu'on renvoie au joueur : son état, celui d'en face, et le tour courant. */
function pvpView(match, player) {
  var side = pvpSideOf(match, player);
  var other = side === "a" ? "b" : "a";
  var both = !!(match.moves.a && match.moves.b);

  return {
    ok: true,
    code: match.code,
    side: side,
    turn: match.turn,
    /* On n'expose les deux coups QUE si les deux sont arrivés. C'est la seule
     * ligne qui rend le jeu honnête : tant qu'il en manque un, personne ne
     * peut rien apprendre. */
    ready: both,
    moves: both ? { a: match.moves.a, b: match.moves.b } : null,
    mine: side ? (match.moves[side] || null) : null,
    opponent: match[other] ? {
      name: match[other].name,
      character: match[other].character,
    } : null,
    over: !!match.over,
  };
}

function pvpCreate(params) {
  var code = pvpNewCode();
  // Collision improbable (un million de codes), mais on vérifie quand même :
  // deux parties sur le même code se mélangeraient sans rien signaler.
  for (var tries = 0; tries < 5 && pvpLoad(code); tries++) code = pvpNewCode();

  var match = {
    code: code,
    created: Date.now(),
    a: {
      id: String(params.player || ""),
      name: String(params.name || "").slice(0, 16),
      character: String(params.character || ""),
    },
    b: null,
    turn: 1,
    moves: {},
    over: false,
  };
  pvpSave(match);
  return pvpView(match, match.a.id);
}

function pvpJoin(params) {
  var match = pvpLoad(params.code);
  if (!match) return { ok: false, error: "unknown-code" };

  var side = pvpSideOf(match, params.player);
  if (!side) {
    if (match.b) return { ok: false, error: "match-full" };
    match.b = {
      id: String(params.player || ""),
      name: String(params.name || "").slice(0, 16),
      character: String(params.character || ""),
    };
    pvpSave(match);
  }
  return pvpView(match, params.player);
}

/**
 * Dépose le coup d'un joueur pour un tour donné.
 *
 * Le passage au tour suivant se fait ICI, quand un joueur envoie un coup pour
 * `tour + 1` alors que le tour courant est complet. Pas de minuterie côté
 * serveur : c'est l'arrivée des coups qui fait avancer la partie, ce qui évite
 * qu'un joueur lent se retrouve sauté.
 */
function pvpMove(params) {
  var lock = LockService.getScriptLock();
  // Deux coups peuvent arriver à la même milliseconde : sans verrou, le second
  // écraserait le premier et la partie se bloquerait pour toujours.
  try { lock.waitLock(5000); } catch (err) { return { ok: false, error: "busy" }; }

  try {
    var match = pvpLoad(params.code);
    if (!match) return { ok: false, error: "unknown-code" };

    var side = pvpSideOf(match, params.player);
    if (!side) return { ok: false, error: "not-in-match" };

    var turn = Number(params.turn);
    var complete = !!(match.moves.a && match.moves.b);

    if (turn === match.turn + 1 && complete) {
      match.turn = turn;
      match.moves = {};
    }
    if (turn !== match.turn) return { ok: false, error: "wrong-turn", turn: match.turn };

    // Un coup déjà déposé ne se change pas : sinon on pourrait le rejouer
    // après avoir vu celui d'en face.
    if (!match.moves[side]) match.moves[side] = String(params.action || "");

    pvpSave(match);
    return pvpView(match, params.player);
  } finally {
    lock.releaseLock();
  }
}

function pvpState(params) {
  var match = pvpLoad(params.code);
  if (!match) return { ok: false, error: "unknown-code" };
  return pvpView(match, params.player);
}

/** Marque la partie terminée, pour que l'autre l'apprenne sans attendre. */
function pvpLeave(params) {
  var match = pvpLoad(params.code);
  if (!match) return { ok: true };
  match.over = true;
  pvpSave(match);
  return { ok: true };
}

/** Aiguillage des appels PVP. Renvoie null si ce n'en est pas un. */
function pvpRoute(params) {
  switch (params.pvp) {
    case "create": return pvpCreate(params);
    case "join":   return pvpJoin(params);
    case "move":   return pvpMove(params);
    case "state":  return pvpState(params);
    case "leave":  return pvpLeave(params);
    default:       return null;
  }
}
