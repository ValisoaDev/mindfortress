/**
 * MIND FORTRESS — Initialisation, Migration & Services SQLite Natif / libSQL (Turso)
 * ZÉRO DONNÉE FICTIVE : Toutes les statistiques, logs, séries et journaux démarrent à 0 / vide.
 * Seule la banque d'exercices (67 puzzles vérifiés par ValisoaChessLite) est pré-chargée à l'état non-résolu.
 */

const fs = require("fs");
const path = require("path");
const { getDbClient, resolveLocalDbFilePath } = require("./client");
const { enrichPuzzleWithFSRS, computeFSRSStats, buildTrainingQueue } = require("./fsrs");
const { computeChronobiologyReport } = require("./lichess");
const { computeAdvancedAnalytics } = require("./analytics");

const BASE_DIR = path.join(__dirname, "..");
const SCHEMA_PATH = path.join(__dirname, "schema.sql");
const SEED_PUZZLES_PATH = path.join(__dirname, "seed_puzzles.json");
const BACKUP_DIR = process.env.VERCEL ? path.join("/tmp", "backups") : path.join(BASE_DIR, "backups");

async function ensureColumns(client, tableName, columnDefs) {
  const tableCheck = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
    args: [tableName]
  });
  if (!tableCheck.rows || tableCheck.rows.length === 0) return;

  const infoRes = await client.execute(`PRAGMA table_info(${tableName})`);
  const existingCols = new Set((infoRes.rows || []).map((r) => r.name));
  for (const [colName, colDef] of Object.entries(columnDefs)) {
    if (!existingCols.has(colName)) {
      await client.execute(`ALTER TABLE ${tableName} ADD COLUMN ${colName} ${colDef}`);
    }
  }
}

async function initDatabase(customUrl) {
  const client = getDbClient(customUrl);
  const schemaSql = fs.readFileSync(SCHEMA_PATH, "utf8");

  // 1. Si mind_fortress.db existait déjà avant l'ajout des colonnes FSRS, migrer les colonnes AVANT la création des index
  await ensureColumns(client, "puzzles", {
    solution_moves: "TEXT NOT NULL DEFAULT '[]'",
    fsrs_state: "INTEGER NOT NULL DEFAULT 0",
    fsrs_stability: "REAL NOT NULL DEFAULT 0.0",
    fsrs_difficulty: "REAL NOT NULL DEFAULT 5.0",
    fsrs_elapsed_days: "INTEGER NOT NULL DEFAULT 0",
    fsrs_scheduled_days: "INTEGER NOT NULL DEFAULT 0",
    fsrs_reps: "INTEGER NOT NULL DEFAULT 0",
    fsrs_lapses: "INTEGER NOT NULL DEFAULT 0",
    fsrs_last_review: "TEXT",
    fsrs_due_date: "TEXT",
    woodpecker_cycle: "INTEGER NOT NULL DEFAULT 1"
  });

  await ensureColumns(client, "settings", {
    updated_at: "TEXT"
  });

  // 2. Exécution du schéma DDL complet (tables + index)
  await client.executeMultiple(schemaSql);

  await ensureColumns(client, "lichess_games", {
    opening: "TEXT DEFAULT 'Ouverture Classique'",
    critical_fen: "TEXT DEFAULT ''",
    critical_move_san: "TEXT DEFAULT ''",
    critical_solution_moves: "TEXT DEFAULT '[]'",
    critical_side: "TEXT DEFAULT 'Blancs'",
    critical_move_number: "INTEGER DEFAULT 15"
  });

  await ensureColumns(client, "opening_repertoire", {
    fsrs_state: "INTEGER NOT NULL DEFAULT 0",
    fsrs_reps: "INTEGER NOT NULL DEFAULT 0",
    fsrs_lapses: "INTEGER NOT NULL DEFAULT 0",
    fsrs_last_review: "TEXT",
    san_moves_json: "TEXT DEFAULT '[]'",
    final_fen: "TEXT DEFAULT ''"
  });

  // 3. Charger et synchroniser les 67 puzzles d'entraînement (tous non-résolus par défaut à la création)
  if (fs.existsSync(SEED_PUZZLES_PATH)) {
    const seedPuzzles = JSON.parse(fs.readFileSync(SEED_PUZZLES_PATH, "utf8"));
    const countPuzzlesRes = await client.execute("SELECT COUNT(*) AS c FROM puzzles");
    const puzzleCount = Number(countPuzzlesRes.rows[0]?.c || 0);

    if (puzzleCount === 0) {
      const stmts = [];
      for (const p of seedPuzzles) {
        const fsrsDifficulty = Math.min(10, Math.max(1, Number(p.diff || 2) * 1.8));
        stmts.push({
          sql: `INSERT INTO puzzles (
                  id, code, title, fen, theme, type, diff, side, solution, solution_moves, hint,
                  custom, solved, attempts, box, fsrs_state, fsrs_stability, fsrs_difficulty
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 1, 0, 0.0, ?)`,
          args: [
            p.id,
            p.code,
            p.title,
            p.fen,
            p.theme,
            p.type || "tactique",
            Number(p.diff || 2),
            p.side || "Blancs",
            p.solution,
            JSON.stringify(p.solution_moves || []),
            p.hint || "",
            fsrsDifficulty
          ]
        });
      }
      await client.batch(stmts);
    } else {
      // Mettre à jour les FEN corrigés et les coups solutions vérifiés par ValisoaChessLite
      const updateStmts = [];
      for (const p of seedPuzzles) {
        updateStmts.push({
          sql: `UPDATE puzzles SET fen = ?, solution = ?, solution_moves = ? WHERE id = ? AND custom = 0`,
          args: [p.fen, p.solution, JSON.stringify(p.solution_moves || []), p.id]
        });
      }
      await client.batch(updateStmts);
    }
  }

  // 4. Paramètres initiaux vierges (Zéro donnée fictive : votre vraie progression commence à 0)
  const defaultSettings = {
    level: "inter",
    xp: "0",
    streak: "0",
    total_min: "0",
    attempts: "0",
    solved_count: "0",
    lichess_username: "",
    count_lichess_in_tracker: "true",
    endurance_notes: "",
    distraction_returns: "0",
    woop_json: JSON.stringify({
      wish: "",
      outcome: "",
      obstacle: "",
      plan: ""
    }),
    journal_3col_json: JSON.stringify({
      win: "",
      lesson: "",
      tomorrow: "",
      pos: "",
      emo: "",
      move: ""
    }),
    baseline_scores_json: JSON.stringify({
      memoire: 5,
      focus: 5,
      emotion: 5,
      clarte: 5
    }),
    weekly_grid_json: JSON.stringify({}),
    repertoire_json: JSON.stringify([]),
    training_mode: "fsrs",
    woodpecker_cycle: "1",
    fsrs_request_retention: "0.90",
    endurance_sessions_json: JSON.stringify([]),
    lichess_profile_json: JSON.stringify(null)
  };

  for (const [k, v] of Object.entries(defaultSettings)) {
    await client.execute({
      sql: "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
      args: [k, v]
    });
  }

  return client;
}

