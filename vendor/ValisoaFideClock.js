/**
 * ============================================================================
 * ValisoaFideClock.js — Simulateur Cadence Classique FIDE (90m + 30s/coup)
 * Scénarios de Zeitnot & Protocole Kotov des 3 Coups Candidats
 * ============================================================================
 * Compatible Navigateur (window.ValisoaFideClock) & Node.js (module.exports).
 */

const FIDE_SCENARIOS = {
  scenario_a: {
    id: "scenario_a",
    code: "SCÉNARIO A",
    title: "Sortie d'ouverture · Coup 15 (Milieu de jeu riche)",
    badge: "65 min + 30s/coup",
    initialSec: 3900, // 65 minutes
    incrementSec: 30,
    moveNumber: 15,
    minCandidatesRequired: 3,
    side: "Blancs",
    fen: "r1bq1rk1/pp2ppbp/2np1np1/8/3NP3/2N1BP2/PPPQ2PP/R3KB1R w KQ - 3 9",
    recommendedCandidates: ["O-O-O", "Bc4", "g4"],
    solution_moves: ["O-O-O", "Bd7", "g4"],
    objective:
      "Prends 10 à 15 minutes pour évaluer les déséquilibres, formuler 3 coups candidats (ex: O-O-O, Bc4, g4) et calculer les réponses noires avant de toucher l'échiquier."
  },
  scenario_b: {
    id: "scenario_b",
    code: "SCÉNARIO B",
    title: "Crise du 30ᵉ coup · Pré-Zeitnot",
    badge: "8 min + 30s/coup",
    initialSec: 480, // 8 minutes
    incrementSec: 30,
    moveNumber: 30,
    minCandidatesRequired: 3,
    side: "Blancs",
    fen: "2r2rk1/1bq1bppp/p2ppn2/1p6/3NP3/1BN1B3/PPPQ1PPP/2KR3R w - - 0 14",
    recommendedCandidates: ["f3", "Rhe1", "Kb1"],
    solution_moves: ["f3", "Rfd8", "Kb1"],
    objective:
      "Il reste 8 minutes avant le contrôle du 40ᵉ coup. Interdiction de paniquer : identifie 3 coups candidats prophylactiques/actifs (ex: f3, Rhe1, Kb1) et joue avec discipline."
  },
  scenario_c: {
    id: "scenario_c",
    code: "SCÉNARIO C",
    title: "Zeitnot Critique · Coup 38 (Survie sur l'incrément)",
    badge: "90 sec + 30s/coup",
    initialSec: 90, // 1 min 30 sec
    incrementSec: 30,
    moveNumber: 38,
    minCandidatesRequired: 2,
    side: "Blancs",
    fen: "3r2k1/pp3ppp/2n1b3/8/3p4/2P2N2/PP2BPPP/3R2K1 w - - 0 38",
    recommendedCandidates: ["Nxd4", "cxd4"],
    solution_moves: ["Nxd4", "Nxd4", "Rxd4"],
    objective:
      "90 secondes au compteur au 38ᵉ coup ! Vis grâce à l'incrément Fischer (+30s/coup) : vérifie 2 candidats solides (ex: Nxd4, cxd4) et exécute sans gaffe avant la chute du drapeau."
  },
  fide_90_30: {
    id: "fide_90_30",
    code: "FIDE 90'+30\"",
    title: "Cadence Officielle Championnat de Madagascar (90 min + 30s)",
    badge: "90 min + 30s/coup",
    initialSec: 5400, // 90 minutes
    incrementSec: 30,
    moveNumber: 1,
    minCandidatesRequired: 3,
    side: "Blancs",
    fen: "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 4 5",
    recommendedCandidates: ["Bg5", "O-O", "Be3"],
    solution_moves: ["Bg5", "h6", "Bxf6"],
    objective:
      "Simulation grandeur nature de la cadence classique FIDE 90 minutes + 30 secondes par coup dès le 1er coup."
  }
};

function normalizeCandidateSan(raw) {
  if (!raw) return "";
  let s = String(raw)
    .trim()
    .replace(/^\d+\.+/, "")
    .trim()
    .replace(/^0-0-0/, "O-O-O")
    .replace(/^0-0/, "O-O");
  s = s
    .replace(/^C(?=[a-h1-8x])/, "N")
    .replace(/^F(?=[a-h1-8x])/, "B")
    .replace(/^T(?=[a-h1-8x])/, "R")
    .replace(/^D(?=[a-h1-8x])/, "Q")
    .replace(/^R(?=[a-h1-8x])/, "K")
    .replace(/=D/i, "=Q")
    .replace(/=T/i, "=R")
    .replace(/=F/i, "=B")
    .replace(/=C/i, "=N");
  return s;
}

/**
 * Crée un état initial de pendule FIDE pour un scénario donné.
 */
function createClockState(scenarioId = "scenario_a") {
  const sc = FIDE_SCENARIOS[scenarioId] || FIDE_SCENARIOS.scenario_a;
  return {
    scenarioId: sc.id,
    code: sc.code,
    title: sc.title,
    fen: sc.fen,
    initialSec: sc.initialSec,
    remainingSec: sc.initialSec,
    incrementSec: sc.incrementSec,
    moveNumber: sc.moveNumber,
    minCandidatesRequired: sc.minCandidatesRequired,
    movesPlayed: 0,
    incrementsAddedSec: 0,
    elapsedTotalSec: 0,
    flagged: false,
    boardUnlocked: false,
    candidateMoves: ["", "", ""],
    moveTimings: []
  };
}

