/**
 * MIND FORTRESS — API Serverless Unifiée (Compatible Vercel Functions & Node.js HTTP)
 * Propulsée par SQLite Natif / libSQL (@libsql/client / Turso)
 */

const fs = require("fs");
const { URL } = require("url");
const { getDbClient, resolveLocalDbFilePath } = require("../db/client");
const { initDatabase, createBackup, recalculateStreak, getFullState } = require("../db/init");
const {
  reviewPuzzle,
  autoRateChessPuzzle,
  previewRatings,
  buildTrainingQueue,
  computeFSRSStats,
  WOODPECKER_CYCLES
} = require("../db/fsrs");
const {
  parsePgnGamesBatch,
  convertPositionToFsrsPuzzle,
  fetchLichessRemoteData
} = require("../db/lichess");
const {
  parseOpeningLineMoves,
  parseOpponentReferencePgn,
  reviewOpeningLineFSRS
} = require("../db/scouting");
const { querySqlAnalytics } = require("../db/analytics");

let initializedForUrl = null;

async function ensureDbReady(customUrl) {
  const client = getDbClient(customUrl);
  if (initializedForUrl !== client.url) {
    await initDatabase(customUrl);
    createBackup(false, customUrl);
    initializedForUrl = client.url;
  }
  return client;
}

function sendJson(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.end(body);
}