function createBackup(manual = false, customUrl = null) {
  const localPath = resolveLocalDbFilePath(customUrl);
  if (!localPath || !fs.existsSync(localPath)) {
    return null;
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10);
  if (manual) {
    const timePart = now.toTimeString().slice(0, 8).replace(/:/g, "-");
    const destName = `mind_fortress_manual_${datePart}_${timePart}.db`;
    const destPath = path.join(BACKUP_DIR, destName);
    fs.copyFileSync(localPath, destPath);
    return destName;
  } else {
    const destName = `mind_fortress_auto_${datePart}.db`;
    const destPath = path.join(BACKUP_DIR, destName);
    if (!fs.existsSync(destPath)) {
      fs.copyFileSync(localPath, destPath);
    }
    return destName;
  }
}

async function recalculateStreak(client) {
  const daysRes = await client.execute("SELECT day_key FROM completed_days ORDER BY day_key DESC");
  const daysSet = new Set((daysRes.rows || []).map((r) => r.day_key));

  const logsRes = await client.execute(
    "SELECT substr(created_at, 1, 10) AS d FROM logs WHERE created_at IS NOT NULL"
  );
  for (const r of logsRes.rows || []) {
    if (r.d) daysSet.add(r.d);
  }

  const today = new Date();
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const checkDate = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10);
    if (daysSet.has(checkDate)) {
      streak += 1;
    } else if (i === 0) {
      continue;
    } else {
      break;
    }
  }

  await client.execute({
    sql: "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('streak', ?, CURRENT_TIMESTAMP)",
    args: [String(streak)]
  });
  return streak;
}

