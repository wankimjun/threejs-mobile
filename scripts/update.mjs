// Node 20+. Chạy: node scripts/update.mjs xsmn | vietlott
// Thử một ngày: DATE=2026-11-13 node scripts/update.mjs xsmn
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = path.join(ROOT, 'data', 'results.json');
const KEEP_DAYS = 60;
const kind = process.argv[2];

const vnToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const dateISO = process.env.DATE || vnToday();
const [Y, M, D] = dateISO.split('-');
const ddmmyyyy = `${D}-${M}-${Y}`;

// ---------- Nguồn XSMN: minhchinh.com ----------
const XSMN_URL = `https://www.minhchinh.com/ket-qua-xo-so-mien-nam/${ddmmyyyy}.html`;

// Giải, số lượng số trên MỖI đài, độ dài mỗi số
const XSMN_PRIZES = [
  ['G8', 1, 2], ['G7', 1, 3], ['G6', 3, 4], ['G5', 1, 4], ['G4', 7, 5],
  ['G3', 2, 5], ['G2', 1, 5], ['G1', 1, 5], ['DB', 1, 6],
];
// Nhãn giá trị trên minhchinh -> khóa giải
const XSMN_LABELS = {
  '100N': 'G8', '200N': 'G7', '400N': 'G6', '1TR': 'G5', '3TR': 'G4',
  '10TR': 'G3', '15TR': 'G2', '30TR': 'G1', '2TỶ': 'DB',
};
const MIEN_NAM = [
  'An Giang', 'Bạc Liêu', 'Bến Tre', 'Bình Dương', 'Bình Phước', 'Bình Thuận',
  'Cà Mau', 'Cần Thơ', 'Đà Lạt', 'Đồng Nai', 'Đồng Tháp', 'Hậu Giang',
  'Kiên Giang', 'Long An', 'Sóc Trăng', 'Tây Ninh', 'Tiền Giang', 'TP. HCM',
  'Trà Vinh', 'Vĩnh Long', 'Vũng Tàu',
];

// ---------- Nguồn Vietlott: minhngoc.net ----------
const BASE = 'https://www.minhngoc.net';
const PRODUCTS = {
  mega645: { url: `${BASE}/ket-qua-xo-so/dien-toan-vietlott/mega-6x45/${ddmmyyyy}.html`, main: 6, special: false, time: '18:00' },
  power655: { url: `${BASE}/ket-qua-xo-so/dien-toan-vietlott/power-6x55/${ddmmyyyy}.html`, main: 6, special: true, time: '18:00' },
};

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

// HTML -> danh sách dòng văn bản (mỗi thẻ là một dấu xuống dòng)
function toLines(html) {
  let t = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  t = t.replace(/<[^>]+>/g, '\n');
  t = t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
       .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return t.split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

// ---------- XSMN (minhchinh) ----------

function parseXsmn(html) {
    const lines = toLines(html);

    // Tìm dòng chứa tên tỉnh theo đúng thứ tự trong bảng.
    // Các tên tỉnh phải xuất hiện liên tiếp.
    let names = [];
    let headerStart = -1;

    for (let i = 0; i < lines.length; i++) {
        if (!MIEN_NAM.includes(lines[i])) continue;

        const candidate = [];
        let j = i;

        while (
            j < lines.length &&
            MIEN_NAM.includes(lines[j])
        ) {
            candidate.push(lines[j]);
            j++;
        }

        if (candidate.length >= 2 && candidate.length > names.length) {
            names = candidate;
            headerStart = i;
        }
    }

    if (headerStart < 0 || names.length < 2) {
        throw new Error('Không tìm thấy hàng tiêu đề các đài XSMN');
    }

    // Mã đài nằm ngay sau hàng tên tỉnh.
    
// Tìm mã đài sau danh sách tên tỉnh.
// Bỏ qua tiêu đề khu vực và nội dung không phải mã đài.
const CODE = /^(?=.*\d)[A-ZĐ0-9-]+$/i;

const REGION_LABELS = new Set([
    'MIỀN BẮC',
    'MIỀN TRUNG',
    'MIỀN NAM',
    'XỔ SỐ MIỀN NAM',
    'KẾT QUẢ XỔ SỐ MIỀN NAM'
]);

const codes = [];
const codePositions = [];

for (
    let j = headerStart + names.length;
    j < lines.length && codes.length < names.length;
    j++
) {
    const value = lines[j].trim();

    // Bỏ qua tiêu đề khu vực
    if (REGION_LABELS.has(value.toLocaleUpperCase('vi-VN'))) {
        continue;
    }

    // Chỉ nhận mã có chữ và số, không nhận tên khu vực
    if (!CODE.test(value)) {
        continue;
    }

    codes.push(value);
    codePositions.push(j);
}

if (codes.length !== names.length) {
    throw new Error(
        `Số mã đài tìm được (${codes.length}) khác số tên đài (${names.length}). ` +
        `Tên đài: ${names.join(', ')}. ` +
        `Mã đài: ${codes.join(', ')}`
    );
}

console.log('Tên đài:', names);
console.log('Mã đài:', codes);

// Dùng vị trí thực tế của mã đài cuối cùng
const lastCodeIndex = codePositions[codePositions.length - 1];


    // Vị trí cuối hàng mã đài
    const end = codeStart + codes.length - 1;

    // Thu thập kết quả từng giải
    const buckets = {};
    let cur = null;

    for (let i = lastCodeIndex + 1; i < lines.length; i++) {
    const l = lines[i];

    if (XSMN_LABELS[l]) {
        cur = XSMN_LABELS[l];
        buckets[cur] = [];
        continue;
    }

    if (cur && /^\d+$/.test(l)) {
        buckets[cur].push(l);
        continue;
    }

    cur = null;
}

    // Kiểm tra và phân chia kết quả theo từng đài
    const out = {};

    names.forEach(name => {
        out[name] = {};
    });

    for (const [key, count, len] of XSMN_PRIZES) {
        const arr = buckets[key] || [];
        const expected = count * names.length;

        if (arr.length !== expected) {
            throw new Error(
                `Giải ${key}: đọc được ${arr.length}/${expected} số`
            );
        }

        names.forEach((name, index) => {
            const part = arr.slice(
                index * count,
                (index + 1) * count
            );

            if (part.some(number => number.length !== len)) {
                throw new Error(
                    `${name}: sai độ dài giải ${key}`
                );
            }

            out[name][key] = part;
        });
    }

    return out;
}


// ---------- Vietlott (minhngoc) ----------
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
    if (`${dm[3]}-${dm[2]}-${dm[1]}` !== dateISO) continue;

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
