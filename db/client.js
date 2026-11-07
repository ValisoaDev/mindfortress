/**
 * MIND FORTRESS — Client Base de Données Unifié (SQLite Natif C / libSQL Turso)
 * - En local : utilise @libsql/client (ou le moteur C SQLite natif de Node `node:sqlite`) sur `file:./mind_fortress.db`
 * - En production (Vercel + Turso) : utilise `TURSO_DATABASE_URL=libsql://...` + `TURSO_AUTH_TOKEN`
 */

const path = require("path");
const fs = require("fs");

// Chargement optionnel d'un fichier .env local sans dépendance externe
function loadDotEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!(key in process.env)) {
          process.env[key] = val;
        }
      }
    }
  }
}

loadDotEnv();

/**
 * Adaptateur compatible `@libsql/client` basé sur le moteur C SQLite natif (`node:sqlite`)
 * ou le protocole HTTP v2/pipeline de Turso Cloud si `@libsql/client` n'est pas compilé pour l'architecture hôte.
 */
function createNativeSqliteClient(dbUrl, authToken) {
  // 1. Essayer @libsql/client officiel en priorité
  try {
    const { createClient } = require("@libsql/client");
    const client = createClient({
      url: dbUrl,
      authToken: authToken || undefined
    });
    return {
      driver: "@libsql/client",
      url: dbUrl,
      client,
      async execute(stmtOrSql, args) {
        if (typeof stmtOrSql === "string") {
          return await client.execute({ sql: stmtOrSql, args: args || [] });
        }
        return await client.execute({
          sql: stmtOrSql.sql,
          args: stmtOrSql.args || []
        });
      },
      async batch(statements, mode = "write") {
        const formatted = statements.map((s) =>
          typeof s === "string" ? { sql: s, args: [] } : { sql: s.sql, args: s.args || [] }
        );
        return await client.batch(formatted, mode);
      },
      async executeMultiple(sqlBatch) {
        return await client.executeMultiple(sqlBatch);
      },
      close() {
        if (typeof client.close === "function") client.close();
      }
    };
  } catch (_err) {
    // 2. Fallback transparent vers le moteur C SQLite natif de Node.js (`node:sqlite`) en local
    //    ou le protocole HTTP standard de Turso (`libsql://` -> `https://.../v2/pipeline`)
    if (dbUrl.startsWith("libsql://") || dbUrl.startsWith("https://")) {
      const httpUrl = dbUrl.replace(/^libsql:\/\//, "https://").replace(/\/$/, "") + "/v2/pipeline";
      return {
        driver: "turso-http-pipeline",
        url: dbUrl,
        async execute(stmtOrSql, args) {
          const sql = typeof stmtOrSql === "string" ? stmtOrSql : stmtOrSql.sql;
          const params = (typeof stmtOrSql === "string" ? args : stmtOrSql.args) || [];
          const res = await fetch(httpUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
            },
            body: JSON.stringify({
              requests: [
                {
                  type: "execute",
                  stmt: {
                    sql,
                    args: params.map((p) =>
                      p === null || p === undefined
                        ? { type: "null" }
                        : typeof p === "number"
                        ? Number.isInteger(p)
                          ? { type: "integer", value: String(p) }
                          : { type: "float", value: p }
                        : { type: "text", value: String(p) }
                    )
                  }
                },
                { type: "close" }
              ]
            })
          });
          if (!res.ok) {
            throw new Error(`Turso HTTP error ${res.status}: ${await res.text()}`);
          }
          const data = await res.json();
          const first = data.results && data.results[0];
          if (first && first.type === "error") {
            throw new Error(first.error.message || "Turso SQL error");
          }
          const execRes = first.response.result;
          const cols = execRes.cols.map((c) => c.name);
          const rows = execRes.rows.map((r) => {
            const obj = {};
            cols.forEach((colName, idx) => {
              const cell = r[idx];
              obj[colName] =
                cell.type === "null"
                  ? null
                  : cell.type === "integer"
                  ? Number(cell.value)
                  : cell.type === "float"
                  ? Number(cell.value)
                  : cell.value;
            });
            return obj;
          });
          return {
            columns: cols,
            rows,
            rowsAffected: execRes.affected_row_count || 0,
            lastInsertRowid: execRes.last_insert_rowid ? Number(execRes.last_insert_rowid) : undefined
          };
        },
        async executeMultiple(sqlBatch) {
          const stmts = sqlBatch
            .split(";")
            .map((s) => s.trim())
            .filter(Boolean);
          for (const s of stmts) {
            await this.execute(s);
          }
        },
        async batch(statements) {
          const results = [];
          for (const s of statements) {
            results.push(await this.execute(s));
          }
          return results;
        },
        close() {}
      };
    }

    // Moteur C SQLite Natif intégré à Node.js (`node:sqlite`)
    const { DatabaseSync } = require("node:sqlite");
    const filePath = dbUrl.startsWith("file:")
      ? path.resolve(path.join(__dirname, ".."), dbUrl.slice("file:".length))
      : path.resolve(path.join(__dirname, ".."), dbUrl);

    const db = new DatabaseSync(filePath);
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec("PRAGMA journal_mode = WAL;");

    return {
      driver: "node:sqlite (Native C SQLite)",
      url: `file:${filePath}`,
      filePath,
      async execute(stmtOrSql, args) {
        const sql = typeof stmtOrSql === "string" ? stmtOrSql : stmtOrSql.sql;
        const params = (typeof stmtOrSql === "string" ? args : stmtOrSql.args) || [];
        const normalizedParams = params.map((p) => (p === undefined ? null : p));
        const trimmed = sql.trim().toUpperCase();
        const isReader =
          trimmed.startsWith("SELECT") ||
          trimmed.startsWith("PRAGMA") ||
          trimmed.includes("RETURNING");

        const stmt = db.prepare(sql);
        if (isReader) {
          const rawRows = stmt.all(...normalizedParams);
          const rows = rawRows.map((r) => ({ ...r }));
          const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
          return {
            columns,
            rows,
            rowsAffected: 0,
            lastInsertRowid: undefined
          };
        } else {
          const info = stmt.run(...normalizedParams);
          return {
            columns: [],
            rows: [],
            rowsAffected: Number(info.changes || 0),
            lastInsertRowid: info.lastInsertRowid !== undefined ? Number(info.lastInsertRowid) : undefined
          };
        }
      },
      async batch(statements) {
        const results = [];
        db.exec("BEGIN IMMEDIATE TRANSACTION;");
        try {
          for (const s of statements) {
            results.push(await this.execute(s));
          }
          db.exec("COMMIT;");
          return results;
        } catch (err) {
          db.exec("ROLLBACK;");
          throw err;
        }
      },
      async executeMultiple(sqlBatch) {
        db.exec(sqlBatch);
      },
      close() {
        db.close();
      }
    };
  }
}

