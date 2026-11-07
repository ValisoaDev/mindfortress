#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MIND FORTRESS — Préparation Championnat de Madagascar 2027
Serveur local SQLite natif (zéro dépendance externe requise : utilise sqlite3 + http.server)
Base de données : mind_fortress.db
"""

import os
import sys
import json
import shutil
import sqlite3
import datetime
import webbrowser
from urllib.parse import urlparse, parse_qs
from http.server import HTTPServer, SimpleHTTPRequestHandler

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "mind_fortress.db")
BACKUP_DIR = os.path.join(BASE_DIR, "backups")
PORT = 5000

INITIAL_PUZZLES = [
    # --- 35 Puzzles de Mind-Fortress-Finale2 ---
    {"id": 1, "code": "MF-01", "fen": "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 0 1", "theme": "mateIn2", "type": "tactique", "diff": 2, "title": "La dame s’invite", "solution": "Dh5+ puis Dxf7# : mat sur la diagonale.", "hint": "Regarde la case f7 uniquement défendue par le roi.", "side": "Blancs"},
    {"id": 2, "code": "MF-02", "fen": "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 0 1", "theme": "mateIn2", "type": "tactique", "diff": 3, "title": "Pression sur f7", "solution": "Dxf7# force la décision immédiate sur f7.", "hint": "La batterie Fou c4 + Dame h5 converge sur f7.", "side": "Blancs"},
    {"id": 3, "code": "MF-03", "fen": "6k1/5ppp/8/8/8/8/8/4K2R w - - 0 1", "theme": "mateIn2", "type": "tactique", "diff": 1, "title": "La tour en embuscade", "solution": "Th8# : mat du couloir, le roi n’a plus d’air.", "hint": "La 8e traverse est entièrement libre.", "side": "Blancs"},
    {"id": 4, "code": "MF-04", "fen": "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 0 1", "theme": "fork", "type": "tactique", "diff": 2, "title": "Fourchette italienne", "solution": "Cg5 menace Cxf7 (fourchette Dame d8 et Tour h8).", "hint": "Quel saut de cavalier joint son attaque au fou c4 ?", "side": "Blancs"},
    {"id": 5, "code": "MF-05", "fen": "r2qkb1r/ppp2ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 0 1", "theme": "fork", "type": "tactique", "diff": 3, "title": "Le cavalier central", "solution": "Cg5 met la pression sur f7 et prépare la fourchette.", "hint": "Cible la case f7 avec deux pièces.", "side": "Blancs"},
    {"id": 6, "code": "MF-06", "fen": "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 1", "theme": "pin", "type": "tactique", "diff": 2, "title": "Le clouage naît", "solution": "Fb5 cloue le cavalier c6 sur la diagonale du roi e8.", "hint": "Développe le fou sur la diagonale a4-e8.", "side": "Blancs"},
    {"id": 7, "code": "MF-07", "fen": "r1bqkb1r/pppp1ppp/2n2n2/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 1", "theme": "pin", "type": "tactique", "diff": 3, "title": "Fou contre cavalier", "solution": "Fb5 cloue le défenseur du pion e5, puis la pression monte.", "hint": "Immobilise le cavalier c6 qui défend e5.", "side": "Blancs"},
    {"id": 8, "code": "MF-08", "fen": "8/5k2/8/8/8/4P3/5K2/8 w - - 0 1", "theme": "advancedPawn", "type": "calcul", "diff": 1, "title": "Le pion avance", "solution": "Rf3 suivi de Rf4-e5 : pousser, soutenir, promouvoir.", "hint": "Le roi doit précéder son pion en finale.", "side": "Blancs"},
    {"id": 9, "code": "MF-09", "fen": "8/2P5/8/8/8/5K2/8/4k3 w - - 0 1", "theme": "advancedPawn", "type": "tactique", "diff": 2, "title": "À un pas de la dame", "solution": "c8=D+ : promotion immédiate avec gain décisif.", "hint": "Le roi noir est trop loin pour empêcher la promotion.", "side": "Blancs"},
    {"id": 10, "code": "MF-10", "fen": "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 1", "theme": "defensiveMove", "type": "tactique", "diff": 2, "title": "Ne pas se faire surprendre", "solution": "Fc4 ou d3 : un coup prophylactique solide sécurise le centre et le roi.", "hint": "Prépare le petit roque rapidement.", "side": "Blancs"},
    {"id": 11, "code": "MF-11", "fen": "r2q1rk1/ppp1ppbp/2n2np1/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQ - 0 1", "theme": "defensiveMove", "type": "calcul", "diff": 4, "title": "La case à surveiller", "solution": "O-O suivi de c3/Te1 : le roque sécurise le roi et coupe les menaces centrales.", "hint": "Mets le roi à l'abri avant d'ouvrir le centre.", "side": "Blancs"},
    {"id": 12, "code": "MF-12", "fen": "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1", "theme": "veryLong", "type": "calcul", "diff": 4, "title": "Le plan long", "solution": "d3 puis c3 et Nbd2-f1-g3 : améliorer toutes les pièces avant de frapper.", "hint": "Plan typique du Giuoco Piano / Espagnole : manœuvre du cavalier b1.", "side": "Blancs"},
    {"id": 13, "code": "MF-13", "fen": "r2qkb1r/ppp1pppp/2n2n2/3p4/3P1B2/5N2/PPP1PPPP/RNBQK2R w KQkq - 0 1", "theme": "veryLong", "type": "calcul", "diff": 5, "title": "Finale technique", "solution": "e3, c3, Fd3 : patience, chaque échange doit servir le contrôle des cases noires.", "hint": "Construis la pyramide de pions d4-e3-c3.", "side": "Blancs"},
    {"id": 14, "code": "MF-14", "fen": "6k1/5ppp/8/8/8/8/5PPP/6K1 w - - 0 1", "theme": "mateIn3", "type": "calcul", "diff": 3, "title": "Mat en trois temps", "solution": "Activation du roi et création d'un réseau de mat au bord.", "hint": "Visualise comment enfermer le roi sur la 8e rangée.", "side": "Blancs"},
    {"id": 15, "code": "MF-15", "fen": "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1", "theme": "mateIn3", "type": "calcul", "diff": 4, "title": "L’attaque du roi", "solution": "Fc4 suivi de Dh5 : ouvrir la diagonale a2-g8 puis viser f7/h7.", "hint": "Combine fou et dame contre l'aile-roi.", "side": "Blancs"},
    {"id": 16, "code": "MF-16", "fen": "rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 1", "theme": "fork", "type": "tactique", "diff": 1, "title": "Première fourchette", "solution": "d4 cxd4 Cxd4 : le cavalier centralisé rayonne et menace des fourchettes.", "hint": "Ouvre le centre dans la Sicilienne.", "side": "Blancs"},
    {"id": 17, "code": "MF-17", "fen": "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1", "theme": "pin", "type": "tactique", "diff": 2, "title": "Diagonale fatale", "solution": "d3 suivi de Fg5 : le fou cloue le cavalier f6 qui protège d5 et la dame.", "hint": "Une fois d3 joué, quel clouage gêne le plus les Noirs ?", "side": "Blancs"},
    {"id": 18, "code": "MF-18", "fen": "8/pp3k2/8/8/8/8/PP3PPP/6K1 w - - 0 1", "theme": "advancedPawn", "type": "calcul", "diff": 2, "title": "Pions liés", "solution": "f4, Rf2, g4, Rf3 : avancer la majorité à l'aile-roi en gardant la structure soudée.", "hint": "Mobilise la majorité de 3 pions contre 0 à l'aile-roi.", "side": "Blancs"},
    {"id": 19, "code": "MF-19", "fen": "r1bqkb1r/pppp1ppp/2n2n2/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1", "theme": "defensiveMove", "type": "tactique", "diff": 3, "title": "Protège ton centre", "solution": "Cc3 défend e4 solidement : un coup de développement solide vaut mieux qu’une menace prématurée.", "hint": "Le pion e4 est attaqué par Cf6.", "side": "Blancs"},
    {"id": 20, "code": "MF-20", "fen": "r2qk2r/ppp1ppbp/2n2np1/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 0 1", "theme": "veryLong", "type": "calcul", "diff": 4, "title": "Manœuvre silencieuse", "solution": "Nbd2-f1-g3 : replacer la pièce la plus passive vers l'aile-roi.", "hint": "Quelle pièce blanche sur la 1re rangée n'est pas encore développée ?", "side": "Blancs"},
    {"id": 21, "code": "MF-21", "fen": "5rk1/5ppp/8/8/8/8/5PPP/6K1 w - - 0 1", "theme": "mateIn2", "type": "tactique", "diff": 2, "title": "Au bord de l’échiquier", "solution": "Attention au mat du couloir : h3 ou g3 donne une case d'air vitale au roi.", "hint": "Regarde la menace noire Tf1#.", "side": "Blancs"},
    {"id": 22, "code": "MF-22", "fen": "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 0 1", "theme": "mateIn3", "type": "tactique", "diff": 3, "title": "La dame en chasse", "solution": "Dxf7# : échec et mat direct sur la case faible f7.", "hint": "La dame est soutenue par le fou c4.", "side": "Blancs"},
    {"id": 23, "code": "MF-23", "fen": "rnbqkb1r/pp1ppppp/5n2/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 1", "theme": "fork", "type": "tactique", "diff": 2, "title": "Le cavalier de f3", "solution": "e5 attaque le cavalier f6 et gagne de l'espace central (ou Cc3 solide).", "hint": "Chasse le cavalier noir de sa case naturelle.", "side": "Blancs"},
    {"id": 24, "code": "MF-24", "fen": "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 1", "theme": "pin", "type": "tactique", "diff": 3, "title": "Le clouage invisible", "solution": "Fb5 cloue le cavalier c6 et prépare la pression sur e5.", "hint": "La diagonale a4-e8 est ouverte.", "side": "Blancs"},
    {"id": 25, "code": "MF-25", "fen": "8/4P3/8/8/8/5K2/8/4k3 w - - 0 1", "theme": "advancedPawn", "type": "calcul", "diff": 3, "title": "Promotion ou rien", "solution": "e8=D+ suivi de De2+ : calculer la course des rois avant de pousser.", "hint": "Promouvoir avec échec !", "side": "Blancs"},
    {"id": 26, "code": "MF-26", "fen": "r1bqkb1r/pppp1ppp/2n2n2/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1", "theme": "defensiveMove", "type": "tactique", "diff": 2, "title": "La case faible", "solution": "Cc3 défend le pion e4 avant que Cxe4 n'arrive.", "hint": "Protège le pion central e4.", "side": "Blancs"},
    {"id": 27, "code": "MF-27", "fen": "r2qkb1r/ppp1pppp/2n2n2/3p4/3P4/5N2/PPP1PPPP/RNBQKB1R w KQkq - 0 1", "theme": "veryLong", "type": "calcul", "diff": 5, "title": "Le marathon", "solution": "c4 (Gambit Dame) ou Ff4 : un plan en trois phases (développement, contrôle de e5, pression c-file).", "hint": "Attaque la base de la chaîne ou développe le fou hors de la chaîne.", "side": "Blancs"},
    {"id": 28, "code": "MF-28", "fen": "6k1/5ppp/8/8/8/8/8/6K1 w - - 0 1", "theme": "mateIn2", "type": "tactique", "diff": 1, "title": "Le roi au coin", "solution": "Visualiser le réseau de mat du couloir sur g8.", "hint": "Les pions f7, g7, h7 forment un mur devant leur propre roi.", "side": "Blancs"},
    {"id": 29, "code": "MF-29", "fen": "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1", "theme": "mateIn3", "type": "calcul", "diff": 4, "title": "Le filet se resserre", "solution": "Fc4 suivi de Df3/Dh5 : chaque menace rapproche le roi adverse de la faute.", "hint": "Braque les pièces sur f7.", "side": "Blancs"},
    {"id": 30, "code": "MF-30", "fen": "r1bqkb1r/pppp1ppp/2n2n2/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 1", "theme": "fork", "type": "tactique", "diff": 3, "title": "Double attaque", "solution": "Cc3 suivi de Fc4/Cg5 : attaquer deux cibles, l’adversaire n’en sauve qu’une.", "hint": "Développe les cavaliers vers le centre.", "side": "Blancs"},
    {"id": 31, "code": "MF-31", "fen": "r2qkb1r/ppp1pppp/2n2n2/3p4/3P1B2/5N2/PPP1PPPP/RNBQK2R w KQkq - 0 1", "theme": "pin", "type": "calcul", "diff": 4, "title": "Clouage absolu", "solution": "e3 suivi de Fb5 : la pièce clouée en c6 ne peut plus bouger sans perdre le roi.", "hint": "Prépare le clouage du cavalier c6.", "side": "Blancs"},
    {"id": 32, "code": "MF-32", "fen": "8/ppP5/8/8/8/8/8/4K2k w - - 0 1", "theme": "advancedPawn", "type": "tactique", "diff": 2, "title": "Le pion passé", "solution": "c8=D : le pion c7 se transforme en Dame et contrôle la diagonale h3-c8.", "hint": "Promouvoir immédiatement en c8.", "side": "Blancs"},
    {"id": 33, "code": "MF-33", "fen": "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 0 1", "theme": "defensiveMove", "type": "calcul", "diff": 4, "title": "Tension maximale", "solution": "c3 suivi de O-O : garder le calme et préparer d4 quand tout est tendu.", "hint": "Contrôle la case d4 avec c3.", "side": "Blancs"},
    {"id": 34, "code": "MF-34", "fen": "r2qk2r/ppp1ppbp/2n2np1/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 0 1", "theme": "veryLong", "type": "calcul", "diff": 5, "title": "La finale des rois", "solution": "O-O, c3, Te1, Nbd2-f1 : plan profond de manœuvre positionnelle.", "hint": "Consolide le centre avant l'expansion.", "side": "Blancs"},
    {"id": 35, "code": "MF-35", "fen": "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 0 1", "theme": "mateIn2", "type": "tactique", "diff": 5, "title": "Le coup de championnat", "solution": "Dxf7# : frappe chirurgicale sur f7.", "hint": "Vérifie les échecs qui sont aussi mat.", "side": "Blancs"},

    # --- 32 Puzzles Tactiques, Calcul Profond & Vision Aveugle (Beton-Arme-Cerveau-Lab & SQLite Complet) ---
    {"id": 36, "code": "P01", "fen": "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 4 5", "theme": "fork", "type": "tactique", "diff": 1, "title": "Saut sur d5 & fourchette", "solution": "1. Bg5 h6 2. Bxf6 Qxf6 3. Nd5 Qd8 4. c3", "hint": "Élimine le défenseur de la case d5 avant d'y sauter avec le cavalier.", "side": "Blancs"},
    {"id": 37, "code": "P02", "fen": "r2qkb1r/ppp2ppp/2n1bn2/3pp3/4P3/1NN5/PPPP1PPP/R1BQKB1R w KQkq - 2 6", "theme": "fork", "type": "tactique", "diff": 2, "title": "Pression centrale & fourchette", "solution": "1. exd5 Nxd5 2. Qf3 Ndb4 3. Bb5+", "hint": "Ouvre la colonne e et vise c6/f7.", "side": "Blancs"},
    {"id": 38, "code": "P03", "fen": "r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 7", "theme": "fork", "type": "tactique", "diff": 2, "title": "Clouage Bg5 vers Nd5", "solution": "1. Bg5 Be6 2. Nd5 Bxd5 3. Bxd5", "hint": "Crée un clouage inconfortable sur f6.", "side": "Blancs"},
    {"id": 39, "code": "P04", "fen": "2rq1rk1/pp2ppbp/2np1np1/8/3NP3/2N1BP2/PPPQ2PP/2KR1B1R w - - 3 10", "theme": "fork", "type": "calcul", "diff": 3, "title": "Dragon Sicilien — Saut Nd5", "solution": "1. Nxc6 bxc6 2. e5 Nd5 3. Nxd5 cxd5", "hint": "Échange en c6 puis pousse e5 pour ouvrir la diagonale.", "side": "Blancs"},
    {"id": 40, "code": "P05", "fen": "r1b2rk1/pp1p1ppp/1qn1pn2/2b5/2B1P3/2NP1N2/PPPB1PPP/R2Q1RK1 w - - 5 8", "theme": "fork", "type": "tactique", "diff": 3, "title": "Trappe Na4 sur la Dame et le Fou", "solution": "1. Na4 Bxf2+ 2. Rxf2 Qc7 3. Nc3", "hint": "Le cavalier c3 peut attaquer simultanément la dame b6 et le fou c5.", "side": "Blancs"},
    {"id": 41, "code": "P06", "fen": "r2q1rk1/1b1nbppp/p2p1n2/1pp1p3/4P3/1B1P1N1P/PPP2PP1/RNBQR1K1 w - - 0 10", "theme": "pin", "type": "tactique", "diff": 2, "title": "Manœuvre Espagnole Nbd2-f1", "solution": "1. Nbd2 Rc8 2. Nf1 c4 3. Ng3", "hint": "Achemine le cavalier b1 vers l'aile-roi via d2-f1.", "side": "Blancs"},
    {"id": 42, "code": "P07", "fen": "rn1qkbnr/ppp2ppp/8/3pp3/4P1b1/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 4", "theme": "pin", "type": "tactique", "diff": 1, "title": "Briser le clouage g4", "solution": "1. h3 Bxf3 2. Qxf3 dxe4 3. Qxe4", "hint": "Pose immédiatement la question au fou g4.", "side": "Blancs"},
    {"id": 43, "code": "P08", "fen": "r1bqk2r/ppp2ppp/2np1n2/4p1B1/1bB1P3/2NP1N2/PPP2PPP/R2QK2R w KQkq - 2 6", "theme": "pin", "type": "calcul", "diff": 3, "title": "Clouage croisé O-O & Nd5", "solution": "1. O-O Bxc3 2. bxc3 h6 3. Bh4", "hint": "Mets le roi à l'abri tout en maintenant le clouage en g5.", "side": "Blancs"},
    {"id": 44, "code": "P09", "fen": "r2qk2r/ppp1bppp/2n1bn2/3pp1B1/8/2NP1NP1/PPP1PPBP/R2Q1RK1 w kq - 3 7", "theme": "pin", "type": "tactique", "diff": 2, "title": "Pression sur le centre d5", "solution": "1. Bxf6 Bxf6 2. e4 d4 3. Ne2", "hint": "Élimine le cavalier f6 pour frapper le centre avec e4.", "side": "Blancs"},
    {"id": 45, "code": "P10", "fen": "2kr3r/ppp1qppp/2np1n2/2b1p1B1/2B1P3/2NP1N1P/PPP2PP1/R2Q1RK1 w - - 1 9", "theme": "pin", "type": "calcul", "diff": 4, "title": "Invasion en d5 sous clouage", "solution": "1. Nd5 Nxd5 2. Bxd5 f6 3. Be3", "hint": "Le cavalier f6 est cloué sur la dame e7 : saute en d5 !", "side": "Blancs"},
    {"id": 46, "code": "P11", "fen": "6k1/5ppp/8/8/8/5Q2/5PPP/6K1 w - - 0 1", "theme": "mateIn2", "type": "tactique", "diff": 1, "title": "Mat du couloir pur", "solution": "1. Qa8+ Qf8 2. Qxf8#", "hint": "La 8e rangée est fatale.", "side": "Blancs"},
    {"id": 47, "code": "P12", "fen": "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4", "theme": "mateIn2", "type": "tactique", "diff": 1, "title": "Mat de Legal / Écolier", "solution": "1. Qxf7#", "hint": "Regarde f7.", "side": "Blancs"},
    {"id": 48, "code": "P13", "fen": "5rk1/pp3ppp/8/8/1b6/2N5/PPP2QoP/2KR4 w - - 0 1", "theme": "mateIn2", "type": "tactique", "diff": 2, "title": "Sacrifice de déviation sur f8", "solution": "1. Qxf8+ Bxf8 2. Rd8#", "hint": "Défie la tour f8 pour libérer d8.", "side": "Blancs"},
    {"id": 49, "code": "P14", "fen": "r4rk1/ppp2ppp/8/8/8/2B5/PPP2QPP/5RK1 w - - 0 1", "theme": "mateIn2", "type": "tactique", "diff": 2, "title": "Batterie Dame + Fou sur g7", "solution": "1. Qf6 gxf6 2. Bxf6#", "hint": "Utilise le fou c3 et la dame sur la grande diagonale.", "side": "Blancs"},
    {"id": 50, "code": "P15", "fen": "3r2k1/p4ppp/8/8/8/1B6/P4PPP/3R2K1 w - - 0 1", "theme": "mateIn2", "type": "tactique", "diff": 2, "title": "Clouage de f7 et mat du couloir", "solution": "1. Rxd8#", "hint": "Le fou b3 cloue le pion f7, mais d8 est déjà fatal !", "side": "Blancs"},
    {"id": 51, "code": "P16", "fen": "2kr4/ppp2ppp/8/8/8/5N2/PPP2PPP/2KR3R w - - 0 1", "theme": "mateIn3", "type": "calcul", "diff": 3, "title": "Doublage des tours sur colonne d", "solution": "1. Rxd8+ Kxd8 2. Rd1+ Ke8 3. Rd8#", "hint": "Échange la tour d8 et prends possession de la colonne ouverte.", "side": "Blancs"},
    {"id": 52, "code": "P17", "fen": "6k1/5p1p/6p1/8/8/2B5/5PPP/4R1K1 w - - 0 1", "theme": "mateIn3", "type": "calcul", "diff": 3, "title": "Les cases noires affaiblies", "solution": "1. Re8+ Qf8 2. Rxf8+ Kxf8 3. Bf6", "hint": "Combine la tour e1 et le fou c3 sur la 8e traverse.", "side": "Blancs"},
    {"id": 53, "code": "P18", "fen": "r1b2rk1/ppp2ppp/2n5/3q4/3P4/2PB4/P4PPP/R1BQ1RK1 w - - 0 11", "theme": "mateIn3", "type": "calcul", "diff": 4, "title": "Sacrifice Grec Bxh7+", "solution": "1. Bxh7+ Kxh7 2. Qh5+ Kg8 3. Qxd5", "hint": "Sacrifice de fou sur h7 suivi d'un double échec/attaque sur d5 !", "side": "Blancs"},
    {"id": 54, "code": "P19", "fen": "1k1r4/pp3ppp/8/8/8/6P1/PP2PP1P/1K1R3R w - - 0 1", "theme": "mateIn3", "type": "calcul", "diff": 3, "title": "Infiltration sur la 8e", "solution": "1. Rxd8+ Kc7 2. Rhd1", "hint": "Capture la tour d8 avec échec.", "side": "Blancs"},
    {"id": 55, "code": "P20", "fen": "r4rk1/ppp2p1p/6p1/8/3n4/2B5/PPP2PPP/R2Q1RK1 w - - 0 12", "theme": "mateIn3", "type": "calcul", "diff": 4, "title": "Exploiter la grande diagonale a1-h8", "solution": "1. Qxd4 f6 2. Qc4+ Kg7 3. Qxc7+", "hint": "Capture le cavalier d4 en créant une menace de mat en g7/h8.", "side": "Blancs"},
    {"id": 56, "code": "P21", "fen": "8/2P5/8/8/8/8/5k2/7K w - - 0 1", "theme": "advancedPawn", "type": "tactique", "diff": 1, "title": "Promotion directe c8=D", "solution": "1. c8=Q", "hint": "Pousse le pion.", "side": "Blancs"},
    {"id": 57, "code": "P22", "fen": "8/1P6/8/2k5/8/2K5/8/8 w - - 0 1", "theme": "advancedPawn", "type": "calcul", "diff": 2, "title": "Soutien de promotion", "solution": "1. b8=Q", "hint": "Le roi noir en c5 ne contrôle pas b8.", "side": "Blancs"},
    {"id": 58, "code": "P23", "fen": "8/5P2/8/4k3/8/4K3/8/8 w - - 0 1", "theme": "advancedPawn", "type": "calcul", "diff": 3, "title": "Promotion tactique f8=D", "solution": "1. f8=Q", "hint": "La case f8 est libre.", "side": "Blancs"},
    {"id": 59, "code": "P24", "fen": "8/3P1k2/8/3K4/8/8/8/8 w - - 0 1", "theme": "advancedPawn", "type": "calcul", "diff": 3, "title": "Course à la dame d8=D", "solution": "1. d8=Q", "hint": "Le pion d7 est soutenu par le roi d5.", "side": "Blancs"},
    {"id": 60, "code": "P25", "fen": "r1bq1rk1/ppp2ppp/2np4/2b1p3/2B1P1n1/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 3 7", "theme": "defensiveMove", "type": "tactique", "diff": 2, "title": "Défense de f2 & chasse du cavalier", "solution": "1. h3 Nf6 2. Be3", "hint": "Chasse le cavalier g4 après avoir protégé f2 avec la tour f1.", "side": "Blancs"},
    {"id": 61, "code": "P26", "fen": "r2q1rk1/ppp1bppp/2np1n2/4p1B1/2B1P1b1/2NP1N2/PPP2PPP/R2Q1RK1 w - - 5 7", "theme": "defensiveMove", "type": "tactique", "diff": 3, "title": "Prophylaxie h3 contre Bg4", "solution": "1. h3 Bxf3 2. Qxf3 Nd4 3. Qd1", "hint": "Force le fou g4 à se déclarer et garde la case d1 pour la dame.", "side": "Blancs"},
    {"id": 62, "code": "P27", "fen": "r1bq1rk1/ppp1ppbp/2np1np1/8/2PPP3/2N2N2/PP2BPPP/R1BQK2R w KQ - 1 6", "theme": "defensiveMove", "type": "tactique", "diff": 2, "title": "Roque dans l'Est-Indienne", "solution": "1. O-O Bg4 2. Be3", "hint": "Roque puis consolide d4 avec Be3.", "side": "Blancs"},
    {"id": 63, "code": "P28", "fen": "r2q1rk1/1pp1ppbp/p1np1np1/8/2PPP1b1/2N1BN2/PP2BPPP/R2Q1RK1 w - - 2 8", "theme": "defensiveMove", "type": "calcul", "diff": 4, "title": "Neutraliser l'activité noire en f3", "solution": "1. Be3 Bxf3 2. Bxf3 e5 3. d5", "hint": "Reprends du fou en f3 et ferme le centre avec d5.", "side": "Blancs"},
    {"id": 64, "code": "P29", "fen": "r1bq1rk1/pp1n1ppp/2pbpn2/3p4/2PP4/2NBPN2/PP3PPP/R1BQ1RK1 w - - 2 7", "theme": "veryLong", "type": "blind", "diff": 4, "title": "Vision Aveugle — Percée e4 Semi-Slave", "solution": "1. b3 dxc4 2. bxc4 e5 3. Qc2 Re8 4. Bb2", "hint": "Visualise 4 coups sans bouger les pièces : b3, dxc4, bxc4, e5.", "side": "Blancs"},
    {"id": 65, "code": "P30", "fen": "r2q1rk1/pp1nbppp/2p1pn2/3p2B1/2PP4/2NBPN2/PPQ2PPP/2KR3R w - - 4 8", "theme": "veryLong", "type": "blind", "diff": 5, "title": "Vision Aveugle — Marée de pions h4-g4", "solution": "1. h4 h6 2. Bf4 dxc4 3. Bxc4 Nd5 4. g4", "hint": "Calcule à l'aveugle la retraite Bf4 et la poussée g4.", "side": "Blancs"},
    {"id": 66, "code": "P31", "fen": "2rq1rk1/pb1nbppp/1p2pn2/2pp4/2PP4/1PN1PN2/PB1NBPPP/2RQ1RK1 w - - 0 10", "theme": "veryLong", "type": "blind", "diff": 4, "title": "Vision Aveugle — Liquidation centrale", "solution": "1. cxd5 exd5 2. dxc5 bxc5 3. Qc2", "hint": "Visualise la structure des pions pendants après cxd5 et dxc5.", "side": "Blancs"},
    {"id": 67, "code": "P32", "fen": "r1b1qrk1/pp1n1pbp/2pp1np1/4p3/2PPP3/2N1BP2/PP1QB1PP/R4RK1 w - - 1 10", "theme": "veryLong", "type": "blind", "diff": 5, "title": "Vision Aveugle — Attaque Samisch d5", "solution": "1. d5 cxd5 2. cxd5 a6 3. Rac1 Nh5 4. g3", "hint": "Ferme le centre avec d5 et contrôle la colonne c.", "side": "Blancs"}
]


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    os.makedirs(BACKUP_DIR, exist_ok=True)
    conn = get_conn()
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS puzzles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT,
            title TEXT,
            fen TEXT,
            theme TEXT,
            type TEXT DEFAULT 'tactique',
            diff INTEGER DEFAULT 2,
            side TEXT DEFAULT 'Blancs',
            solution TEXT,
            hint TEXT DEFAULT '',
            custom INTEGER DEFAULT 0,
            solved INTEGER DEFAULT 0,
            attempts INTEGER DEFAULT 0,
            best_time_sec INTEGER DEFAULT 0,
            box INTEGER DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            at_label TEXT,
            created_at TEXT,
            type TEXT,
            puzzle_id INTEGER,
            text TEXT,
            theme TEXT,
            diff INTEGER DEFAULT 2,
            time_sec INTEGER DEFAULT 0,
            success INTEGER DEFAULT 1,
            xp INTEGER DEFAULT 0,
            emotion TEXT DEFAULT 'calme',
            intensity INTEGER DEFAULT 3,
            notes TEXT DEFAULT ''
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS contextual_journal (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            log_id INTEGER,
            linked_text TEXT,
            created_at TEXT,
            at_label TEXT,
            note TEXT,
            before_emotion TEXT,
            after_emotion TEXT,
            before_intensity INTEGER DEFAULT 3,
            after_intensity INTEGER DEFAULT 2,
            lieu TEXT DEFAULT 'Maison',
            bruit TEXT DEFAULT 'Calme',
            sommeil TEXT DEFAULT 'Bon',
            fatigue INTEGER DEFAULT 2,
            pression TEXT DEFAULT 'Entraînement',
            tag TEXT DEFAULT ''
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS completed_days (
            day_key TEXT PRIMARY KEY,
            status TEXT DEFAULT 'done',
            sessions_count INTEGER DEFAULT 1,
            notes TEXT DEFAULT ''
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS blindage_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT,
            wish TEXT,
            outcome TEXT,
            obstacle TEXT,
            plan TEXT,
            col1 TEXT,
            col2 TEXT,
            col3 TEXT,
            mode TEXT DEFAULT 'daily',
            breathing_cycles INTEGER DEFAULT 0
        )
    """)

    # Populate initial puzzles if empty
    cur.execute("SELECT COUNT(*) as c FROM puzzles")
    if cur.fetchone()["c"] == 0:
        for p in INITIAL_PUZZLES:
            solved = 1 if p["id"] in (1, 3, 4, 8, 16) else 0
            box = 2 if solved else 1
            cur.execute("""
                INSERT INTO puzzles (id, code, title, fen, theme, type, diff, side, solution, hint, custom, solved, attempts, box)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
            """, (
                p["id"], p["code"], p["title"], p["fen"], p["theme"],
                p["type"], p["diff"], p["side"], p["solution"], p.get("hint", ""),
                solved, 1 if solved else 0, box
            ))

    # Populate default settings if empty
    default_settings = {
        "level": "inter",
        "xp": "420",
        "streak": "6",
        "total_min": "310",
        "attempts": "19",
        "solved_count": "14",
        "lichess_username": "champion_2027",
        "count_lichess_in_tracker": "true",
        "endurance_notes": "1. Candidats : Cf5, Te1, h4.\n2. Vérifier la réponse adverse avant de bouger.\n3. Respirer si le calcul se brouille.",
        "distraction_returns": "0",
        "woop_json": json.dumps({
            "wish": "Tenir 45 minutes de calcul lucide au championnat.",
            "outcome": "Finir les parties longues avec une tête froide.",
            "obstacle": "Vouloir jouer vite dès que la position devient tendue.",
            "plan": "Si je sens la précipitation, je pose les mains et je fais 3 cycles 4–6."
        }, ensure_ascii=False),
        "journal_3col_json": json.dumps({
            "win": "J’ai vérifié toutes les réponses adverses sur 3 puzzles.",
            "lesson": "Les coups de recul du cavalier m’échappent encore.",
            "tomorrow": "10 fourchettes + 1 finale de pions sans bouger les pièces.",
            "pos": "Tour en c8, 2 min à la pendule, pion d5 isolé",
            "emo": "Peur du contre-jeu, tension 6/10",
            "move": "Tc1! consolide d'abord + éval +0.8"
        }, ensure_ascii=False),
        "baseline_scores_json": json.dumps({
            "memoire": 5,
            "focus": 5,
            "emotion": 4,
            "clarte": 5
        }, ensure_ascii=False),
        "weekly_grid_json": json.dumps({}, ensure_ascii=False),
        "repertoire_json": json.dumps([
            {"id": 1, "side": "Blancs", "name": "Italienne / Giuoco Piano", "moves": "1.e4 e5 2.Cf3 Cc6 3.Fc4 Fc5 4.c3 Cf6 5.d3", "plan": "Construire le centre c3-d3, manœuvre Cbd2-f1-g3, viser f7/d4.", "mastery": 75},
            {"id": 2, "side": "Noirs", "name": "Défense Sicilienne / Najdorf-Scheveningen", "moves": "1.e4 c5 2.Cf3 d6 3.d4 cxd4 4.Cxd4 Cf6 5.Cc3 a6", "plan": "Contrôler e5/d5, pression sur la colonne semi-ouverte c et contre-jeu aile-dame.", "mastery": 65},
            {"id": 3, "side": "Noirs", "name": "Gambit Dame Refusé / Semi-Slave", "moves": "1.d4 d5 2.c4 e6 3.Cc3 Cf6 4.Cf3 c6", "plan": "Solidité centrale d5, préparer la libération ...dxc4 puis ...e5 ou ...c5.", "mastery": 70}
        ], ensure_ascii=False)
    }
    for k, v in default_settings.items():
        cur.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (k, v))

    # Populate initial logs if empty
    cur.execute("SELECT COUNT(*) as c FROM logs")
    if cur.fetchone()["c"] == 0:
        now = datetime.datetime.now()
        sample_logs = [
            (101, "Aujourd’hui · 07:40", now.isoformat(), "Force", 4, "Force — Fourchette italienne résolue", "fork", 2, 48, 1, 25, "focus", 3, "Bon scan des échecs et captures"),
            (102, "Hier · 18:15", (now - datetime.timedelta(days=1)).isoformat(), "Endurance", None, "Endurance — 30 min de calcul profond", "veryLong", 4, 1800, 1, 40, "calme", 2, "Tenue solide sur finale de tours"),
            (103, "Il y a 2 j", (now - datetime.timedelta(days=2)).isoformat(), "Blindage", None, "Blindage — 6 cycles respiration 4–6 + WOOP", "defensiveMove", 2, 360, 1, 20, "confiant", 4, "Routine pré-coup verrouillée")
        ]
        for row in sample_logs:
            cur.execute("""
                INSERT INTO logs (id, at_label, created_at, type, puzzle_id, text, theme, diff, time_sec, success, xp, emotion, intensity, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, row)

    # Populate initial contextual_journal if empty
    cur.execute("SELECT COUNT(*) as c FROM contextual_journal")
    if cur.fetchone()["c"] == 0:
        now = datetime.datetime.now()
        cur.execute("""
            INSERT INTO contextual_journal (
                id, log_id, linked_text, created_at, at_label, note,
                before_emotion, after_emotion, before_intensity, after_intensity,
                lieu, bruit, sommeil, fatigue, pression, tag
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            501, 101, "Force — Fourchette italienne résolue", now.isoformat(), "Aujourd’hui · 07:42",
            "J’allais jouer trop vite sur f7 ; j’ai posé les mains 4 secondes et j’ai vu la fourchette intermediaire.",
            "stress", "calme", 3, 2, "Maison", "Calme", "Bon", 2, "Entraînement", "routine pré-coup"
        ))

    # Populate initial completed_days if empty
    cur.execute("SELECT COUNT(*) as c FROM completed_days")
    if cur.fetchone()["c"] == 0:
        today = datetime.date.today()
        for offset in (0, 1, 2, 3, 4, 5, 7, 9, 10, 12, 14):
            d_str = (today - datetime.timedelta(days=offset)).isoformat()
            cur.execute("INSERT OR IGNORE INTO completed_days (day_key, status, sessions_count) VALUES (?, 'done', 1)", (d_str,))

    conn.commit()
    conn.close()


