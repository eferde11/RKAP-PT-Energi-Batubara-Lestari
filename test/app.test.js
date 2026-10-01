process.env.ADMIN_PASSWORD = "admin-password-123";
const test = require("node:test");
const assert = require("node:assert");
const { createApp } = require("../server");
const { sanitize, totals } = require("../lib/rules");

let base, server;
test.before(async () => { server = createApp(":memory:").listen(0); await new Promise((r) => server.on("listening", r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());

async function call(method, url, body, cookie) {
  const r = await fetch(base + url, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})), cookie: (r.headers.get("set-cookie") || "").split(";")[0] };
}
const login = async (u, p) => (await call("POST", "/api/login", { username: u, password: p })).cookie;

test("aturan bisnis: total & selisih", () => {
  const p = sanitize({ bsc: [{ p: "Financial", prog: "A", bob: 100 }], ox: [{ prog: "A", kode: "X", m: Array(12).fill(1000) }, { prog: "TIDAK ADA", m: [500] }], cx: [{ prog: "A", biaya: 2000 }] });
  const t = totals(p);
  assert.equal(t.ot, 12500); assert.equal(t.ct, 2000); assert.equal(t.gap, 500);
});

test("alur lengkap: login, isolasi departemen, validasi, pengajuan, review, konsolidasi", async () => {
  assert.equal((await call("GET", "/api/me")).status, 401);
  assert.equal((await call("POST", "/api/login", { username: "admin", password: "salah" })).status, 401);
  const admin = await login("admin", "admin-password-123");
  assert.ok(admin);
  assert.equal((await call("POST", "/api/users", { username: "fat", password: "password-fat-1", role: "departemen", dept_id: 19 }, admin)).status, 200);
  assert.equal((await call("POST", "/api/users", { username: "cpoc", password: "password-cpoc-1", role: "reviewer" }, admin)).status, 200);
  assert.equal((await call("POST", "/api/users", { username: "x", password: "pendek", role: "reviewer" }, admin)).status, 400);

  const fat = await login("fat", "password-fat-1");
  assert.equal((await call("GET", "/api/submissions/20", null, fat)).status, 403, "tidak boleh buka departemen lain");
  assert.equal((await call("GET", "/api/consolidation", null, fat)).status, 403);

  const payload = { pic: "Ferry", bsc: [{ p: "Financial", prog: "Efisiensi Biaya", bob: 60 }, { p: "Learning & Growth", prog: "Pelatihan", bob: 30 }],
    ox: [{ prog: "Pelatihan", kode: "AB3.11-06.02.02.04", m: Array(12).fill(1000000) }], cx: [{ prog: "Efisiensi Biaya", kode: "AB3.AT06-00.00.00.00", biaya: 20000000 }] };
  assert.equal((await call("PUT", "/api/submissions/19", payload, fat)).status, 200);
  const bad = await call("POST", "/api/submissions/19/submit", null, fat);
  assert.equal(bad.status, 400); assert.match(bad.json.error, /bobot BSC harus 100%/);

  payload.bsc[1].bob = 40;
  payload.ox.push({ prog: "Pelatihan", kode: "KODE-NGASAL", m: [1000] });
  await call("PUT", "/api/submissions/19", payload, fat);
  assert.match((await call("POST", "/api/submissions/19/submit", null, fat)).json.error, /Kode WBS tidak valid/);

  payload.ox.pop();
  await call("PUT", "/api/submissions/19", payload, fat);
  assert.equal((await call("POST", "/api/submissions/19/submit", null, fat)).status, 200);
  assert.equal((await call("PUT", "/api/submissions/19", payload, fat)).status, 409, "terkunci setelah diajukan");
  assert.equal((await call("POST", "/api/submissions/19/review", { status: "Disetujui" }, fat)).status, 403);

  const cpoc = await login("cpoc", "password-cpoc-1");
  assert.equal((await call("POST", "/api/submissions/19/review", { status: "Perlu Revisi", note: "Cek OPEX" }, cpoc)).json.note, "Cek OPEX");
  assert.equal((await call("GET", "/api/submissions/19", null, fat)).json.status, "Perlu Revisi");
  assert.equal((await call("PUT", "/api/submissions/19", payload, fat)).status, 200, "bisa diedit lagi setelah revisi");
  await call("POST", "/api/submissions/19/submit", null, fat);
  assert.equal((await call("POST", "/api/submissions/19/review", { status: "Disetujui" }, cpoc)).json.status, "Disetujui");

  const ks = (await call("GET", "/api/consolidation", null, cpoc)).json.rows;
  const row = ks.find((r) => r.dept === "FAT Department");
  assert.deepEqual([row.ot, row.ct, row.bo, row.status], [12000000, 20000000, 100, "Disetujui"]);
  assert.equal(ks.length, 20);
  const page = await (await fetch(base + "/")).text();
  assert.ok(page.includes('"cap":[[') && !page.includes("__DATA__") && !page.includes("__DEPTS__"), "master data tersisip di halaman");
});