let activeClient = null;
let activeUrl = null;

function getDbClient(customUrl) {
  const defaultPath = path.join(__dirname, "..", "mind_fortress.db");
  const targetUrl = customUrl || process.env.TURSO_DATABASE_URL || `file:${defaultPath}`;
  const authToken = process.env.TURSO_AUTH_TOKEN || "";

  if (!activeClient || activeUrl !== targetUrl) {
    if (activeClient) {
      try {
        activeClient.close();
      } catch (_e) {}
    }
    activeClient = createNativeSqliteClient(targetUrl, authToken);
    activeUrl = targetUrl;
  }
  return activeClient;
}

function resolveLocalDbFilePath(customUrl) {
  const defaultPath = path.join(__dirname, "..", "mind_fortress.db");
  const targetUrl = customUrl || process.env.TURSO_DATABASE_URL || `file:${defaultPath}`;
  if (targetUrl.startsWith("libsql://") || targetUrl.startsWith("https://")) {
    return null; // Base hébergée sur Turso Cloud
  }
  const raw = targetUrl.startsWith("file:") ? targetUrl.slice("file:".length) : targetUrl;
  return path.resolve(path.join(__dirname, ".."), raw);
}

module.exports = {
  getDbClient,
  createNativeSqliteClient,
  resolveLocalDbFilePath
};