/**
 * Fait avancer le décompte de la pendule de `deltaSec` secondes.
 * Détecte automatiquement la chute du drapeau (`flagged = true` si `remainingSec === 0`).
 */
function tickClock(clockState, deltaSec = 1) {
  const step = Math.max(0, Number(deltaSec || 1));
  const prevRem = Math.max(0, Number(clockState.remainingSec || 0));
  const nextRem = Math.max(0, prevRem - step);
  const actualElapsed = prevRem - nextRem;
  return {
    ...clockState,
    remainingSec: nextRem,
    elapsedTotalSec: Number(clockState.elapsedTotalSec || 0) + actualElapsed,
    flagged: nextRem === 0
  };
}

/**
 * Applique l'incrément Fischer (+30s/coup) après un coup valide joué sur l'échiquier,
 * uniquement si le drapeau n'est pas tombé.
 */
function applyFischerIncrement(clockState, moveSan = "", thinkTimeSec = 0) {
  if (clockState.flagged || Number(clockState.remainingSec) <= 0) {
    return {
      ...clockState,
      remainingSec: 0,
      flagged: true
    };
  }
  const inc = Number(clockState.incrementSec || 30);
  const nextRem = Number(clockState.remainingSec) + inc;
  const nextMovesPlayed = Number(clockState.movesPlayed || 0) + 1;
  const nextMoveNumber = Number(clockState.moveNumber || 1) + 1;
  const nextIncrementsAdded = Number(clockState.incrementsAddedSec || 0) + inc;
  const timings = Array.isArray(clockState.moveTimings) ? [...clockState.moveTimings] : [];
  timings.push({
    moveNumber: clockState.moveNumber || 1,
    san: moveSan,
    thinkTimeSec: Number(thinkTimeSec || 0),
    clockAfterSec: nextRem
  });

  return {
    ...clockState,
    remainingSec: nextRem,
    movesPlayed: nextMovesPlayed,
    moveNumber: nextMoveNumber,
    incrementsAddedSec: nextIncrementsAdded,
    moveTimings: timings
  };
}

/**
 * Vérifie les coups candidats saisis par le joueur avec ValisoaChessLite
 * et détermine si l'échiquier peut être déverrouillé (Protocole anti-impulsivité Kotov).
 */
function validateCandidateMoves(candidates = [], fen = "", ChessEngineClass = null, minRequired = 3) {
  const Engine =
    ChessEngineClass ||
    (typeof window !== "undefined" && window.ValisoaChessLite ? window.ValisoaChessLite : null);

  let engineInstance = null;
  if (Engine && fen) {
    engineInstance = new Engine();
    if (!engineInstance.load(fen)) {
      engineInstance = null;
    }
  }

  const seen = new Set();
  const details = [];
  let validCount = 0;

  for (const raw of candidates) {
    const norm = normalizeCandidateSan(raw);
    if (!norm) {
      details.push({ raw, san: "", valid: false, reason: "Vide" });
      continue;
    }
    if (seen.has(norm.toLowerCase())) {
      details.push({ raw, san: norm, valid: false, reason: "Doublon" });
      continue;
    }
    if (engineInstance) {
      const isLegal = engineInstance.isLegalMove(norm);
      if (isLegal) {
        seen.add(norm.toLowerCase());
        validCount++;
        details.push({ raw, san: norm, valid: true, reason: "Légal" });
      } else {
        details.push({ raw, san: norm, valid: false, reason: "Coup illégal" });
      }
    } else {
      seen.add(norm.toLowerCase());
      validCount++;
      details.push({ raw, san: norm, valid: true, reason: "Accepté" });
    }
  }

  const reqCount = Math.max(1, Number(minRequired || 3));
  const unlocked = validCount >= reqCount;

  return {
    unlocked,
    validCount,
    minRequired: reqCount,
    details,
    message: unlocked
      ? `✅ ${validCount}/${reqCount} coups candidats légaux validés — Échiquier déverrouillé !`
      : `🔒 Saisis au moins ${reqCount} coups candidats légaux différents (${validCount}/${reqCount} validé(s)) avant de jouer.`
  };
}

/**
 * Formate un temps en secondes en HH:MM:SS (si >= 1h) ou MM:SS.
 */
function formatFideClock(sec) {
  const s = Math.max(0, Math.floor(Number(sec || 0)));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const remSec = s % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(remSec).padStart(2, "0")}`;
  }
  return `${String(mins).padStart(2, "0")}:${String(remSec).padStart(2, "0")}`;
}

const ValisoaFideClock = {
  FIDE_SCENARIOS,
  normalizeCandidateSan,
  createClockState,
  tickClock,
  applyFischerIncrement,
  validateCandidateMoves,
  formatFideClock
};

if (typeof window !== "undefined") {
  window.ValisoaFideClock = ValisoaFideClock;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = ValisoaFideClock;
}
