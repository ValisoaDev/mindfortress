/**
 * ValisoaChesspgnparser.js
 * A professional PGN parser with built-in parser combinator engine.
 * Architecture:
 * - PART 1: ValisoaParserEngine (Parser Combinator Framework)
 * - PART 2: PGN Grammar (ValisoaChesspgnparser)
 * - PART 3: API Exports
 */

// ============================================================================
// PART 1: ValisoaParserEngine (Parser Combinator Framework)
// ============================================================================
// Cette section contient le moteur qui remplace Peggy/PEG.js. Il fournit les
// blocs de construction (combinateurs) pour analyser n'importe quel texte.

/**
 * Représente l'état courant de l'analyse.
 * Garde la trace du texte global, de l'index de lecture, de la ligne et de la colonne.
 */
class ParserState {
    constructor(text, index = 0, line = 1, column = 1) {
        this.text = text;
        this.index = index;
        this.line = line;
        this.column = column;
    }
    
    /**
     * Fait avancer le curseur de lecture de 'n' caractères et recalcule
     * la ligne et la colonne courante pour les messages d'erreur.
     */
    advance(n, textChunk = null) {
        if (n === 0) return this;
        let newLine = this.line;
        let newCol = this.column;
        let chunk = textChunk !== null ? textChunk : this.text.substr(this.index, n);
        
        for (let i = 0; i < n; i++) {
            if (chunk[i] === '\n') {
                newLine++;
                newCol = 1;
            } else {
                newCol++;
            }
        }
        return new ParserState(this.text, this.index + n, newLine, newCol);
    }
}

/**
 * Résultat du retour d'un parseur (Succès ou Échec).
 */
class ParseResult {
    constructor(success, value, state, expected = []) {
        this.success = success; // true si le parseur a réussi
        this.value = value;     // la valeur extraite
        this.state = state;     // le nouvel état (nouveau curseur)
        this.expected = expected; // pour le débogage (ex: attendait "e4")
    }
}

// Utilitaires de retour rapides
const success = (value) => (state) => new ParseResult(true, value, state);
const failure = (expected) => (state) => new ParseResult(false, null, state, [expected]);

/**
 * Cherche une chaîne de caractères exacte (ex: str("[") cherche le crochet ouvrant).
 */
const str = (s) => (state) => {
    if (state.text.startsWith(s, state.index)) {
        return new ParseResult(true, s, state.advance(s.length, s));
    }
    return failure(`"${s}"`)(state);
};

/**
 * Cherche une correspondance avec une expression régulière.
 */
const regex = (re, expectedName) => (state) => {
    // Rend la regex "sticky" ('y') pour forcer la recherche à l'index exact actuel
    const stickyRe = new RegExp(re.source, re.flags + (re.flags.includes('y') ? '' : 'y'));
    stickyRe.lastIndex = state.index;
    const match = stickyRe.exec(state.text);
    if (match) {
        return new ParseResult(true, match, state.advance(match[0].length, match[0]));
    }
    return failure(expectedName || "regex match")(state);
};

/**
 * SEQUENCE : Applique plusieurs parseurs à la suite.
 * Échoue si l'un d'eux échoue (Comportement "ET").
 */
const seq = (parsers) => (state) => {
    let currentState = state;
    const results = [];
    for (const parser of parsers) {
        const result = parser(currentState);
        if (!result.success) return result; // Échec immédiat (fail fast)
        results.push(result.value);
        currentState = result.state;
    }
    return new ParseResult(true, results, currentState);
};

/**
 * CHOICE : Essaie une liste de parseurs un par un.
 * S'arrête au premier qui réussit (Comportement "OU").
 */
const choice = (parsers) => (state) => {
    let expected = [];
    let farthestState = state; // Garde en mémoire l'endroit de l'erreur la plus lointaine
    for (const parser of parsers) {
        const result = parser(state);
        if (result.success) return result;
        
        // Suivi de l'erreur la plus pertinente pour l'utilisateur
        if (result.state.index > farthestState.index) {
            farthestState = result.state;
            expected = result.expected;
        } else if (result.state.index === farthestState.index) {
            expected = expected.concat(result.expected);
        }
    }
    return new ParseResult(false, null, farthestState, expected);
};

