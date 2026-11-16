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
    // Chỉ lấy bảng kết quả XSMN đầu tiên, không quét toàn bộ trang.
    const tableMatch = html.match(
        /<table\b(?=[^>]*\bclass=["'][^"']*\bkqxsmiennam\b)[^>]*>([\s\S]*?)<\/table>/i
    );

    if (!tableMatch) {
        throw new Error('Không tìm thấy bảng kết quả XSMN (.kqxsmiennam).');
    }

    const tableHtml = tableMatch[1];

    // Lấy các hàng trong bảng.
    const rows = [
        ...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)
    ].map(match => match[1]);

    // Lấy class của một ô TD.
    function getClasses(attrs) {
        const match = attrs.match(/\bclass\s*=\s*["']([^"']*)["']/i);
        return match ? match[1].split(/\s+/).filter(Boolean) : [];
    }

    // Lấy các ô TD trong một hàng.
    function getCells(rowHtml) {
        return [
            ...rowHtml.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)
        ].map(match => ({
            classes: getClasses(match[1]),
            html: match[2]
        }));
    }

    // Chuyển HTML thành văn bản.
    function cleanText(value) {
        return value
            .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;|&#160;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;|&apos;/gi, "'")
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&#(\d+);/g, (_, n) =>
                String.fromCodePoint(Number(n))
            )
            .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
                String.fromCodePoint(parseInt(n, 16))
            )
            .replace(/\s+/g, ' ')
            .trim();
    }

    // Tìm hàng chứa tên đài.
    const namesCells = rows
        .map(getCells)
        .find(cells => cells.some(cell =>
            cell.classes.includes('tentinh')
        ));

    if (!namesCells) {
        throw new Error('Không tìm thấy hàng tên đài (.tentinh).');
    }

    const names = namesCells
        .filter(cell => cell.classes.includes('tentinh'))
        .map(cell => cleanText(cell.html));

    // Tìm hàng chứa mã đài.
    const codesCells = rows
        .map(getCells)
        .find(cells => cells.some(cell =>
            cell.classes.includes('loaive')
        ));

    if (!codesCells) {
        throw new Error('Không tìm thấy hàng mã đài (.loaive).');
    }

    const codes = codesCells
        .filter(cell => cell.classes.includes('loaive'))
        .map(cell => cleanText(cell.html));

    // Kiểm tra tên đài và mã đài.
    if (names.length === 0 || names.length !== codes.length) {
        throw new Error(
            `Số tên đài (${names.length}) khác số mã đài (${codes.length}).`
        );
    }

    for (let i = 0; i < names.length; i++) {
        if (!names[i] || !/^[\p{L}\d-]+$/u.test(codes[i])) {
            throw new Error(
                `Mã đài không hợp lệ: ${names[i]} = ${codes[i]}`
            );
        }
    }

    // Ánh xạ class HTML sang tên giải trong results.json.
    const PRIZE_CLASS_MAP = {
        giai_tam: 'G8',
        giai_bay: 'G7',
        giai_sau: 'G6',
        giai_nam: 'G5',
        giai_tu: 'G4',
        giai_ba: 'G3',
        giai_nhi: 'G2',
        giai_nhat: 'G1',
        giai_dac_biet: 'DB'
    };

    // Số lượng và độ dài số của từng giải.
    const expected = new Map(
        XSMN_PRIZES.map(([prize, count, digits]) => [
            prize,
            { count, digits }
        ])
    );

    // Khởi tạo kết quả theo từng đài.
    const out = Object.fromEntries(
        names.map(name => [name, {}])
    );

    const foundPrizes = new Set();

    // Đọc số trúng thưởng trong một ô.
    function getNumbers(cellHtml) {
        const divs = [
            ...cellHtml.matchAll(
                /<div\b([^>]*)>([\s\S]*?)<\/div>/gi
            )
        ];

        return divs.map(match => {
            const attrs = match[1];
            const content = match[2];

            // Ưu tiên thuộc tính data để giữ nguyên số 0 ở đầu.
            const dataMatch = attrs.match(
                /\bdata\s*=\s*["'](\d+)["']/i
            );

            return dataMatch
                ? dataMatch[1]
                : cleanText(content).replace(/\s+/g, '');
        }).filter(Boolean);
    }

    // Duyệt từng hàng giải thưởng.
    for (const rowHtml of rows) {
        const cells = getCells(rowHtml);

        if (cells.length === 0) continue;

        const labelClass = cells[0].classes.find(
            cls => cls.startsWith('ten_giai_')
        );

        if (!labelClass) continue;

        const prizeClass = labelClass.replace(/^ten_/, '');
        const prize = PRIZE_CLASS_MAP[prizeClass];

        if (!prize) continue;

        if (foundPrizes.has(prize)) {
            throw new Error(`Giải ${prize} xuất hiện nhiều lần.`);
        }

        const spec = expected.get(prize);

        if (!spec) {
            throw new Error(`Chưa cấu hình số lượng giải ${prize}.`);
        }

        if (cells.length !== names.length + 1) {
            throw new Error(
                `Giải ${prize}: số ô dữ liệu không khớp số đài.`
            );
        }

        // Mỗi ô tương ứng với một đài.
        for (let i = 0; i < names.length; i++) {
            const numbers = getNumbers(cells[i + 1].html);

            if (numbers.length !== spec.count) {
                throw new Error(
                    `${names[i]} - ${prize}: cần ${spec.count} số, ` +
                    `nhưng tìm thấy ${numbers.length} số.`
                );
            }

            for (const number of numbers) {
                if (
                    !/^\d+$/.test(number) ||
                    number.length !== spec.digits
                ) {
                    throw new Error(
                        `${names[i]} - ${prize}: số không hợp lệ ${number}`
                    );
                }
            }

            out[names[i]][prize] = numbers;
        }

        foundPrizes.add(prize);
    }

    // Không cho phép lưu nếu thiếu bất kỳ giải nào.
    for (const [prize] of XSMN_PRIZES) {
        if (!foundPrizes.has(prize)) {
            throw new Error(`Không tìm thấy dữ liệu giải ${prize}.`);
        }
    }

    console.log(
        'Đài XSMN:',
        names.map((name, i) => `${name} (${codes[i]})`).join(', ')
    );

    console.log(
        `Đã phân tích ${names.length} đài và ${foundPrizes.size} giải.`
    );

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
