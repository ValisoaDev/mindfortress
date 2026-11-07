/**
 * ValisoaScoutingOpenings.js — Module « Scouting Adversaires Madagascar 2027 » & Répertoire d'Ouvertures Interactif FSRS
 * Propulsé par ValisoaChessLite.js, ValisoaChessboard.js, ValisoaChesspgnparser.js & ValisoaFSRS.js
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ValisoaScoutingOpenings = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DEFAULT_START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

  const OPPONENT_STYLES = [
    "Tactique / Agressif",
    "Solide / Positionnel",
    "Spécialiste Finales",
    "Joueur de Zeitnot",
    "Théoricien d'Ouvertures",
    "Contre-attaquant / Dynamique"
  ];

  function normalizeSanToken(token) {
    if (!token || typeof token !== "string") return "";
    return token
      .trim()
      .replace(/^0-0-0/, "O-O-O")
      .replace(/^0-0/, "O-O")
      .replace(/[!?]+$/g, "");
  }

  /**
   * Analyse et valide une séquence de coups d'ouverture (format PGN ou liste SAN)
   * avec ValisoaChesspgnparser et ValisoaChessLite.
   */
  function parseOpeningLineMoves(movesText, startFen = "start", pgnParser = null, ChessLiteClass = null) {
    const ChessCtor =
      ChessLiteClass ||
      (typeof window !== "undefined" && window.ValisoaChessLite) ||
      null;
    const parser =
      pgnParser ||
      (typeof window !== "undefined" && window.ValisoaChesspgnparser) ||
      null;

    if (!ChessCtor) {
      throw new Error("ValisoaChessLite est requis pour valider une ligne d'ouverture.");
    }

    const effectiveStartFen =
      !startFen || startFen === "start" ? DEFAULT_START_FEN : String(startFen).trim();

    const chess = new ChessCtor();
    if (!chess.load(effectiveStartFen)) {
      return {
        valid: false,
        error: "FEN de départ invalide",
        startFen: effectiveStartFen,
        finalFen: effectiveStartFen,
        sanMoves: [],
        frames: []
      };
    }

    const raw = String(movesText || "").trim();
    if (!raw) {
      return {
        valid: false,
        error: "Aucun coup fourni",
        startFen: effectiveStartFen,
        finalFen: effectiveStartFen,
        sanMoves: [],
        frames: [{ ply: 0, moveNumber: 0, san: "Départ", fen: effectiveStartFen }]
      };
    }

    let rawTokens = [];
    if (parser && effectiveStartFen === DEFAULT_START_FEN) {
      try {
        const parsed = parser.parse(raw, { startRule: "game" });
        if (parsed && Array.isArray(parsed.moves) && parsed.moves.length > 0) {
          rawTokens = parsed.moves.map((m) => m.move);
        }
      } catch (_e) {}
    }

    if (rawTokens.length === 0) {
      rawTokens = raw
        .replace(/\{[^}]*\}/g, " ")
        .replace(/\d+\.+/g, " ")
        .replace(/\b(1-0|0-1|1\/2-1\/2|\*)\b/g, " ")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    }

    const sanMoves = [];
    const frames = [
      {
        ply: 0,
        moveNumber: 0,
        san: "Position initiale",
        fen: chess.fen()
      }
    ];

    for (let i = 0; i < rawTokens.length; i++) {
      const clean = normalizeSanToken(rawTokens[i]);
      if (!clean) continue;
      const mv = chess.move(clean);
      if (!mv) {
        return {
          valid: false,
          error: `Coup illégal détecté au demi-coup ${i + 1} : « ${rawTokens[i]} »`,
          startFen: effectiveStartFen,
          finalFen: chess.fen(),
          sanMoves,
          frames
        };
      }
      sanMoves.push(mv.san);
      frames.push({
        ply: sanMoves.length,
        moveNumber: Math.floor((sanMoves.length - 1) / 2) + 1,
        san: mv.san,
        fen: chess.fen()
      });
    }

    return {
      valid: sanMoves.length > 0,
      error: sanMoves.length > 0 ? null : "Aucun coup légal détecté",
      startFen: effectiveStartFen,
      finalFen: chess.fen(),
      sanMoves,
      frames
    };
  }

  /**
   * Analyse le PGN de référence d'un adversaire du Championnat de Madagascar 2027
   * avec ValisoaChesspgnparser et ValisoaChessLite.
   */
  function parseOpponentReferencePgn(referencePgn, pgnParser = null, ChessLiteClass = null) {
    const raw = String(referencePgn || "").trim();
    if (!raw) {
      return {
        valid: false,
        tags: {},
        result: "*",
        movesCount: 0,
        frames: [{ ply: 0, moveNumber: 0, san: "Position initiale", fen: DEFAULT_START_FEN }],
        summary: "Aucun PGN de référence renseigné."
      };
    }

    const parser =
      pgnParser ||
      (typeof window !== "undefined" && window.ValisoaChesspgnparser) ||
      null;
    const ChessCtor =
      ChessLiteClass ||
      (typeof window !== "undefined" && window.ValisoaChessLite) ||
      null;

    if (!parser || !ChessCtor) {
      throw new Error("ValisoaChesspgnparser et ValisoaChessLite sont requis.");
    }

    let gObj = null;
    try {
      const games = parser.parse(raw, { startRule: "games" });
      gObj = games && games[0] ? games[0] : parser.parse(raw, { startRule: "game" });
    } catch (_e) {
      // Si c'est juste une suite de coups sans en-têtes PGN
      const lineRes = parseOpeningLineMoves(raw, "start", parser, ChessCtor);
      return {
        valid: lineRes.valid,
        tags: {},
        result: "*",
        movesCount: lineRes.sanMoves.length,
        frames: lineRes.frames,
        summary: lineRes.valid
          ? `${lineRes.sanMoves.length} demi-coup(s) validés sur ValisoaChessLite`
          : lineRes.error || "PGN invalide"
      };
    }

    if (!gObj || !Array.isArray(gObj.moves)) {
      return {
        valid: false,
        tags: {},
        result: "*",
        movesCount: 0,
        frames: [{ ply: 0, moveNumber: 0, san: "Position initiale", fen: DEFAULT_START_FEN }],
        summary: "Syntaxe PGN non reconnue."
      };
    }

    const tags = gObj.tags || {};
    const startFen = tags.SetUp === "1" && tags.FEN ? tags.FEN : DEFAULT_START_FEN;
    const chess = new ChessCtor();
    if (!chess.load(startFen)) {
      return {
        valid: false,
        tags,
        result: "*",
        movesCount: 0,
        frames: [],
        summary: "FEN initiale invalide dans le PGN."
      };
    }

    const frames = [
      {
        ply: 0,
        moveNumber: 0,
        san: "Position initiale",
        fen: chess.fen(),
        comment: (gObj.gameComments || []).join(" ")
      }
    ];

    for (let idx = 0; idx < gObj.moves.length; idx++) {
      const mNode = gObj.moves[idx];
      const mv = chess.move(normalizeSanToken(mNode.move));
      if (!mv) break;
      frames.push({
        ply: frames.length,
        moveNumber: mNode.moveNumber || Math.floor(idx / 2) + 1,
        san: mv.san,
        fen: chess.fen(),
        comment: (mNode.comments || []).join(" ")
      });
    }

    const players =
      tags.White && tags.Black ? `${tags.White} vs ${tags.Black} · ` : "";
    const result = gObj.result || tags.Result || "*";

    return {
      valid: frames.length > 1,
      tags,
      result,
      movesCount: frames.length - 1,
      frames,
      summary: `${players}${frames.length - 1} demi-coup(s) · Résultat ${result}`
    };
  }

  /**
   * Planifie la révision espacée FSRS d'une ligne du répertoire d'ouvertures
   */
  function reviewOpeningLineFSRS(lineRow, rating = 3, now = new Date(), FSRSModule = null) {
    const fsrs =
      FSRSModule ||
      (typeof window !== "undefined" && window.ValisoaFSRS) ||
      null;

    const r = Math.min(4, Math.max(1, Number(rating || 3)));
    const curMastery = Number(lineRow.mastery ?? 50);
    let nextMastery = curMastery;
    if (r === 4) nextMastery = Math.min(100, curMastery + 15);
    else if (r === 3) nextMastery = Math.min(100, curMastery + 10);
    else if (r === 2) nextMastery = Math.max(20, curMastery - 5);
    else nextMastery = Math.max(10, curMastery - 20);

    if (fsrs && typeof fsrs.reviewPuzzle === "function") {
      const cardProxy = {
        id: lineRow.id || 1,
        diff: 3,
        fsrs_state: Number(lineRow.fsrs_state || 0),
        fsrs_stability: Number(lineRow.fsrs_stability || 0),
        fsrs_difficulty: Number(lineRow.fsrs_difficulty || 5.0),
        fsrs_elapsed_days: Number(lineRow.fsrs_elapsed_days || 0),
        fsrs_scheduled_days: Number(lineRow.fsrs_scheduled_days || 0),
        fsrs_reps: Number(lineRow.fsrs_reps || 0),
        fsrs_lapses: Number(lineRow.fsrs_lapses || 0),
        fsrs_last_review: lineRow.fsrs_last_review || null,
        fsrs_due_date: lineRow.fsrs_due_date || null
      };
      const sim = fsrs.reviewPuzzle(cardProxy, r, now, 0.9);
      return {
        mastery: nextMastery,
        fsrs_state: sim.fsrs_state,
        fsrs_stability: sim.fsrs_stability,
        fsrs_difficulty: sim.fsrs_difficulty,
        fsrs_reps: sim.fsrs_reps,
        fsrs_lapses: sim.fsrs_lapses,
        fsrs_last_review: sim.fsrs_last_review,
        fsrs_due_date: sim.fsrs_due_date,
        fsrs_scheduled_days: sim.fsrs_scheduled_days,
        rating: r,
        ratingLabel: sim.ratingLabel
      };
    }

    const scheduledDays = r === 4 ? 7 : r === 3 ? 3 : r === 2 ? 1 : 0;
    const dueDate = new Date(now.getTime() + scheduledDays * 86400000).toISOString();
    return {
      mastery: nextMastery,
      fsrs_state: r === 1 ? 3 : 2,
      fsrs_stability: scheduledDays || 0.5,
      fsrs_difficulty: Number(lineRow.fsrs_difficulty || 5.0),
      fsrs_reps: Number(lineRow.fsrs_reps || 0) + 1,
      fsrs_lapses: Number(lineRow.fsrs_lapses || 0) + (r === 1 ? 1 : 0),
      fsrs_last_review: now.toISOString(),
      fsrs_due_date: dueDate,
      fsrs_scheduled_days: scheduledDays,
      rating: r,
      ratingLabel: r >= 3 ? "Good · Solide" : "Again · À revoir"
    };
  }

  return {
    DEFAULT_START_FEN,
    OPPONENT_STYLES,
    parseOpeningLineMoves,
    parseOpponentReferencePgn,
    reviewOpeningLineFSRS
  };
});
