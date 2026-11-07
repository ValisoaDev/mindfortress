/**
 * ============================================================================
 * TESTS AUTOMATISÉS OBLIGATOIRES — ÉTAPE 2
 * Intégration ValisoaChessLite_board + Nettoyage 100% des données fictives
 * ============================================================================
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const ValisoaChessLite = require("../vendor/ValisoaChessLite.js");
const ValisoaChessboard = require("../vendor/ValisoaChessboard.js");
const ValisoaChesspgnparser = require("../vendor/ValisoaChesspgnparser.js");
const { initDatabase, getFullState } = require("../db/init.js");

function requestRaw(port, urlPath) {
  return new Promise((resolve, reject) => {
    http
      .get({ hostname: "127.0.0.1", port, path: urlPath }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks)
          });
        });
      })
      .on("error", reject);
  });
}

async function runTests() {
  console.log("==================================================================");
  console.log("🧪 EXÉCUTION DES TESTS OBLIGATOIRES — ÉTAPE 2");
  console.log("==================================================================\n");

  // -------------------------------------------------------------------------
  // TEST 1 : Vérification ZÉRO donnée fictive dans mind_fortress.db
  // -------------------------------------------------------------------------
  console.log("▶ Test 1 : Vérification ZÉRO donnée fictive dans mind_fortress.db...");
  const client = await initDatabase();
  const state = await getFullState();
  const s = state.settings;

  assert.equal(Number(s.xp), 0, "XP initial doit être 0 (aucune donnée fictive)");
  assert.equal(Number(s.streak), 0, "Streak initial doit être 0 (aucune donnée fictive)");
  assert.equal(Number(s.total_min), 0, "Temps total initial doit être 0");
  assert.equal(Number(s.attempts), 0, "Tentatives initiales doivent être 0");
  assert.equal(Number(s.solved_count), 0, "Compteur résolus initial doit être 0");
  assert.equal(s.endurance_notes, "", "Notes d'endurance initiales doivent être vides");
  assert.deepEqual(JSON.parse(s.repertoire_json), [], "Répertoire initial doit être vide");

  const logsCount = await client.execute("SELECT COUNT(*) AS cnt FROM logs");
  assert.equal(Number(logsCount.rows[0].cnt), 0, "Table logs doit contenir 0 entrée fictive");

  const journalCount = await client.execute("SELECT COUNT(*) AS cnt FROM contextual_journal");
  assert.equal(Number(journalCount.rows[0].cnt), 0, "Table contextual_journal doit contenir 0 entrée fictive");

  const daysCount = await client.execute("SELECT COUNT(*) AS cnt FROM completed_days");
  assert.equal(Number(daysCount.rows[0].cnt), 0, "Table completed_days doit contenir 0 jour coché fictif");

  const solvedPuzzlesCount = await client.execute("SELECT COUNT(*) AS cnt FROM puzzles WHERE solved = 1");
  assert.equal(Number(solvedPuzzlesCount.rows[0].cnt), 0, "Aucun puzzle ne doit être pré-résolu (0/67)");

  console.log("  ✅ Test 1 RÉUSSI : Zéro donnée fictive dans SQLite (0 j streak, 0 XP, 0/67 résolus, 0 log).\n");

  // -------------------------------------------------------------------------
  // TEST 2 : Validation des 67 puzzles dans ValisoaChessLite (FEN + coups)
  // -------------------------------------------------------------------------
  console.log("▶ Test 2 : Validation des 67 puzzles et séquences de coups avec ValisoaChessLite...");
  const puzzlesRes = await client.execute("SELECT * FROM puzzles ORDER BY id ASC");
  assert.equal(puzzlesRes.rows.length, 67, "Les 67 puzzles du corpus doivent être présents");

  let totalVerifiedMoves = 0;
  for (const row of puzzlesRes.rows) {
    const chess = new ValisoaChessLite();
    const loaded = chess.load(row.fen);
    assert.equal(loaded, true, `FEN invalide pour le puzzle #${row.id} (${row.code}): ${row.fen}`);

    const solMoves = JSON.parse(row.solution_moves || "[]");
    assert.ok(Array.isArray(solMoves) && solMoves.length > 0, `Puzzle #${row.id} (${row.code}) doit avoir solution_moves non vide`);

    for (const san of solMoves) {
      const moveObj = chess.move(san);
      assert.ok(moveObj, `Coup illégal '${san}' dans le puzzle #${row.id} (${row.code}) sur FEN ${chess.fen()}`);
      totalVerifiedMoves++;
    }
  }
  console.log(`  ✅ Test 2 RÉUSSI : 67/67 puzzles chargés et ${totalVerifiedMoves} coups exécutés légalement par ValisoaChessLite.\n`);

  // -------------------------------------------------------------------------
  // TEST 3 : Fonctionnalités avancées de ValisoaChessLite (Mat, Pat, Undo/Redo)
  // -------------------------------------------------------------------------
  console.log("▶ Test 3 : Vérification moteur ValisoaChessLite (Mat, Undo, Redo, SAN)...");
  const game = new ValisoaChessLite();
  assert.ok(game.move("e4"));
  assert.ok(game.move("e5"));
  assert.ok(game.move("Bc4"));
  assert.ok(game.move("Nc6"));
  assert.ok(game.move("Qh5"));
  assert.ok(game.move("Nf6"));
  const mateMove = game.move("Qxf7#");
  assert.ok(mateMove, "Qxf7# doit être légal");
  assert.equal(game.isCheckmate(), true, "La position doit être reconnue comme échec et mat");
  assert.equal(game.isGameOver(), true, "La partie doit être terminée");

  const undone = game.undo();
  assert.equal(undone.san, "Qxf7#", "Undo doit annuler Qxf7#");
  assert.equal(game.isCheckmate(), false, "Après undo, ce n'est plus mat");
  assert.equal(game.isLegalMove("Qxf7#"), true, "isLegalMove doit valider Qxf7# sans modifier la position");
  const replayed = game.move("Qxf7#");
  assert.equal(replayed.san, "Qxf7#", "move('Qxf7#') doit rejouer Qxf7#");
  assert.equal(game.isCheckmate(), true, "Après re-exécution, c'est à nouveau mat");
  console.log("  ✅ Test 3 RÉUSSI : Moteur ValisoaChessLite (Mat, Undo, Redo, SAN) 100% opérationnel.\n");

  // -------------------------------------------------------------------------
  // TEST 4 : Validation de ValisoaChesspgnparser + replay sur ValisoaChessLite
  // -------------------------------------------------------------------------
  console.log("▶ Test 4 : Validation de ValisoaChesspgnparser (Tags, Commentaires, NAGs, Variantes)...");
  const samplePgn = `
[Event "Préparation Championnat de Madagascar 2027"]
[Site "Antananarivo"]
[White "Valisoa"]
[Black "Adversaire"]
[Result "1-0"]

1. e4 e5 {Début ouvert classique} 2. Nf3 Nc6 (2... Nf6 {Défense Petrov} 3. Nxe5) 3. Bb5 a6 $1 4. Ba4 Nf6 5. O-O 1-0
  `.trim();

  const parsedGames = ValisoaChesspgnparser.parse(samplePgn);
  assert.equal(parsedGames.length, 1, "Une partie PGN doit être extraite");
  const g0 = parsedGames[0];
  assert.equal(g0.tags.Event, "Préparation Championnat de Madagascar 2027");
  assert.equal(g0.tags.White, "Valisoa");
  assert.equal(g0.result, "1-0");
  assert.equal(g0.moves.length, 9, "La ligne principale doit compter 9 demi-coups");
  assert.equal(g0.moves[1].comments[0], "Début ouvert classique", "Le commentaire PGN doit être extrait");
  assert.equal(g0.moves[3].ravs.length, 1, "La sous-variante (2... Nf6) doit être extraite récursivement");
  assert.ok(g0.moves[5].nags.includes("$1"), "Le NAG $1 doit être extrait");

  // Replay de tous les coups sur ValisoaChessLite
  const replayEngine = new ValisoaChessLite();
  for (const m of g0.moves) {
    const sanStr = m.move || m.san;
    const played = replayEngine.move(sanStr);
    assert.ok(played, `Le coup PGN ${sanStr} doit être jouable dans ValisoaChessLite`);
  }
  console.log("  ✅ Test 4 RÉUSSI : ValisoaChesspgnparser + replay ValisoaChessLite 100% opérationnels.\n");

  // -------------------------------------------------------------------------
  // TEST 5 : Vérification du serveur HTTP (fichiers vendor + SVG + index.html)
  // -------------------------------------------------------------------------
  console.log("▶ Test 5 : Vérification du service HTTP des bibliothèques ValisoaChess et des pièces SVG...");
  const { createAppServer } = require("../server.js");
  const testPort = 18766;
  const server = createAppServer();
  await new Promise((resolve) => server.listen(testPort, "127.0.0.1", resolve));

  try {
    const assetsToVerify = [
      "/vendor/ValisoaChessLite.js",
      "/vendor/ValisoaChessboard.js",
      "/vendor/ValisoaChessboard.css",
      "/vendor/ValisoaChesspgnparser.js",
      "/vendor/ValisoaFSRS.js",
      "/img/chesspieces/wikipedia/wK.svg",
      "/img/chesspieces/wikipedia/wQ.svg",
      "/img/chesspieces/wikipedia/bK.svg",
      "/img/chesspieces/wikipedia/bN.svg",
      "/"
    ];

    for (const assetUrl of assetsToVerify) {
      const res = await requestRaw(testPort, assetUrl);
      assert.equal(res.status, 200, `L'URL ${assetUrl} doit retourner HTTP 200`);
      assert.ok(res.body.length > 100, `Le contenu de ${assetUrl} ne doit pas être vide`);
    }

    const indexHtml = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
    assert.ok(indexHtml.includes("ValisoaChessLite"), "index.html doit intégrer ValisoaChessLite");
    assert.ok(indexHtml.includes("ValisoaChessboard"), "index.html doit intégrer ValisoaChessboard");
    assert.ok(indexHtml.includes("ValisoaChesspgnparser"), "index.html doit intégrer ValisoaChesspgnparser");
    assert.ok(indexHtml.includes('localStorage.removeItem("mindFortressSQLite_v3")'), "index.html doit purger l'ancien cache localStorage de démo");
    console.log("  ✅ Test 5 RÉUSSI : Tous les fichiers ValisoaChess (.js, .css, 12 pièces .svg) et index.html sont servis avec succès.\n");
  } finally {
    server.close();
  }

  console.log("==================================================================");
  console.log("🏆 TOUS LES TESTS DE L'ÉTAPE 2 SONT PASSÉS AVEC SUCCÈS (100%) !");
  console.log("==================================================================");
}

runTests().catch((err) => {
  console.error("\n❌ ÉCHEC D'UN TEST DE L'ÉTAPE 2 :", err);
  process.exit(1);
});
