/**
 * MIND FORTRESS — Script de Migration & Synchronisation Locale (mind_fortress.db) -> Turso Cloud
 * Compatible avec le workflow de déploiement GitHub (valisoadev) + Vercel + Turso libSQL
 */

const fs = require("fs");
const path = require("path");
const { createNativeSqliteClient } = require("./client");
const { initDatabase } = require("./init");

const SCHEMA_PATH = path.join(__dirname, "schema.sql");

/**
 * Synchronise intégralement toutes les tables d'une base source (ex: file:./mind_fortress.db)
 * vers une base cible (ex: libsql://mind-fortress-valisoadev.turso.io ou une base SQLite cible).
 */
async function syncDatabaseToTarget(sourceUrl, targetUrl, targetAuthToken = "") {
  if (!targetUrl) {
    throw new Error(
      "URL cible manquante. Définis TURSO_DATABASE_URL dans ton fichier .env (ex: libsql://mind-fortress-valisoadev.turso.io)."
    );
  }

  // S'assurer que la base source est initialisée
  await initDatabase(sourceUrl);
  const sourceClient = createNativeSqliteClient(sourceUrl, "");
  const targetClient = createNativeSqliteClient(targetUrl, targetAuthToken);

  try {
    // 1. Appliquer le schéma complet sur la cible
    const schemaSql = fs.readFileSync(SCHEMA_PATH, "utf8");
    await targetClient.executeMultiple(schemaSql);

    // Assurer les colonnes additionnelles de migration sur la cible
    await initDatabase(targetUrl);

    const tablesReport = {};

    // 2. Synchroniser `settings`
    const settingsRes = await sourceClient.execute("SELECT key, value, updated_at FROM settings");
    for (const r of settingsRes.rows || []) {
      await targetClient.execute({
        sql: "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)",
        args: [r.key, r.value, r.updated_at || new Date().toISOString()]
      });
    }
    tablesReport.settings = (settingsRes.rows || []).length;

    // 3. Synchroniser `puzzles` (67 puzzles de base + puzzles personnalisés + états FSRS) en batch transactionnel
    const puzzlesRes = await sourceClient.execute("SELECT * FROM puzzles ORDER BY id ASC");
    const puzzleStmts = (puzzlesRes.rows || []).map((p) => ({
      sql: `INSERT OR REPLACE INTO puzzles (
              id, code, title, fen, theme, type, diff, side, solution, solution_moves, hint,
              custom, solved, attempts, best_time_sec, box,
              fsrs_state, fsrs_stability, fsrs_difficulty, fsrs_elapsed_days, fsrs_scheduled_days,
              fsrs_reps, fsrs_lapses, fsrs_last_review, fsrs_due_date, woodpecker_cycle, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        p.id,
        p.code,
        p.title,
        p.fen,
        p.theme,
        p.type,
        p.diff,
        p.side,
        p.solution,
        p.solution_moves || "[]",
        p.hint || "",
        p.custom || 0,
        p.solved || 0,
        p.attempts || 0,
        p.best_time_sec || 0,
        p.box || 1,
        p.fsrs_state || 0,
        p.fsrs_stability || 0.0,
        p.fsrs_difficulty || 5.0,
        p.fsrs_elapsed_days || 0,
        p.fsrs_scheduled_days || 0,
        p.fsrs_reps || 0,
        p.fsrs_lapses || 0,
        p.fsrs_last_review || null,
        p.fsrs_due_date || null,
        p.woodpecker_cycle || 1,
        p.created_at || new Date().toISOString()
      ]
    }));
    if (puzzleStmts.length > 0) {
      await targetClient.batch(puzzleStmts);
    }
    tablesReport.puzzles = puzzleStmts.length;

    // 4. Synchroniser `fsrs_review_logs`
    const fsrsLogsRes = await sourceClient.execute("SELECT * FROM fsrs_review_logs ORDER BY id ASC");
    for (const fl of fsrsLogsRes.rows || []) {
      await targetClient.execute({
        sql: `INSERT OR REPLACE INTO fsrs_review_logs (
                id, puzzle_id, rating, state, elapsed_days, scheduled_days,
                solve_time_sec, stability, difficulty, reviewed_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          fl.id,
          fl.puzzle_id,
          fl.rating,
          fl.state,
          fl.elapsed_days,
          fl.scheduled_days,
          fl.solve_time_sec || 0,
          fl.stability,
          fl.difficulty,
          fl.reviewed_at
        ]
      });
    }
    tablesReport.fsrs_review_logs = (fsrsLogsRes.rows || []).length;

    // 5. Synchroniser `logs`
    const logsRes = await sourceClient.execute("SELECT * FROM logs ORDER BY id ASC");
    for (const lg of logsRes.rows || []) {
      await targetClient.execute({
        sql: `INSERT OR REPLACE INTO logs (
                id, at_label, created_at, type, puzzle_id, text, theme, diff,
                time_sec, success, xp, emotion, intensity, notes
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          lg.id,
          lg.at_label,
          lg.created_at,
          lg.type,
          lg.puzzle_id || null,
          lg.text,
          lg.theme,
          lg.diff,
          lg.time_sec,
          lg.success,
          lg.xp,
          lg.emotion,
          lg.intensity,
          lg.notes || ""
        ]
      });
    }
    tablesReport.logs = (logsRes.rows || []).length;

    // 6. Synchroniser `contextual_journal`
    const journalRes = await sourceClient.execute("SELECT * FROM contextual_journal ORDER BY id ASC");
    for (const cj of journalRes.rows || []) {
      await targetClient.execute({
        sql: `INSERT OR REPLACE INTO contextual_journal (
                id, log_id, linked_text, created_at, at_label, note,
                before_emotion, after_emotion, before_intensity, after_intensity,
                lieu, bruit, sommeil, fatigue, pression, tag
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          cj.id,
          cj.log_id || null,
          cj.linked_text,
          cj.created_at,
          cj.at_label,
          cj.note,
          cj.before_emotion,
          cj.after_emotion,
          cj.before_intensity,
          cj.after_intensity,
          cj.lieu,
          cj.bruit,
          cj.sommeil,
          cj.fatigue,
          cj.pression,
          cj.tag || ""
        ]
      });
    }
    tablesReport.contextual_journal = (journalRes.rows || []).length;

    // 7. Synchroniser `completed_days`
    const daysRes = await sourceClient.execute("SELECT * FROM completed_days");
    for (const d of daysRes.rows || []) {
      await targetClient.execute({
        sql: "INSERT OR REPLACE INTO completed_days (day_key, status, sessions_count, notes) VALUES (?, ?, ?, ?)",
        args: [d.day_key, d.status || "done", d.sessions_count || 1, d.notes || ""]
      });
    }
    tablesReport.completed_days = (daysRes.rows || []).length;

    // 8. Synchroniser `blindage_entries`
    const blindageRes = await sourceClient.execute("SELECT * FROM blindage_entries ORDER BY id ASC");
    for (const b of blindageRes.rows || []) {
      await targetClient.execute({
        sql: `INSERT OR REPLACE INTO blindage_entries (
                id, created_at, wish, outcome, obstacle, plan, col1, col2, col3, mode, breathing_cycles
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          b.id,
          b.created_at,
          b.wish,
          b.outcome,
          b.obstacle,
          b.plan,
          b.col1,
          b.col2,
          b.col3,
          b.mode,
          b.breathing_cycles
        ]
      });
    }
    tablesReport.blindage_entries = (blindageRes.rows || []).length;

    // 9. Synchroniser `lichess_games`
    const lichessRes = await sourceClient.execute("SELECT * FROM lichess_games");
    for (const g of lichessRes.rows || []) {
      await targetClient.execute({
        sql: `INSERT OR REPLACE INTO lichess_games (
                id, white, black, result, speed, played_at, pgn, hour_of_day,
                opening, critical_fen, critical_move_san, critical_solution_moves,
                critical_side, critical_move_number, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          g.id,
          g.white,
          g.black,
          g.result,
          g.speed,
          g.played_at,
          g.pgn,
          g.hour_of_day,
          g.opening || "Ouverture Classique",
          g.critical_fen || "",
          g.critical_move_san || "",
          g.critical_solution_moves || "[]",
          g.critical_side || "Blancs",
          g.critical_move_number || 15,
          g.created_at || new Date().toISOString()
        ]
      });
    }
    tablesReport.lichess_games = (lichessRes.rows || []).length;

    // 10. Synchroniser `opponents`
    const oppRes = await sourceClient.execute("SELECT * FROM opponents ORDER BY id ASC");
    for (const o of oppRes.rows || []) {
      await targetClient.execute({
        sql: `INSERT OR REPLACE INTO opponents (
                id, name, fide_elo, lichess_username, style, psych_profile,
                white_repertoire, black_repertoire, reference_pgn, match_plan, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          o.id,
          o.name,
          o.fide_elo || null,
          o.lichess_username || "",
          o.style || "Solide",
          o.psych_profile || "",
          o.white_repertoire || "",
          o.black_repertoire || "",
          o.reference_pgn || "",
          o.match_plan || "",
          o.updated_at || new Date().toISOString()
        ]
      });
    }
    tablesReport.opponents = (oppRes.rows || []).length;

    // 11. Synchroniser `opening_repertoire`
    const repRes = await sourceClient.execute("SELECT * FROM opening_repertoire ORDER BY id ASC");
    for (const r of repRes.rows || []) {
      await targetClient.execute({
        sql: `INSERT OR REPLACE INTO opening_repertoire (
                id, side, name, eco, moves, plan, start_fen, mastery,
                fsrs_state, fsrs_stability, fsrs_difficulty, fsrs_reps, fsrs_lapses,
                fsrs_last_review, fsrs_due_date, san_moves_json, final_fen, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          r.id,
          r.side,
          r.name,
          r.eco || "",
          r.moves,
          r.plan || "",
          r.start_fen || "start",
          r.mastery ?? 60,
          r.fsrs_state || 0,
          r.fsrs_stability || 0.0,
          r.fsrs_difficulty || 5.0,
          r.fsrs_reps || 0,
          r.fsrs_lapses || 0,
          r.fsrs_last_review || null,
          r.fsrs_due_date || null,
          r.san_moves_json || "[]",
          r.final_fen || "",
          r.updated_at || new Date().toISOString()
        ]
      });
    }
    tablesReport.opening_repertoire = (repRes.rows || []).length;

    return {
      ok: true,
      sourceUrl,
      targetUrl,
      tablesReport,
      syncedAt: new Date().toISOString()
    };
  } finally {
    sourceClient.close();
    targetClient.close();
  }
}

if (require.main === module) {
  const localDbPath = path.join(__dirname, "..", "mind_fortress.db");
  const sourceUrl = `file:${localDbPath}`;
  const targetUrl = process.env.TURSO_DATABASE_URL;
  const targetToken = process.env.TURSO_AUTH_TOKEN || "";

  if (!targetUrl || targetUrl.startsWith("file:")) {
    console.error(
      "⚠️  Pour synchroniser vers Turso Cloud, renseigne TURSO_DATABASE_URL=libsql://... et TURSO_AUTH_TOKEN=... dans ton fichier .env"
    );
    process.exit(1);
  }

  syncDatabaseToTarget(sourceUrl, targetUrl, targetToken)
    .then((rep) => {
      console.log("✅ Synchronisation locale -> Turso Cloud réussie :", rep.tablesReport);
    })
    .catch((err) => {
      console.error("❌ Erreur lors de la synchronisation Turso :", err);
      process.exit(1);
    });
}

module.exports = {
  syncDatabaseToTarget
};
