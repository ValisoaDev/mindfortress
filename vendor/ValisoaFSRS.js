/**
 * ============================================================================
 * ValisoaFSRS.js — Free Spaced Repetition Scheduler (FSRS v4.5 / v5)
 * + Mode Hybride Woodpecker (Hans Tikkanen) pour l'Entraînement aux Échecs
 * ============================================================================
 * Modèle mathématique DSR (Difficulty, Stability, Retrievability) :
 * - R(t, S) = (1 + (19/81) * (t / S))^(-0.5)
 * - I(r, S) = (S / (19/81)) * (r^(-2) - 1)  [Pour r = 0.90, I(0.90, S) = S]
 * Compatible Navigateur (window.ValisoaFSRS) & Node.js / Vercel (module.exports).
 */

const FSRS_STATES = {
  NEW: 0,
  LEARNING: 1,
  REVIEW: 2,
  RELEARNING: 3
};

const FSRS_STATE_LABELS = {
  0: "Nouveau",
  1: "Apprentissage",
  2: "Révision",
  3: "Réapprentissage"
};

const FSRS_RATINGS = {
  AGAIN: 1,
  HARD: 2,
  GOOD: 3,
  EASY: 4
};

const FSRS_RATING_LABELS = {
  1: "Again · Gaffe",
  2: "Hard · Difficile",
  3: "Good · Solide",
  4: "Easy · Réflexe"
};

// Poids officiels FSRS v4.5 / v5
const DEFAULT_WEIGHTS = [
  0.4072, // w0: S0(1 - Again)
  1.1829, // w1: S0(2 - Hard)
  3.1262, // w2: S0(3 - Good)
  15.4722, // w3: S0(4 - Easy)
  7.2102, // w4: D0(1) base difficulty
  0.5316, // w5: D0 exponential slope
  1.0651, // w6: difficulty delta
  0.0046, // w7: mean reversion weight
  1.5418, // w8: stability recall growth factor
  0.1367, // w9: stability saturation exponent
  1.0473, // w10: retrievability recall bonus exponent
  1.9395, // w11: post-lapse stability factor
  0.11, // w12: post-lapse difficulty exponent
  0.29, // w13: post-lapse stability exponent
  2.27, // w14: post-lapse retrievability exponent
  0.25, // w15: Hard multiplier (< 1)
  2.9898 // w16: Easy multiplier (> 1)
];

const DECAY = -0.5;
const FACTOR = 19 / 81; // Garantit R(S, S) = (1 + 19/81)^(-0.5) = (100/81)^(-0.5) = 9/10 = 0.90

// Les 5 Cycles officiels de la Méthode Woodpecker (Hans Tikkanen & Axel Smith)
const WOODPECKER_CYCLES = [
  {
    cycle: 1,
    name: "Cycle 1 · Empreinte",
    targetDays: 28,
    desc: "Calcul précis et profond sur tout le corpus (28 jours max)."
  },
  {
    cycle: 2,
    name: "Cycle 2 · Accélération",
    targetDays: 14,
    desc: "Diviser le temps du Cycle 1 par 2 (14 jours max)."
  },
  {
    cycle: 3,
    name: "Cycle 3 · Automatisme",
    targetDays: 7,
    desc: "Reconnaissance rapide des schémas tactiques (7 jours max)."
  },
  {
    cycle: 4,
    name: "Cycle 4 · Sur-vitesse",
    targetDays: 3,
    desc: "Vision quasi-instantanée des menaces et motifs (72h max)."
  },
  {
    cycle: 5,
    name: "Cycle 5 · Flash 24h",
    targetDays: 1,
    desc: "Tout le lot en 24h pour un affûtage maximal avant le Championnat."
  }
];

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function round2(val) {
  return Math.round(Number(val) * 100) / 100;
}

/**
 * Calcule la probabilité de rappel R(t, S) dans [0, 1].
 * @param {number} elapsedDays - Nombre de jours écoulés depuis la dernière révision (t >= 0)
 * @param {number} stability - Stabilité mémorielle S en jours
 * @returns {number} Probabilité R entre 0 et 1
 */
function calculateRetrievability(elapsedDays, stability) {
  const s = Number(stability || 0);
  if (s <= 0) return 0;
  const t = Math.max(0, Number(elapsedDays || 0));
  const r = Math.pow(1 + FACTOR * (t / s), DECAY);
  return clamp(r, 0, 1);
}

/**
 * Calcule l'intervalle optimal en jours pour une rétention cible (ex: 0.90).
 * @param {number} stability - Stabilité S en jours
 * @param {number} requestRetention - Rétention cible (défaut 0.90)
 * @param {number} maxInterval - Intervalle maximal en jours (défaut 365)
 * @returns {number} Intervalle entier en jours (>= 1)
 */
