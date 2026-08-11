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

/** Colonnes de la feuille, dans l'ordre. */
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
 * Appelée automatiquement par Google à chaque partie terminée.
 * Le jeu envoie un JSON ; on l'ajoute en bas de la feuille.
 */
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];

    // Première utilisation : on écrit la ligne d'en-têtes.
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(COLUMNS);
      sheet.setFrozenRows(1);
    }

    var actions = data.actions || {};
    sheet.appendRow([
      data.date || new Date().toISOString(),
      data.tester || "",
      String(data.name || "").slice(0, 16),
      data.version || "",
      data.mode || "",
      data.difficulty || "",
      data.result || "",
      data.streak === "" || data.streak === undefined ? "" : data.streak,
      data.hiddenBullets === undefined ? "" : data.hiddenBullets,
      data.timedOut === undefined ? "" : data.timedOut,
      data.lastPersonality || "",
      data.character || "",
      data.level === undefined ? "" : data.level,
      data.feats === undefined ? "" : data.feats,
      data.duels, data.manches, data.turns,
      data.manches ? Math.round((data.turns / data.manches) * 10) / 10 : "",
      data.clashes, data.superShots,
      actions.charge || 0,
      actions.shoot || 0,
      actions.defend || 0,
    ]);

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
  if (!params.mode && !callback) {
    return ContentService.createTextOutput(
      "Point de collecte DuelMinds actif. Les parties arrivent par POST, " +
      "le classement se lit avec ?mode=arcade."
    );
  }

  var payload;
  try {
    payload = { ok: true, mode: params.mode || "arcade",
                difficulty: params.difficulty || "",
                rows: leaderboard(params.mode || "arcade", params.difficulty || "") };
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

  var first = Math.max(2, lastRow - LEADERBOARD_SCAN + 1);
  var values = sheet.getRange(first, 1, lastRow - first + 1, COLUMNS.length).getValues();

  var iDate   = COLUMNS.indexOf("date");
  var iTester = COLUMNS.indexOf("testeur");
  var iName   = COLUMNS.indexOf("pseudo");
  var iMode   = COLUMNS.indexOf("mode");
  var iDiff   = COLUMNS.indexOf("difficulte");
  var iStreak = COLUMNS.indexOf("serie");

  var best = {};
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    if (String(row[iMode]) !== String(mode)) continue;
    if (difficulty && String(row[iDiff]) !== String(difficulty)) continue;

    var streak = Number(row[iStreak]);
    if (!streak || streak <= 0) continue;

    var key = String(row[iTester] || "?");
    if (!best[key] || streak > best[key].streak) {
      best[key] = {
        name: String(row[iName] || "").slice(0, 16),
        tester: key.slice(0, 4),        // de quoi se reconnaitre, sans plus
        streak: streak,
        difficulty: String(row[iDiff] || ""),
        date: String(row[iDate] || "").slice(0, 10),
      };
    }
  }

  var list = [];
  for (var k in best) if (best.hasOwnProperty(k)) list.push(best[k]);
  list.sort(function (a, b) { return b.streak - a.streak; });
  return list.slice(0, LEADERBOARD_SIZE);
}
