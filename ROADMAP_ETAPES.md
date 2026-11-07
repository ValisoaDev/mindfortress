# 🏰 MIND FORTRESS — Feuille de Route & Plan d'Exécution Pas-à-Pas
**Objectif :** Préparation au Championnat de Madagascar d'Échecs (Septembre 2027)  
**Architecture cible :** SQLite Natif / libSQL (100% compatible **Turso + Vercel**) + Bibliothèques **`ValisoaChess`** (`ValisoaChessLite`, `ValisoaChessboard`, `ValisoaChesspgnparser`) + Algorithme **FSRS** (Free Spaced Repetition Scheduler).

> **Règle d'or d'exécution :**  
> Aucune étape suivante ne démarre tant que l'étape en cours n'a pas passé **100 % de ses tests automatisés (scripts de test) et de sa validation fonctionnelle**.

---

## 📌 ÉTAPE 1 : Socle Base de Données SQLite Natif / libSQL (Prêt pour Turso + Vercel)

### Objectif
Supprimer la couche hybride `sql.js` (WebAssembly bridé dans le navigateur) et mettre en place une architecture **Node.js / API Serverless Vercel** utilisant le client officiel **`@libsql/client`** (le moteur SQLite natif de **Turso**).
- **En local :** `@libsql/client` lit et écrit directement dans le vrai fichier binaire SQLite natif `file:./mind_fortress.db` (avec support complet des clés étrangères, index, transactions ACID, WAL).
- **En production (Vercel + Turso) :** Il suffit de renseigner `TURSO_DATABASE_URL=libsql://...` et `TURSO_AUTH_TOKEN=...` dans Vercel sans changer une seule ligne de code SQL ni d'API.

### Livrables de l'Étape 1
1. Configuration du projet (`package.json`, `.env.example`, configuration `vercel.json`).
2. Module de connexion unifié `db/client.js` basé sur `@libsql/client` (`file:mind_fortress.db` en local, `libsql://` sur Turso).
3. Schéma SQLite natif strict et migré (`db/schema.sql` + script de migration conservant les 67 puzzles et les données existantes), incluant dès maintenant les colonnes nécessaires pour FSRS, les coups UCI/SAN et le scouting d'adversaires.
4. API REST modulaire compatible Vercel Serverless Functions (`/api/state`, `/api/puzzles`, `/api/logs`, `/api/journal`, `/api/blindage`, `/api/settings`, `/api/backup`).

### ✅ Tests Obligatoires avant passage à l'Étape 2 (VALIDÉS À 100%)
- `tests/step1_db_turso.test.js` :
  - [x] Vérification de la connexion native libSQL/SQLite (`@libsql/client`) sur `file:mind_fortress.db` et de l'en-tête binaire `SQLite format 3`.
  - [x] Test d'intégrité des 10 tables, contraintes `FOREIGN KEY (ON DELETE CASCADE)`, transactions et index.
  - [x] Vérification que les 67 puzzles initiaux sont présents et requêtables en < 10 ms (`4.85 ms`).
  - [x] Test CRUD complet sur chaque route API (`GET`, `POST`, `DELETE`) et vérification de la migration de `mind_fortress.db`.

---

## 📌 ÉTAPE 2 : Intégration de la Suite `ValisoaChessLite_board` (Moteur + Échiquier + Parseur PGN)

### Objectif
Remplacer l'échiquier statique de l'application par vos propres bibliothèques situées dans `D:\Chess\ValisoaChessLite_board` :
1. **`ValisoaChessLite.js`** : Moteur Bitboards (`BigInt`) gérant la validation légale des coups, échec, mat, pat, prise en passant, roque, règle des 50 coups, triple répétition (Zobrist) et historique SAN.
2. **`ValisoaChessboard.js` + `ValisoaChessboard.css` + `img/chesspieces/wikipedia/*.svg`** : Échiquier interactif Drag & Drop (`PointerEvents`), animations FLIP, pre-moves, flèches et cercles vectoriels SVG (`addArrow`, `addCircle`, `addDot`) et nettoyage mémoire (`destroy()`).
3. **`ValisoaChesspgnparser.js`** : Parseur PGN complet (AST avec tags, commentaires `{}`, NAGs et variantes récursives RAV).

