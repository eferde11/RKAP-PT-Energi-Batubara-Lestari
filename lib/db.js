const { DatabaseSync } = require("node:sqlite");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEPTS = [
  ["Corporate Secretary", "Direksi & Corporate", "HO", "Sergi Andiva"], ["Internal Audit & Risk Management", "Direksi & Corporate", "HO", "Yunita Taurina"],
  ["HCGS Department", "HCGS Division", "HO", "Tubagus Heri D. Wijaya"], ["Human Capital & Administration Department", "HCGS Division", "Site", "M. Yusriani"],
  ["Legal & Permit Department", "Legal Division", "HO", "Pras Adhitya AP"], ["Procurement Department", "Procurement Division", "HO", "Bintang Arif"],
  ["Procurement (Site)", "Procurement Division", "Site", "Mariyana"], ["Corporate Affairs Department", "Business Support", "HO/Site", "Bambang Octaryono"],
  ["Operation Department / Kepala Teknik Tambang", "Operation Division", "Site", "Agung Basuki"], ["Coal Quality & Processing Plant Section", "Operation Division", "Site", "Yan Yan Riyana"],
  ["Hauling Section", "Operation Division", "Site", "Teddy Ristiadi Segara"], ["Safety, Health & Environment (SHE) Section", "Operation Division", "Site", "Arief Aminuddin"],
  ["Revegetation & Rehabilitation Section", "Operation Division", "Site", "Mariano A. Simamora"], ["Port Section", "Operation Division", "Site", "Afdi Huttama"],
  ["Technical Service & Planning (Mine Engineering)", "Engineering Division", "Site", "Binner Joni"], ["Mine Strategic & Development Department", "Engineering Division", "Site", "Ardiles"],
  ["Mine Economic Development Department", "Engineering Division", "Site", "Wiesan"], ["Strategic Planning Management Department", "CPOC Division", "HO", "Wahyu Dwi Anggoro"],
  ["FAT Department", "FAT Division", "HO", "Ferry Wahyu Wisuda"], ["Sales Department", "Sales Division", "HO", "Fikri Abdul Aziz"],
];

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return salt.toString("hex") + ":" + crypto.scryptSync(pw, salt, 64).toString("hex");
}
function verifyPassword(pw, stored) {
  const [s, h] = stored.split(":");
  const a = crypto.scryptSync(pw, Buffer.from(s, "hex"), 64), b = Buffer.from(h, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function openDb(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS departments(id INTEGER PRIMARY KEY, name TEXT UNIQUE, divisi TEXT, lokasi TEXT, kepala TEXT);
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE, pass TEXT, role TEXT CHECK(role IN('departemen','reviewer','admin')), dept_id INTEGER REFERENCES departments(id), created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id), expires INTEGER);
    CREATE TABLE IF NOT EXISTS wbs_codes(kode TEXT PRIMARY KEY, tipe TEXT, deskripsi TEXT);
    CREATE TABLE IF NOT EXISTS submissions(id INTEGER PRIMARY KEY, dept_id INTEGER REFERENCES departments(id), year INTEGER, status TEXT DEFAULT 'Draft', note TEXT DEFAULT '', payload TEXT DEFAULT '{}', updated_at TEXT, UNIQUE(dept_id, year));
    CREATE TABLE IF NOT EXISTS audit_log(id INTEGER PRIMARY KEY, at TEXT DEFAULT CURRENT_TIMESTAMP, user_id INTEGER, action TEXT, dept_id INTEGER, detail TEXT);
  `);
  if (db.prepare("SELECT COUNT(*) c FROM departments").get().c === 0) {
    const ins = db.prepare("INSERT INTO departments(name,divisi,lokasi,kepala) VALUES(?,?,?,?)");
    DEPTS.forEach((d) => ins.run(...d));
  }
  if (db.prepare("SELECT COUNT(*) c FROM wbs_codes").get().c === 0) {
    const w = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/wbs.json"), "utf8"));
    const ins = db.prepare("INSERT OR IGNORE INTO wbs_codes VALUES(?,?,?)");
    for (const [d, dn] of Object.entries(w.div)) for (const [j, jn] of Object.entries(w.jen)) ins.run(`AB3.11-06.02.${d}.${j}`, "OPEX", `${dn} / ${jn}`);
    ins.run("AB3.11-06.01.00.00", "OPEX", "Payroll & Kesehatan");
    w.extra.forEach(([k, d]) => ins.run(k, "OPEX", d.replace(/^\/|\/$/g, "")));
    w.cap.forEach(([k, n]) => ins.run(k, "CAPEX", n));
  }
  if (db.prepare("SELECT COUNT(*) c FROM users").get().c === 0) {
    const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString("base64url");
    db.prepare("INSERT INTO users(username,pass,role) VALUES('admin',?,'admin')").run(hashPassword(pw));
    if (!process.env.ADMIN_PASSWORD) console.log(`\n[SETUP] Akun admin dibuat. username: admin  password: ${pw}\n        Simpan, lalu buat akun departemen lewat menu Pengguna.\n`);
  }
  return db;
}
module.exports = { openDb, hashPassword, verifyPassword };
