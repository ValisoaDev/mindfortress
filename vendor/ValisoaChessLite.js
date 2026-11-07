/**
 * ValisoaChessLite.js
 * Moteur logique d'échecs basé sur la méthode ultra-performante des Bitboards (BigInt).
 */

// ==========================================================
// CONSTANTES ET PRECALCULS BITBOARDS
// ==========================================================
const MASKS = {
    FILE_A: 0x0101010101010101n,
    FILE_H: 0x8080808080808080n,
    RANK_1: 0x00000000000000FFn,
    RANK_8: 0xFF00000000000000n
};

const KNIGHT_ATTACKS = new Array(64).fill(0n);
const KING_ATTACKS = new Array(64).fill(0n);
const PAWN_ATTACKS = { w: new Array(64).fill(0n), b: new Array(64).fill(0n) };

// Phase 8 : Zobrist Hashing
const ZOBRIST = {
    pieces: new Array(12 * 64),
    castling: new Array(16),
    enPassant: new Array(9),
    turn: 0n
};

function initMasks() {
    const knightMoves = [15, 17, 6, 10, -15, -17, -6, -10];
    const kingMoves = [8, -8, 1, -1, 9, 7, -9, -7];

    for (let sq = 0; sq < 64; sq++) {
        for (let m of knightMoves) {
            const target = sq + m;
            if (target >= 0 && target < 64 && Math.abs((sq % 8) - (target % 8)) <= 2) {
                KNIGHT_ATTACKS[sq] |= (1n << BigInt(target));
            }
        }
        for (let m of kingMoves) {
            const target = sq + m;
            if (target >= 0 && target < 64 && Math.abs((sq % 8) - (target % 8)) <= 1) {
                KING_ATTACKS[sq] |= (1n << BigInt(target));
            }
        }
        const f = sq % 8;
        if (sq + 7 < 64 && f > 0) PAWN_ATTACKS.w[sq] |= (1n << BigInt(sq + 7)); 
        if (sq + 9 < 64 && f < 7) PAWN_ATTACKS.w[sq] |= (1n << BigInt(sq + 9)); 
        if (sq - 9 >= 0 && f > 0) PAWN_ATTACKS.b[sq] |= (1n << BigInt(sq - 9)); 
        if (sq - 7 >= 0 && f < 7) PAWN_ATTACKS.b[sq] |= (1n << BigInt(sq - 7)); 
    }

    // Init Zobrist Constants
    let seed = 1n;
    function rand64() {
        seed ^= seed << 13n; seed ^= seed >> 7n; seed ^= seed << 17n;
        return seed;
    }
    for (let i = 0; i < 12 * 64; i++) ZOBRIST.pieces[i] = rand64();
    for (let i = 0; i < 16; i++) ZOBRIST.castling[i] = rand64();
    for (let i = 0; i < 9; i++) ZOBRIST.enPassant[i] = rand64();
    ZOBRIST.turn = rand64();
}
initMasks();

class ValisoaChessLite {
    constructor(fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1') {
        this.clear();
        this.load(fen);
    }

    clear() {
        this.colors = { w: 0n, b: 0n };
        this.pieces = { p: 0n, n: 0n, b: 0n, r: 0n, q: 0n, k: 0n };
        this.turn = 'w'; 
        this.castling = { wK: false, wQ: false, bK: false, bQ: false };
        this.enPassant = -1; 
        this.halfMoves = 0; 
        this.moveNumber = 1; 
        this.historyData = []; 
        this.headers = {}; 
        
        // Positions initiales pour le Roque (Permet le support Chess960)
        this.startKings = { w: 4, b: 60 };
        this.startRooks = { wK: 7, wQ: 0, bK: 63, bQ: 56 };
    }

    squareToIndex(sq) {
        if (sq === null || sq === undefined || sq === '-') return -1;
        if (typeof sq === 'number') return sq; // Déjà un index entier (ex: depuis un objet verbose)
        if (!sq) return -1;
        const file = sq.charCodeAt(0) - 'a'.charCodeAt(0);
        const rank = sq.charCodeAt(1) - '1'.charCodeAt(0);
        return rank * 8 + file;
    }