### Livrables de l'Étape 2
1. Intégration propre des assets `ValisoaChessLite.js`, `ValisoaChessboard.js`, `ValisoaChessboard.css`, `ValisoaChesspgnparser.js` et des pièces SVG dans le projet.
2. **Composant Échiquier Interactif (`ValisoaBoardWidget`)** connecté dans :
   - **Bloc 01 (Force / Puzzle du jour)** & **Mode Focus (Bibliothèque de Puzzles)** :
     - Jouer les coups par glisser-déposer (ou saisie clavier SAN en mode **Vision Aveugle**).
     - Validation automatique du coup joué contre la ligne de solution avec `ValisoaChessLite`.
     - Réponse automatique animée de l'adversaire (`board.move(...)`) s'il s'agit d'un puzzle multi-coups.
     - Affichage des points de destination légaux (`board.addDot()`) optionnel (désactivable en mode conditions tournoi) et dessin de flèches/cercles d'analyse (`board.addArrow()`, `board.addCircle()`).
   - **Créateur de Puzzle personnalisé** : possibilité de jouer ou éditer la position et de vérifier la légalité du FEN via `ValisoaChessLite`.
   - **Onglet Lichess & Bloc 02 Endurance** : remplacement du lecteur PGN basique par `ValisoaChesspgnparser.parse()` pour naviguer coup par coup dans une partie ou une variante sur l'échiquier `ValisoaChessboard`.

### ✅ Tests Obligatoires avant passage à l'Étape 3 (VALIDÉS À 100%)
- `tests/step2_valisoachess.test.js` :
  - [x] Nettoyage 100% des données fictives dans SQLite (`0 j` streak, `0` XP, `0/67` résolus, `0` log, `0` entrée journal, `0` jour coché) et purge automatique des anciens caches `localStorage`.
  - [x] Chargement des 67 FEN de la base SQLite dans `ValisoaChessLite` sans aucune erreur et validation automatique des 204 coups solutions.
  - [x] Test du parseur `ValisoaChesspgnparser` sur des PGN complets avec commentaires, NAGs et sous-variantes, rejoués sur `ValisoaChessLite`.
  - [x] Vérification du service HTTP des bibliothèques `ValisoaChessLite.js`, `ValisoaChessboard.js`, `ValisoaChessboard.css`, `ValisoaChesspgnparser.js`, et des 12 pièces SVG (`img/chesspieces/wikipedia/*.svg`).

---

## 📌 ÉTAPE 3 : Algorithme FSRS (Free Spaced Repetition Scheduler) + Mode Hybride Woodpecker

### Objectif
Implémenter le véritable algorithme mathématique **FSRS v4.5 / v5** (modèle **DSR** : *Difficulty*, *Stability*, *Retrievability*) dans SQLite, tout en permettant de basculer entre la **Révision Intelligente FSRS** au quotidien et le **Cycle Woodpecker (Hans Tikkanen)** en phase d'affûtage intensif.

### Fonctionnement détaillé
1. **Modèle Mathématique FSRS stocké dans SQLite (`puzzles` & `fsrs_review_logs`)** :
   - $D \in [1, 10]$ (**Difficulté**) : complexité intrinsèque du puzzle pour vous.
   - $S > 0$ (**Stabilité en jours**) : durée (en jours) pour que la probabilité de rappel $R$ passe de 100 % à 90 % (rétention cible configurable, par défaut `request_retention = 0.90`).
   - $R(t, S) = \left(1 + \frac{19}{81} \cdot \frac{t}{S}\right)^{-0.5}$ (**Récupérabilité / Retrievability**) : probabilité actuelle de résoudre le puzzle sans erreur.