function calculateNextInterval(stability, requestRetention = 0.9, maxInterval = 365) {
  const s = Math.max(0.1, Number(stability || 0.1));
  const r = clamp(Number(requestRetention || 0.9), 0.7, 0.99);
  const rawInterval = (s / FACTOR) * (Math.pow(r, 1 / DECAY) - 1);
  return clamp(Math.round(rawInterval), 1, maxInterval);
}

/**
 * Stabilité initiale S0(G) lors de la toute première révision d'un puzzle.
 */
function initStability(rating, w = DEFAULT_WEIGHTS) {
  const g = clamp(Math.round(Number(rating || 3)), 1, 4);
  return round2(Math.max(0.1, w[g - 1]));
}

/**
 * Difficulté initiale D0(G) combinée avec la difficulté intrinsèque du puzzle (1..5).
 */
function initDifficulty(rating, puzzleDiff = 2, w = DEFAULT_WEIGHTS) {
  const g = clamp(Math.round(Number(rating || 3)), 1, 4);
  const baseD0 = w[4] - Math.exp(w[5] * (g - 1)) + 1;
  // Légère pondération par la difficulté intrinsèque de l'exercice d'échecs (1..5 -> -0.6..+1.0)
  const chessOffset = (clamp(Number(puzzleDiff || 2), 1, 5) - 2.5) * 0.4;
  return round2(clamp(baseD0 + chessOffset, 1, 10));
}

/**
 * Mise à jour de la difficulté D'(D, G) avec retour vers la moyenne (mean reversion).
 */
function nextDifficulty(d, rating, w = DEFAULT_WEIGHTS) {
  const g = clamp(Math.round(Number(rating || 3)), 1, 4);
  const curD = clamp(Number(d || 5), 1, 10);
  const deltaD = -w[6] * (g - 3);
  const dampedD = curD + deltaD * ((10 - curD) / 9);
  const d0Easy = w[4] - Math.exp(w[5] * (4 - 1)) + 1;
  const nextD = w[7] * d0Easy + (1 - w[7]) * dampedD;
  return round2(clamp(nextD, 1, 10));
}

/**
 * Stabilité après un rappel réussi S'_r(D, S, R, G) pour G in {2, 3, 4}.
 */
function nextRecallStability(d, s, r, rating, w = DEFAULT_WEIGHTS) {
  const g = clamp(Math.round(Number(rating || 3)), 2, 4);
  const curD = clamp(Number(d || 5), 1, 10);
  const curS = Math.max(0.1, Number(s || 0.1));
  const curR = clamp(Number(r || 0.9), 0.01, 1);

  const hardPenalty = g === FSRS_RATINGS.HARD ? w[15] : 1;
  const easyBonus = g === FSRS_RATINGS.EASY ? w[16] : 1;

  const inc =
    Math.exp(w[8]) *
    (11 - curD) *
    Math.pow(curS, -w[9]) *
    (Math.exp((1 - curR) * w[10]) - 1) *
    hardPenalty *
    easyBonus;

  // Garantit que la stabilité augmente toujours lors d'un succès (Good/Easy)
  const minGrowth = g === FSRS_RATINGS.HARD ? 1.05 : g === FSRS_RATINGS.GOOD ? 1.25 : 1.6;
  const newS = Math.max(curS * minGrowth, curS * (1 + inc));
  return round2(clamp(newS, 0.1, 3650));
}

/**
 * Stabilité post-oubli S'_f(D, S, R) lorsque le joueur rate le puzzle (G = 1 : Again).
 */
function nextForgetStability(d, s, r, w = DEFAULT_WEIGHTS) {
  const curD = clamp(Number(d || 5), 1, 10);
  const curS = Math.max(0.1, Number(s || 0.1));
  const curR = clamp(Number(r || 0.9), 0.01, 1);

  const rawSf =
    w[11] *
    Math.pow(curD, -w[12]) *
    (Math.pow(curS + 1, w[13]) - 1) *
    Math.exp((1 - curR) * w[14]);

  return round2(clamp(Math.min(rawSf, curS * 0.75), 0.1, curS));
}

/**
 * Calcule les jours écoulés entre deux dates ISO (minimum 0).
 */
function diffDays(lastReviewIso, nowDate = new Date()) {
  if (!lastReviewIso) return 0;
  const lastMs = new Date(lastReviewIso).getTime();
  if (Number.isNaN(lastMs)) return 0;
  const nowMs = nowDate instanceof Date ? nowDate.getTime() : new Date(nowDate).getTime();
  return Math.max(0, (nowMs - lastMs) / 86400000);
}

