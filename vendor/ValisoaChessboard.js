/**
 * ValisoaChessboard.js
 * Bibliothèque d'interface graphique pour jeu d'échecs en Vanilla JS.
 */

class ValisoaChessboard {
    constructor(container, config = {}) {
        this.container = typeof container === 'string' ? document.getElementById(container) : container;
        
        // Identifiant unique pour le multi-instances (Évite les conflits SVG)
        this.instanceId = 'v' + Math.random().toString(36).substr(2, 9);
        
        this.pieceTheme = config.pieceTheme || 'img/chesspieces/wikipedia/{piece}.svg';
        this.showNotation = config.showNotation !== false;
        
        this.draggable = config.draggable !== false;
        this.dropOffBoard = config.dropOffBoard || 'snapback'; 
        this.moveSpeed = config.moveSpeed !== undefined ? config.moveSpeed : 150; 
        
        // --- PHASE 7 : PREMOVES ET TOURS ---
        this.playingColor = config.playingColor || 'both'; // 'w', 'b', ou 'both' (jeu local)
        this.turnColor = config.turnColor || 'w'; // A qui le tour ?
        this.premovable = config.premovable !== false;
        
        // Callbacks avancés
        this.onDragStart = config.onDragStart || null;
        this.onDrop = config.onDrop || null; 
        this.onChange = config.onChange || null;
        this.onPremove = config.onPremove || null; // Déclenché quand un pre-move est enregistré
        this.onPremoveCancel = config.onPremoveCancel || null;

        this.state = {
            orientation: config.orientation || 'white',
            draggedPieceEl: null,
            ghostPieceEl: null,
            sourceSquare: null,  
            selectedSquare: null,
            lastMove: null,
            premove: null // {source, target, piece}       
        };

        this.position_data = {};
        if (config.position) {
            this.setPosition(config.position);
        }

        // Sauvegarde des fonctions liées pour éviter les fuites de mémoire (Memory Leaks)
        this._boundPointerMove = this._onPointerMove.bind(this);
        this._boundPointerUp = this._onPointerUp.bind(this);
        this._boundContextMenu = this._onContextMenu.bind(this);
        this._boundPointerDown = this._onPointerDown.bind(this);

        this._renderBoard();
        this._renderPieces();
        this._attachEvents();
    }

    // ==========================================================
    // API PUBLIQUE (Phase 7 Enterprise-ready)
    // ==========================================================

    /**
     * Nettoie les événements globaux. Indispensable pour les apps React/Vue/Angular (SPA).
     */
    destroy() {
        document.removeEventListener('pointermove', this._boundPointerMove);
        document.removeEventListener('pointerup', this._boundPointerUp);
        if (this.container) {
            this.container.removeEventListener('pointerdown', this._boundPointerDown);
            this.container.removeEventListener('contextmenu', this._boundContextMenu);
            this.container.innerHTML = '';
        }
    }

    setTurn(color) {
        this.turnColor = color;
        // Si c'est notre tour et qu'on a un premove enregistré, on l'exécute automatiquement !
        if (this.playingColor !== 'both' && this.turnColor === this.playingColor && this.state.premove) {
            const pm = this.state.premove;
            this.cancelPremove(); // Nettoie l'affichage du premove
            this._attemptMove(pm.source, pm.target, true); // Tente le mouvement
        }
    }

    position(newPosition = undefined) {
        if (newPosition === undefined) return { ...this.position_data };
        this.setPosition(newPosition);
    }

