@echo off
chcp 65001 >nul
title MIND FORTRESS — Préparation Championnat de Madagascar 2027 (SQLite Natif / Turso Ready)
cd /d "%~dp0"
echo ====================================================================
echo   MIND FORTRESS — Demarrage du serveur SQLite Natif / libSQL
echo   Base de donnees : mind_fortress.db (100%% compatible Turso + Vercel)
echo ====================================================================
node server.js
pause