/**
 * Détermine automatiquement la note FSRS (1..4) adaptée aux échecs selon la performance :
 * - 1 (Again) : Échec ou coup illégal/erroné joué sur ValisoaChessboard
 * - 2 (Hard)  : Résolu mais avec indice ou temps > 1.6x le temps cible
 * - 3 (Good)  : Résolu sans erreur dans le temps normal
 * - 4 (Easy)  : Résolu du 1er coup sans indice très rapidement (<= 12s ou <= 45% du temps cible)
 */
function autoRateChessPuzzle({
  success = true,
  hadMistake = false,
  timeSec = 0,
  diff = 2,
  hintUsed = false
} = {}) {
  if (!success || hadMistake) {
    return FSRS_RATINGS.AGAIN;
  }
  const targetByDiff = { 1: 20, 2: 35, 3: 60, 4: 100, 5: 150 };
  const targetSec = targetByDiff[clamp(Math.round(Number(diff || 2)), 1, 5)] || 45;
  const t = Number(timeSec || 0);

  if (hintUsed || (t > 0 && t > targetSec * 1.6)) {
    return FSRS_RATINGS.HARD;
  }
  if (!hintUsed && t > 0 && t <= Math.max(10, Math.round(targetSec * 0.45))) {
    return FSRS_RATINGS.EASY;
  }
  return FSRS_RATINGS.GOOD;
}

/**
 * Exécute une transition FSRS complète pour un puzzle selon la note attribuée (1, 2, 3 ou 4).
 * @param {object} puzzle - Objet puzzle contenant les champs fsrs_*
 * @param {number} rating - Note FSRS : 1 (Again), 2 (Hard), 3 (Good), 4 (Easy)
 * @param {Date|string} now - Date de la révision
 * @param {number} requestRetention - Rétention cible (défaut 0.90)
 */
function reviewPuzzle(puzzle = {}, rating = FSRS_RATINGS.GOOD, now = new Date(), requestRetention = 0.9) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowIso = nowDate.toISOString();
  const g = clamp(Math.round(Number(rating || 3)), 1, 4);

  const prevState = Number(puzzle.fsrs_state || FSRS_STATES.NEW);
  const prevS = Number(puzzle.fsrs_stability || 0);
  const prevD = Number(puzzle.fsrs_difficulty || clamp(Number(puzzle.diff || 2) * 1.8, 1, 10));
  const prevReps = Number(puzzle.fsrs_reps || 0);
  const prevLapses = Number(puzzle.fsrs_lapses || 0);
  const prevBox = Number(puzzle.box || 1);
  const elapsed = prevState === FSRS_STATES.NEW ? 0 : diffDays(puzzle.fsrs_last_review, nowDate);
  const retrievabilityBefore =
    prevState === FSRS_STATES.NEW || prevS <= 0 ? 0 : calculateRetrievability(elapsed, prevS);

  let newS;
  let newD;
  let newState;
  let newLapses = prevLapses;
  let scheduledDays;

  if (prevState === FSRS_STATES.NEW || prevS <= 0) {
    // Première révision du puzzle
    newS = initStability(g);
    newD = initDifficulty(g, puzzle.diff || 2);
    if (g === FSRS_RATINGS.AGAIN) {
      newState = FSRS_STATES.LEARNING;
      newLapses += 1;
      scheduledDays = 0; // À revoir aujourd'hui / immédiatement
    } else if (g === FSRS_RATINGS.HARD) {
      newState = FSRS_STATES.LEARNING;
      scheduledDays = 1;
    } else {
      newState = FSRS_STATES.REVIEW;
      scheduledDays = calculateNextInterval(newS, requestRetention);
    }
  } else {
    // Puzzle déjà connu (Learning, Review, Relearning)
    const rEff = retrievabilityBefore > 0 ? retrievabilityBefore : 0.9;
    newD = nextDifficulty(prevD, g);
    if (g === FSRS_RATINGS.AGAIN) {
      newS = nextForgetStability(prevD, prevS, rEff);
      newState = FSRS_STATES.RELEARNING;
      newLapses += 1;
      scheduledDays = 0; // Reprogrammation immédiate (même jour)
    } else {
      newS = nextRecallStability(prevD, prevS, rEff, g);
      newState = FSRS_STATES.REVIEW;
      scheduledDays = calculateNextInterval(newS, requestRetention);
    }
  }

  // Calcul de la prochaine date d'échéance (fsrs_due_date)
  // Si scheduledDays === 0 (Again), échéance dans 10 minutes (même séance / aujourd'hui)
  const dueMs =
    scheduledDays === 0
      ? nowDate.getTime() + 10 * 60 * 1000
      : nowDate.getTime() + scheduledDays * 86400000;
  const dueIso = new Date(dueMs).toISOString();

  // Synchronisation harmonieuse avec la boîte Woodpecker (1..5)
  let newBox = prevBox;
  if (g === FSRS_RATINGS.AGAIN) {
    newBox = 1;
  } else if (g === FSRS_RATINGS.HARD) {
    newBox = Math.max(1, prevBox);
  } else if (g === FSRS_RATINGS.GOOD) {
    newBox = Math.min(5, prevBox + 1);
  } else if (g === FSRS_RATINGS.EASY) {
    newBox = Math.min(5, prevBox + 2);
  }

  return {
    rating: g,
    ratingLabel: FSRS_RATING_LABELS[g],
    fsrs_state: newState,
    stateLabel: FSRS_STATE_LABELS[newState],
    fsrs_stability: newS,
    fsrs_difficulty: newD,
    fsrs_elapsed_days: Math.round(elapsed * 100) / 100,
    fsrs_scheduled_days: scheduledDays,
    fsrs_reps: prevReps + 1,
    fsrs_lapses: newLapses,
    fsrs_last_review: nowIso,
    fsrs_due_date: dueIso,
    retrievability_before: round2(retrievabilityBefore * 100),
    retrievability_now: g === FSRS_RATINGS.AGAIN ? 45 : 100,
    box: newBox,
    solved: g >= FSRS_RATINGS.HARD ? 1 : 0
  };
}

