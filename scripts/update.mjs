
// Node 20+. Chạy: node scripts/update.mjs xsmn|vietlott
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = path.join(ROOT, 'data', 'results.json');
const KEEP_DAYS = 60;
const kind = process.argv[2];

// Ngày theo giờ Việt Nam (UTC+7), không phụ thuộc máy chủ CI
const vnToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const dateISO = process.env.DATE || vnToday();

// ---------- NGUỒN DỮ LIỆU: cần điền ----------
// Mỗi hàm nhận HTML hoặc JSON của nguồn và trả về đúng cấu trúc:
//   xsmn:     { "TP.HCM": { G8:["12"], G7:["345"], G6:[...], G5:[...], G4:[...], G3:[...], G2:[...], G1:[...], DB:["123456"] }, ... }
//   vietlott: { mega645:[{ky,time,numbers:[6]}], power655:[{ky,time,numbers:[6],special}],
//               max3d:[{ky,time,prizes:{n1:[],n2:[],n3:[],kk:[]}}], lotto535:[{ky,time,numbers:[5],special}] }
const SOURCES = {
  xsmn: {
    url: d => null,                       // ví dụ: `https://<nguon>/xsmn/${d}`
    parse: (body, d) => { throw new Error('Chưa cấu hình parser XSMN'); },
  },
  vietlott: {
    url: d => null,
    parse: (body, d) => { throw new Error('Chưa cấu hình parser Vietlott'); },
  },
};

async function main() {
  const src = SOURCES[kind];
  if (!src) throw new Error('Loại không hợp lệ: ' + kind);
  const url = src.url(dateISO);
  if (!url) throw new Error('Chưa cấu hình URL cho ' + kind);

  const res = await fetch(url, { headers: { 'User-Agent': 'lottery-dashboard/1.0' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const parsed = src.parse(await res.text(), dateISO);

  let data;
  try { data = JSON.parse(await readFile(DATA_FILE, 'utf8')); }
  catch { data = { updatedAt: null, xsmn: {}, vietlott: {} }; }

  data[kind][dateISO] = parsed;

  // Xóa dữ liệu quá KEEP_DAYS ngày
  const cutoff = Date.now() - KEEP_DAYS * 864e5;
  for (const k of ['xsmn', 'vietlott']) {
    for (const d of Object.keys(data[k])) {
      if (new Date(d).getTime() < cutoff) delete data[k][d];
    }
  }
  data.updatedAt = new Date().toISOString();

  await mkdir(path.dirname(DATA_FILE), { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(data, null, 2));
  console.log(`Đã cập nhật ${kind} ngày ${dateISO}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