    indexToSquare(index) {
        if (index < 0 || index > 63) return '-';
        const file = String.fromCharCode('a'.charCodeAt(0) + (index % 8));
        const rank = String.fromCharCode('1'.charCodeAt(0) + Math.floor(index / 8));
        return file + rank;
    }

    put(type, color, index) {
        const mask = 1n << BigInt(index);
        this.colors[color] |= mask;
        this.pieces[type] |= mask;
    }

    remove(index) {
        const mask = ~(1n << BigInt(index));
        for (const color in this.colors) this.colors[color] &= mask;
        for (const type in this.pieces) this.pieces[type] &= mask;
    }

    get(index) {
        const mask = 1n << BigInt(index);
        let color = null;
        if (this.colors.w & mask) color = 'w';
        else if (this.colors.b & mask) color = 'b';
        else return null; 

        for (const type in this.pieces) {
            if (this.pieces[type] & mask) {
                return { type: type, color: color };
            }
        }
        return null;
    }

    load(fen) {
        this.clear();
        const tokens = fen.split(' ');
        if (tokens.length < 6) return false;

        const placement = tokens[0];
        let index = 56; 
        for (let i = 0; i < placement.length; i++) {
            const char = placement[i];
            if (char === '/') index -= 16;
            else if (!isNaN(char)) index += parseInt(char, 10);
            else {
                const pieceType = char.toLowerCase();
                if (!(pieceType in this.pieces) || index < 0 || index > 63) return false;
                const color = (char === char.toUpperCase()) ? 'w' : 'b';
                this.put(pieceType, color, index);
                index++;
            }
        }

        this.turn = tokens[1] === 'b' ? 'b' : 'w';
        
        // Détection dynamique des cases de Rois et Tours pour Chess960
        const wKing = this._getBits(this.pieces.k & this.colors.w)[0];
        const bKing = this._getBits(this.pieces.k & this.colors.b)[0];
        if (wKing !== undefined) this.startKings.w = wKing;
        if (bKing !== undefined) this.startKings.b = bKing;
        
        const wRooks = this._getBits(this.pieces.r & this.colors.w);
        const bRooks = this._getBits(this.pieces.r & this.colors.b);
        
        // Assigne les tours d'origine pour le roque (Chess960 compatible)
        this.startRooks.wK = wRooks.filter(sq => sq > wKing).pop() || 7;
        this.startRooks.wQ = wRooks.filter(sq => sq < wKing).shift() || 0;
        this.startRooks.bK = bRooks.filter(sq => sq > bKing).pop() || 63;
        this.startRooks.bQ = bRooks.filter(sq => sq < bKing).shift() || 56;

        if (tokens[2] !== '-') {
            this.castling.wK = tokens[2].includes('K');
            this.castling.wQ = tokens[2].includes('Q');
            this.castling.bK = tokens[2].includes('k');
            this.castling.bQ = tokens[2].includes('q');
        }

        this.enPassant = this.squareToIndex(tokens[3]);
        this.halfMoves = parseInt(tokens[4], 10) || 0;
        this.moveNumber = parseInt(tokens[5], 10) || 1;
        return true;
    }

    // ==========================================================
    // ZOBRIST HASHING ET 3 RÉPÉTITIONS
    // ==========================================================

