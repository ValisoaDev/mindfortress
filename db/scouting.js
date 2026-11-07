/**
 * MIND FORTRESS — Module Backend Scouting Adversaires Madagascar 2027 & Répertoire d'Ouvertures FSRS
 */

const ValisoaScoutingOpenings = require("../vendor/ValisoaScoutingOpenings");
const ValisoaChesspgnparser = require("../vendor/ValisoaChesspgnparser");
const ValisoaChessLite = require("../vendor/ValisoaChessLite");
const ValisoaFSRS = require("../vendor/ValisoaFSRS");

function parseOpeningLineMoves(movesText, startFen = "start") {
  return ValisoaScoutingOpenings.parseOpeningLineMoves(
    movesText,
    startFen,
    ValisoaChesspgnparser,
    ValisoaChessLite
  );
}

function parseOpponentReferencePgn(referencePgn) {
  return ValisoaScoutingOpenings.parseOpponentReferencePgn(
    referencePgn,
    ValisoaChesspgnparser,
    ValisoaChessLite
  );
}

function reviewOpeningLineFSRS(lineRow, rating = 3, now = new Date()) {
  return ValisoaScoutingOpenings.reviewOpeningLineFSRS(lineRow, rating, now, ValisoaFSRS);
}

module.exports = {
  ...ValisoaScoutingOpenings,
  parseOpeningLineMoves,
  parseOpponentReferencePgn,
  reviewOpeningLineFSRS
};