/**
 * Rend un parseur facultatif (Optionnel). N'échoue jamais.
 */
const optional = (parser) => (state) => {
    const result = parser(state);
    if (result.success) return result;
    return new ParseResult(true, null, state); // Retourne l'état intact en cas d'échec
};

/**
 * MANY : Répète un parseur 0 ou plusieurs fois. N'échoue jamais.
 */
const many = (parser) => (state) => {
    let currentState = state;
    const results = [];
    while (true) {
        const result = parser(currentState);
        if (!result.success || result.state.index <= currentState.index) break;
        results.push(result.value);
        currentState = result.state;
    }
    return new ParseResult(true, results, currentState);
};

/**
 * MAP : Transforme le résultat d'un parseur s'il réussit.
 * Très utile pour structurer le texte brut en objets JSON propres.
 */
const map = (parser, fn) => (state) => {
    const result = parser(state);
    if (result.success) {
        return new ParseResult(true, fn(result.value), result.state);
    }
    return result;
};

/**
 * LAZY : Évalue un parseur de façon paresseuse.
 * Indispensable pour gérer la récursivité (ex: des variations imbriquées (1. e4 (1. d4 (1. c4)))).
 */
const lazy = (fn) => (state) => {
    return fn()(state);
};

// ============================================================================
// PART 2: PGN Grammar (ValisoaChesspgnparser)
// ============================================================================
// Définition de la grammaire spécifique au format PGN des échecs en utilisant
// les blocs de construction (str, regex, seq...) de la Partie 1.

// ----------------------------------------------------------------------------
// Tokens de base (espaces, ponctuation)
// ----------------------------------------------------------------------------
const whitespaceRegex = /[ \t\r\n]+/;
const ws = regex(whitespaceRegex, "whitespace"); // parse un espace
const wsOpt = optional(ws); // parse un espace optionnel

const lbracket = str('[');
const rbracket = str(']');
const lparen = str('(');
const rparen = str(')');

