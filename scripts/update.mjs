// Node 20+. Chạy: node scripts/update.mjs xsmn | vietlott
// Chạy thử một ngày: DATE=2026-11-12 node scripts/update.mjs xsmn
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = path.join(ROOT, 'data', 'results.json');
const KEEP_DAYS = 60;
const BASE = 'https://www.minhngoc.net';
const kind = process.argv[2];

const vnToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const dateISO = process.env.DATE || vnToday();
const [Y, M, D] = dateISO.split('-');
const ddmmyyyy = `${D}-${M}-${Y}`;

const PRODUCTS = {
  mega645: { url: `${BASE}/ket-qua-xo-so/dien-toan-vietlott/mega-6x45/${ddmmyyyy}.html`, main: 6, special: false, time: '18:00' },
  power655: { url: `${BASE}/ket-qua-xo-so/dien-toan-vietlott/power-6x55/${ddmmyyyy}.html`, main: 6, special: true, time: '18:00' },
};
const XSMN_URL = `${BASE}/ket-qua-xo-so/mien-nam/${ddmmyyyy}.html`;

// Thứ tự giải và số lượng số, độ dài từng số của XSMN
const XSMN_PRIZES = [
  ['G8', 1, 2], ['G7', 1, 3], ['G6', 3, 4], ['G5', 1, 4], ['G4', 7, 5],
  ['G3', 2, 5], ['G2', 1, 5], ['G1', 1, 5], ['DB', 1, 6],
];

async function get(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; lottery-dashboard/1.0)',
      'Accept-Language': 'vi-VN,vi;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} tại ${url}`);
  return res.text();
}

// Chuyển HTML thành danh sách dòng văn bản: mỗi thẻ là một dấu xuống dòng
function toLines(html) {
  let t = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  t = t.replace(/<[^>]+>/g, '\n');
  t = t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
       .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return t.split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

// ---------- XSMN ----------
function parseXsmn(html) {
  const lines = toLines(html);
  const out = {};
  for (let i = 0; i < lines.length; i++) {
    if (!/^XS[A-Z]{1,6}\b/.test(lines[i])) continue;   // dòng mã đài, ví dụ "XSTN - 11K2"
    const name = lines[i - 1];                          // tên đài nằm ngay trên dòng mã
    if (!name || /^XS/.test(name) || /\d/.test(name) || out[name]) continue;

    const nums = [];
    for (let j = i + 1; j < lines.length && nums.length < 18; j++) {
      if (/^\d+$/.test(lines[j])) nums.push(lines[j]);
      else if (/^XS[A-Z]{1,6}\b/.test(lines[j])) break;  // sang đài khác
    }
    if (nums.length !== 18) {
      console.warn(`Bỏ qua ${name}: đọc được ${nums.length}/18 số`);
      continue;
    }

    const rec = {};
    let p = 0;
    for (const [key, count, len] of XSMN_PRIZES) {
      const arr = nums.slice(p, p + count);
      p += count;
      if (arr.some(x => x.length !== len)) throw new Error(`${name}: sai độ dài giải ${key}`);
      rec[key] = arr;
    }
    out[name] = rec;
  }
  if (!Object.keys(out).length) throw new Error('Không tìm thấy kết quả XSMN trong trang');
  return out;
}

// ---------- Vietlott ----------
function parseVietlott(html, cfg) {
  const lines = toLines(html);
  const out = [];
  const want = cfg.special ? cfg.main + 1 : cfg.main;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^Kỳ vé:\s*#?(\d+)/);
    if (!m) continue;
    const ky = m[1];
    const dm = lines[i].match(/(\d{2})\/(\d{2})\/(\d{4})/) || (lines[i + 1] || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!dm) continue;
    const iso = `${dm[3]}-${dm[2]}-${dm[1]}`;
    if (iso !== dateISO) continue;

    const nums = [];
    for (let j = i + 1; j < lines.length && nums.length < want; j++) {
      if (/^\d{1,2}$/.test(lines[j])) nums.push(lines[j].padStart(2, '0'));
      else if (nums.length) break;
    }
    if (nums.length !== want) throw new Error(`Kỳ ${ky}: đọc được ${nums.length}/${want} số`);

    out.push({
      ky,
      time: cfg.time,
      numbers: nums.slice(0, cfg.main),
      ...(cfg.special ? { special: nums[cfg.main] } : {}),
    });
  }
  return out;
}

// ---------- Lưu ----------
async function main() {
  let data;
  try { data = JSON.parse(await readFile(DATA_FILE, 'utf8')); }
  catch { data = { updatedAt: null, xsmn: {}, vietlott: {} }; }

  if (kind === 'xsmn') {
    data.xsmn[dateISO] = parseXsmn(await get(XSMN_URL));
    console.log(`XSMN ${dateISO}: ${Object.keys(data.xsmn[dateISO]).length} đài`);
  } else if (kind === 'vietlott') {
    const rec = {};
    for (const [key, cfg] of Object.entries(PRODUCTS)) {
      try {
        const list = parseVietlott(await get(cfg.url), cfg);
        if (list.length) rec[key] = list;
        else console.warn(`${key}: chưa có kỳ quay ngày ${dateISO}`);
      } catch (e) {
        console.warn(`${key}: ${e.message}`);
      }
    }
    if (!Object.keys(rec).length) throw new Error('Không lấy được kết quả Vietlott nào');
    data.vietlott[dateISO] = rec;
    console.log(`Vietlott ${dateISO}: ${Object.keys(rec).join(', ')}`);
  } else {
    throw new Error('Loại không hợp lệ: ' + kind);
  }

  const cutoff = Date.now() - KEEP_DAYS * 864e5;
  for (const k of ['xsmn', 'vietlott']) {
    for (const d of Object.keys(data[k])) {
      if (new Date(d).getTime() < cutoff) delete data[k][d];
    }
  }
  data.updatedAt = new Date().toISOString();

  await mkdir(path.dirname(DATA_FILE), { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

main().catch(e => { console.error(e.message); process.exit(1); });