function readJsonBody(req) {
  if (req.body && typeof req.body === "object") {
    return Promise.resolve(req.body);
  }
  if (typeof req.body === "string" && req.body.trim()) {
    return Promise.resolve(JSON.parse(req.body));
  }
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk.toString("utf8");
    });
    req.on("end", () => {
      if (!raw || !raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function formatNowLabel() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  return `${dd}/${mm} · ${hh}:${min}`;
}

async function apiHandler(req, res, customUrl = null) {
  if (req.method === "OPTIONS") {
    return sendJson(res, { ok: true }, 200);
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const rawPath = parsedUrl.searchParams.get("__path") || parsedUrl.pathname;
  const pathname = rawPath.replace(/\/+$/, "") || "/";

  try {
    const client = await ensureDbReady(customUrl);

    // ========================================================================
    // GET ROUTES
    // ========================================================================
    if (req.method === "GET") {
      if (pathname === "/api/state" || pathname === "/api") {
        const state = await getFullState(customUrl);
        return sendJson(res, state, 200);
      }

      if (pathname === "/api/analytics") {
        const state = await getFullState(customUrl);
        const sqlAggregations = await querySqlAnalytics(client);
        return sendJson(
          res,
          {
            ok: true,
            advancedAnalytics: state.advancedAnalytics,
            sqlAggregations,
            chronobiologyReport: state.chronobiologyReport
          },
          200
        );
      }

      if (pathname === "/api/puzzles/due") {
        const state = await getFullState(customUrl);
        const modeParam = parsedUrl.searchParams.get("mode") || state.settings.training_mode || "fsrs";
        const limitParam = Number(parsedUrl.searchParams.get("limit") || 67);
        const queue = buildTrainingQueue(state.puzzles, modeParam, new Date()).slice(0, limitParam);
        const stats = computeFSRSStats(state.puzzles, new Date());
        return sendJson(
          res,
          {
            mode: modeParam,
            woodpeckerCycle: Number(state.settings.woodpecker_cycle || 1),
            woodpeckerCyclesInfo: WOODPECKER_CYCLES,
            stats,
            queue
          },
          200
        );
      }

      if (pathname === "/api/db/download") {
        const localPath = resolveLocalDbFilePath(customUrl);
        if (localPath && fs.existsSync(localPath)) {
          const data = fs.readFileSync(localPath);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/x-sqlite3");
          res.setHeader("Content-Disposition", 'attachment; filename="mind_fortress.db"');
          res.setHeader("Content-Length", String(data.length));
          return res.end(data);
        }
        return sendJson(
          res,
          { error: "Base hébergée sur Turso Cloud ou fichier local introuvable." },
          404
        );
      }

      return sendJson(res, { error: `Route GET inconnue: ${pathname}` }, 404);
    }

    // ========================================================================
    // POST ROUTES
    // ========================================================================
    if (req.method === "POST") {
      const payload = await readJsonBody(req);

      if (pathname === "/api/settings") {
        for (const [k, v] of Object.entries(payload)) {
          const valStr = typeof v === "string" ? v : JSON.stringify(v);
          await client.execute({
            sql: "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
            args: [k, valStr]
          });
        }
        return sendJson(res, await getFullState(customUrl), 200);
      }

      if (pathname === "/api/puzzles") {
        const code = payload.code || `PERSO-${Date.now() % 100000}`;
        const diff = Number(payload.diff || 3);
        const fsrsDifficulty = Math.min(10, Math.max(1, diff * 1.8));
        await client.execute({
          sql: `INSERT INTO puzzles (
                  code, title, fen, theme, type, diff, side, solution, solution_moves, hint,
                  custom, solved, attempts, box, fsrs_difficulty
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, 1, ?)`,
          args: [
            code,
            payload.title || "Puzzle perso",
            payload.fen || "",
            payload.theme || "fork",
            payload.type || "tactique",
            diff,
            payload.side || "Blancs",
            payload.solution || "Solution à compléter après résolution.",
            JSON.stringify(payload.solution_moves || []),
            payload.hint || "",
            fsrsDifficulty
          ]
        });
        return sendJson(res, await getFullState(customUrl), 200);
      }

      if (pathname === "/api/puzzles/solve") {
        const pid = Number(payload.id);
        const success = payload.success !== false ? 1 : 0;
        const timeSec = Number(payload.time_sec || 0);
        const hadMistake = Boolean(payload.had_mistake);
        const hintUsed = Boolean(payload.hint_used);
        const emotion = payload.emotion || "Focus";

        const rowRes = await client.execute({
          sql: "SELECT * FROM puzzles WHERE id = ?",
          args: [pid]
        });
        const row = rowRes.rows && rowRes.rows[0];
        let fsrsUpdate = null;

        if (row) {
          const retRes = await client.execute(
            "SELECT value FROM settings WHERE key = 'fsrs_request_retention'"
          );
          const requestRetention = Number(retRes.rows[0]?.value || 0.9);

          const rating = payload.rating
            ? Number(payload.rating)
            : autoRateChessPuzzle({
                success: Boolean(success),
                hadMistake,
                timeSec,
                diff: Number(row.diff || 2),
                hintUsed
              });

          fsrsUpdate = reviewPuzzle(row, rating, new Date(), requestRetention);

          const newAttempts = Number(row.attempts || 0) + 1;
          const newSolved = row.solved || fsrsUpdate.solved ? 1 : 0;
          let bestTime = Number(row.best_time_sec || 0);
          if (fsrsUpdate.solved && timeSec > 0 && (bestTime === 0 || timeSec < bestTime)) {
            bestTime = timeSec;
          }

          await client.execute({
            sql: `UPDATE puzzles
                  SET solved = ?,
                      attempts = ?,
                      box = ?,
                      best_time_sec = ?,
                      fsrs_state = ?,
                      fsrs_stability = ?,
                      fsrs_difficulty = ?,
                      fsrs_elapsed_days = ?,
                      fsrs_scheduled_days = ?,
                      fsrs_reps = ?,
                      fsrs_lapses = ?,
                      fsrs_last_review = ?,
                      fsrs_due_date = ?
                  WHERE id = ?`,
            args: [
              newSolved,
              newAttempts,
              fsrsUpdate.box,
              bestTime,
              fsrsUpdate.fsrs_state,
              fsrsUpdate.fsrs_stability,
              fsrsUpdate.fsrs_difficulty,
              fsrsUpdate.fsrs_elapsed_days,
              fsrsUpdate.fsrs_scheduled_days,
              fsrsUpdate.fsrs_reps,
              fsrsUpdate.fsrs_lapses,
              fsrsUpdate.fsrs_last_review,
              fsrsUpdate.fsrs_due_date,
              pid
            ]
          });

          // Enregistrement dans le journal mathématique FSRS (fsrs_review_logs)
          await client.execute({
            sql: `INSERT INTO fsrs_review_logs (
                    puzzle_id, rating, state, elapsed_days, scheduled_days,
                    solve_time_sec, stability, difficulty, reviewed_at
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
              pid,
              fsrsUpdate.rating,
              fsrsUpdate.fsrs_state,
              Math.round(fsrsUpdate.fsrs_elapsed_days),
              fsrsUpdate.fsrs_scheduled_days,
              timeSec,
              fsrsUpdate.fsrs_stability,
              fsrsUpdate.fsrs_difficulty,
              fsrsUpdate.fsrs_last_review
            ]
          });
        }

        const updatedState = await getFullState(customUrl);
        updatedState.lastFsrsReview = fsrsUpdate;
        return sendJson(res, updatedState, 200);
      }

      if (pathname === "/api/woodpecker/cycle") {
        const nextCycle = Math.min(5, Math.max(1, Number(payload.cycle || 1)));
        await client.execute({
          sql: "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('woodpecker_cycle', ?, CURRENT_TIMESTAMP)",
          args: [String(nextCycle)]
        });
        await client.execute({
          sql: "UPDATE puzzles SET woodpecker_cycle = ?",
          args: [nextCycle]
        });
        if (payload.reset_cycle_solved) {
          await client.execute("UPDATE puzzles SET solved = 0");
        }
        return sendJson(res, await getFullState(customUrl), 200);
      }

      if (pathname === "/api/endurance") {
        const nowIso = new Date().toISOString();
        const atLabel = formatNowLabel();
        const existingRes = await client.execute(
          "SELECT value FROM settings WHERE key = 'endurance_sessions_json'"
        );
        let sessions = [];
        try {
          if (existingRes.rows[0]?.value) {
            sessions = JSON.parse(existingRes.rows[0].value);
          }
        } catch (_e) {}

        const newSession = {
          id: Date.now(),
          created_at: nowIso,
          at_label: atLabel,
          scenario_id: payload.scenario_id || "scenario_a",
          scenario_title: payload.scenario_title || "Endurance FIDE",
          initial_sec: Number(payload.initial_sec || 3900),
          remaining_sec: Number(payload.remaining_sec || 0),
          increment_sec: Number(payload.increment_sec || 30),
          moves_played: Number(payload.moves_played || 0),
          increments_added_sec: Number(payload.increments_added_sec || 0),
          candidate_moves: Array.isArray(payload.candidate_moves) ? payload.candidate_moves : [],
          distraction_returns: Number(payload.distraction_returns || 0),
          flagged: Boolean(payload.flagged),
          notes: payload.notes || ""
        };

        sessions.unshift(newSession);
        sessions = sessions.slice(0, 100);

        await client.execute({
          sql: "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('endurance_sessions_json', ?, CURRENT_TIMESTAMP)",
          args: [JSON.stringify(sessions)]
        });
        await client.execute({
          sql: "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('endurance_notes', ?, CURRENT_TIMESTAMP)",
          args: [String(payload.notes || "")]
        });
        await client.execute({
          sql: "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('distraction_returns', ?, CURRENT_TIMESTAMP)",
          args: [String(newSession.distraction_returns)]
        });

        const updatedState = await getFullState(customUrl);
        updatedState.lastEnduranceSession = newSession;
        return sendJson(res, updatedState, 200);
      }

      if (pathname === "/api/logs") {
        const nowIso = new Date().toISOString();
        const atLabel = payload.at_label || formatNowLabel();
        const createdAt = payload.created_at || nowIso;
        const xpGain = Number(payload.xp || 0);
        const addMin = Number(payload.add_min || 0);
        const markToday = payload.mark_today !== false;

        await client.execute({
          sql: `INSERT INTO logs (
                  at_label, created_at, type, puzzle_id, text, theme, diff,
                  time_sec, success, xp, emotion, intensity, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            atLabel,
            createdAt,
            payload.type || "Force",
            payload.puzzle_id || null,
            payload.text || "Séance validée",
            payload.theme || "fork",
            Number(payload.diff || 2),
            Number(payload.time_sec || 0),
            payload.success !== false ? 1 : 0,
            xpGain,
            payload.emotion || "calme",
            Number(payload.intensity || 3),
            payload.notes || ""
          ]
        });

        // Mise à jour XP
        const xpRes = await client.execute("SELECT value FROM settings WHERE key = 'xp'");
        const curXp = Number(xpRes.rows[0]?.value || 0);
        await client.execute({
          sql: "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('xp', ?, CURRENT_TIMESTAMP)",
          args: [String(curXp + xpGain)]
        });

        // Mise à jour minutes totales
        if (addMin > 0) {
          const minRes = await client.execute("SELECT value FROM settings WHERE key = 'total_min'");
          const curMin = Number(minRes.rows[0]?.value || 0);
          await client.execute({
            sql: "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('total_min', ?, CURRENT_TIMESTAMP)",
            args: [String(curMin + addMin)]
          });
        }

        // Mise à jour compteur d'essais / réussites
        if (payload.increment_attempts) {
          const attRes = await client.execute("SELECT value FROM settings WHERE key = 'attempts'");
          const curAtt = Number(attRes.rows[0]?.value || 0);
          await client.execute({
            sql: "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('attempts', ?, CURRENT_TIMESTAMP)",
            args: [String(curAtt + 1)]
          });
          if (payload.success !== false) {
            const solRes = await client.execute(
              "SELECT value FROM settings WHERE key = 'solved_count'"
            );
            const curSol = Number(solRes.rows[0]?.value || 0);
            await client.execute({
              sql: "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('solved_count', ?, CURRENT_TIMESTAMP)",
              args: [String(curSol + 1)]
            });
          }
        }

        if (markToday) {
          const todayKey = new Date().toISOString().slice(0, 10);
          await client.execute({
            sql: "INSERT OR IGNORE INTO completed_days (day_key, status, sessions_count) VALUES (?, 'done', 1)",
            args: [todayKey]
          });
        }

        await recalculateStreak(client);
        return sendJson(res, await getFullState(customUrl), 200);
      }

      if (pathname === "/api/journal") {
        const nowIso = new Date().toISOString();
        await client.execute({
          sql: `INSERT INTO contextual_journal (
                  log_id, linked_text, created_at, at_label, note,
                  before_emotion, after_emotion, before_intensity, after_intensity,
                  lieu, bruit, sommeil, fatigue, pression, tag
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            payload.logId || null,
            payload.linkedText || "Séance libre — hors log",
            payload.createdAt || nowIso,
            payload.atLabel || formatNowLabel(),
            payload.note || "",
            payload.beforeEmotion || "stress",
            payload.afterEmotion || "calme",
            Number(payload.beforeIntensity || 3),
            Number(payload.afterIntensity || 2),
            payload.lieu || "Maison",
            payload.bruit || "Calme",
            payload.sommeil || "Bon",
            Number(payload.fatigue || 2),
            payload.pression || "Entraînement",
            payload.tag || ""
          ]
        });
        return sendJson(res, await getFullState(customUrl), 200);
      }

      if (pathname === "/api/days/toggle") {
        const dayKey = payload.day_key;
        if (dayKey) {
          const checkRes = await client.execute({
            sql: "SELECT day_key FROM completed_days WHERE day_key = ?",
            args: [dayKey]
          });
          if (checkRes.rows && checkRes.rows.length > 0) {
            await client.execute({
              sql: "DELETE FROM completed_days WHERE day_key = ?",
              args: [dayKey]
            });
          } else {
            await client.execute({
              sql: "INSERT INTO completed_days (day_key, status, sessions_count) VALUES (?, 'done', 1)",
              args: [dayKey]
            });
          }
          await recalculateStreak(client);
        }
        return sendJson(res, await getFullState(customUrl), 200);
      }

      if (pathname === "/api/blindage") {
        await client.execute({
          sql: `INSERT INTO blindage_entries (
                  created_at, wish, outcome, obstacle, plan,
                  col1, col2, col3, mode, breathing_cycles
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            new Date().toISOString(),
            payload.wish || "",
            payload.outcome || "",
            payload.obstacle || "",
            payload.plan || "",
            payload.col1 || "",
            payload.col2 || "",
            payload.col3 || "",
            payload.mode || "daily",
            Number(payload.breathing_cycles || 0)
          ]
        });
        return sendJson(res, await getFullState(customUrl), 200);
      }

      if (pathname === "/api/backup") {
        const fname = createBackup(true, customUrl);
        const state = await getFullState(customUrl);
        state.backupCreated = fname;
        return sendJson(res, state, 200);
      }

      if (pathname === "/api/import-json") {
        if ("level" in payload) {
          await client.execute({
            sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('level', ?)",
            args: [String(payload.level)]
          });
        }
        if ("xp" in payload) {
          await client.execute({
            sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('xp', ?)",
            args: [String(payload.xp)]
          });
        }
        if ("totalMin" in payload) {
          await client.execute({
            sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('total_min', ?)",
            args: [String(payload.totalMin)]
          });
        }
        if ("lichessUsername" in payload) {
          await client.execute({
            sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('lichess_username', ?)",
            args: [String(payload.lichessUsername)]
          });
        }
        if (payload.woop && typeof payload.woop === "object") {
          await client.execute({
            sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('woop_json', ?)",
            args: [JSON.stringify(payload.woop)]
          });
        }
        if (payload.journal && typeof payload.journal === "object") {
          await client.execute({
            sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('journal_3col_json', ?)",
            args: [JSON.stringify(payload.journal)]
          });
        }
        if (Array.isArray(payload.completedDays)) {
          for (const dk of payload.completedDays) {
            await client.execute({
              sql: "INSERT OR IGNORE INTO completed_days (day_key) VALUES (?)",
              args: [String(dk).slice(0, 10)]
            });
          }
        }
        if (Array.isArray(payload.customPuzzles)) {
          for (const cp of payload.customPuzzles) {
            await client.execute({
              sql: `INSERT OR IGNORE INTO puzzles (code, title, fen, theme, type, diff, side, solution, custom, solved)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0)`,
              args: [
                cp.code || `IMPORT-${Date.now() % 100000}`,
                cp.title || cp.description || "Puzzle importé",
                cp.fen || "",
                cp.theme || "fork",
                cp.type || "tactique",
                Number(cp.diff || cp.difficulty || 3),
                cp.side || "Blancs",
                cp.solution || ""
              ]
            });
          }
        }
        if (Array.isArray(payload.journalContextuel)) {
          for (const cj of payload.journalContextuel) {
            await client.execute({
              sql: `INSERT INTO contextual_journal (
                      log_id, linked_text, created_at, at_label, note,
                      before_emotion, after_emotion, before_intensity, after_intensity,
                      lieu, bruit, sommeil, fatigue, pression, tag
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              args: [
                cj.logId || null,
                cj.linkedText || "Séance importée",
                cj.createdAt || new Date().toISOString(),
                cj.atLabel || "Importé",
                cj.note || "",
                cj.beforeEmotion || "stress",
                cj.afterEmotion || "calme",
                Number(cj.beforeIntensity || 3),
                Number(cj.afterIntensity || 2),
                cj.lieu || "Maison",
                cj.bruit || "Calme",
                cj.sommeil || "Bon",
                Number(cj.fatigue || 2),
                cj.pression || "Entraînement",
                cj.tag || ""
              ]
            });
          }
        }
        await recalculateStreak(client);
        return sendJson(res, await getFullState(customUrl), 200);
      }

      if (pathname === "/api/lichess/sync") {
        let username = String(payload.username || "").trim();
        if (!username) {
          const uRes = await client.execute(
            "SELECT value FROM settings WHERE key = 'lichess_username'"
          );
          username = String(uRes.rows[0]?.value || "").trim();
        } else {
          await client.execute({
            sql: "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('lichess_username', ?, CURRENT_TIMESTAMP)",
            args: [username]
          });
        }

        let effectivePgn = String(payload.raw_pgn || "").trim();
        let profileData = payload.profile && typeof payload.profile === "object" ? payload.profile : null;

        if (!effectivePgn && username) {
          const remote = await fetchLichessRemoteData(username, Number(payload.max_games || 10));
          if (remote.rawPgn) effectivePgn = remote.rawPgn;
          if (!profileData && remote.profile) profileData = remote.profile;
        }

        if (profileData) {
          await client.execute({
            sql: "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('lichess_profile_json', ?, CURRENT_TIMESTAMP)",
            args: [JSON.stringify(profileData)]
          });
        }

        const beforeCountRes = await client.execute("SELECT COUNT(*) AS c FROM lichess_games");
        const beforeCount = Number(beforeCountRes.rows[0]?.c || 0);

        const parsedGames = effectivePgn ? parsePgnGamesBatch(effectivePgn, username) : [];
        for (const g of parsedGames) {
          await client.execute({
            sql: `INSERT OR IGNORE INTO lichess_games (
                    id, white, black, result, speed, played_at, pgn, hour_of_day,
                    opening, critical_fen, critical_move_san, critical_solution_moves,
                    critical_side, critical_move_number
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
              g.id,
              g.white,
              g.black,
              g.result,
              g.speed,
              g.played_at,
              g.pgn,
              Number(g.hour_of_day ?? 14),
              g.opening || "Ouverture Classique",
              g.critical_fen || "",
              g.critical_move_san || "",
              JSON.stringify(g.critical_solution_moves || []),
              g.critical_side || "Blancs",
              Number(g.critical_move_number || 15)
            ]
          });
        }

        const afterCountRes = await client.execute("SELECT COUNT(*) AS c FROM lichess_games");
        const afterCount = Number(afterCountRes.rows[0]?.c || 0);
        const insertedCount = Math.max(0, afterCount - beforeCount);

        const updatedState = await getFullState(customUrl);
        updatedState.syncReport = {
          username,
          parsedCount: parsedGames.length,
          insertedCount,
          duplicatesSkipped: Math.max(0, parsedGames.length - insertedCount),
          totalInDb: afterCount
        };
        return sendJson(res, updatedState, 200);
      }

      if (pathname === "/api/lichess/to-puzzle") {
        let pzInput = { ...payload };

        if (payload.game_id) {
          const gRes = await client.execute({
            sql: "SELECT * FROM lichess_games WHERE id = ?",
            args: [String(payload.game_id)]
          });
          const gRow = gRes.rows && gRes.rows[0];
          if (!gRow) {
            return sendJson(res, { error: `Partie Lichess introuvable: ${payload.game_id}` }, 404);
          }

          let critFen = gRow.critical_fen;
          let critMoves = [];
          try {
            critMoves =
              typeof gRow.critical_solution_moves === "string"
                ? JSON.parse(gRow.critical_solution_moves)
                : gRow.critical_solution_moves || [];
          } catch (_e) {}

          if (!critFen && gRow.pgn) {
            const parsed = parsePgnGamesBatch(gRow.pgn, "");
            if (parsed[0]) {
              critFen = parsed[0].critical_fen;
              critMoves = parsed[0].critical_solution_moves;
            }
          }

          pzInput = {
            gameId: gRow.id,
            white: gRow.white,
            black: gRow.black,
            fen: payload.fen || critFen,
            solution_moves: payload.solution_moves || critMoves,
            moveNumber: payload.moveNumber || gRow.critical_move_number || 15,
            theme: payload.theme || "middlegame",
            diff: payload.diff || 3,
            title:
              payload.title ||
              `Gaffe / Moment clé · ${gRow.white} vs ${gRow.black} (${gRow.opening || gRow.speed || "Lichess"})`,
            hint:
              payload.hint ||
              `Extrait de la partie ${gRow.white} vs ${gRow.black} (${gRow.played_at || "Lichess"}).`
          };
        }

        const builtPuzzle = convertPositionToFsrsPuzzle(pzInput);

        const insRes = await client.execute({
          sql: `INSERT INTO puzzles (
                  code, title, fen, theme, type, diff, side, solution, solution_moves, hint,
                  custom, solved, attempts, box, fsrs_state, fsrs_stability, fsrs_difficulty
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, 1, 0, 0.0, ?)`,
          args: [
            builtPuzzle.code,
            builtPuzzle.title,
            builtPuzzle.fen,
            builtPuzzle.theme,
            builtPuzzle.type,
            builtPuzzle.diff,
            builtPuzzle.side,
            builtPuzzle.solution,
            JSON.stringify(builtPuzzle.solution_moves || []),
            builtPuzzle.hint,
            builtPuzzle.fsrs_difficulty
          ]
        });

        const updatedState = await getFullState(customUrl);
        updatedState.createdPuzzle = {
          ...builtPuzzle,
          id: Number(insRes.lastInsertRowid || 0)
        };
        return sendJson(res, updatedState, 200);
      }

      if (pathname === "/api/opponents") {
        const name = String(payload.name || "").trim();
        if (!name) {
          return sendJson(res, { error: "Le nom de l'adversaire est obligatoire." }, 400);
        }

        const fideElo = payload.fide_elo ? Number(payload.fide_elo) : null;
        const lichessUsername = String(payload.lichess_username || "").trim();
        const style = String(payload.style || "Solide / Positionnel").trim();
        const psychProfile = String(payload.psych_profile || "").trim();
        const whiteRep = String(payload.white_repertoire || "").trim();
        const blackRep = String(payload.black_repertoire || "").trim();
        const refPgn = String(payload.reference_pgn || "").trim();
        const matchPlan = String(payload.match_plan || "").trim();

        let opponentId = payload.id ? Number(payload.id) : null;
        if (opponentId) {
          await client.execute({
            sql: `UPDATE opponents
                  SET name = ?, fide_elo = ?, lichess_username = ?, style = ?,
                      psych_profile = ?, white_repertoire = ?, black_repertoire = ?,
                      reference_pgn = ?, match_plan = ?, updated_at = CURRENT_TIMESTAMP
                  WHERE id = ?`,
            args: [
              name,
              fideElo,
              lichessUsername,
              style,
              psychProfile,
              whiteRep,
              blackRep,
              refPgn,
              matchPlan,
              opponentId
            ]
          });
        } else {
          const insOpp = await client.execute({
            sql: `INSERT INTO opponents (
                    name, fide_elo, lichess_username, style, psych_profile,
                    white_repertoire, black_repertoire, reference_pgn, match_plan
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
              name,
              fideElo,
              lichessUsername,
              style,
              psychProfile,
              whiteRep,
              blackRep,
              refPgn,
              matchPlan
            ]
          });
          opponentId = Number(insOpp.lastInsertRowid || 0);
        }

        const updatedState = await getFullState(customUrl);
        updatedState.lastOpponent = updatedState.opponents.find((o) => o.id === opponentId) || null;
        return sendJson(res, updatedState, 200);
      }

      if (pathname === "/api/openings") {
        const name = String(payload.name || "").trim();
        const movesText = String(payload.moves || "").trim();
        if (!name || !movesText) {
          return sendJson(
            res,
            { error: "Le nom et la séquence de coups de l'ouverture sont obligatoires." },
            400
          );
        }

        const startFen = String(payload.start_fen || "start").trim();
        const parsedLine = parseOpeningLineMoves(movesText, startFen);
        if (!parsedLine.valid) {
          return sendJson(
            res,
            { error: parsedLine.error || "Séquence de coups d'ouverture illégale sur ValisoaChessLite." },
            400
          );
        }

        const side = payload.side === "Noirs" ? "Noirs" : "Blancs";
        const eco = String(payload.eco || "").trim();
        const plan = String(payload.plan || "").trim();
        const mastery = Math.min(100, Math.max(0, Number(payload.mastery ?? 60)));
        const sanMovesJson = JSON.stringify(parsedLine.sanMoves);
        const finalFen = parsedLine.finalFen;

        let lineId = payload.id ? Number(payload.id) : null;
        if (lineId) {
          await client.execute({
            sql: `UPDATE opening_repertoire
                  SET side = ?, name = ?, eco = ?, moves = ?, plan = ?, start_fen = ?,
                      mastery = ?, san_moves_json = ?, final_fen = ?, updated_at = CURRENT_TIMESTAMP
                  WHERE id = ?`,
            args: [
              side,
              name,
              eco,
              movesText,
              plan,
              startFen,
              mastery,
              sanMovesJson,
              finalFen,
              lineId
            ]
          });
        } else {
          const insLine = await client.execute({
            sql: `INSERT INTO opening_repertoire (
                    side, name, eco, moves, plan, start_fen, mastery, san_moves_json, final_fen
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [side, name, eco, movesText, plan, startFen, mastery, sanMovesJson, finalFen]
          });
          lineId = Number(insLine.lastInsertRowid || 0);
        }

        const updatedState = await getFullState(customUrl);
        updatedState.lastOpeningLine =
          updatedState.openingRepertoire.find((l) => l.id === lineId) || null;
        return sendJson(res, updatedState, 200);
      }

      if (pathname === "/api/openings/review") {
        const lineId = Number(payload.id);
        const rating = Number(payload.rating || 3);
        const rowRes = await client.execute({
          sql: "SELECT * FROM opening_repertoire WHERE id = ?",
          args: [lineId]
        });
        const row = rowRes.rows && rowRes.rows[0];
        if (!row) {
          return sendJson(res, { error: `Ligne d'ouverture introuvable: ${lineId}` }, 404);
        }

        const rev = reviewOpeningLineFSRS(row, rating, new Date());
        await client.execute({
          sql: `UPDATE opening_repertoire
                SET mastery = ?,
                    fsrs_state = ?,
                    fsrs_stability = ?,
                    fsrs_difficulty = ?,
                    fsrs_reps = ?,
                    fsrs_lapses = ?,
                    fsrs_last_review = ?,
                    fsrs_due_date = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?`,
          args: [
            rev.mastery,
            rev.fsrs_state,
            rev.fsrs_stability,
            rev.fsrs_difficulty,
            rev.fsrs_reps,
            rev.fsrs_lapses,
            rev.fsrs_last_review,
            rev.fsrs_due_date,
            lineId
          ]
        });

        const updatedState = await getFullState(customUrl);
        updatedState.lastOpeningReview = rev;
        return sendJson(res, updatedState, 200);
      }

      if (pathname === "/api/reset") {
        createBackup(true, customUrl);
        await client.batch([
          "DELETE FROM contextual_journal",
          "DELETE FROM logs",
          "DELETE FROM completed_days",
          "DELETE FROM blindage_entries",
          "DELETE FROM fsrs_review_logs",
          "DELETE FROM lichess_games",
          "DELETE FROM opponents",
          "DELETE FROM opening_repertoire",
          "DELETE FROM puzzles WHERE custom = 1",
          "UPDATE puzzles SET solved = 0, attempts = 0, box = 1, best_time_sec = 0, fsrs_state = 0, fsrs_stability = 0, fsrs_reps = 0, fsrs_lapses = 0, fsrs_last_review = NULL, fsrs_due_date = NULL",
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('xp', '0')",
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('streak', '0')",
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('total_min', '0')",
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('attempts', '0')",
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('solved_count', '0')",
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('endurance_sessions_json', '[]')",
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('lichess_profile_json', 'null')"
        ]);
        return sendJson(res, await getFullState(customUrl), 200);
      }

      return sendJson(res, { error: `Route POST inconnue: ${pathname}` }, 404);
    }

    // ========================================================================
    // DELETE ROUTES
    // ========================================================================
    if (req.method === "DELETE") {
      const idParam = parsedUrl.searchParams.get("id");
      if (idParam) {
        const idNum = Number(idParam);
        if (pathname === "/api/journal") {
          await client.execute({
            sql: "DELETE FROM contextual_journal WHERE id = ?",
            args: [idNum]
          });
        } else if (pathname === "/api/logs") {
          await client.execute({
            sql: "DELETE FROM logs WHERE id = ?",
            args: [idNum]
          });
        } else if (pathname === "/api/puzzles") {
          await client.execute({
            sql: "DELETE FROM puzzles WHERE id = ? AND custom = 1",
            args: [idNum]
          });
        } else if (pathname === "/api/lichess") {
          await client.execute({
            sql: "DELETE FROM lichess_games WHERE id = ?",
            args: [String(idParam)]
          });
        } else if (pathname === "/api/opponents") {
          await client.execute({
            sql: "DELETE FROM opponents WHERE id = ?",
            args: [idNum]
          });
        } else if (pathname === "/api/openings") {
          await client.execute({
            sql: "DELETE FROM opening_repertoire WHERE id = ?",
            args: [idNum]
          });
        }
      }
      return sendJson(res, await getFullState(customUrl), 200);
    }

    return sendJson(res, { error: `Méthode non supportée: ${req.method}` }, 405);
  } catch (err) {
    console.error("[MIND FORTRESS API ERROR]", err);
    return sendJson(res, { error: err.message || String(err) }, 500);
  }
}

module.exports = apiHandler;
