const express = require("express");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { openDb, hashPassword, verifyPassword } = require("./lib/db");
const { STATUS, sanitize, totals, validateSubmit } = require("./lib/rules");

const YEAR = 2027;
const SESSION_MS = 8 * 3600 * 1000;

function createApp(dbFile = process.env.DB_PATH || path.join(__dirname, "data", "rkap.db")) {
  const db = openDb(dbFile);
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));
  app.use((req, res, next) => {
    res.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin",
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:" });
    next();
  });
  const audit = (uid, action, dept, detail = "") => db.prepare("INSERT INTO audit_log(user_id,action,dept_id,detail) VALUES(?,?,?,?)").run(uid, action, dept ?? null, detail);
  const cookie = (req, n) => (req.headers.cookie || "").split(";").map((c) => c.trim().split("=")).find(([k]) => k === n)?.[1];
  const secure = process.env.COOKIE_SECURE === "1" ? "; Secure" : "";

  // ---- auth ----
  const attempts = new Map();
  app.post("/api/login", (req, res) => {
    const key = req.ip, now = Date.now(), a = (attempts.get(key) || []).filter((t) => now - t < 15 * 60000);
    if (a.length >= 10) return res.status(429).json({ error: "Terlalu banyak percobaan. Coba lagi 15 menit lagi." });
    const u = db.prepare("SELECT * FROM users WHERE username=?").get(String(req.body.username || ""));
    if (!u || !verifyPassword(String(req.body.password || ""), u.pass)) { a.push(now); attempts.set(key, a); return res.status(401).json({ error: "Username atau password salah." }); }
    const token = crypto.randomBytes(32).toString("base64url");
    db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(token, u.id, now + SESSION_MS);
    res.set("Set-Cookie", `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`);
    audit(u.id, "login", null);
    res.json({ ok: true });
  });
  const auth = (req, res, next) => {
    const t = cookie(req, "sid");
    const row = t && db.prepare("SELECT u.id,u.username,u.role,u.dept_id,s.expires FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?").get(t);
    if (!row || row.expires < Date.now()) return res.status(401).json({ error: "Belum login." });
    req.user = row; next();
  };
  const need = (...roles) => (req, res, next) => (roles.includes(req.user.role) ? next() : res.status(403).json({ error: "Tidak punya hak akses." }));
  app.post("/api/logout", (req, res) => { const t = cookie(req, "sid"); if (t) db.prepare("DELETE FROM sessions WHERE token=?").run(t); res.set("Set-Cookie", "sid=; Max-Age=0; Path=/"); res.json({ ok: true }); });
  app.get("/api/me", auth, (req, res) => res.json({ user: { username: req.user.username, role: req.user.role, dept_id: req.user.dept_id } }));

  // ---- submissions ----
  const access = (req, res, next) => {
    const id = Number(req.params.id);
    if (!db.prepare("SELECT 1 FROM departments WHERE id=?").get(id)) return res.status(404).json({ error: "Departemen tidak ditemukan." });
    if (req.user.role === "departemen" && req.user.dept_id !== id) return res.status(403).json({ error: "Anda hanya boleh mengakses departemen sendiri." });
    req.deptId = id; next();
  };
  const getSub = (dept) => {
    db.prepare("INSERT OR IGNORE INTO submissions(dept_id,year,updated_at) VALUES(?,?,?)").run(dept, YEAR, new Date().toISOString());
    return db.prepare("SELECT * FROM submissions WHERE dept_id=? AND year=?").get(dept, YEAR);
  };
  const editable = (s) => s.status === "Draft" || s.status === "Perlu Revisi";
  app.get("/api/submissions/:id", auth, access, (req, res) => {
    const s = getSub(req.deptId), d = db.prepare("SELECT name FROM departments WHERE id=?").get(req.deptId);
    res.json({ dept: d.name, status: s.status, note: s.note, payload: JSON.parse(s.payload) });
  });
  app.put("/api/submissions/:id", auth, access, need("departemen", "admin"), (req, res) => {
    const s = getSub(req.deptId);
    if (!editable(s)) return res.status(409).json({ error: `Data berstatus ${s.status} dan terkunci.` });
    db.prepare("UPDATE submissions SET payload=?,updated_at=? WHERE id=?").run(JSON.stringify(sanitize(req.body)), new Date().toISOString(), s.id);
    audit(req.user.id, "save", req.deptId); res.json({ ok: true });
  });
  app.post("/api/submissions/:id/submit", auth, access, need("departemen", "admin"), (req, res) => {
    const s = getSub(req.deptId);
    if (!editable(s)) return res.status(409).json({ error: `Data sudah berstatus ${s.status}.` });
    const codes = (t) => new Set(db.prepare("SELECT kode FROM wbs_codes WHERE tipe=?").all(t).map((r) => r.kode));
    const errors = validateSubmit(JSON.parse(s.payload), codes("OPEX"), codes("CAPEX"));
    if (errors.length) return res.status(400).json({ error: "Belum bisa diajukan: " + errors.slice(0, 5).join(" | ") + (errors.length > 5 ? ` (+${errors.length - 5} lagi)` : "") });
    db.prepare("UPDATE submissions SET status='Diajukan',note='',updated_at=? WHERE id=?").run(new Date().toISOString(), s.id);
    audit(req.user.id, "submit", req.deptId); res.json({ status: "Diajukan" });
  });
  app.post("/api/submissions/:id/review", auth, access, need("reviewer", "admin"), (req, res) => {
    const s = getSub(req.deptId), st = req.body.status;
    if (!["Disetujui", "Perlu Revisi"].includes(st)) return res.status(400).json({ error: "Status tidak valid." });
    if (s.status !== "Diajukan" && s.status !== "Disetujui") return res.status(409).json({ error: "Hanya data yang sudah diajukan yang bisa ditinjau." });
    const note = String(req.body.note || "").slice(0, 500);
    db.prepare("UPDATE submissions SET status=?,note=?,updated_at=? WHERE id=?").run(st, note, new Date().toISOString(), s.id);
    audit(req.user.id, "review:" + st, req.deptId, note); res.json({ status: st, note });
  });
  app.get("/api/consolidation", auth, need("reviewer", "admin"), (req, res) => {
    const rows = db.prepare("SELECT d.id,d.name,s.status,s.payload FROM departments d LEFT JOIN submissions s ON s.dept_id=d.id AND s.year=? ORDER BY d.id").all(YEAR).map((r) => {
      const t = totals(sanitize(r.payload ? JSON.parse(r.payload) : {}));
      return { dept_id: r.id, dept: r.name, status: r.status || "Belum mulai", ot: t.ot, ct: t.ct, bo: t.bo };
    });
    res.json({ rows });
  });

  // ---- admin ----
  app.get("/api/users", auth, need("admin"), (req, res) => res.json({ users: db.prepare("SELECT u.id,u.username,u.role,d.name dept FROM users u LEFT JOIN departments d ON d.id=u.dept_id ORDER BY u.id").all() }));
  app.post("/api/users", auth, need("admin"), (req, res) => {
    const { username, password, role, dept_id } = req.body;
    if (!/^[a-z0-9._-]{3,40}$/i.test(String(username || ""))) return res.status(400).json({ error: "Username 3-40 karakter (huruf, angka, . _ -)." });
    if (String(password || "").length < 10) return res.status(400).json({ error: "Password minimal 10 karakter." });
    if (!["departemen", "reviewer", "admin"].includes(role)) return res.status(400).json({ error: "Peran tidak valid." });
    if (role === "departemen" && !db.prepare("SELECT 1 FROM departments WHERE id=?").get(Number(dept_id))) return res.status(400).json({ error: "Pilih departemen untuk peran departemen." });
    try { db.prepare("INSERT INTO users(username,pass,role,dept_id) VALUES(?,?,?,?)").run(username, hashPassword(password), role, role === "departemen" ? Number(dept_id) : null); }
    catch { return res.status(409).json({ error: "Username sudah dipakai." }); }
    audit(req.user.id, "create_user", null, username); res.json({ ok: true });
  });

  // ---- frontend (data master disisipkan di server) ----
  const html = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8");
  app.get("/", (req, res) => {
    const w = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "wbs.json"), "utf8"));
    const depts = db.prepare("SELECT id,name FROM departments ORDER BY id").all();
    const j = (o) => JSON.stringify(o).replace(/</g, "\\u003c");
    res.type("html").send(html.replace("__DATA__", () => j(w)).replace("__DEPTS__", () => j(depts)));
  });
  return app;
}
module.exports = { createApp, STATUS };
if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => console.log(`Sistem RKAP 2027 berjalan di http://localhost:${port}`));
}
