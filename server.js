
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || "";
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

const GROUPS = ["teacher", "master", "student", "r1", "r2", "r3", "r4", "r5"];

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  });
  res.end(JSON.stringify(body));
}

function parseCookies(req) {
  const out = {};
  for (const item of (req.headers.cookie || "").split(";")) {
    const i = item.indexOf("=");
    if (i > 0) out[item.slice(0, i).trim()] = decodeURIComponent(item.slice(i + 1).trim());
  }
  return out;
}

function signature(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
}

function isAdmin(req) {
  const token = parseCookies(req).owner;
  if (!token) return false;
  const [value, sig] = token.split(".");
  return !!value && sig === signature(value);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (err) { reject(err); }
    });
  });
}

async function db(endpoint, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) throw new Error("Supabase environment variables are missing");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(text);
  return text ? JSON.parse(text) : null;
}

async function getData() {
  const rows = await db("students?select=*&order=created_at.asc");
  const data = Object.fromEntries(GROUPS.map(g => [g, []]));
  for (const row of rows) {
    if (data[row.group_key]) {
      data[row.group_key].push({
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      });
    }
  }
  return data;
}

function serveStatic(req, res) {
  let requestPath = decodeURIComponent(req.url.split("?")[0]);
  if (requestPath === "/") requestPath = "/index.html";
  if (requestPath.includes("..")) return send(res, 404, { error: "not found" });

  const file = path.join(__dirname, "public", requestPath);
  fs.readFile(file, (err, content) => {
    if (err) return send(res, 404, { error: "not found" });
    const type = {
      ".html": "text/html; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".png": "image/png",
      ".svg": "image/svg+xml"
    }[path.extname(file)] || "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = url.pathname;
    const method = req.method;

    if (p === "/api/health" && method === "GET") {
      return send(res, 200, { ok: true, databaseConfigured: !!SUPABASE_URL && !!SUPABASE_SECRET_KEY });
    }

    if (p === "/api/data" && method === "GET") {
      return send(res, 200, { data: await getData(), admin: isAdmin(req) });
    }

    if (p === "/api/admin/unlock" && method === "POST") {
      if (!ADMIN_KEY) return send(res, 500, { error: "ยังไม่ได้ตั้ง ADMIN_KEY ใน Render" });
      const body = await readJson(req);
      if (String(body.key || "") !== ADMIN_KEY) {
        return send(res, 401, { error: "รหัสเจ้าของไม่ถูกต้อง" });
      }
      const value = crypto.randomBytes(24).toString("hex");
      const token = `${value}.${signature(value)}`;
      return send(res, 200, { ok: true }, {
        "Set-Cookie": `owner=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`
      });
    }

    if (p === "/api/admin/lock" && method === "POST") {
      return send(res, 200, { ok: true }, {
        "Set-Cookie": "owner=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
      });
    }

    if (p === "/api/data" && method === "POST") {
      if (!isAdmin(req)) return send(res, 403, { error: "ต้องเปิดโหมดเจ้าของก่อน" });
      const body = await readJson(req);
      const group = String(body.group || "");
      const name = String(body.name || "").trim();
      if (!GROUPS.includes(group) || !name) return send(res, 400, { error: "ข้อมูลไม่ครบ" });
      await db("students", { method: "POST", body: JSON.stringify({ group_key: group, name }) });
      return send(res, 200, { data: await getData() });
    }

    const match = p.match(/^\/api\/data\/([a-z0-9]+)\/([0-9a-f-]+)$/i);
    if (match && (method === "PATCH" || method === "DELETE")) {
      if (!isAdmin(req)) return send(res, 403, { error: "ต้องเปิดโหมดเจ้าของก่อน" });
      const group = match[1];
      const id = match[2];
      if (!GROUPS.includes(group)) return send(res, 400, { error: "หมวดไม่ถูกต้อง" });

      if (method === "DELETE") {
        await db(`students?id=eq.${id}&group_key=eq.${group}`, { method: "DELETE" });
      } else {
        const body = await readJson(req);
        const name = String(body.name || "").trim();
        if (!name) return send(res, 400, { error: "ชื่อว่างไม่ได้" });
        await db(`students?id=eq.${id}&group_key=eq.${group}`, {
          method: "PATCH",
          body: JSON.stringify({ name, updated_at: new Date().toISOString() })
        });
      }
      return send(res, 200, { data: await getData() });
    }

    if (p === "/api/backup" && method === "GET") {
      if (!isAdmin(req)) return send(res, 403, { error: "ต้องเปิดโหมดเจ้าของก่อน" });
      return send(res, 200, { exportedAt: new Date().toISOString(), data: await getData() });
    }

    serveStatic(req, res);
  } catch (err) {
    console.error(err);
    send(res, 500, { error: "เกิดข้อผิดพลาดในการเชื่อมต่อระบบ" });
  }
});

server.listen(PORT, () => console.log(`Yantra registry running on ${PORT}`));