/**
 * Prévisualise l'effet des 4 notes FSRS (Again, Hard, Good, Easy) sur un puzzle
 * pour afficher les futurs intervalles sur les 4 boutons de l'interface.
 */
function previewRatings(puzzle = {}, now = new Date(), requestRetention = 0.9) {
  const out = {};
  for (const r of [1, 2, 3, 4]) {
    const sim = reviewPuzzle(puzzle, r, now, requestRetention);
    out[r] = {
      rating: r,
      label: FSRS_RATING_LABELS[r],
      scheduledDays: sim.fsrs_scheduled_days,
      intervalText: sim.fsrs_scheduled_days === 0 ? "< 10m" : `${sim.fsrs_scheduled_days}j`,
      stability: sim.fsrs_stability,
      difficulty: sim.fsrs_difficulty,
      nextBox: sim.box
    };
  }
  return out;
}

/**
 * Enrichit un puzzle avec ses indicateurs FSRS temps réel (R%, est-il dû aujourd'hui, priorité).
 */
function enrichPuzzleWithFSRS(puzzle, now = new Date()) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowMs = nowDate.getTime();
  const state = Number(puzzle.fsrs_state || 0);
  const stability = Number(puzzle.fsrs_stability || 0);
  const difficulty = round2(
    Number(puzzle.fsrs_difficulty || clamp(Number(puzzle.diff || 2) * 1.8, 1, 10))
  );
  const elapsedDays = state === 0 ? 0 : diffDays(puzzle.fsrs_last_review, nowDate);
  const retrievability =
    state === 0 || stability <= 0
      ? 0
      : round2(calculateRetrievability(elapsedDays, stability) * 100);

  let isDue = false;
  let dueInDays = 0;
  if (state === 0) {
    isDue = true; // Les nouveaux puzzles sont disponibles dans la file d'acquisition
  } else if (puzzle.fsrs_due_date) {
    const dueMs = new Date(puzzle.fsrs_due_date).getTime();
    if (!Number.isNaN(dueMs)) {
      isDue = dueMs <= nowMs;
      dueInDays = Math.ceil((dueMs - nowMs) / 86400000);
    }
  } else {
    isDue = true;
  }

  return {
    ...puzzle,
    fsrs_state: state,
    fsrs_state_label: FSRS_STATE_LABELS[state] || "Nouveau",
    fsrs_stability: stability,
    fsrs_difficulty: difficulty,
    fsrs_retrievability: retrievability,
    fsrs_is_due: isDue,
    fsrs_due_in_days: dueInDays
  };
}

/**
 * Trie et construit la file d'attente quotidienne selon le mode choisi ('fsrs' ou 'woodpecker').
 * Ordre de priorité FSRS :
 * 1. Puzzles en Réapprentissage / Apprentissage échus (fsrs_state in [1, 3] & isDue)
 * 2. Puzzles en Révision échus (fsrs_state === 2 & isDue) par R(t, S) croissant (les plus proches de l'oubli d'abord)
 * 3. Nouveaux puzzles (fsrs_state === 0) par difficulté progressive
 * 4. Puzzles non échus triés par R(t, S) croissant
 */
