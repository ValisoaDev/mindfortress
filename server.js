/**
 * MIND FORTRESS — Serveur Local Node.js + SQLite Natif / libSQL (Turso-ready)
 * En production sur Vercel, les routes `/api/*` sont automatiquement servies par `api/index.js`
 * et les fichiers statiques (`index.html`, assets) par le CDN Edge de Vercel.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { exec } = require("child_process");
const apiHandler = require("./api/index");
const { initDatabase, createBackup } = require("./db/init");
const { resolveLocalDbFilePath } = require("./db/client");

const BASE_DIR = __dirname;
const PORT = Number(process.env.PORT || 5000);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".db": "application/x-sqlite3"
};

function createAppServer(customDbUrl = null) {
  return http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = decodeURIComponent(parsedUrl.pathname);

    if (pathname.startsWith("/api")) {
      return await apiHandler(req, res, customDbUrl);
    }

    let relPath = pathname === "/" ? "/index.html" : pathname;
    const safePath = path.normalize(path.join(BASE_DIR, relPath));

    if (!safePath.startsWith(BASE_DIR)) {
      res.statusCode = 403;
      return res.end("Forbidden");
    }

    if (fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
      const ext = path.extname(safePath).toLowerCase();
      res.statusCode = 200;
      res.setHeader("Content-Type", MIME_TYPES[ext] || "application/octet-stream");
      return fs.createReadStream(safePath).pipe(res);
    }

    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("404 Not Found");
  });
}

if (require.main === module) {
  (async () => {
    const client = await initDatabase();
    const backup = createBackup(false);
    const localDb = resolveLocalDbFilePath();

    const server = createAppServer();
    server.listen(PORT, "127.0.0.1", () => {
      console.log("=".repeat(68));
      console.log("  MIND FORTRESS — Préparation Championnat de Madagascar 2027");
      console.log(`  Moteur SQLite : ${client.driver}`);
      console.log(`  Base active   : ${localDb || client.url}`);
      if (backup) {
        console.log(`  Sauvegarde    : backups/${backup}`);
      }
      console.log(`  URL Locale    : http://127.0.0.1:${PORT}`);
      console.log("=".repeat(68));

      if (!process.argv.includes("--no-browser")) {
        const url = `http://127.0.0.1:${PORT}`;
        if (process.platform === "win32") {
          exec(`start "" "${url}"`);
        }
      }
    });
  })().catch((err) => {
    console.error("Erreur fatale au démarrage de server.js :", err);
    process.exit(1);
  });
}

module.exports = { createAppServer };