    computeHash() {
        let h = 0n;
        const types = ['p', 'n', 'b', 'r', 'q', 'k'];
        for (let i = 0; i < 64; i++) {
            const p = this.get(i);
            if (p) {
                const cIdx = p.color === 'w' ? 0 : 1;
                const tIdx = types.indexOf(p.type);
                const zIndex = (cIdx * 6 + tIdx) * 64 + i;
                h ^= ZOBRIST.pieces[zIndex];
            }
        }
        let cIdx = 0;
        if (this.castling.wK) cIdx |= 1;
        if (this.castling.wQ) cIdx |= 2;
        if (this.castling.bK) cIdx |= 4;
        if (this.castling.bQ) cIdx |= 8;
        h ^= ZOBRIST.castling[cIdx];

        if (this.enPassant !== -1) h ^= ZOBRIST.enPassant[this.enPassant % 8];
        if (this.turn === 'b') h ^= ZOBRIST.turn;
        
        return h;
    }

    isThreefoldRepetition() {
        const currentHash = this.computeHash();
        let count = 1;
        // Optimization: on ne cherche que dans les coups depuis le dernier "halfMove" reset
        const start = Math.max(0, this.historyData.length - this.halfMoves);
        for (let i = this.historyData.length - 1; i >= start; i -= 2) {
            if (this.historyData[i].hash === currentHash) count++;
            if (count >= 3) return true;
        }
        return false;
    }

    // ==========================================================
    // GÉNÉRATION DES COUPS (Move Generation)
    // ==========================================================

    _getBits(bitboard) {
        const indices = [];
        for (let i = 0n; i < 64n; i++) {
            if ((bitboard >> i) & 1n) indices.push(Number(i));
        }
        return indices;
    }

    _getSlidingAttacks(sq, pieceType, occupied) {
        let attacks = 0n;
        const dirs = {
            r: [8, -8, 1, -1],
            b: [9, -9, 7, -7],
            q: [8, -8, 1, -1, 9, -9, 7, -7]
        }[pieceType];
        
        for (let d of dirs) {
            let currentSq = sq;
            while (true) {
                const f0 = currentSq % 8;
                currentSq += d;
                if (currentSq < 0 || currentSq >= 64) break; 
                const f1 = currentSq % 8;
                if (Math.abs(f0 - f1) > 2) break; 
                
                const mask = 1n << BigInt(currentSq);
                attacks |= mask;
                if (occupied & mask) break; 
            }
        }
        return attacks;
    }
    
    _isPathClear(sq1, sq2, ignoreSqs = []) {
        const min = Math.min(sq1, sq2);
        const max = Math.max(sq1, sq2);
        const occupied = this.colors.w | this.colors.b;
        for (let sq = min + 1; sq < max; sq++) {
            if (!ignoreSqs.includes(sq)) {
                if ((occupied >> BigInt(sq)) & 1n) return false;
            }
        }
        return true;
    }