2. **Notation FSRS à 4 niveaux adaptée aux Échecs (auto-calculée + ajustable)** :
   - **`1 — Again (Échec / Gaffe)`** : Coup illégal ou mauvais coup joué sur `ValisoaChessboard` (ou abandon / clic sur Solution). Réinitialise la stabilité post-oubli.
   - **`2 — Hard (Difficile / Lent)`** : Puzzle résolu du premier coup, mais au-delà du temps cible (ou après utilisation de l'indice).
   - **`3 — Good (Solide)`** : Puzzle résolu du premier coup dans le temps imparti.
   - **`4 — Easy (Réflexe pur)`** : Puzzle résolu du premier coup en moins de 10 secondes sans hésitation.
3. **Double Mode d'Entraînement** :
   - **Mode FSRS (Par défaut)** : File quotidienne priorisée par $R(t, S)$ croissant (les puzzles proches ou en-dessous de 90 % de rétention sortent en premier).
   - **Mode Cycle Woodpecker (Tikkanen)** : Sélection d'une cohorte fixe de puzzles (ex. Lot de 67 ou 200 puzzles) avec suivi du numéro de cycle (Cycle 1 : 28j → Cycle 2 : 14j → Cycle 3 : 7j → Cycle 4 : 3j → Cycle 5 : 24h) et objectif de division du temps global par 2.

### ✅ Tests Obligatoires avant passage à l'Étape 4 (VALIDÉS À 100%)
- `tests/step3_fsrs.test.js` :
  - [x] Tests unitaires mathématiques de la formule FSRS v4.5 ($R(S, S) = 0.90$, $I(0.90, S) = S$, $S_0$, $D_0$) et des intervalles en jours pour les notes `1 (Again)`, `2 (Hard)`, `3 (Good)`, `4 (Easy)` sur un nouveau puzzle (`state = New`) et un puzzle connu (`state = Review`).
  - [x] Vérification qu'un échec (`1 — Again`) augmente $D$, réduit $S$, incrémente `lapses`, renvoie en Boîte 1 et reprogramme le puzzle immédiatement.
  - [x] Vérification de la file d'attente SQLite `/api/puzzles/due` (tri exact par date d'échéance FSRS et probabilité $R$), de la table `fsrs_review_logs` et des Cycles Woodpecker 1 à 5 (`/api/woodpecker/cycle`).

---

## 📌 ÉTAPE 4 : Simulation Cadence Championnat FIDE (90 min + 30s/coup) & Gestion du Zeitnot

### Objectif
Transformer le **Bloc 02 (Endurance & Calcul profond)** en véritable simulateur des conditions du Championnat de Madagascar 2027 (cadence classique FIDE).

### Fonctionnalités
1. **Scénarios de Pendule Réalistes** :
   - *Scénario A — Sortie d'ouverture (Coup 15)* : 65 min au compteur + 30s/coup, position stratégique riche (trouver le plan et 3 coups candidats).
   - *Scénario B — Crise du 30ᵉ coup (Pré-Zeitnot)* : 8 min au compteur + 30s/coup, position tactico-stratégique tendue.
   - *Scénario C — Zeitnot Critique (Coup 38)* : 90 secondes au compteur + 30s/coup, obligation de jouer le coup sur `ValisoaChessboard` avant la chute du drapeau.
2. **Protocole structuré de saisie des 3 coups candidats** avant d'être autorisé à bouger la pièce sur l'échiquier (discipline anti-impulsivité).
3. **Enregistrement dans SQLite** du temps consommé, du respect de l'incrément et du nombre de retours d'attention volontaires.

### ✅ Tests Obligatoires avant passage à l'Étape 5 (VALIDÉS À 100%)
- `tests/step4_fide_clock.test.js` :
  - [x] Test précis du décompte de la pendule avec incrément Fischer (+30s après chaque coup joué sur `ValisoaChessboard`) et détection de la chute du drapeau.
  - [x] Test du verrouillage/déverrouillage « Coups candidats obligatoires » (Protocole Kotov) et validation de légalité avec `ValisoaChessLite` avant le coup sur l'échiquier.
  - [x] Test de sauvegarde du rapport de session Endurance dans SQLite (`POST /api/endurance`).

---

## 📌 ÉTAPE 5 : Synchronisation Automatique API Lichess & Diagnostic Chronobiologique — ✅ VALIDÉ (100% des tests passés)

### Objectif
Connecter l'application à l'API Lichess pour importer automatiquement vos données d'entraînement et de parties dans SQLite sans saisie manuelle fastidieuse.

### Fonctionnalités
1. **Route `/api/lichess/sync`** :
   - Récupération du profil et des courbes Elo (Classical, Rapid, Blitz, Puzzle) via `https://lichess.org/api/user/{username}`.
   - Importation des $N$ dernières parties PGN jouées sur Lichess, analysées avec `ValisoaChesspgnparser` et stockées dans une table SQLite `lichess_games`.
