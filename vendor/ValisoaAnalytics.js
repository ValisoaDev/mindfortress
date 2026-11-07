/**
 * ValisoaAnalytics.js — Analytique Avancée & Corrélations Cognitives (Sommeil, Fatigue, Émotions, Précision FSRS)
 * Pour MIND FORTRESS — Préparation Championnat de Madagascar 2027
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ValisoaAnalytics = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const FATIGUE_LABELS = {
    1: "1/5 · Très frais",
    2: "2/5 · Frais",
    3: "3/5 · Normal",
    4: "4/5 · Fatigué",
    5: "5/5 · Épuisé"
  };

  /**
   * Calcule toutes les corrélations (Fatigue × Réussite, Sommeil × Réussite, Émotion × Temps moyen,
   * Courbe de Rétention FSRS et Alerte de Seuil de Risque de Gaffe).
   */
  function computeAdvancedAnalytics({
    logs = [],
    contextualJournal = [],
    puzzles = [],
    fsrsReviewLogs = []
  } = {}) {
    const safeLogs = Array.isArray(logs) ? logs : [];
    const safeJournal = Array.isArray(contextualJournal) ? contextualJournal : [];
    const safePuzzles = Array.isArray(puzzles) ? puzzles : [];
    const safeFsrsLogs = Array.isArray(fsrsReviewLogs) ? fsrsReviewLogs : [];

    // Indexer les logs par ID pour croiser avec contextual_journal.log_id
    const logById = new Map();
    for (const lg of safeLogs) {
      if (lg && lg.id !== undefined) {
        logById.set(Number(lg.id), lg);
      }
    }

    // 1. CORRÉLATION FATIGUE (1 à 5) × RÉUSSITE & VITESSE
    const fatigueBuckets = {};
    for (let fLevel = 1; fLevel <= 5; fLevel++) {
      fatigueBuckets[fLevel] = {
        fatigue: fLevel,
        label: FATIGUE_LABELS[fLevel],
        count: 0,
        successSum: 0,
        timeSecSum: 0,
        successRatePct: null,
        avgTimeSec: null
      };
    }

    // 2. CORRÉLATION SOMMEIL × RÉUSSITE
    const sleepMap = new Map();
    function ensureSleepBucket(sleepKey) {
      const k = String(sleepKey || "Bon").trim() || "Bon";
      if (!sleepMap.has(k)) {
        sleepMap.set(k, {
          sommeil: k,
          count: 0,
          successSum: 0,
          timeSecSum: 0,
          successRatePct: null,
          avgTimeSec: null
        });
      }
      return sleepMap.get(k);
    }

    // 3. CORRÉLATION ENVIRONNEMENT (LIEU / BRUIT)
    const envMap = new Map();
    function ensureEnvBucket(envKey) {
      const k = String(envKey || "Maison · Calme").trim();
      if (!envMap.has(k)) {
        envMap.set(k, {
          environment: k,
          count: 0,
          successSum: 0,
          timeSecSum: 0,
          successRatePct: null,
          avgTimeSec: null
        });
      }
      return envMap.get(k);
    }

    // Parcourir les entrées du journal contextuel et les relier aux logs (ou utiliser l'intensité émotionnelle)
    for (const cj of safeJournal) {
      const fLevel = Math.min(5, Math.max(1, Number(cj.fatigue ?? 2)));
      const sleepKey = cj.sommeil || "Bon";
      const envKey = `${cj.lieu || "Maison"} · ${cj.bruit || "Calme"}`;
      const linkedId = Number(cj.log_id ?? cj.logId ?? 0);
      const linkedLog = linkedId ? logById.get(linkedId) : null;

      let isSuccess = 1;
      let timeSec = 45;
      if (linkedLog) {
        isSuccess = linkedLog.success === 1 || linkedLog.success === true ? 1 : 0;
        timeSec = Number(linkedLog.time_sec || 45);
      } else {
        const afterEmo = String(cj.after_emotion || cj.afterEmotion || "").toLowerCase();
        const afterInt = Number(cj.after_intensity ?? cj.afterIntensity ?? 2);
        isSuccess =
          afterEmo.includes("tilt") || afterEmo.includes("stress") || (fLevel >= 4 && afterInt >= 4)
            ? 0
            : 1;
        timeSec = fLevel >= 4 ? 75 : 40;
      }

      const fb = fatigueBuckets[fLevel];
      fb.count += 1;
      fb.successSum += isSuccess;
      fb.timeSecSum += timeSec;

      const sb = ensureSleepBucket(sleepKey);
      sb.count += 1;
      sb.successSum += isSuccess;
      sb.timeSecSum += timeSec;

      const eb = ensureEnvBucket(envKey);
      eb.count += 1;
      eb.successSum += isSuccess;
      eb.timeSecSum += timeSec;
    }

    const fatigueCorrelation = Object.values(fatigueBuckets).map((b) => ({
      ...b,
      successRatePct: b.count > 0 ? Math.round((b.successSum / b.count) * 100) : null,
      avgTimeSec: b.count > 0 ? Math.round(b.timeSecSum / b.count) : null
    }));

    const sleepCorrelation = Array.from(sleepMap.values()).map((b) => ({
      ...b,
      successRatePct: b.count > 0 ? Math.round((b.successSum / b.count) * 100) : null,
      avgTimeSec: b.count > 0 ? Math.round(b.timeSecSum / b.count) : null
    }));

    const environmentCorrelation = Array.from(envMap.values()).map((b) => ({
      ...b,
      successRatePct: b.count > 0 ? Math.round((b.successSum / b.count) * 100) : null,
      avgTimeSec: b.count > 0 ? Math.round(b.timeSecSum / b.count) : null
    }));

    // 4. CORRÉLATION ÉMOTION × PRÉCISION & TEMPS MOYEN (sur `logs`)
    const emoMap = new Map();
    for (const lg of safeLogs) {
      const emoRaw = String(lg.emotion || "Focus").trim();
      const emoKey = emoRaw.charAt(0).toUpperCase() + emoRaw.slice(1).toLowerCase();
      if (!emoMap.has(emoKey)) {
        emoMap.set(emoKey, {
          emotion: emoKey,
          count: 0,
          successSum: 0,
          timeSecSum: 0,
          xpSum: 0,
          successRatePct: 0,
          avgTimeSec: 0
        });
      }
      const b = emoMap.get(emoKey);
      const ok = lg.success === 1 || lg.success === true ? 1 : 0;
      b.count += 1;
      b.successSum += ok;
      b.timeSecSum += Number(lg.time_sec || 0);
      b.xpSum += Number(lg.xp || 0);
    }

    const emotionCorrelation = Array.from(emoMap.values())
      .map((b) => ({
        ...b,
        successRatePct: b.count > 0 ? Math.round((b.successSum / b.count) * 100) : 0,
        avgTimeSec: b.count > 0 ? Math.round(b.timeSecSum / b.count) : 0
      }))
      .sort((a, b) => b.count - a.count);

    // 5. COURBE DE RÉTENTION & STABILITÉ FSRS
    const stabilityBands = [
      { id: "new", label: "Nouveaux (S = 0j)", min: 0, max: 0.001, count: 0, retSum: 0 },
      { id: "short", label: "Court terme (< 3j)", min: 0.001, max: 3, count: 0, retSum: 0 },
      { id: "medium", label: "Consolidation (3–14j)", min: 3, max: 14, count: 0, retSum: 0 },
      { id: "long", label: "Ancrage fort (14–60j)", min: 14, max: 60, count: 0, retSum: 0 },
      { id: "fortress", label: "Forteresse (> 60j)", min: 60, max: Infinity, count: 0, retSum: 0 }
    ];

    for (const pz of safePuzzles) {
      const s = Number(pz.fsrs_stability || 0);
      const rPct = Number(pz.fsrs_retrievability_pct ?? (s > 0 ? 90 : 0));
      if (s <= 0) {
        stabilityBands[0].count += 1;
        stabilityBands[0].retSum += rPct;
      } else if (s < 3) {
        stabilityBands[1].count += 1;
        stabilityBands[1].retSum += rPct;
      } else if (s < 14) {
        stabilityBands[2].count += 1;
        stabilityBands[2].retSum += rPct;
      } else if (s < 60) {
        stabilityBands[3].count += 1;
        stabilityBands[3].retSum += rPct;
      } else {
        stabilityBands[4].count += 1;
        stabilityBands[4].retSum += rPct;
      }
    }

    const fsrsRetentionCurve = stabilityBands.map((b) => ({
      id: b.id,
      label: b.label,
      count: b.count,
      avgRetrievabilityPct: b.count > 0 ? Math.round(b.retSum / b.count) : 0
    }));

    const ratingCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const rl of safeFsrsLogs) {
      const r = Number(rl.rating || 3);
      if (ratingCounts[r] !== undefined) ratingCounts[r] += 1;
    }

    // 6. ALERTE AUTOMATIQUE DE « SEUIL DE RISQUE DE GAFFE »
    let riskScore = 15;
    const triggers = [];

    const latestJournal = safeJournal[0] || null;
    if (latestJournal) {
      const lastFatigue = Number(latestJournal.fatigue ?? 2);
      const lastSleep = String(latestJournal.sommeil || "Bon").toLowerCase();
      const lastBeforeEmo = String(
        latestJournal.before_emotion || latestJournal.beforeEmotion || ""
      ).toLowerCase();

      if (lastFatigue >= 4) {
        riskScore += 35;
        triggers.push(`Fatigue élevée signalée (${lastFatigue}/5)`);
      }
      if (lastSleep.includes("mauvais") || lastSleep.includes("court") || lastSleep.includes("insomnie")) {
        riskScore += 30;
        triggers.push(`Dette de sommeil (${latestJournal.sommeil})`);
      }
      if (lastBeforeEmo.includes("tilt") || lastBeforeEmo.includes("stress") || lastBeforeEmo.includes("colère")) {
        riskScore += 25;
        triggers.push(`Charge émotionnelle pré-séance (${latestJournal.before_emotion || latestJournal.beforeEmotion})`);
      }
    }

    const highFatigueRows = fatigueCorrelation.filter((f) => f.fatigue >= 4 && f.count > 0);
    const lowFatigueRows = fatigueCorrelation.filter((f) => f.fatigue <= 2 && f.count > 0);
    if (highFatigueRows.length > 0) {
      const avgHighSuccess =
        highFatigueRows.reduce((acc, r) => acc + r.successRatePct, 0) / highFatigueRows.length;
      if (avgHighSuccess <= 55) {
        riskScore += 20;
        triggers.push(`Précision historique sous fatigue (4–5/5) chute à ${Math.round(avgHighSuccess)}%`);
      }
    }

    const recentLogs = safeLogs.slice(0, 5);
    if (recentLogs.length >= 3) {
      const recentFails = recentLogs.filter((l) => l.success === 0 || l.success === false).length;
      if (recentFails >= 2) {
        riskScore += 25;
        triggers.push(`${recentFails} erreurs sur les ${recentLogs.length} dernières résolutions`);
      }
    }

    riskScore = Math.min(100, Math.max(5, riskScore));
    const level = riskScore >= 65 ? "high" : riskScore >= 40 ? "moderate" : "low";
    const title =
      level === "high"
        ? "🚨 Alerte Rouge : Seuil de Risque de Gaffe Dépassé"
        : level === "moderate"
        ? "⚠️ Vigilance : Fatigue / Charge Cognitive Modérée"
        : "✅ Zone de Lucidité Optimale (Bouclier Actif)";

    const message =
      level === "high"
        ? "Tes indicateurs actuels correspondent à ton profil historique de gaffe. Active immédiatement le Tilt Reboot 90s (Respiration 4–6) et privilégie la révision légère plutôt que le calcul lourd."
        : level === "moderate"
        ? "Surveille ton rythme respiratoire et applique strictement le Protocole Kotov des 3 coups candidats avant de toucher une pièce."
        : "Système nerveux stable : conditions idéales pour les puzzles FSRS difficiles et la simulation FIDE 90'+30s.";

    return {
      fatigueCorrelation,
      sleepCorrelation,
      environmentCorrelation,
      emotionCorrelation,
      fsrsRetentionCurve,
      ratingCounts,
      lowFatigueAvgSuccessPct:
        lowFatigueRows.length > 0
          ? Math.round(
              lowFatigueRows.reduce((acc, r) => acc + r.successRatePct, 0) / lowFatigueRows.length
            )
          : null,
      highFatigueAvgSuccessPct:
        highFatigueRows.length > 0
          ? Math.round(
              highFatigueRows.reduce((acc, r) => acc + r.successRatePct, 0) / highFatigueRows.length
            )
          : null,
      blunderRiskAlert: {
        level,
        score: riskScore,
        title,
        message,
        triggers
      }
    };
  }

  return {
    FATIGUE_LABELS,
    computeAdvancedAnalytics
  };
});