    generatePseudoMoves() {
        const moves = [];
        const us = this.turn;
        const them = us === 'w' ? 'b' : 'w';
        
        const ourPieces = this.colors[us];
        const theirPieces = this.colors[them];
        const occupied = ourPieces | theirPieces;
        const empty = ~occupied;

        // 1. LES PIONS 
        const pawns = this.pieces.p & ourPieces;
        const pushOffset = us === 'w' ? 8 : -8;
        const doublePushOffset = us === 'w' ? 16 : -16;
        const rankStart = us === 'w' ? 1 : 6; 
        const rankPromo = us === 'w' ? 7 : 0;
        
        for (let sq of this._getBits(pawns)) {
            const target1 = sq + pushOffset;
            if (target1 >= 0 && target1 < 64 && ((empty >> BigInt(target1)) & 1n)) {
                if (Math.floor(target1 / 8) === rankPromo) {
                    ['q', 'r', 'b', 'n'].forEach(promo => moves.push({ from: sq, to: target1, piece: 'p', captured: null, promotion: promo }));
                } else {
                    moves.push({ from: sq, to: target1, piece: 'p', captured: null });
                    const rank = Math.floor(sq / 8);
                    if (rank === rankStart) {
                        const target2 = sq + doublePushOffset;
                        if ((empty >> BigInt(target2)) & 1n) {
                            moves.push({ from: sq, to: target2, piece: 'p', captured: null });
                        }
                    }
                }
            }
            
            let attacks = PAWN_ATTACKS[us][sq] & theirPieces;
            for (let target of this._getBits(attacks)) {
                if (Math.floor(target / 8) === rankPromo) {
                    ['q', 'r', 'b', 'n'].forEach(promo => moves.push({ from: sq, to: target, piece: 'p', captured: this.get(target), promotion: promo }));
                } else {
                    moves.push({ from: sq, to: target, piece: 'p', captured: this.get(target) });
                }
            }

            if (this.enPassant !== -1) {
                const epMask = 1n << BigInt(this.enPassant);
                if (PAWN_ATTACKS[us][sq] & epMask) {
                    moves.push({ from: sq, to: this.enPassant, piece: 'p', captured: { type: 'p', color: them }, isEnPassant: true });
                }
            }
        }

        // 2. LES CAVALIERS
        const knights = this.pieces.n & ourPieces;
        for (let sq of this._getBits(knights)) {
            let attacks = KNIGHT_ATTACKS[sq] & ~ourPieces;
            for (let target of this._getBits(attacks)) moves.push({ from: sq, to: target, piece: 'n', captured: this.get(target) });
        }

        // 3. LES ROIS (Et le Roque Chess960 Compatible)
        const kings = this.pieces.k & ourPieces;
        for (let sq of this._getBits(kings)) {
            let attacks = KING_ATTACKS[sq] & ~ourPieces;
            for (let target of this._getBits(attacks)) moves.push({ from: sq, to: target, piece: 'k', captured: this.get(target) });
        }
        
        if (us === 'w') {
            const kSq = this.startKings.w;
            if (this.castling.wK) {
                const rSq = this.startRooks.wK;
                if (this._isPathClear(kSq, 6, [kSq, rSq]) && this._isPathClear(rSq, 5, [kSq, rSq])) {
                    moves.push({ from: kSq, to: 6, piece: 'k', isCastling: 'wK', rookFrom: rSq, rookTo: 5 });
                }
            }
            if (this.castling.wQ) {
                const rSq = this.startRooks.wQ;
                if (this._isPathClear(kSq, 2, [kSq, rSq]) && this._isPathClear(rSq, 3, [kSq, rSq])) {
                    moves.push({ from: kSq, to: 2, piece: 'k', isCastling: 'wQ', rookFrom: rSq, rookTo: 3 });
                }
            }
        } else {
            const kSq = this.startKings.b;
            if (this.castling.bK) {
                const rSq = this.startRooks.bK;
                if (this._isPathClear(kSq, 62, [kSq, rSq]) && this._isPathClear(rSq, 61, [kSq, rSq])) {
                    moves.push({ from: kSq, to: 62, piece: 'k', isCastling: 'bK', rookFrom: rSq, rookTo: 61 });
                }
            }
            if (this.castling.bQ) {
                const rSq = this.startRooks.bQ;
                if (this._isPathClear(kSq, 58, [kSq, rSq]) && this._isPathClear(rSq, 59, [kSq, rSq])) {
                    moves.push({ from: kSq, to: 58, piece: 'k', isCastling: 'bQ', rookFrom: rSq, rookTo: 59 });
                }
            }
        }

        // 4. PIÈCES À LONGUE PORTÉE
        for (let type of ['b', 'r', 'q']) {
            for (let sq of this._getBits(this.pieces[type] & ourPieces)) {
                let attacks = this._getSlidingAttacks(sq, type, occupied) & ~ourPieces;
                for (let target of this._getBits(attacks)) moves.push({ from: sq, to: target, piece: type, captured: this.get(target) });
            }
        }

        return moves;
    }

    generatePremoves(color) {
        if (this.turn === color) return this.generateMoves();
        this.turn = color;
        const pseudoMoves = this.generatePseudoMoves();
        this.turn = color === 'w' ? 'b' : 'w'; 
        return pseudoMoves;
    }

    // ==========================================================
    // VALIDATION LÉGALE DES COUPS
    // ==========================================================

