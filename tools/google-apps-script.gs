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
 * Si tu modifies ce script plus tard, il faut RE-DÉPLOYER :
 *   Déployer -> Gérer les déploiements -> crayon -> Version : Nouvelle
 *   [ Deploy -> Manage deployments -> ✏ -> Version: New version -> Deploy ]
 * L'URL, elle, ne change pas.
 * =============================================================================
 */

/** Colonnes de la feuille, dans l'ordre. */
var COLUMNS = [
  "date", "testeur", "version",
  "mode", "difficulte", "resultat", "serie",
  "ballesCachees",   // 1 si le joueur ne voyait pas le barillet adverse
  "tempsEcoule",     // mode blitz : nombre de fois où le chrono a decide
  "dernierCaractere", // caractere du dernier adversaire affronte
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
      data.version || "",
      data.mode || "",
      data.difficulty || "",
      data.result || "",
      data.streak === "" || data.streak === undefined ? "" : data.streak,
      data.hiddenBullets === undefined ? "" : data.hiddenBullets,
      data.timedOut === undefined ? "" : data.timedOut,
      data.lastPersonality || "",
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

/** Permet de vérifier depuis un navigateur que le point de collecte répond. */
function doGet() {
  return ContentService.createTextOutput(
    "Point de collecte DuelMinds actif. Les parties arrivent par POST."
  );
}
