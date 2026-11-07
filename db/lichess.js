/**
 * MIND FORTRESS — Module Backend Lichess Sync, Conversion PGN -> FSRS & Chronobiologie (Node.js / SQLite)
 */

const https = require("https");
const ValisoaLichess = require("../vendor/ValisoaLichess");
const ValisoaChesspgnparser = require("../vendor/ValisoaChesspgnparser");
const ValisoaChessLite = require("../vendor/ValisoaChessLite");

function httpsGetText(url, acceptHeader = "application/json", timeoutMs = 4500) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          Accept: acceptHeader,
          "User-Agent": "MindFortress-Madagascar2027/1.0"
        },
        timeout: timeoutMs
      },
      (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => resolve(body));
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error("Timeout Lichess API"));
    });
    req.on("error", reject);
  });
}

async function fetchLichessRemoteData(username, maxGames = 10) {
  const cleanUser = String(username || "").trim();
  if (!cleanUser) {
    return { profile: null, rawPgn: "" };
  }

  let profile = null;
  let rawPgn = "";

  try {
    const profileJson = await httpsGetText(
      `https://lichess.org/api/user/${encodeURIComponent(cleanUser)}`,
      "application/json",
      4000
    );
    const data = JSON.parse(profileJson);
    profile = {
      username: data.username || cleanUser,
      classical: data.perfs?.classical?.rating || null,
      rapid: data.perfs?.rapid?.rating || null,
      blitz: data.perfs?.blitz?.rating || null,
      bullet: data.perfs?.bullet?.rating || null,
      puzzle: data.perfs?.puzzle?.rating || null,
      countAll: data.count?.all || 0,
      fetchedAt: new Date().toISOString()
    };
  } catch (_err) {
    // Hors-ligne ou utilisateur non trouvé sur le réseau
  }

  try {
    rawPgn = await httpsGetText(
      `https://lichess.org/api/games/user/${encodeURIComponent(cleanUser)}?max=${Number(
        maxGames || 10
      )}&opening=true&pgnInJson=false`,
      "application/x-chess-pgn",
      5000
    );
  } catch (_err) {
    // Hors-ligne
  }

  return { profile, rawPgn };
}

function parsePgnGamesBatch(pgnText, username = "") {
  return ValisoaLichess.parsePgnGamesBatch(
    pgnText,
    username,
    ValisoaChesspgnparser,
    ValisoaChessLite
  );
}

function convertPositionToFsrsPuzzle(options) {
  return ValisoaLichess.convertPositionToFsrsPuzzle(options, ValisoaChessLite);
}

module.exports = {
  ...ValisoaLichess,
  parsePgnGamesBatch,
  convertPositionToFsrsPuzzle,
  fetchLichessRemoteData
};