def create_daily_backup(manual=False):
    os.makedirs(BACKUP_DIR, exist_ok=True)
    if not os.path.exists(DB_PATH):
        return None
    if manual:
        stamp = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        dest = os.path.join(BACKUP_DIR, f"mind_fortress_manual_{stamp}.db")
        shutil.copy2(DB_PATH, dest)
        return os.path.basename(dest)
    else:
        today_str = datetime.date.today().isoformat()
        dest = os.path.join(BACKUP_DIR, f"mind_fortress_auto_{today_str}.db")
        if not os.path.exists(dest):
            shutil.copy2(DB_PATH, dest)
        return os.path.basename(dest)


def recalculate_streak(conn):
    cur = conn.cursor()
    cur.execute("SELECT day_key FROM completed_days ORDER BY day_key DESC")
    days = {r["day_key"] for r in cur.fetchall()}
    cur.execute("SELECT substr(created_at, 1, 10) as d FROM logs WHERE created_at IS NOT NULL")
    for r in cur.fetchall():
        if r["d"]:
            days.add(r["d"])

    today = datetime.date.today()
    streak = 0
    for i in range(365):
        check = (today - datetime.timedelta(days=i)).isoformat()
        if check in days:
            streak += 1
        elif i == 0:
            continue
        else:
            break
    cur.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('streak', ?)", (str(streak),))
    conn.commit()
    return streak