// ----------------------------------------------------------------------------
// En-têtes (Tags) : [Event "FIDE World Cup"]
// ----------------------------------------------------------------------------
// Regex pour extraire le texte entre guillemets, en gérant les guillemets échappés (\")
const stringRegex = /"([^"\\]*(?:\\.[^"\\]*)*)"/;
const tagString = map(regex(stringRegex, "tag string"), match => {
    return match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
});

// Le nom de l'en-tête (ex: Event, White, Black)
const symbolRegex = /[A-Za-z0-9_+\-#=:]+/;
const symbol = map(regex(symbolRegex, "symbol"), match => match[0]);

// Parse une paire complète [Clé "Valeur"] et retourne { name: 'Clé', value: 'Valeur' }
const tagPair = map(
    seq([lbracket, wsOpt, symbol, wsOpt, tagString, wsOpt, rbracket]),
    (res) => ({ name: res[2], value: res[4] })
);

// Transforme la liste des paires en un objet JSON unique (ex: { Event: "...", White: "..." })
const tags = map(
    many(seq([wsOpt, tagPair, wsOpt])),
    (res) => {
        const tagsObj = {};
        res.forEach(item => {
            tagsObj[item[1].name] = item[1].value;
        });
        return tagsObj;
    }
);

// ----------------------------------------------------------------------------
// Coups (Moves), Commentaires, NAGs, Variations
// ----------------------------------------------------------------------------
// Numéro du coup : ex '1.', '1...', '42.'
const moveNumberRegex = /[0-9]+\.+/;
const moveNumber = map(regex(moveNumberRegex, "move number"), match => match[0]);

// Commentaires en accolade { ... }
const blockCommentRegex = /{([^}]*)}/;
const blockComment = map(regex(blockCommentRegex, "block comment"), match => match[1].trim());

// Commentaires en fin de ligne (commence par ; et va jusqu'à la fin de la ligne)
const eolCommentRegex = /;([^\r\n]*)/;
const eolComment = map(regex(eolCommentRegex, "eol comment"), match => match[1].trim());

// Un commentaire peut être soit en bloc, soit en ligne
const comment = choice([blockComment, eolComment]);

// NAGs (Numeric Annotation Glyphs) ex: $1, $3
const nagRegex = /\$([0-9]+)/;
const nag = map(regex(nagRegex, "NAG"), match => '$' + match[1]);

// Notation Algébrique Standard (SAN). 
// Gère O-O-O, O-O, coups réguliers (Nf3), pions (e4), promotions (=Q), échecs (+) et mats (#)
const sanRegex = /(O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?)/;
const san = map(regex(sanRegex, "SAN move"), match => match[0]);

// Déclaration de la variation récursive (Forward declaration car un RAV contient des coups, qui eux-mêmes peuvent contenir des RAVs)
let ravPattern;
const rav = lazy(() => ravPattern);

// Un "élément" peut être un commentaire, un NAG ou une sous-variation
const element = choice([
    map(comment, c => ({ type: "comment", value: c })),
    map(nag, n => ({ type: "nag", value: n })),
    map(rav, r => ({ type: "rav", value: r }))
]);

// Convertit la chaîne '1.' ou '1...' en un entier 1.
const turnNumber = map(moveNumber, n => parseInt(n.replace(/\./g, ''), 10));

// Noeud central : Représente UN coup (ex: "1. e4 {Commentaire} $1")
const moveNode = map(
    seq([
        optional(seq([turnNumber, wsOpt])), // Le numéro est optionnel car on peut avoir e4 d5 sans numéro répété
        san,                                // Le coup lui-même
        wsOpt,
        many(seq([element, wsOpt]))         // Tous les commentaires, NAGs ou sous-variations attachés à ce coup
    ]),
    (res) => {
        let num = res[0] ? res[0][0] : null;
        let move = res[1];
        let elements = res[3].map(item => item[0]);
        
        let node = { move: move };
        if (num !== null) node.moveNumber = num;
        
        // Trie et extrait les éléments enfants du coup
        const comments = elements.filter(e => e.type === "comment").map(e => e.value);
        const nags = elements.filter(e => e.type === "nag").map(e => e.value);
        const ravs = elements.filter(e => e.type === "rav").map(e => e.value);
        
        if (comments.length > 0) node.comments = comments;
        if (nags.length > 0) node.nags = nags;
        if (ravs.length > 0) node.ravs = ravs;
        
        return node;
    }
);

// RAV (Recursive Annotation Variation) : Les sous-variations entre parenthèses (1. e4 (1. d4))
ravPattern = map(
    seq([
        lparen,
        wsOpt,
        many(seq([choice([moveNode, map(element, e=>e)]), wsOpt])), // Liste de coups dans la parenthèse
        rparen
    ]),
    (res) => {
        // Retourne uniquement la liste des noeuds de coups de la sous-variation
        return res[2].map(item => item[0]).filter(node => node.move); 
    }
);

// Résultat final de la partie
const resultRegex = /(1-0|0-1|1\/2-1\/2|\*)/;
const gameResult = map(regex(resultRegex, "game result"), match => match[0]);

// Séquence complète de texte des coups (Movetext)
const movetext = map(
    seq([
        many(seq([choice([moveNode, map(element, e => e)]), wsOpt])), // Parse tous les coups et éléments orphelins
        optional(gameResult) // Termine par le résultat (Optionnel)
    ]),
    (res) => {
        const items = res[0].map(item => item[0]);
        const moves = [];
        let currentGameComments = [];
        
        // Cette boucle rattache les commentaires/variations "orphelins" au coup précédent
        // Ou bien aux commentaires globaux de la partie s'ils sont placés tout au début (ex: {Partie jouée à Paris} 1. e4)
        for (const item of items) {
            if (item.move) {
                moves.push(item);
            } else if (item.type === 'comment') {
                if (moves.length === 0) currentGameComments.push(item.value);
                else {
                    let lastMove = moves[moves.length - 1];
                    if (!lastMove.comments) lastMove.comments = [];
                    lastMove.comments.push(item.value);
                }
            } else if (item.type === 'nag') {
                if (moves.length > 0) {
                    let lastMove = moves[moves.length - 1];
                    if (!lastMove.nags) lastMove.nags = [];
                    lastMove.nags.push(item.value);
                }
            } else if (item.type === 'rav') {
                if (moves.length > 0) {
                    let lastMove = moves[moves.length - 1];
                    if (!lastMove.ravs) lastMove.ravs = [];
                    lastMove.ravs.push(item.value);
                }
            }
        }
        
        let resObj = { moves: moves };
        if (currentGameComments.length > 0) resObj.gameComments = currentGameComments;
        if (res[1]) resObj.result = res[1];
        
        return resObj;
    }
);

// Une Partie (Game) complète = Tags + Movetext
const game = map(
    seq([wsOpt, tags, wsOpt, movetext, wsOpt]),
    (res) => {
        const gameTags = Object.keys(res[1]).length > 0 ? res[1] : null;
        const gameMoves = res[3];
        
        let g = {};
        if (gameTags) g.tags = gameTags;
        g.moves = gameMoves.moves;
        if (gameMoves.gameComments) g.gameComments = gameMoves.gameComments;
        
        // Le résultat dans les tags l'emporte, sinon on prend celui du movetext
        if (gameTags && gameTags.Result) {
             g.result = gameTags.Result;
        } else if (gameMoves.result) {
             g.result = gameMoves.result;
        }
        
        return g;
    }
);

// Une base de données complète PGN = 0 à plusieurs Parties
const pgnDatabase = map(
    many(game),
    (res) => res
);

// ============================================================================
// PART 3: API Exports
// ============================================================================

/**
 * Fonction noyau qui exécute un parseur spécifique sur une chaîne.
 */
function parseString(parser, input, options = {}) {
    const state = new ParserState(input);
    const result = parser(state);
    
    if (result.success) {
        // Sécurité : si option matchEntire est activée, on vérifie que tout le texte a été analysé
        if (options.matchEntire && result.state.index < input.length) {
            throw new Error(`Erreur de parsing à la ligne ${result.state.line}, colonne ${result.state.column} : N'a pas pu consommer la fin du texte PGN.`);
        }
        return result.value;
    } else {
        // En cas d'erreur, on remonte le(s) caractère(s) attendu(s)
        const expected = [...new Set(result.expected)].join(" ou ");
        throw new Error(`Erreur de syntaxe à la ligne ${result.state.line}, colonne ${result.state.column} : Attendu ${expected}.`);
    }
}

/**
 * L'API publique de la bibliothèque.
 */
const ValisoaChesspgnparser = {
    /**
     * Parse un texte PGN.
     * @param {string} input - La chaîne de texte PGN.
     * @param {object} options - Configuration de l'analyseur.
     *                           startRule: "games" (défaut), "game", "tags", ou "pgn".
     */
    parse: function(input, options = {}) {
        let parser;
        let rule = options.startRule || "games";
        
        // Sélectionne le bon parseur de départ en fonction des options
        if (rule === "game") parser = game;
        else if (rule === "tags") parser = tags;
        else if (rule === "pgn") parser = movetext;
        else parser = pgnDatabase; // Par défaut : multiples parties
        
        return parseString(parser, input, options);
    }
};

// Injection Globale (Compatibilité Navigateur et Environnement NodeJS)
if (typeof window !== 'undefined') {
    window.ValisoaChesspgnparser = ValisoaChesspgnparser; // Export pour Navigateur
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ValisoaChesspgnparser; // Export pour Node.js / Webpack
}
