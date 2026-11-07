/**
 * ValisoaLichess.js — Synchronisation Lichess, Conversion PGN -> Puzzles FSRS & Diagnostic Chronobiologique
 * Propulsé par ValisoaChesspgnparser.js & ValisoaChessLite.js pour MIND FORTRESS (Madagascar 2027)
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ValisoaLichess = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DEFAULT_START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

  const CHRONO_SLOTS_DEF = [
    {
      id: "matin",
      label: "Matin (05h–11h)",
      shortLabel: "05h–11h",
      icon: "🌅",
      Advice: "Créneau idéal pour le calcul pur FSRS et les rondes matinales du Championnat."
    },
    {
      id: "midi",
      label: "Midi / Après-midi (12h–16h)",
      shortLabel: "12h–16h",
      icon: "☀️",
      Advice: "Heure officielle des rondes FIDE (14h00–18h00) : travaille l'Endurance 90'+30s ici."
    },
    {
      id: "soir",
      label: "Soir (17h–21h)",
      shortLabel: "17h–21h",
      icon: "🌆",
      Advice: "Bon créneau pour la révision légère du répertoire et le Blindage mental."
    },
    {
      id: "nuit",
      label: "Nuit (22h–04h)",
      shortLabel: "22h–04h",
      icon: "🌙",
      Advice: "Zone de fatigue nerveuse : évite le Blitz impulsif, privilégie le sommeil réparateur."
    }
  ];

  function getSlotIdForHour(hour) {
    const h = Number(hour);
    if (!Number.isFinite(h) || h < 0 || h > 23) return "midi";
    if (h >= 5 && h <= 11) return "matin";
    if (h >= 12 && h <= 16) return "midi";
    if (h >= 17 && h <= 21) return "soir";
    return "nuit";
  }

  function cleanSanToken(san) {
    if (!san || typeof san !== "string") return "";
    return san
      .trim()
      .replace(/^0-0-0/, "O-O-O")
      .replace(/^0-0/, "O-O")
      .replace(/[!?]+$/g, "");
  }

  function simpleHashId(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return "lg_" + (h >>> 0).toString(16).padStart(8, "0");
  }

  function inferSpeedFromTags(tags) {
    if (!tags) return "rapid";
    const ev = String(tags.Event || "").toLowerCase();
    if (ev.includes("classical") || ev.includes("standard") || ev.includes("championnat")) return "classical";
    if (ev.includes("rapid")) return "rapid";
    if (ev.includes("blitz")) return "blitz";
    if (ev.includes("bullet")) return "bullet";
    if (ev.includes("correspondence")) return "classical";

    const tc = String(tags.TimeControl || "");
    const m = tc.match(/^(\d+)(?:\+(\d+))?/);
    if (m) {
      const baseSec = Number(m[1] || 0);
      const incSec = Number(m[2] || 0);
      const estTotal = baseSec + incSec * 40;
      if (estTotal >= 1500) return "classical";
      if (estTotal >= 480) return "rapid";
      if (estTotal >= 180) return "blitz";
      return "bullet";
    }
    return "rapid";
  }

  function extractHourFromTags(tags) {
    if (!tags) return 14;
    const tStr = String(tags.UTCTime || tags.Time || "");
    const m = tStr.match(/^(\d{1,2}):/);
    if (m) {
      const h = Number(m[1]);
      if (h >= 0 && h <= 23) return h;
    }
    return 14;
  }

  function extractGameId(tags, rawMovesKey) {
    if (tags && tags.Site) {
      const m = String(tags.Site).match(/lichess\.org\/([a-zA-Z0-9]{8,12})/);
      if (m && m[1]) return m[1].slice(0, 8);
    }
    if (tags && tags.GameId) {
      return String(tags.GameId);
    }
    const sig = `${tags?.White || "W"}|${tags?.Black || "B"}|${tags?.UTCDate || tags?.Date || ""}|${tags?.UTCTime || ""}|${rawMovesKey}`;
    return simpleHashId(sig);
  }

  function rebuildSingleGamePgn(tags, movesList, result) {
    const lines = [];
    const orderedKeys = ["Event", "Site", "Date", "UTCDate", "UTCTime", "White", "Black", "Result", "TimeControl", "ECO", "Opening"];
    const used = new Set();
    if (tags && typeof tags === "object") {
      for (const k of orderedKeys) {
        if (tags[k] !== undefined) {
          lines.push(`[${k} "${tags[k]}"]`);
          used.add(k);
        }
      }
      for (const [k, v] of Object.entries(tags)) {
        if (!used.has(k) && v !== undefined) {
          lines.push(`[${k} "${v}"]`);
        }
      }
    }
    lines.push("");
    const moveTokens = [];
    for (let i = 0; i < movesList.length; i++) {
      if (i % 2 === 0) {
        moveTokens.push(`${Math.floor(i / 2) + 1}. ${movesList[i]}`);
      } else {
        moveTokens.push(movesList[i]);
      }
    }
    if (result) moveTokens.push(result);
    lines.push(moveTokens.join(" "));
    return lines.join("\n").trim();
  }

  /**
   * Analyse un lot de parties PGN (multi-parties) avec ValisoaChesspgnparser et ValisoaChessLite
   */
  function parsePgnGamesBatch(pgnText, username = "", pgnParser = null, ChessLiteClass = null) {
    const raw = String(pgnText || "").trim();
    if (!raw) return [];

    const parser =
      pgnParser ||
      (typeof window !== "undefined" && window.ValisoaChesspgnparser) ||
      null;
    const ChessCtor =
      ChessLiteClass ||
      (typeof window !== "undefined" && window.ValisoaChessLite) ||
      null;

    if (!parser || !ChessCtor) {
      throw new Error("ValisoaChesspgnparser et ValisoaChessLite sont requis pour analyser les parties PGN.");
    }

    let parsedGames = [];
    try {
      parsedGames = parser.parse(raw, { startRule: "games" });
      if (!Array.isArray(parsedGames) || parsedGames.length === 0) {
        const single = parser.parse(raw, { startRule: "game" });
        if (single) parsedGames = [single];
      }
    } catch (_err) {
      // Fallback découpage par blocs [Event "..."] si un bloc isolé comporte un commentaire non standard
      const chunks = raw
        .split(/(?=\[Event\s+")/g)
        .map((c) => c.trim())
        .filter(Boolean);
      for (const ch of chunks) {
        try {
          const g = parser.parse(ch, { startRule: "game" });
          if (g) parsedGames.push(g);
        } catch (_e2) {}
      }
    }

    const results = [];
    const seenIds = new Set();

    for (const gObj of parsedGames) {
      if (!gObj || !Array.isArray(gObj.moves) || gObj.moves.length === 0) continue;
      const tags = gObj.tags || {};
      const startFen = tags.SetUp === "1" && tags.FEN ? tags.FEN : DEFAULT_START_FEN;
      const chess = new ChessCtor();
      if (!chess.load(startFen)) continue;

      const frames = [];
      const sanMoves = [];
      let flaggedCriticalIdx = -1;

      for (let idx = 0; idx < gObj.moves.length; idx++) {
        const mNode = gObj.moves[idx];
        const fenBefore = chess.fen();
        const turnBefore = typeof chess.turn === "function" ? chess.turn() : chess.turn || "w";
        const rawSan = cleanSanToken(mNode.move);
        const mv = chess.move(rawSan);
        if (!mv) break;

        const commentStr = Array.isArray(mNode.comments) ? mNode.comments.join(" ") : "";
        const nags = Array.isArray(mNode.nags) ? mNode.nags : [];
        const hasBlunderAnnotation =
          nags.includes("$2") ||
          nags.includes("$4") ||
          nags.includes("$6") ||
          /\?\?|gaffe|blunder|mistake|erreur|tactique|critique/i.test(commentStr);

        if (hasBlunderAnnotation && flaggedCriticalIdx === -1) {
          flaggedCriticalIdx = frames.length;
        }

        sanMoves.push(mv.san);
        frames.push({
          ply: frames.length + 1,
          moveNumber: Math.floor(frames.length / 2) + 1,
          fenBefore,
          fenAfter: chess.fen(),
          turnBefore,
          san: mv.san,
          comment: commentStr,
          nags
        });
      }

      if (frames.length === 0) continue;

      // Déterminer la couleur du joueur s'il a renseigné son pseudo
      const whiteName = tags.White || "Blancs";
      const blackName = tags.Black || "Noirs";
      const userLower = String(username || "").trim().toLowerCase();
      let preferredTurn = null;
      if (userLower) {
        if (blackName.toLowerCase() === userLower) preferredTurn = "b";
        else if (whiteName.toLowerCase() === userLower) preferredTurn = "w";
      }

      // Choisir la position critique (soit annotée, soit au coeur du milieu de jeu)
      let critIdx = flaggedCriticalIdx;
      if (critIdx === -1) {
        const midIdx = Math.min(frames.length - 1, Math.max(0, Math.floor(frames.length * 0.55)));
        critIdx = midIdx;
        if (preferredTurn && frames[critIdx].turnBefore !== preferredTurn) {
          if (critIdx + 1 < frames.length && frames[critIdx + 1].turnBefore === preferredTurn) {
            critIdx = critIdx + 1;
          } else if (critIdx - 1 >= 0 && frames[critIdx - 1].turnBefore === preferredTurn) {
            critIdx = critIdx - 1;
          }
        }
      }

      const critFrame = frames[critIdx];
      const solutionMoves = frames.slice(critIdx, Math.min(frames.length, critIdx + 3)).map((f) => f.san);

      const gameResult = gObj.result || tags.Result || "*";
      const id = extractGameId(tags, sanMoves.join(","));
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      const dateStr = tags.UTCDate || tags.Date || new Date().toISOString().slice(0, 10).replace(/-/g, ".");
      const timeStr = tags.UTCTime || tags.Time || "14:00:00";
      const playedAt = `${dateStr.replace(/\./g, "-")} ${timeStr}`;
      const hourOfDay = extractHourFromTags(tags);
      const speed = inferSpeedFromTags(tags);
      const cleanPgn = rebuildSingleGamePgn(tags, sanMoves, gameResult);

      results.push({
        id,
        white: whiteName,
        black: blackName,
        result: gameResult,
        speed,
        played_at: playedAt,
        hour_of_day: hourOfDay,
        opening: tags.Opening || tags.ECO || "Ouverture Classique",
        pgn: cleanPgn,
        moves_count: frames.length,
        critical_fen: critFrame.fenBefore,
        critical_move_san: critFrame.san,
        critical_solution_moves: solutionMoves,
        critical_side: critFrame.turnBefore === "b" ? "Noirs" : "Blancs",
        critical_move_number: critFrame.moveNumber,
        critical_comment: critFrame.comment || ""
      });
    }

    return results;
  }

  /**
   * Convertit une partie Lichess ou une position PGN en Puzzle FSRS vérifié par ValisoaChessLite
   */
  function convertPositionToFsrsPuzzle(options, ChessLiteClass = null) {
    const ChessCtor =
      ChessLiteClass ||
      (typeof window !== "undefined" && window.ValisoaChessLite) ||
      null;

    if (!ChessCtor) {
      throw new Error("ValisoaChessLite est requis pour valider le puzzle généré.");
    }

    const fen = String(options.fen || options.critical_fen || DEFAULT_START_FEN).trim();
    const chess = new ChessCtor();
    if (!chess.load(fen)) {
      throw new Error(`FEN invalide pour la création de puzzle : ${fen}`);
    }

    const turnVal = typeof chess.turn === "function" ? chess.turn() : chess.turn || "w";
    const side = turnVal === "b" ? "Noirs" : "Blancs";
    const candidateSolutionMoves = Array.isArray(options.solution_moves)
      ? options.solution_moves
      : Array.isArray(options.critical_solution_moves)
      ? options.critical_solution_moves
      : options.nextMoveSan
      ? [options.nextMoveSan]
      : [];

    const validMoves = [];
    for (const rawMove of candidateSolutionMoves) {
      const cleaned = cleanSanToken(rawMove);
      if (!cleaned) continue;
      const mv = chess.move(cleaned);
      if (mv) {
        validMoves.push(mv.san);
      } else {
        break;
      }
    }

    // Si aucun coup n'a été fourni, utiliser le premier coup légal de la position pour garantir la jouabilité
    if (validMoves.length === 0) {
      const legalMoves = chess.moves();
      if (legalMoves && legalMoves.length > 0) {
        const mv = chess.move(legalMoves[0]);
        if (mv) validMoves.push(mv.san);
      }
    }

    const gameIdPart = options.gameId || options.id || String(Date.now() % 100000);
    const code = options.code || `LI-${String(gameIdPart).slice(0, 8).toUpperCase()}`;
    const white = options.white || "Blancs";
    const black = options.black || "Noirs";
    const moveNum = options.moveNumber || options.critical_move_number || 15;
    const title =
      options.title ||
      `Gaffe / Position critique · ${white} vs ${black} (Coup ${moveNum})`;
    const diff = Math.min(5, Math.max(1, Number(options.diff || 3)));
    const fsrsDifficulty = Number(Math.min(10, Math.max(1, diff * 1.8)).toFixed(2));
    const solutionText =
      options.solution ||
      `${validMoves.join(" ")} — Suite critique extraite de ${white} vs ${black}.`;

    return {
      code,
      title,
      fen,
      theme: options.theme || "middlegame",
      type: options.type || "tactique",
      diff,
      side,
      solution: solutionText,
      solution_moves: validMoves,
      hint:
        options.hint ||
        `Position issue de la partie ${white} vs ${black} (coup ${moveNum}). Trouve la meilleure suite (${side}).`,
      custom: 1,
      solved: 0,
      attempts: 0,
      box: 1,
      fsrs_state: 0,
      fsrs_stability: 0.0,
      fsrs_difficulty: fsrsDifficulty
    };
  }

  /**
   * Calcule le Diagnostic Chronobiologique sur 4 créneaux horaires
   * en croisant les parties Lichess (lichess_games) et les séances d'entraînement (logs).
   */
  function computeChronobiologyReport(lichessGames = [], logs = [], username = "") {
    const buckets = {};
    for (const def of CHRONO_SLOTS_DEF) {
      buckets[def.id] = {
        ...def,
        gamesCount: 0,
        logsCount: 0,
        totalEvents: 0,
        scoreSum: 0,
        successRatePct: null
      };
    }

    const userLower = String(username || "").trim().toLowerCase();

    for (const g of lichessGames || []) {
      let hr = Number(g.hour_of_day);
      if (!Number.isFinite(hr) && g.played_at) {
        const m = String(g.played_at).match(/(\d{1,2}):\d{2}/);
        if (m) hr = Number(m[1]);
      }
      if (!Number.isFinite(hr)) hr = 14;

      const slotId = getSlotIdForHour(hr);
      const b = buckets[slotId];
      if (!b) continue;

      const res = String(g.result || "*");
      const whiteLower = String(g.white || "").toLowerCase();
      const blackLower = String(g.black || "").toLowerCase();

      let score = 0.5;
      const isBlack = userLower && blackLower === userLower && whiteLower !== userLower;
      if (res === "1-0") {
        score = isBlack ? 0 : 1;
      } else if (res === "0-1") {
        score = isBlack ? 1 : 0;
      } else if (res === "1/2-1/2") {
        score = 0.5;
      } else {
        continue;
      }

      b.gamesCount += 1;
      b.totalEvents += 1;
      b.scoreSum += score;
    }

    for (const lg of logs || []) {
      let hr = null;
      if (lg.created_at) {
        const d = new Date(lg.created_at);
        if (!Number.isNaN(d.getTime())) {
          hr = d.getUTCHours();
        }
      }
      if (hr === null && lg.at_label) {
        const m = String(lg.at_label).match(/(\d{1,2}):\d{2}/);
        if (m) hr = Number(m[1]);
      }
      if (hr === null || !Number.isFinite(hr)) continue;

      const slotId = getSlotIdForHour(hr);
      const b = buckets[slotId];
      if (!b) continue;

      const isOk = lg.success === 1 || lg.success === true;
      b.logsCount += 1;
      b.totalEvents += 1;
      b.scoreSum += isOk ? 1 : 0;
    }

    const slots = CHRONO_SLOTS_DEF.map((def) => {
      const b = buckets[def.id];
      const successRatePct =
        b.totalEvents > 0 ? Math.round((b.scoreSum / b.totalEvents) * 100) : null;
      return {
        ...b,
        successRatePct
      };
    });

    const activeSlots = slots.filter((s) => s.totalEvents > 0);
    let peakSlot = null;
    let riskSlot = null;

    if (activeSlots.length > 0) {
      const sortedDesc = [...activeSlots].sort((a, b) => {
        if (b.successRatePct !== a.successRatePct) return b.successRatePct - a.successRatePct;
        return b.totalEvents - a.totalEvents;
      });
      peakSlot = sortedDesc[0];

      const sortedAsc = [...activeSlots].sort((a, b) => {
        if (a.successRatePct !== b.successRatePct) return a.successRatePct - b.successRatePct;
        return b.totalEvents - a.totalEvents;
      });
      if (activeSlots.length >= 2 || sortedAsc[0].successRatePct < 60) {
        riskSlot = sortedAsc[0];
      }
    }

    const totalAnalyzed = activeSlots.reduce((acc, s) => acc + s.totalEvents, 0);
    let recommendation =
      "Synchronise tes parties Lichess ou valide quelques séances pour révéler ton profil chronobiologique réel.";
    if (peakSlot && riskSlot && peakSlot.id !== riskSlot.id) {
      recommendation = `Pic de lucidité détecté sur « ${peakSlot.label} » (${peakSlot.successRatePct}% de réussite) contre ${riskSlot.successRatePct}% sur « ${riskSlot.label} ». Planifie tes calculs complexes FSRS sur ${peakSlot.shortLabel} et applique le Tilt Reboot sur ${riskSlot.shortLabel}.`;
    } else if (peakSlot) {
      recommendation = `Créneau fort actuel : « ${peakSlot.label} » (${peakSlot.successRatePct}% de réussite sur ${peakSlot.totalEvents} séance(s)/partie(s)). Continue d'alimenter tes données.`;
    }

    return {
      totalAnalyzed,
      slots,
      peakSlot,
      riskSlot,
      recommendation
    };
  }

  return {
    CHRONO_SLOTS_DEF,
    getSlotIdForHour,
    parsePgnGamesBatch,
    convertPositionToFsrsPuzzle,
    computeChronobiologyReport
  };
});