def get_full_state():
    conn = get_conn()
    cur = conn.cursor()

    cur.execute("SELECT key, value FROM settings")
    settings = {r["key"]: r["value"] for r in cur.fetchall()}

    cur.execute("SELECT * FROM puzzles ORDER BY id ASC")
    puzzles = [dict(r) for r in cur.fetchall()]

    cur.execute("SELECT * FROM logs ORDER BY id DESC LIMIT 200")
    logs = [dict(r) for r in cur.fetchall()]

    cur.execute("SELECT * FROM contextual_journal ORDER BY id DESC LIMIT 200")
    journal = [dict(r) for r in cur.fetchall()]

    cur.execute("SELECT day_key FROM completed_days ORDER BY day_key DESC")
    completed_days = [r["day_key"] for r in cur.fetchall()]

    cur.execute("SELECT * FROM blindage_entries ORDER BY id DESC LIMIT 50")
    blindage_history = [dict(r) for r in cur.fetchall()]

    backups = []
    if os.path.exists(BACKUP_DIR):
        backups = sorted(
            [f for f in os.listdir(BACKUP_DIR) if f.endswith(".db")],
            reverse=True
        )[:15]

    conn.close()
    return {
        "mode": "sqlite_native",
        "dbPath": DB_PATH,
        "settings": settings,
        "puzzles": puzzles,
        "logs": logs,
        "contextualJournal": journal,
        "completedDays": completed_days,
        "blindageHistory": blindage_history,
        "backups": backups
    }


class MindFortressHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def log_message(self, format, *args):
        # Quiet clean logging
        pass

    def _send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw)

    def do_OPTIONS(self):
        self._send_json({"ok": True})

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/" or path == "":
            self.path = "/index.html"
            return super().do_GET()

        if path == "/api/state":
            return self._send_json(get_full_state())

        if path == "/api/db/download":
            if os.path.exists(DB_PATH):
                with open(DB_PATH, "rb") as f:
                    data = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "application/x-sqlite3")
                self.send_header("Content-Disposition", 'attachment; filename="mind_fortress.db"')
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            return self._send_json({"error": "DB not found"}, 404)

        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        try:
            if path == "/api/settings":
                payload = self._read_json()
                conn = get_conn()
                cur = conn.cursor()
                for k, v in payload.items():
                    val_str = v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)
                    cur.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (k, val_str))
                conn.commit()
                conn.close()
                return self._send_json(get_full_state())

            if path == "/api/puzzles":
                p = self._read_json()
                conn = get_conn()
                cur = conn.cursor()
                code = p.get("code") or f"PERSO-{int(datetime.datetime.now().timestamp()) % 10000}"
                cur.execute("""
                    INSERT INTO puzzles (code, title, fen, theme, type, diff, side, solution, hint, custom, solved, attempts, box)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, 1)
                """, (
                    code,
                    p.get("title", "Puzzle perso"),
                    p.get("fen", ""),
                    p.get("theme", "fork"),
                    p.get("type", "tactique"),
                    int(p.get("diff", 3)),
                    p.get("side", "À toi de jouer"),
                    p.get("solution", "Solution à compléter après résolution."),
                    p.get("hint", "")
                ))
                conn.commit()
                conn.close()
                return self._send_json(get_full_state())

            if path == "/api/puzzles/solve":
                data = self._read_json()
                pid = int(data.get("id"))
                success = 1 if data.get("success", True) else 0
                time_sec = int(data.get("time_sec", 0))
                conn = get_conn()
                cur = conn.cursor()
                cur.execute("SELECT * FROM puzzles WHERE id = ?", (pid,))
                row = cur.fetchone()
                if row:
                    new_attempts = (row["attempts"] or 0) + 1
                    new_solved = 1 if (row["solved"] or success) else 0
                    current_box = row["box"] or 1
                    new_box = min(5, current_box + 1) if success else 1
                    best_t = row["best_time_sec"] or 0
                    if success and time_sec > 0 and (best_t == 0 or time_sec < best_t):
                        best_t = time_sec
                    cur.execute("""
                        UPDATE puzzles SET solved = ?, attempts = ?, box = ?, best_time_sec = ?
                        WHERE id = ?
                    """, (new_solved, new_attempts, new_box, best_t, pid))
                conn.commit()
                conn.close()
                return self._send_json(get_full_state())

            if path == "/api/logs":
                l = self._read_json()
                conn = get_conn()
                cur = conn.cursor()
                now = datetime.datetime.now()
                at_label = l.get("at_label") or now.strftime("%d/%m · %H:%M")
                created_at = l.get("created_at") or now.isoformat()
                xp_gain = int(l.get("xp", 0))
                add_min = int(l.get("add_min", 0))
                mark_today = l.get("mark_today", True)

                cur.execute("""
                    INSERT INTO logs (at_label, created_at, type, puzzle_id, text, theme, diff, time_sec, success, xp, emotion, intensity, notes)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    at_label, created_at,
                    l.get("type", "Force"),
                    l.get("puzzle_id"),
                    l.get("text", "Séance validée"),
                    l.get("theme", "fork"),
                    int(l.get("diff", 2)),
                    int(l.get("time_sec", 0)),
                    1 if l.get("success", True) else 0,
                    xp_gain,
                    l.get("emotion", "calme"),
                    int(l.get("intensity", 3)),
                    l.get("notes", "")
                ))

                # Update XP & total_min
                cur.execute("SELECT value FROM settings WHERE key = 'xp'")
                r_xp = cur.fetchone()
                cur_xp = int(r_xp["value"]) if r_xp else 0
                cur.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('xp', ?)", (str(cur_xp + xp_gain),))

                if add_min > 0:
                    cur.execute("SELECT value FROM settings WHERE key = 'total_min'")
                    r_min = cur.fetchone()
                    cur_min = int(r_min["value"]) if r_min else 0
                    cur.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('total_min', ?)", (str(cur_min + add_min),))

                if l.get("increment_attempts"):
                    cur.execute("SELECT value FROM settings WHERE key = 'attempts'")
                    r_att = cur.fetchone()
                    cur_att = int(r_att["value"]) if r_att else 0
                    cur.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('attempts', ?)", (str(cur_att + 1),))
                    if l.get("success", True):
                        cur.execute("SELECT value FROM settings WHERE key = 'solved_count'")
                        r_sol = cur.fetchone()
                        cur_sol = int(r_sol["value"]) if r_sol else 0
                        cur.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('solved_count', ?)", (str(cur_sol + 1),))

                if mark_today:
                    today_str = datetime.date.today().isoformat()
                    cur.execute("INSERT OR IGNORE INTO completed_days (day_key, status, sessions_count) VALUES (?, 'done', 1)", (today_str,))

                conn.commit()
                recalculate_streak(conn)
                conn.close()
                return self._send_json(get_full_state())

            if path == "/api/journal":
                j = self._read_json()
                conn = get_conn()
                cur = conn.cursor()
                now = datetime.datetime.now()
                cur.execute("""
                    INSERT INTO contextual_journal (
                        log_id, linked_text, created_at, at_label, note,
                        before_emotion, after_emotion, before_intensity, after_intensity,
                        lieu, bruit, sommeil, fatigue, pression, tag
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    j.get("logId"),
                    j.get("linkedText", "Séance libre — hors log"),
                    j.get("createdAt") or now.isoformat(),
                    j.get("atLabel") or now.strftime("%d/%m/%Y · %H:%M"),
                    j.get("note", ""),
                    j.get("beforeEmotion", "stress"),
                    j.get("afterEmotion", "calme"),
                    int(j.get("beforeIntensity", 3)),
                    int(j.get("afterIntensity", 2)),
                    j.get("lieu", "Maison"),
                    j.get("bruit", "Calme"),
                    j.get("sommeil", "Bon"),
                    int(j.get("fatigue", 2)),
                    j.get("pression", "Entraînement"),
                    j.get("tag", "")
                ))
                conn.commit()
                conn.close()
                return self._send_json(get_full_state())

            if path == "/api/days/toggle":
                d = self._read_json()
                day_key = d.get("day_key")
                conn = get_conn()
                cur = conn.cursor()
                cur.execute("SELECT day_key FROM completed_days WHERE day_key = ?", (day_key,))
                if cur.fetchone():
                    cur.execute("DELETE FROM completed_days WHERE day_key = ?", (day_key,))
                else:
                    cur.execute("INSERT INTO completed_days (day_key, status, sessions_count) VALUES (?, 'done', 1)", (day_key,))
                conn.commit()
                recalculate_streak(conn)
                conn.close()
                return self._send_json(get_full_state())

            if path == "/api/blindage":
                b = self._read_json()
                conn = get_conn()
                cur = conn.cursor()
                cur.execute("""
                    INSERT INTO blindage_entries (created_at, wish, outcome, obstacle, plan, col1, col2, col3, mode, breathing_cycles)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    datetime.datetime.now().isoformat(),
                    b.get("wish", ""), b.get("outcome", ""), b.get("obstacle", ""), b.get("plan", ""),
                    b.get("col1", ""), b.get("col2", ""), b.get("col3", ""),
                    b.get("mode", "daily"), int(b.get("breathing_cycles", 0))
                ))
                conn.commit()
                conn.close()
                return self._send_json(get_full_state())

            if path == "/api/backup":
                fname = create_daily_backup(manual=True)
                state = get_full_state()
                state["backupCreated"] = fname
                return self._send_json(state)

            if path == "/api/import-json":
                payload = self._read_json()
                conn = get_conn()
                cur = conn.cursor()
                if "level" in payload:
                    cur.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('level', ?)", (str(payload["level"]),))
                if "xp" in payload:
                    cur.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('xp', ?)", (str(payload["xp"]),))
                if "totalMin" in payload:
                    cur.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('total_min', ?)", (str(payload["totalMin"]),))
                if "lichessUsername" in payload:
                    cur.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('lichess_username', ?)", (str(payload["lichessUsername"]),))
                if "woop" in payload and isinstance(payload["woop"], dict):
                    cur.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('woop_json', ?)", (json.dumps(payload["woop"], ensure_ascii=False),))
                if "journal" in payload and isinstance(payload["journal"], dict):
                    cur.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('journal_3col_json', ?)", (json.dumps(payload["journal"], ensure_ascii=False),))
                if "completedDays" in payload and isinstance(payload["completedDays"], list):
                    for dk in payload["completedDays"]:
                        cur.execute("INSERT OR IGNORE INTO completed_days (day_key) VALUES (?)", (str(dk)[:10],))
                if "customPuzzles" in payload and isinstance(payload["customPuzzles"], list):
                    for cp in payload["customPuzzles"]:
                        cur.execute("""
                            INSERT INTO puzzles (code, title, fen, theme, type, diff, side, solution, custom, solved)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0)
                        """, (
                            cp.get("code", "IMPORT"),
                            cp.get("title", cp.get("description", "Puzzle importé")),
                            cp.get("fen", ""),
                            cp.get("theme", "fork"),
                            cp.get("type", "tactique"),
                            int(cp.get("diff", cp.get("difficulty", 3))),
                            cp.get("side", "Blancs"),
                            cp.get("solution", "")
                        ))
                if "journalContextuel" in payload and isinstance(payload["journalContextuel"], list):
                    for cj in payload["journalContextuel"]:
                        cur.execute("""
                            INSERT INTO contextual_journal (
                                log_id, linked_text, created_at, at_label, note,
                                before_emotion, after_emotion, before_intensity, after_intensity,
                                lieu, bruit, sommeil, fatigue, pression, tag
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """, (
                            cj.get("logId"), cj.get("linkedText", "Séance importée"),
                            cj.get("createdAt", datetime.datetime.now().isoformat()),
                            cj.get("atLabel", "Importé"), cj.get("note", ""),
                            cj.get("beforeEmotion", "stress"), cj.get("afterEmotion", "calme"),
                            int(cj.get("beforeIntensity", 3)), int(cj.get("afterIntensity", 2)),
                            cj.get("lieu", "Maison"), cj.get("bruit", "Calme"),
                            cj.get("sommeil", "Bon"), int(cj.get("fatigue", 2)),
                            cj.get("pression", "Entraînement"), cj.get("tag", "")
                        ))
                conn.commit()
                recalculate_streak(conn)
                conn.close()
                return self._send_json(get_full_state())

            if path == "/api/reset":
                create_daily_backup(manual=True)
                conn = get_conn()
                cur = conn.cursor()
                cur.execute("DELETE FROM logs")
                cur.execute("DELETE FROM contextual_journal")
                cur.execute("DELETE FROM completed_days")
                cur.execute("DELETE FROM blindage_entries")
                cur.execute("DELETE FROM puzzles WHERE custom = 1")
                cur.execute("UPDATE puzzles SET solved = 0, attempts = 0, box = 1, best_time_sec = 0")
                cur.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('xp', '0')")
                cur.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('streak', '0')")
                cur.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('total_min', '0')")
                cur.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('attempts', '0')")
                cur.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('solved_count', '0')")
                conn.commit()
                conn.close()
                return self._send_json(get_full_state())

        except Exception as e:
            return self._send_json({"error": str(e)}, 500)

        return self._send_json({"error": "Not found"}, 404)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        conn = get_conn()
        cur = conn.cursor()
        if path == "/api/journal" and "id" in qs:
            cur.execute("DELETE FROM contextual_journal WHERE id = ?", (int(qs["id"][0]),))
        elif path == "/api/logs" and "id" in qs:
            cur.execute("DELETE FROM logs WHERE id = ?", (int(qs["id"][0]),))
        elif path == "/api/puzzles" and "id" in qs:
            cur.execute("DELETE FROM puzzles WHERE id = ? AND custom = 1", (int(qs["id"][0]),))
        conn.commit()
        conn.close()
        return self._send_json(get_full_state())


if __name__ == "__main__":
    init_db()
    backup_file = create_daily_backup(manual=False)
    print("=" * 64)
    print("  MIND FORTRESS — Préparation Championnat de Madagascar 2027")
    print(f"  Base SQLite active : {DB_PATH}")
    if backup_file:
        print(f"  Sauvegarde auto    : backups/{backup_file}")
    print(f"  URL Application    : http://localhost:{PORT}")
    print("=" * 64)

    if "--init-only" in sys.argv:
        sys.exit(0)

    server = HTTPServer(("127.0.0.1", PORT), MindFortressHandler)
    if "--no-browser" not in sys.argv:
        webbrowser.open(f"http://localhost:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nArrêt du serveur MIND FORTRESS.")
        server.server_close()