    isSquareAttacked(sq, byColor) {
        const theirPieces = this.colors[byColor];
        const occupied = this.colors.w | this.colors.b;
        const usColor = byColor === 'w' ? 'b' : 'w';
        if (PAWN_ATTACKS[usColor][sq] & this.pieces.p & theirPieces) return true;
        if (KNIGHT_ATTACKS[sq] & this.pieces.n & theirPieces) return true;
        if (KING_ATTACKS[sq] & this.pieces.k & theirPieces) return true;
        if (this._getSlidingAttacks(sq, 'b', occupied) & (this.pieces.b | this.pieces.q) & theirPieces) return true;
        if (this._getSlidingAttacks(sq, 'r', occupied) & (this.pieces.r | this.pieces.q) & theirPieces) return true;
        return false;
    }

    makeMove(move) {
        this.historyData.push({
            move: move,
            turn: this.turn,
            castling: { ...this.castling },
            enPassant: this.enPassant,
            halfMoves: this.halfMoves,
            moveNumber: this.moveNumber,
            hash: this.computeHash()
        });

        const us = this.turn;
        const them = us === 'w' ? 'b' : 'w';
        const fromMask = 1n << BigInt(move.from);
        const toMask = 1n << BigInt(move.to);

        this.colors[us] &= ~fromMask;
        this.pieces[move.piece] &= ~fromMask;
        
        if (move.captured) {
            if (move.isEnPassant) {
                const epCaptureSq = us === 'w' ? move.to - 8 : move.to + 8;
                const epMask = 1n << BigInt(epCaptureSq);
                this.colors[them] &= ~epMask;
                this.pieces.p &= ~epMask;
            } else {
                this.colors[them] &= ~toMask;
                this.pieces[move.captured.type] &= ~toMask;
            }
            this.halfMoves = 0; 
        } else if (move.piece === 'p') {
            this.halfMoves = 0; 
        } else {
            this.halfMoves++;
        }

        if (move.isCastling) {
            const rFromMask = 1n << BigInt(move.rookFrom);
            const rToMask = 1n << BigInt(move.rookTo);
            this.colors[us] &= ~rFromMask;
            this.pieces.r &= ~rFromMask;
            this.colors[us] |= rToMask;
            this.pieces.r |= rToMask;
        }

        this.colors[us] |= toMask;
        if (move.promotion) {
            this.pieces[move.promotion] |= toMask;
        } else {
            this.pieces[move.piece] |= toMask;
        }
        
        if (move.piece === 'k') {
            if (us === 'w') { this.castling.wK = false; this.castling.wQ = false; }
            else { this.castling.bK = false; this.castling.bQ = false; }
        }
        for (let sq of [move.from, move.to]) {
            if (sq === this.startRooks.wQ) this.castling.wQ = false;
            else if (sq === this.startRooks.wK) this.castling.wK = false;
            else if (sq === this.startRooks.bQ) this.castling.bQ = false;
            else if (sq === this.startRooks.bK) this.castling.bK = false;
        }

        if (move.piece === 'p' && Math.abs(move.to - move.from) === 16) {
            this.enPassant = move.from + (us === 'w' ? 8 : -8);
        } else {
            this.enPassant = -1;
        }

        if (us === 'b') this.moveNumber++;
        this.turn = them;
    }