function buildTrainingQueue(puzzles = [], mode = "fsrs", now = new Date()) {
  const enriched = puzzles.map((p) => enrichPuzzleWithFSRS(p, now));

  if (mode === "woodpecker") {
    // En mode Woodpecker (Hans Tikkanen) : priorité aux boîtes basses (Boîte 1 -> 5), puis non-résolus du cycle
    return [...enriched].sort((a, b) => {
      const boxA = Number(a.box || 1);
      const boxB = Number(b.box || 1);
      if (boxA !== boxB) return boxA - boxB;
      const solA = Number(a.solved || 0);
      const solB = Number(b.solved || 0);
      if (solA !== solB) return solA - solB;
      return Number(a.id) - Number(b.id);
    });
  }

  // Mode FSRS (par défaut)
  function bucketPriority(p) {
    if ((p.fsrs_state === 1 || p.fsrs_state === 3) && p.fsrs_is_due) return 1; // Urgent (Apprentissage / Oubli)
    if (p.fsrs_state === 2 && p.fsrs_is_due) return 2; // Révision échue aujourd'hui
    if (p.fsrs_state === 0) return 3; // Nouveau puzzle à acquérir
    return 4; // Déjà révisé, échéance future
  }

  return [...enriched].sort((a, b) => {
    const bA = bucketPriority(a);
    const bB = bucketPriority(b);
    if (bA !== bB) return bA - bB;

    if (bA === 1 || bA === 2 || bA === 4) {
      // Tri par probabilité de rappel R(t, S) croissante (le plus fragile en premier)
      if (a.fsrs_retrievability !== b.fsrs_retrievability) {
        return a.fsrs_retrievability - b.fsrs_retrievability;
      }
    }
    // Pour les nouveaux puzzles, progression pédagogique par difficulté puis ID
    if (Number(a.diff || 2) !== Number(b.diff || 2)) {
      return Number(a.diff || 2) - Number(b.diff || 2);
    }
    return Number(a.id) - Number(b.id);
  });
}

/**
 * Calcule un résumé analytique global de la mémoire FSRS sur l'ensemble du corpus.
 */
function computeFSRSStats(puzzles = [], now = new Date()) {
  const enriched = puzzles.map((p) => enrichPuzzleWithFSRS(p, now));
  const counts = {
    total: enriched.length,
    newCount: 0,
    learningCount: 0,
    reviewCount: 0,
    relearningCount: 0,
    dueReviewsCount: 0,
    dueTodayTotal: 0
  };

  let sumStability = 0;
  let sumRetrievability = 0;
  let activeCards = 0;

  for (const p of enriched) {
    if (p.fsrs_state === 0) {
      counts.newCount++;
    } else {
      activeCards++;
      sumStability += Number(p.fsrs_stability || 0);
      sumRetrievability += Number(p.fsrs_retrievability || 0);
      if (p.fsrs_state === 1) counts.learningCount++;
      else if (p.fsrs_state === 2) counts.reviewCount++;
      else if (p.fsrs_state === 3) counts.relearningCount++;

      if (p.fsrs_is_due) {
        counts.dueReviewsCount++;
      }
    }
  }

  // Objectif quotidien : toutes les révisions échues + jusqu'à 10 nouveaux puzzles
  counts.dueTodayTotal = counts.dueReviewsCount + Math.min(10, counts.newCount);

  return {
    ...counts,
    activeCards,
    avgStabilityDays: activeCards > 0 ? round2(sumStability / activeCards) : 0,
    avgRetrievabilityPct: activeCards > 0 ? round2(sumRetrievability / activeCards) : 0
  };
}

const ValisoaFSRS = {
  FSRS_STATES,
  FSRS_STATE_LABELS,
  FSRS_RATINGS,
  FSRS_RATING_LABELS,
  DEFAULT_WEIGHTS,
  WOODPECKER_CYCLES,
  calculateRetrievability,
  calculateNextInterval,
  initStability,
  initDifficulty,
  nextDifficulty,
  nextRecallStability,
  nextForgetStability,
  autoRateChessPuzzle,
  reviewPuzzle,
  previewRatings,
  enrichPuzzleWithFSRS,
  buildTrainingQueue,
  computeFSRSStats
};

if (typeof window !== "undefined") {
  window.ValisoaFSRS = ValisoaFSRS;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = ValisoaFSRS;
}