2. **Extraction automatique de vos propres gaffes en Puzzles FSRS** :
   - Possibilité de convertir une position critique d'une de vos parties Lichess directement en puzzle dans votre banque FSRS.
3. **Analyse Chronobiologique** :
   - Croisement automatique de vos résultats Lichess / sessions avec l'heure de la journée pour identifier vos créneaux de lucidité maximale et vos heures à risque de gaffe.

### ✅ Tests Obligatoires avant passage à l'Étape 6 (VALIDÉS À 100%)
- `tests/step5_lichess_sync.test.js` :
  - [x] Test de récupération et parsing JSON/PGN Lichess (avec mock hors-ligne + test réel API).
  - [x] Test d'insertion sans doublons (`INSERT OR IGNORE` sur `id` dans `lichess_games`) dans SQLite.
  - [x] Test de création d'un puzzle FSRS à partir d'une position PGN importée et du diagnostic chronobiologique sur 4 créneaux.

---

## 📌 ÉTAPE 6 : Module « Scouting Adversaires Madagascar 2027 » & Répertoire d'Ouvertures Interactif — ✅ VALIDÉ (100% des tests passés)

### Objectif
Préparer concrètement les rondes du Championnat de Madagascar 2027 avec une base de données dédiée aux adversaires locaux et à votre répertoire sur `ValisoaChessboard`.

### Fonctionnalités
1. **Table SQLite `opponents` (Fiches Adversaires Madagascar 2027)** :
   - Nom, Elo FIDE / Lichess, style de jeu (tactique, solide, joueur de zeitnot, agressif), forces/faiblesses psychologiques.
   - Ouvertures jouées avec les Blancs et avec les Noirs + PGN de référence visualisable sur `ValisoaChessboard` via `ValisoaChesspgnparser`.
   - Plan de match spécifique contre cet adversaire.
2. **Répertoire d'Ouvertures Interactif (`opening_repertoire`)** :
   - Entrée et révision de vos lignes Blancs / Noirs directement sur l'échiquier `ValisoaChessboard` avec révision espacée FSRS des variantes d'ouverture.

### ✅ Tests Obligatoires avant passage à l'Étape 7 (VALIDÉS À 100%)
- `tests/step6_scouting_openings.test.js` :
  - [x] Test CRUD complet des fiches adversaires et des arbres d'ouvertures dans SQLite.
  - [x] Test de lecture et d'exécution d'une ligne d'ouverture sur `ValisoaChessLite` + `ValisoaChessboard` et révision FSRS.

---

## 📌 ÉTAPE 7 : Analytique Avancée (Corrélation Sommeil / Fatigue / Émotions / Précision FSRS) & Déploiement GitHub (`valisoadev`) + Turso + Vercel — ✅ VALIDÉ (100% des tests passés)

### Objectif
Exploiter toutes les données croisées de SQLite pour piloter votre forme jusqu'en septembre 2027 et valider le déploiement cloud via votre compte GitHub `valisoadev`.

### Fonctionnalités
1. **Tableau de bord de corrélation dans `Progression`** :
   - Taux de réussite tactique et vitesse de calcul en fonction du **Niveau de Fatigue (1–5)**, de la **Qualité du Sommeil**, du **Lieu / Bruit** et de l'**Émotion pré-session**.
   - Alerte automatique de « Seuil de Risque de Gaffe » lorsque les indicateurs du jour correspondent à votre profil historique de contre-performance.
2. **Script de migration & synchronisation locale ↔ Turso Cloud + Guide GitHub `valisoadev`** :
   - Script `db/push_to_turso.js` (`npm run db:push-turso`) permettant de pousser votre base locale `mind_fortress.db` vers votre instance Turso Cloud et guide [`DEPLOY_GITHUB_VERCEL_TURSO.md`](file:///d:/Chess/MIND%20FORTRESS/DEPLOY_GITHUB_VERCEL_TURSO.md) configuré pour `valisoadev`.

### ✅ Tests Obligatoires Finaux (VALIDÉS À 100%)
- `tests/step7_analytics_deploy.test.js` :
  - [x] Test des requêtes SQL d'agrégation et de corrélation (Fatigue × Réussite, Émotion × Temps moyen, Courbe de rétention FSRS & Alerte de Seuil de Risque de Gaffe).
  - [x] Exécution de la suite complète des tests des Étapes 1 à 7 (`npm test`) avec **0 erreur**.