    unmakeMove() {
        if (this.historyData.length === 0) return null;
        const state = this.historyData.pop();
        const move = state.move;
        const us = state.turn; 
        const them = us === 'w' ? 'b' : 'w';
        
        const fromMask = 1n << BigInt(move.from);
        const toMask = 1n << BigInt(move.to);

        this.colors[us] &= ~toMask;
        if (move.promotion) this.pieces[move.promotion] &= ~toMask;
        else this.pieces[move.piece] &= ~toMask;
        
        if (move.captured) {
            if (move.isEnPassant) {
                const epCaptureSq = us === 'w' ? move.to - 8 : move.to + 8;
                const epMask = 1n << BigInt(epCaptureSq);
                this.colors[them] |= epMask;
                this.pieces.p |= epMask;
            } else {
                this.colors[them] |= toMask;
                this.pieces[move.captured.type] |= toMask;
            }
        }

        if (move.isCastling) {
            const rFromMask = 1n << BigInt(move.rookFrom);
            const rToMask = 1n << BigInt(move.rookTo);
            this.colors[us] &= ~rToMask;
            this.pieces.r &= ~rToMask;
            this.colors[us] |= rFromMask;
            this.pieces.r |= rFromMask;
        }

        this.colors[us] |= fromMask;
        this.pieces[move.piece] |= fromMask;

        this.turn = state.turn;
        this.castling = state.castling;
        this.enPassant = state.enPassant;
        this.halfMoves = state.halfMoves;
        this.moveNumber = state.moveNumber;
        
        return move;
    }

    generateMoves() {
        const pseudoMoves = this.generatePseudoMoves();
        const legalMoves = [];
        const us = this.turn;
        const them = us === 'w' ? 'b' : 'w';

        for (let move of pseudoMoves) {
            if (move.isCastling) {
                let valid = true;
                const pathEnd = move.to; 
                const pathStart = move.from;
                const step = pathEnd > pathStart ? 1 : -1;
                for (let sq = pathStart; sq !== pathEnd + step; sq += step) {
                    if (this.isSquareAttacked(sq, them)) {
                        valid = false;
                        break;
                    }
                }
                if (!valid) continue;
            }

            this.makeMove(move); 
            
            const kingBits = this._getBits(this.pieces.k & this.colors[us]);
            if (kingBits.length > 0) {
                if (!this.isSquareAttacked(kingBits[0], them)) {
                    legalMoves.push(move); 
                }
            }
            
            this.unmakeMove(); 
        }
        return legalMoves;
    }

    // Outil d'Audit : Perft
    perft(depth) {
        if (depth === 0) return 1;
        const moves = this.generateMoves();
        if (depth === 1) return moves.length;
        let nodes = 0;
        for (let i = 0; i < moves.length; i++) {
            this.makeMove(moves[i]);
            nodes += this.perft(depth - 1);
            this.unmakeMove();
        }
        return nodes;
    }

    // ==========================================================
    // NOTATION SAN (Standard Algebraic Notation)
    // ==========================================================

    moveToSan(move, legalMoves = null) {
        if (!legalMoves) legalMoves = this.generateMoves();
        
        if (move.isCastling) {
            let san = move.to > move.from ? 'O-O' : 'O-O-O';
            this.makeMove(move);
            if (this.isCheckmate()) san += '#';
            else if (this.inCheck()) san += '+';
            this.unmakeMove();
            return san;
        }

        let san = '';
        const isCapture = move.captured !== undefined && move.captured !== null;

        if (move.piece === 'p') {
            if (isCapture) {
                san += this.indexToSquare(move.from)[0] + 'x';
            }
            san += this.indexToSquare(move.to);
            if (move.promotion) san += '=' + move.promotion.toUpperCase();
        } else {
            san += move.piece.toUpperCase();
            
            const ambiguousMoves = legalMoves.filter(m => 
                m.piece === move.piece && m.to === move.to && m.from !== move.from
            );

            if (ambiguousMoves.length > 0) {
                const fromSq = this.indexToSquare(move.from);
                const file = fromSq[0];
                const rank = fromSq[1];
                
                const sameFile = ambiguousMoves.some(m => this.indexToSquare(m.from)[0] === file);
                const sameRank = ambiguousMoves.some(m => this.indexToSquare(m.from)[1] === rank);

                if (!sameFile) san += file;
                else if (!sameRank) san += rank;
                else san += fromSq;
            }

            if (isCapture) san += 'x';
            san += this.indexToSquare(move.to);
        }

        this.makeMove(move);
        if (this.isCheckmate()) san += '#';
        else if (this.inCheck()) san += '+';
        this.unmakeMove();

        return san;
    }

