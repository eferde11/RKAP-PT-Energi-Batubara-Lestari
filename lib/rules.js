// Aturan bisnis RKAP - dipakai server (sumber kebenaran) dan test.
const PERSP = ["Financial", "Customer", "Internal Business Process", "Learning & Growth"];
const STATUS = ["Draft", "Diajukan", "Disetujui", "Perlu Revisi"];
const str = (v, n = 300) => String(v ?? "").slice(0, n);
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; };
const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);

function sanitize(p = {}) {
  return {
    pic: str(p.pic, 120),
    bsc: arr(p.bsc, 200).map((r) => ({
      p: str(r.p, 40), sas: str(r.sas), kpi: str(r.kpi), sat: str(r.sat, 40), base: str(r.base, 40), tgt: str(r.tgt, 40),
      bob: Math.min(100, Math.max(0, Number(r.bob) || 0)), prog: str(r.prog).trim(), pic: str(r.pic, 120),
      q: [0, 1, 2, 3].map((i) => !!(r.q && r.q[i])),
    })),
    ox: arr(p.ox, 500).map((r) => ({
      prog: str(r.prog).trim(), kode: str(r.kode, 40).trim(), ur: str(r.ur),
      m: Array.from({ length: 12 }, (_, i) => num(r.m && r.m[i])),
    })),
    cx: arr(p.cx, 500).map((r) => ({
      prog: str(r.prog).trim(), kode: str(r.kode, 40).trim(), nama: str(r.nama), biaya: num(r.biaya), waktu: str(r.waktu, 80),
    })),
  };
}

const sum = (a) => a.reduce((x, y) => x + y, 0);
function totals(p) {
  const ot = sum(p.ox.map((r) => sum(r.m))), ct = sum(p.cx.map((r) => r.biaya));
  const bo = sum(p.bsc.map((r) => r.bob));
  const progs = new Set(p.bsc.map((r) => r.prog).filter(Boolean));
  const linked = sum(p.ox.filter((r) => progs.has(r.prog)).map((r) => sum(r.m))) + sum(p.cx.filter((r) => progs.has(r.prog)).map((r) => r.biaya));
  return { ot, ct, total: ot + ct, bo, linked, gap: ot + ct - linked };
}

// wbsOx / wbsCx: Set kode yang valid
function validateSubmit(p, wbsOx, wbsCx) {
  const e = [], t = totals(p);
  const rows = p.bsc.filter((r) => r.prog || r.kpi || r.sas);
  if (!rows.some((r) => r.prog)) e.push("Isi minimal satu Program Kerja.");
  const seen = new Set();
  rows.forEach((r, i) => {
    const n = i + 1;
    if (!PERSP.includes(r.p)) e.push(`Rencana Kerja baris ${n}: pilih perspektif BSC.`);
    if (!r.prog) e.push(`Rencana Kerja baris ${n}: nama Program Kerja kosong.`);
    else if (seen.has(r.prog)) e.push(`Program Kerja ganda: "${r.prog}" (nama harus unik).`);
    seen.add(r.prog);
  });
  if (Math.round(t.bo) !== 100) e.push(`Total bobot BSC harus 100% (kini ${t.bo}%).`);
  p.ox.forEach((r, i) => { if (sum(r.m) > 0 || r.kode) { if (!wbsOx.has(r.kode)) e.push(`OPEX baris ${i + 1}: Kode WBS tidak valid.`); if (!seen.has(r.prog)) e.push(`OPEX baris ${i + 1}: pilih Program Kerja yang ada di Rencana Kerja.`); } });
  p.cx.forEach((r, i) => { if (r.biaya > 0 || r.kode) { if (!wbsCx.has(r.kode)) e.push(`CAPEX baris ${i + 1}: Kode WBS Aset tidak valid.`); if (!seen.has(r.prog)) e.push(`CAPEX baris ${i + 1}: pilih Program Kerja yang ada di Rencana Kerja.`); } });
  return e;
}
module.exports = { PERSP, STATUS, sanitize, totals, validateSubmit };