async function getFullState(customUrl) {
  const client = getDbClient(customUrl);

  const [
    settingsRes,
    puzzlesRes,
    logsRes,
    journalRes,
    daysRes,
    blindageRes,
    fsrsLogsRes,
    lichessGamesRes,
    opponentsRes,
    openingRepRes
  ] = await Promise.all([
    client.execute("SELECT key, value FROM settings"),
    client.execute("SELECT * FROM puzzles ORDER BY id ASC"),
    client.execute("SELECT * FROM logs ORDER BY id DESC LIMIT 200"),
    client.execute("SELECT * FROM contextual_journal ORDER BY id DESC LIMIT 200"),
    client.execute("SELECT day_key FROM completed_days ORDER BY day_key DESC"),
    client.execute("SELECT * FROM blindage_entries ORDER BY id DESC LIMIT 50"),
    client.execute("SELECT * FROM fsrs_review_logs ORDER BY id DESC LIMIT 100"),
    client.execute("SELECT * FROM lichess_games ORDER BY played_at DESC, created_at DESC LIMIT 100"),
    client.execute("SELECT * FROM opponents ORDER BY id DESC"),
    client.execute("SELECT * FROM opening_repertoire ORDER BY id ASC")
  ]);

  const settings = {};
  for (const r of settingsRes.rows || []) {
    settings[r.key] = r.value;
  }

  const now = new Date();
  const puzzles = (puzzlesRes.rows || []).map((p) => {
    let parsedMoves = [];
    try {
      parsedMoves = typeof p.solution_moves === "string" ? JSON.parse(p.solution_moves) : p.solution_moves || [];
    } catch (_e) {}
    return enrichPuzzleWithFSRS(
      {
        ...p,
        solution_moves: parsedMoves
      },
      now
    );
  });

  const activeMode = settings.training_mode || "fsrs";
  const fsrsStats = computeFSRSStats(puzzles, now);
  const dueQueue = buildTrainingQueue(puzzles, activeMode, now);

  let backups = [];
  if (fs.existsSync(BACKUP_DIR)) {
    backups = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith(".db"))
      .sort()
      .reverse()
      .slice(0, 15);
  }

  const localDbPath = resolveLocalDbFilePath(customUrl);

  let enduranceSessions = [];
  try {
    if (settings.endurance_sessions_json) {
      enduranceSessions = JSON.parse(settings.endurance_sessions_json);
    }
  } catch (_e) {}

  let lichessProfile = null;
  try {
    if (settings.lichess_profile_json) {
      lichessProfile = JSON.parse(settings.lichess_profile_json);
    }
  } catch (_e) {}

  const lichessGames = (lichessGamesRes.rows || []).map((g) => {
    let solMoves = [];
    try {
      solMoves =
        typeof g.critical_solution_moves === "string"
          ? JSON.parse(g.critical_solution_moves)
          : g.critical_solution_moves || [];
    } catch (_e) {}
    return {
      ...g,
      critical_solution_moves: solMoves
    };
  });

  const chronobiologyReport = computeChronobiologyReport(
    lichessGames,
    logsRes.rows || [],
    settings.lichess_username || ""
  );

  const opponents = opponentsRes.rows || [];
  const openingRepertoire = (openingRepRes.rows || []).map((row) => {
    let sanMoves = [];
    try {
      sanMoves =
        typeof row.san_moves_json === "string"
          ? JSON.parse(row.san_moves_json)
          : row.san_moves_json || [];
    } catch (_e) {}
    return {
      ...row,
      san_moves: sanMoves
    };
  });

  const advancedAnalytics = computeAdvancedAnalytics({
    logs: logsRes.rows || [],
    contextualJournal: journalRes.rows || [],
    puzzles,
    fsrsReviewLogs: fsrsLogsRes.rows || []
  });

  return {
    mode: "sqlite_native",
    driver: client.driver,
    dbPath: localDbPath || client.url,
    tursoReady: true,
    settings,
    puzzles,
    fsrsStats,
    dueQueueIds: dueQueue.map((p) => p.id),
    fsrsReviewLogs: fsrsLogsRes.rows || [],
    enduranceSessions,
    lichessProfile,
    lichessGames,
    chronobiologyReport,
    opponents,
    openingRepertoire,
    advancedAnalytics,
    logs: logsRes.rows || [],
    contextualJournal: journalRes.rows || [],
    completedDays: (daysRes.rows || []).map((r) => r.day_key),
    blindageHistory: blindageRes.rows || [],
    backups
  };
}

if (require.main === module) {
  initDatabase()
    .then(async (client) => {
      const backup = createBackup(false);
      const state = await getFullState();
      console.log(`[MIND FORTRESS DB] Initialisée avec succès (${client.driver})`);
      console.log(`[MIND FORTRESS DB] Puzzles en base : ${state.puzzles.length}`);
      if (backup) console.log(`[MIND FORTRESS DB] Sauvegarde auto : backups/${backup}`);
      client.close();
    })
    .catch((err) => {
      console.error("[MIND FORTRESS DB] Erreur d'initialisation :", err);
      process.exit(1);
    });
}

module.exports = {
  initDatabase,
  createBackup,
  recalculateStreak,
  getFullState
};