    moveFromSan(san) {
        const cleanSan = san.replace(/[+#!?]/g, '');
        const legalMoves = this.generateMoves();
        
        for (let m of legalMoves) {
            const mSan = this.moveToSan(m, legalMoves);
            if (mSan.replace(/[+#!?]/g, '') === cleanSan) {
                m.san = mSan;
                return m;
            }
        }
        return null;
    }

    // ==========================================================
    // PGN, HISTORIQUE ET API PUBLIQUE AVANCÉE
    // ==========================================================

    history(options = { verbose: false }) {
        const moves = [];
        for (let i = 0; i < this.historyData.length; i++) {
            if (options.verbose) {
                moves.push(this.historyData[i].move);
            } else {
                moves.push(this.historyData[i].move.san);
            }
        }
        return moves;
    }

    header(...args) {
        for (let i = 0; i < args.length; i += 2) {
            if (typeof args[i] === 'string' && typeof args[i + 1] === 'string') {
                this.headers[args[i]] = args[i + 1];
            }
        }
        return this.headers;
    }

    pgn() {
        let pgnStr = '';
        for (const [key, value] of Object.entries(this.headers)) {
            pgnStr += `[${key} "${value}"]\n`;
        }
        if (Object.keys(this.headers).length > 0) pgnStr += '\n';

        const moves = this.history();
        let moveText = '';
        for (let i = 0; i < moves.length; i++) {
            if (i % 2 === 0) moveText += `${(i / 2) + 1}. ${moves[i]} `;
            else moveText += `${moves[i]} `;
        }
        
        if (this.headers.Result) moveText += this.headers.Result;
        
        return pgnStr + moveText.trim();
    }

    loadPgn(pgn) {
        const lines = pgn.split(/\r?\n/);
        let moveText = '';
        let tempHeaders = {};
        
        for (let line of lines) {
            line = line.trim();
            if (line.startsWith('[')) {
                const match = line.match(/\[(\w+)\s+"(.*)"\]/);
                if (match) tempHeaders[match[1]] = match[2];
            } else if (line !== '') {
                moveText += line + ' ';
            }
        }

        const fen = (tempHeaders['SetUp'] === '1' && tempHeaders['FEN']) 
            ? tempHeaders['FEN'] 
            : 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

        if (!this.load(fen)) return false;

        for (const [key, value] of Object.entries(tempHeaders)) {
            this.header(key, value);
        }

        moveText = moveText.replace(/\{[^}]*\}/g, ''); 
        moveText = moveText.replace(/\d+\.+/g, ''); 
        moveText = moveText.replace(/\$[0-9]+/g, ''); 
        
        const moves = moveText.split(/\s+/).filter(m => m !== '' && !['1-0', '0-1', '1/2-1/2', '*'].includes(m));

        for (let m of moves) {
            const moveObj = this.move(m);
            if (!moveObj) return false; 
        }
        return true;
    }

    inCheck() {
        const us = this.turn;
        const them = us === 'w' ? 'b' : 'w';
        const kingBits = this._getBits(this.pieces.k & this.colors[us]);
        if (kingBits.length === 0) return false;
        return this.isSquareAttacked(kingBits[0], them);
    }

    isCheckmate() {
        return this.inCheck() && this.generateMoves().length === 0;
    }

    isStalemate() {
        return !this.inCheck() && this.generateMoves().length === 0;
    }

    isInsufficientMaterial() {
        const numPieces = this._getBits(this.colors.w | this.colors.b).length;
        if (numPieces === 2) return true; 
        if (numPieces === 3 && (this.pieces.b !== 0n || this.pieces.n !== 0n)) return true; 
        return false;
    }

    isDraw() {
        return this.halfMoves >= 100 || this.isStalemate() || this.isInsufficientMaterial() || this.isThreefoldRepetition();
    }

    isGameOver() {
        return this.isCheckmate() || this.isDraw();
    }

    fen() {
        let empty = 0;
        let fenStr = '';
        for (let r = 7; r >= 0; r--) {
            for (let f = 0; f < 8; f++) {
                const sq = r * 8 + f;
                const piece = this.get(sq);
                if (!piece) {
                    empty++;
                } else {
                    if (empty > 0) {
                        fenStr += empty;
                        empty = 0;
                    }
                    fenStr += piece.color === 'w' ? piece.type.toUpperCase() : piece.type.toLowerCase();
                }
            }
            if (empty > 0) {
                fenStr += empty;
                empty = 0;
            }
            if (r > 0) fenStr += '/';
        }

        fenStr += ` ${this.turn} `;
        
        let castling = '';
        if (this.castling.wK) castling += 'K';
        if (this.castling.wQ) castling += 'Q';
        if (this.castling.bK) castling += 'k';
        if (this.castling.bQ) castling += 'q';
        fenStr += castling || '-';
        
        fenStr += ` ${this.enPassant === -1 ? '-' : this.indexToSquare(this.enPassant)} `;
        fenStr += `${this.halfMoves} ${this.moveNumber}`;

        return fenStr;
    }
    /**
     * Vérifie si un coup est légal SANS modifier l'échiquier.
     * @param {string|Object} moveObj - Le coup à tester (ex: "e4" ou {from: "e2", to: "e4"})
     * @returns {boolean}
     */
    isLegalMove(moveObj) {
        const legalMoves = this.generateMoves();
        
        if (typeof moveObj === 'string') {
            const cleanSan = moveObj.replace(/[+#!?]/g, '');
            return legalMoves.some(m => this.moveToSan(m, legalMoves).replace(/[+#!?]/g, '') === cleanSan);
        }
        
        const fromSq = this.squareToIndex(moveObj.from);
        const toSq = this.squareToIndex(moveObj.to);
        const promo = moveObj.promotion ? moveObj.promotion.toLowerCase() : null;

        return legalMoves.some(m => {
            if (m.from !== fromSq || m.to !== toSq) return false;
            if (m.promotion && promo && m.promotion !== promo) return false;
            if (m.promotion && !promo && m.promotion !== 'q') return false;
            return true;
        });
    }

    /**
     * ATTENTION : Cette fonction n'est pas qu'un validateur.
     * Elle altère définitivement la position et avance le tour. 
     * Pour simplement tester la validité d'un coup sans le jouer, utilisez isLegalMove().
     */
    move(moveObj) {
        let fromSq = -1, toSq = -1, promotion = null;
        
        if (typeof moveObj === 'string') {
            if (moveObj.match(/^O-O/) || (!moveObj.includes('-') && !moveObj.match(/^[a-h][1-8][a-h][1-8]/))) {
                const m = this.moveFromSan(moveObj);
                if (m) {
                    this.makeMove(m);
                    return m;
                }
                return null;
            }

            const cleanStr = moveObj.replaceAll('-', '');
            fromSq = this.squareToIndex(cleanStr.substring(0, 2));
            toSq = this.squareToIndex(cleanStr.substring(2, 4));
            if (cleanStr.length > 4) promotion = cleanStr[4].toLowerCase();
        } else {
            fromSq = this.squareToIndex(moveObj.from);
            toSq = this.squareToIndex(moveObj.to);
            promotion = moveObj.promotion;
        }

        const legalMoves = this.generateMoves();
        for (let m of legalMoves) {
            if (m.from === fromSq && m.to === toSq) {
                if (m.promotion) {
                    if (promotion && m.promotion !== promotion) continue;
                    if (!promotion && m.promotion !== 'q') continue;
                }

                m.san = this.moveToSan(m, legalMoves); 
                this.makeMove(m);
                return m;
            }
        }
        return null; 
    }

    undo() {
        return this.unmakeMove();
    }
}

if (typeof window !== 'undefined') {
    window.ValisoaChessLite = ValisoaChessLite;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ValisoaChessLite;
}