    setPosition(newPosition) {
        const oldPos = { ...this.position_data };

        if (typeof newPosition === 'string') {
            if (newPosition.toLowerCase() === 'start') {
                this.position_data = ValisoaChessboard.fenToObj('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
            } else {
                this.position_data = ValisoaChessboard.fenToObj(newPosition);
            }
        } else {
            this.position_data = { ...newPosition };
        }

        if (this.onChange) this.onChange(oldPos, this.position_data);
        this._renderPieces();
    }

    orientation(newOrientation = undefined) {
        if (newOrientation === undefined) return this.state.orientation;
        this.state.orientation = newOrientation === 'black' ? 'black' : 'white';
        this._renderBoard();
        this._renderPieces();
    }

    flip() {
        this.orientation(this.state.orientation === 'white' ? 'black' : 'white');
    }

    clear() {
        this.setPosition({});
    }

    move(moveStr) {
        const parts = moveStr.split('-');
        if (parts.length === 2) {
            const [source, target] = parts;
            if (this.position_data[source]) {
                this._attemptMove(source, target, true); 
            }
        }
    }

    // ==========================================================
    // GESTION DES PREMOVES (Phase 7)
    // ==========================================================

    _registerPremove(source, target, piece) {
        this.state.premove = { source, target, piece };
        this._highlightPremove();
        if (this.onPremove) this.onPremove(source, target, piece);
    }

    cancelPremove() {
        if (!this.state.premove) return;
        this.state.premove = null;
        
        const squares = this.container.querySelectorAll('.valisoa-square');
        squares.forEach(s => s.classList.remove('premove'));
        
        if (this.onPremoveCancel) this.onPremoveCancel();
    }

    _highlightPremove() {
        const squares = this.container.querySelectorAll('.valisoa-square');
        squares.forEach(s => s.classList.remove('premove'));
        
        if (this.state.premove) {
            const sq1 = this.container.querySelector(`[data-square="${this.state.premove.source}"]`);
            const sq2 = this.container.querySelector(`[data-square="${this.state.premove.target}"]`);
            if (sq1) sq1.classList.add('premove');
            if (sq2) sq2.classList.add('premove');
        }
    }

    _onContextMenu(e) {
        e.preventDefault(); // Empêche le menu clic droit
        if (this.state.premove) {
            this.cancelPremove();
        }
    }

    // ==========================================================
    // ANNOTATIONS VISUELLES (Flèches et Cercles SVG)
    // ==========================================================

    _getSquareCenter(square) {
        const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
        const rank = 7 - (square.charCodeAt(1) - '1'.charCodeAt(0));
        
        const f = this.state.orientation === 'white' ? file : 7 - file;
        const r = this.state.orientation === 'white' ? rank : 7 - rank;

        return { x: (f + 0.5) * 12.5, y: (r + 0.5) * 12.5 };
    }

    addArrow(source, target, colorName = 'green') {
        const g = this.container.querySelector(`.valisoa-shapes-${this.instanceId}`);
        if (!g) return;

        const p1 = this._getSquareCenter(source);
        const p2 = this._getSquareCenter(target);

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const ratio = (dist - 4.5) / dist; 

        const x2 = p1.x + dx * ratio;
        const y2 = p1.y + dy * ratio;

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', `${p1.x}%`);
        line.setAttribute('y1', `${p1.y}%`);
        line.setAttribute('x2', `${x2}%`);
        line.setAttribute('y2', `${y2}%`);
        
        const colors = { green: 'rgba(21, 120, 27, 0.8)', red: 'rgba(200, 30, 30, 0.8)', blue: 'rgba(30, 80, 200, 0.8)', yellow: 'rgba(220, 180, 20, 0.8)' };
        
        line.setAttribute('stroke', colors[colorName] || colorName);
        line.setAttribute('stroke-width', '1.8%');
        line.setAttribute('stroke-linecap', 'round');
        line.setAttribute('marker-end', `url(#arrowhead-${colorName}-${this.instanceId})`);
        
        g.appendChild(line);
    }

    addCircle(square, colorName = 'green') {
        const g = this.container.querySelector(`.valisoa-shapes-${this.instanceId}`);
        if (!g) return;

        const p = this._getSquareCenter(square);
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', `${p.x}%`);
        circle.setAttribute('cy', `${p.y}%`);
        circle.setAttribute('r', '5.5%');
        
        const colors = { green: 'rgba(21, 120, 27, 0.8)', red: 'rgba(200, 30, 30, 0.8)', blue: 'rgba(30, 80, 200, 0.8)', yellow: 'rgba(220, 180, 20, 0.8)' };
        
        circle.setAttribute('fill', 'none');
        circle.setAttribute('stroke', colors[colorName] || colorName);
        circle.setAttribute('stroke-width', '1%');
        
        g.appendChild(circle);
    }

    addDot(square, colorName = 'rgba(21, 120, 27, 0.4)') {
        const g = this.container.querySelector(`.valisoa-shapes-${this.instanceId}`);
        if (!g) return;

        const p = this._getSquareCenter(square);
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', `${p.x}%`);
        circle.setAttribute('cy', `${p.y}%`);
        circle.setAttribute('r', '2.5%'); 
        
        const colors = { green: 'rgba(21, 120, 27, 0.4)', red: 'rgba(200, 30, 30, 0.4)', blue: 'rgba(30, 80, 200, 0.4)', yellow: 'rgba(220, 180, 20, 0.4)' };
        
        circle.setAttribute('fill', colors[colorName] || colorName);
        circle.classList.add('valisoa-dot'); 
        
        g.appendChild(circle);
    }

    clearAnnotations() {
        const g = this.container.querySelector(`.valisoa-shapes-${this.instanceId}`);
        if (g) g.innerHTML = '';
    }

    clearDots() {
        const g = this.container.querySelector(`.valisoa-shapes-${this.instanceId}`);
        if (g) g.querySelectorAll('.valisoa-dot').forEach(d => d.remove());
    }

    // ==========================================================
    // MÉTHODES INTERNES DE RENDU
    // ==========================================================

    _renderBoard() {
        if (!this.container) return;
        this.container.innerHTML = '';
        
        const boardEl = document.createElement('div');
        boardEl.className = 'valisoa-board';
        boardEl.style.position = 'relative'; 
        boardEl.setAttribute('role', 'application');
        boardEl.setAttribute('aria-label', 'Échiquier Interactif');
        
        const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
        const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
        
        if (this.state.orientation === 'black') {
            files.reverse();
            ranks.reverse();
        }

        for (let r = 0; r < 8; r++) {
            for (let f = 0; f < 8; f++) {
                const square = files[f] + ranks[r];
                const squareEl = document.createElement('div');
                const isBlack = (r + f) % 2 !== 0;
                
                squareEl.className = `valisoa-square ${isBlack ? 'black' : 'white'}`;
                squareEl.dataset.square = square; 
                squareEl.setAttribute('aria-label', `Case ${square}`);

                if (this.showNotation) {
                    if (f === 0) {
                        const numEl = document.createElement('span');
                        numEl.className = 'valisoa-notation numeric';
                        numEl.innerText = ranks[r];
                        squareEl.appendChild(numEl);
                    }
                    if (r === 7) {
                        const alphaEl = document.createElement('span');
                        alphaEl.className = 'valisoa-notation alpha';
                        alphaEl.innerText = files[f];
                        squareEl.appendChild(alphaEl);
                    }
                }
                boardEl.appendChild(squareEl);
            }
        }
        
        // OVERLAY SVG 
        const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svgEl.setAttribute('class', 'valisoa-annotations');
        svgEl.style.position = 'absolute';
        svgEl.style.top = '0';
        svgEl.style.left = '0';
        svgEl.style.width = '100%';
        svgEl.style.height = '100%';
        svgEl.style.pointerEvents = 'none';
        svgEl.style.zIndex = '10';

        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const colors = { green: 'rgba(21, 120, 27, 0.8)', red: 'rgba(200, 30, 30, 0.8)', blue: 'rgba(30, 80, 200, 0.8)', yellow: 'rgba(220, 180, 20, 0.8)' };

        for (const [name, color] of Object.entries(colors)) {
            const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
            marker.setAttribute('id', `arrowhead-${name}-${this.instanceId}`);
            marker.setAttribute('markerWidth', '4');
            marker.setAttribute('markerHeight', '4');
            marker.setAttribute('refX', '2.5'); 
            marker.setAttribute('refY', '2');
            marker.setAttribute('orient', 'auto');

            const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            polygon.setAttribute('points', '0 0, 4 2, 0 4');
            polygon.setAttribute('fill', color);
            marker.appendChild(polygon);
            defs.appendChild(marker);
        }
        svgEl.appendChild(defs);
        
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', `valisoa-shapes-${this.instanceId}`);
        svgEl.appendChild(g);

        boardEl.appendChild(svgEl);
        this.container.appendChild(boardEl);
    }

    _renderPieces() {
        const oldPieces = this.container.querySelectorAll('.valisoa-piece, .valisoa-ghost');
        oldPieces.forEach(p => p.remove());

        const pieceNames = { p: 'Pion', n: 'Cavalier', b: 'Fou', r: 'Tour', q: 'Dame', k: 'Roi' };
        const colorNames = { w: 'Blanc', b: 'Noir' };

        for (const [square, piece] of Object.entries(this.position_data)) {
            const squareEl = this.container.querySelector(`[data-square="${square}"]`);
            if (squareEl) {
                const pieceEl = document.createElement('img');
                pieceEl.className = 'valisoa-piece';
                pieceEl.src = this.pieceTheme.replace('{piece}', piece);
                pieceEl.dataset.piece = piece; 
                
                // A11y
                const type = piece[1].toLowerCase();
                const color = piece[0];
                pieceEl.setAttribute('alt', `${pieceNames[type]} ${colorNames[color]} sur ${square}`);
                pieceEl.setAttribute('role', 'img');

                squareEl.appendChild(pieceEl);
            }
        }
        this._highlightLastMove();
        this._highlightPremove();
    }

    // ==========================================================
    // INTERACTIVITÉ
    // ==========================================================

    _attachEvents() {
        this.container.addEventListener('pointerdown', this._boundPointerDown);
        this.container.addEventListener('contextmenu', this._boundContextMenu);
        document.addEventListener('pointermove', this._boundPointerMove);
        document.addEventListener('pointerup', this._boundPointerUp);
    }

    _onPointerDown(e) {
        if (e.button !== 0 && e.pointerType === 'mouse') {
            return; // Laisse le clic droit faire son annulation
        }

        const target = e.target;
        
        // Annulation du pre-move si on clique ailleurs sur l'échiquier
        if (this.state.premove) {
            this.cancelPremove();
        }

        // SCÉNARIO 1 : CLICK-TO-MOVE 
        if (this.state.selectedSquare) {
            const squareEl = target.closest('.valisoa-square');
            if (squareEl) {
                const targetSquare = squareEl.dataset.square;
                if (this.state.selectedSquare !== targetSquare) {
                    this._attemptMoveLogic(this.state.selectedSquare, targetSquare, true);
                }
            }
            this._clearSelection();
            return;
        }

        // SCÉNARIO 2 : DRAG & DROP 
        if (target.classList.contains('valisoa-piece') && this.draggable) {
            e.preventDefault(); 
            const squareEl = target.closest('.valisoa-square');
            const sourceSquare = squareEl.dataset.square;
            const piece = target.dataset.piece;

            // Phase 7 : Vérification du tour et des droits
            const pieceColor = piece[0];
            const isMyPiece = this.playingColor === 'both' || pieceColor === this.playingColor;
            const isMyTurn = this.turnColor === pieceColor;

            if (!isMyPiece) return; // On ne touche pas aux pièces adverses
            if (!isMyTurn && !this.premovable) return; // Premove interdit
            
            // CALLBACK onDragStart
            if (this.onDragStart) {
                const proceed = this.onDragStart(sourceSquare, piece);
                if (proceed === false) return; 
            }
            
            this.state.draggedPieceEl = target;
            this.state.sourceSquare = sourceSquare;
            
            const rect = target.getBoundingClientRect();
            target.style.width = rect.width + 'px';
            target.style.height = rect.height + 'px';
            
            target.classList.add('dragging');
            
            // Ghost Piece
            const ghostEl = target.cloneNode();
            ghostEl.classList.remove('dragging');
            ghostEl.classList.add('valisoa-ghost');
            ghostEl.style.opacity = '0.3';
            ghostEl.style.pointerEvents = 'none';
            squareEl.appendChild(ghostEl);
            this.state.ghostPieceEl = ghostEl;

            this._moveDraggedPiece(e.clientX, e.clientY); 
            
            this.state.selectedSquare = sourceSquare;
            squareEl.classList.add('selected'); 
        }
    }

    _onPointerMove(e) {
        if (!this.state.draggedPieceEl) return;
        this._moveDraggedPiece(e.clientX, e.clientY);
    }

    _moveDraggedPiece(x, y) {
        const piece = this.state.draggedPieceEl;
        piece.style.left = (x - piece.offsetWidth / 2) + 'px';
        piece.style.top = (y - piece.offsetHeight / 2) + 'px';
    }

    _onPointerUp(e) {
        if (!this.state.draggedPieceEl) return;

        const pieceEl = this.state.draggedPieceEl;
        const sourceSquare = this.state.sourceSquare;
        
        pieceEl.classList.remove('dragging');
        pieceEl.style.left = '';
        pieceEl.style.top = '';
        pieceEl.style.width = '';  
        pieceEl.style.height = ''; 

        if (this.state.ghostPieceEl) {
            this.state.ghostPieceEl.remove();
            this.state.ghostPieceEl = null;
        }

        const elementBelow = document.elementFromPoint(e.clientX, e.clientY);
        const squareEl = elementBelow ? elementBelow.closest('.valisoa-square') : null;

        if (squareEl && squareEl.dataset.square !== sourceSquare) {
            const targetSquare = squareEl.dataset.square;
            this._attemptMoveLogic(sourceSquare, targetSquare, false, pieceEl); 
            this._clearSelection(); 
        } else {
            // Drop hors plateau
            if (!squareEl && this.dropOffBoard === 'trash') {
                const piece = this.position_data[sourceSquare];
                delete this.position_data[sourceSquare];
                if (this.onDrop) this.onDrop(sourceSquare, 'offboard', piece);
                this._renderPieces();
            } else {
                // Snapback
                const sourceSquareEl = this.container.querySelector(`[data-square="${sourceSquare}"]`);
                if (sourceSquareEl) sourceSquareEl.appendChild(pieceEl);
            }
        }

        this.state.draggedPieceEl = null;
        this.state.sourceSquare = null;
    }

    // ==========================================================
    // LOGIQUE DE DÉPLACEMENT ET ANIMATION
    // ==========================================================

    _attemptMoveLogic(source, target, animate, pieceElToSnap = null) {
        const piece = this.position_data[source];
        if (!piece) return;

        // Phase 7 : Est-ce un premove ?
        const isMyTurn = this.turnColor === piece[0];
        if (!isMyTurn && this.playingColor !== 'both') {
            this._registerPremove(source, target, piece);
            // Snapback visuel (le premove sera validé à notre tour réel)
            const sourceSquareEl = this.container.querySelector(`[data-square="${source}"]`);
            if (sourceSquareEl && pieceElToSnap) sourceSquareEl.appendChild(pieceElToSnap);
            this._renderPieces();
            return;
        }

        // C'est notre tour (ou jeu local 'both') -> exécution normale
        const targetSquareEl = this.container.querySelector(`[data-square="${target}"]`);
        if (targetSquareEl && pieceElToSnap) targetSquareEl.appendChild(pieceElToSnap);

        this._attemptMove(source, target, animate);
    }

    _attemptMove(source, target, animate = false) {
        const piece = this.position_data[source];
        if (!piece) return;

        const isPawn = piece[1] === 'P';
        const isWhitePromotion = isPawn && piece[0] === 'w' && target[1] === '8';
        const isBlackPromotion = isPawn && piece[0] === 'b' && target[1] === '1';

        if (isWhitePromotion || isBlackPromotion) {
            this._showPromotionMenu(source, target, piece[0]);
            return;
        }

        this._commitMove(source, target, null, animate);
    }

    _commitMove(source, target, promotionPiece, animate = false) {
        if (this.onDrop) {
            const moveResult = this.onDrop(source, target, promotionPiece);
            if (moveResult === 'snapback') {
                this._renderPieces();
                return;
            } else if (typeof moveResult === 'string' && moveResult.includes('/')) {
                // Si onDrop retourne un FEN, on met à jour la position exacte (Gère Roque, En Passant, etc.)
                this.position(moveResult);
                return;
            } else if (moveResult === 'trash') {
                delete this.position_data[source];
                this._renderPieces();
                return;
            }
        }
        
        const pieceToPlace = promotionPiece ? promotionPiece : this.position_data[source];
        const oldPos = { ...this.position_data };
        
        delete this.position_data[source];
        this.position_data[target] = pieceToPlace;
        this.state.lastMove = { source, target };
        
        if (this.onChange) this.onChange(oldPos, this.position_data);

        if (animate) {
            this._animateMove(source, target, () => {
                this._renderPieces();
            });
        } else {
            this._renderPieces();
        }
    }

    _animateMove(source, target, callback) {
        const sourceSquareEl = this.container.querySelector(`[data-square="${source}"]`);
        const targetSquareEl = this.container.querySelector(`[data-square="${target}"]`);
        const pieceEl = sourceSquareEl ? sourceSquareEl.querySelector('.valisoa-piece') : null;

        if (!pieceEl || !targetSquareEl) {
            if (callback) callback();
            return;
        }

        const firstRect = pieceEl.getBoundingClientRect();
        targetSquareEl.appendChild(pieceEl);
        const lastRect = pieceEl.getBoundingClientRect();

        const deltaX = firstRect.left - lastRect.left;
        const deltaY = firstRect.top - lastRect.top;

        pieceEl.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
        pieceEl.style.transition = 'none';

        requestAnimationFrame(() => {
            pieceEl.offsetHeight; 
            pieceEl.style.transform = 'translate(0, 0)';
            pieceEl.style.transition = `transform ${this.moveSpeed}ms ease-out`;
            
            setTimeout(() => {
                pieceEl.style.transform = '';
                pieceEl.style.transition = '';
                if (callback) callback();
            }, this.moveSpeed);
        });
    }

    // ==========================================================
    // MENU PROMOTION
    // ==========================================================

    _showPromotionMenu(source, target, pieceColor) {
        this._hidePromotionMenu(); 

        const squareEl = this.container.querySelector(`[data-square="${target}"]`);
        if (!squareEl) return;

        const menu = document.createElement('div');
        menu.className = 'valisoa-promotion-menu';
        
        if (target[1] === '8') menu.classList.add('down');
        else menu.classList.add('up');

        const pieces = ['Q', 'R', 'B', 'N']; 
        
        pieces.forEach(p => {
            const promoPiece = pieceColor + p;
            const img = document.createElement('img');
            img.src = this.pieceTheme.replace('{piece}', promoPiece);
            img.className = 'valisoa-promotion-piece';
            
            img.addEventListener('pointerdown', (e) => {
                e.stopPropagation(); 
                this._hidePromotionMenu();
                this._commitMove(source, target, promoPiece, false); 
            });
            menu.appendChild(img);
        });

        squareEl.appendChild(menu);

        this._promotionCancelListener = (e) => {
            if (!menu.contains(e.target)) {
                this._hidePromotionMenu();
                this._renderPieces(); 
            }
        };
        setTimeout(() => { document.addEventListener('pointerdown', this._promotionCancelListener); }, 10);
    }

    _hidePromotionMenu() {
        const menu = this.container.querySelector('.valisoa-promotion-menu');
        if (menu) menu.remove();
        if (this._promotionCancelListener) {
            document.removeEventListener('pointerdown', this._promotionCancelListener);
            this._promotionCancelListener = null;
        }
    }

    _highlightLastMove() {
        const squares = this.container.querySelectorAll('.valisoa-square');
        squares.forEach(s => s.classList.remove('highlight'));
        
        if (this.state.lastMove) {
            const sq1 = this.container.querySelector(`[data-square="${this.state.lastMove.source}"]`);
            const sq2 = this.container.querySelector(`[data-square="${this.state.lastMove.target}"]`);
            if (sq1) sq1.classList.add('highlight');
            if (sq2) sq2.classList.add('highlight');
        }
    }

    _clearSelection() {
        this.state.selectedSquare = null;
        const squares = this.container.querySelectorAll('.valisoa-square');
        squares.forEach(s => s.classList.remove('selected'));
    }

    static fenToObj(fen) {
        if (!fen) return {};
        const fenPlacement = fen.split(' ')[0];
        const rows = fenPlacement.split('/');
        const position = {};
        
        const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
        const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];

        for (let r = 0; r < 8; r++) {
            let f = 0;
            for (let i = 0; i < rows[r].length; i++) {
                const char = rows[r][i];
                if (isNaN(char)) { 
                    const color = (char === char.toUpperCase()) ? 'w' : 'b';
                    const square = files[f] + ranks[r];
                    position[square] = color + char.toUpperCase();
                    f++;
                } else { 
                    f += parseInt(char, 10);
                }
            }
        }
        return position;
    }
}

if (typeof window !== 'undefined') {
    window.ValisoaChessboard = ValisoaChessboard;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ValisoaChessboard;
}
