
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// 1. CẤU HÌNH
// ============================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'data', 'results.json');

const KEEP_DAYS = 60;
const REQUEST_TIMEOUT = 30000;

const kind = (process.argv[2] || '').toLowerCase();

function getVietnamToday() {
    return new Date(Date.now() + 7 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
}

const dateISO = process.env.DATE || getVietnamToday();

const BASE_MINHNGOC = 'https://www.minhngoc.net';
const BASE_MINHCHINH = 'https://www.minhchinh.com';

const VIETLOTT_DATA_URL =
    'https://raw.githubusercontent.com/vietvudanh/vietlott-data/main/data';

const XSMN_PRIZES = [
    ['G8', 1, 2],
    ['G7', 1, 3],
    ['G6', 3, 4],
    ['G5', 1, 4],
    ['G4', 7, 5],
    ['G3', 2, 5],
    ['G2', 1, 5],
    ['G1', 1, 5],
    ['DB', 1, 6],
];

const XSMN_URL = (() => {
    const [year, month, day] = dateISO.split('-');

    return (
        `${BASE_MINHCHINH}/ket-qua-xo-so-mien-nam/` +
        `${day}-${month}-${year}.html`
    );
})();

const PRODUCTS = {
    mega645: {
        url: `${BASE_MINHNGOC}/ket-qua-xo-so/dien-toan-vietlott/mega-6x45/${dateISO.split('-').reverse().join('')}.html`,
        main: 6,
        special: false,
        time: '18:00',
        drawDays: [0, 3, 5],
    },

    power655: {
        url: `${BASE_MINHNGOC}/ket-qua-xo-so/dien-toan-vietlott/power-6x55/${dateISO.split('-').reverse().join('')}.html`,
        main: 6,
        special: true,
        time: '18:00',
        drawDays: [2, 4, 6],
    },
};

const DATASET_PRODUCTS = {
    max3d: {
        file: '3d.jsonl',
        time: '18:00',
        type: 'max3d',
    },

    max3d_pro: {
        file: '3d_pro.jsonl',
        time: '18:00',
        type: 'max3d_pro',
    },

    keno: {
        file: 'keno.jsonl',
        time: null,
        type: 'keno',
    },
};

const ALLOWED_KINDS = [
    'xsmn',
    'vietlott',
    'mega645',
    'power655',
    'max3d',
    'max3d_pro',
    'keno',
    'all',
];

// ============================================================
// 2. VALIDATE NGÀY
// ============================================================

function validateDate(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error(`Ngày không hợp lệ: ${date}`);
    }

    const parsed = new Date(`${date}T00:00:00.000Z`);

    if (
        !Number.isFinite(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== date
    ) {
        throw new Error(`Ngày không tồn tại: ${date}`);
    }
}

// ============================================================
// 3. HTTP REQUEST
// ============================================================

async function get(url) {
    console.log(`GET ${url}`);

    const response = await fetch(url, {
        method: 'GET',

        headers: {
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',

            Accept:
                'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',

            'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
        },

        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });

    if (!response.ok) {
        throw new Error(
            `HTTP ${response.status} khi truy cập ${url}`
        );
    }

    return await response.text();
}

// ============================================================
// 4. HTML HELPERS
// ============================================================

function decodeHtml(value = '') {
    return String(value)
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
        );
}

function stripHtml(html = '') {
    return decodeHtml(
        String(html)
            .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
            .replace(/<!--[\s\S]*?-->/g, ' ')
            .replace(/<[^>]+>/g, ' ')
    )
        .replace(/\s+/g, ' ')
        .trim();
}

function getAttributes(tag = '') {
    const attributes = {};

    const regex =
        /([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;

    let match;

    while ((match = regex.exec(tag)) !== null) {
        attributes[match[1].toLowerCase()] =
            decodeHtml(match[2] ?? match[3] ?? match[4] ?? '');
    }

    return attributes;
}

function getClassNames(tag = '') {
    const attrs = getAttributes(tag);

    return (attrs.class || '')
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
}

function getDataNumber(html = '') {
    const tagMatch = html.match(/<[^>]*\bdata\s*=\s*["']([^"']+)["'][^>]*>/i);

    if (tagMatch) {
        return decodeHtml(tagMatch[1]).trim();
    }

    return stripHtml(html).trim();
}

function extractTags(html = '', tagName = 'td') {
    const results = [];

    const regex = new RegExp(
        `<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}\\s*>`,
        'gi'
    );

    let match;

    while ((match = regex.exec(html)) !== null) {
        results.push(match[0]);
    }

    return results;
}

function extractRows(html = '') {
    return extractTags(html, 'tr');
}

function toLines(html = '') {
    return stripHtml(
        html
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(?:div|p|li|tr|td|th|h[1-6])\s*>/gi, '\n')
    )
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
}

function extractNumbers(html = '') {
    const numbers = [];

    const regex =
        /<[^>]*\bdata\s*=\s*["'](\d+)["'][^>]*>|>(\d{1,6})</gi;

    let match;

    while ((match = regex.exec(html)) !== null) {
        numbers.push(match[1] || match[2]);
    }

    return numbers;
}

// ============================================================
// 5. PARSE XSMN
// ============================================================


function getActualXsmnDate(html) {
    const patterns = [
        /XSMN hôm nay\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i,
        /KQXSMN[^<]{0,150}?(\d{1,2})\/(\d{1,2})\/(\d{4})/i,
    ];

    for (const pattern of patterns) {
        const match = html.match(pattern);

        if (match) {
            const [, day, month, year] = match;

            return [
                year,
                month.padStart(2, '0'),
                day.padStart(2, '0'),
            ].join('-');
        }
    }

    return null;
}


function parseXsmn(html) {
    if (!html || typeof html !== 'string') {
        throw new Error('HTML XSMN rỗng hoặc không hợp lệ.');
    }

    // --------------------------------------------------------
    // 1. Kiểm tra ngày thực tế trên trang
    // --------------------------------------------------------

    const actualDateMatch =
        html.match(/XSMN hôm nay\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i) ||
        html.match(/KQXSMN[^<]{0,150}?(\d{1,2})\/(\d{1,2})\/(\d{4})/i);

    if (actualDateMatch) {
        const [, day, month, year] = actualDateMatch;

        const actualDate = [
            year,
            month.padStart(2, '0'),
            day.padStart(2, '0')
        ].join('-');

        if (actualDate !== dateISO) {
            throw new Error(
                `Nguồn Minh Chính trả kết quả ngày ${actualDate}, ` +
                `không phải ngày yêu cầu ${dateISO}. ` +
                `Có thể kết quả ngày mới chưa được công bố.`
            );
        }
    }

    // --------------------------------------------------------
    // 2. Tìm bảng kết quả mới
    // --------------------------------------------------------

    const tables = [
        ...html.matchAll(
            /<table\b[^>]*>[\s\S]*?<\/table>/gi
        )
    ].map(match => match[0]);

    const table = tables.find(item => {
        const content = stripHtml(item).toUpperCase();

        return (
            content.includes('100N') &&
            content.includes('200N') &&
            content.includes('2TỶ')
        );
    });

    if (!table) {
        throw new Error(
            'Không tìm thấy bảng kết quả XSMN chứa 100N, 200N và 2TỶ. ' +
            'Website có thể đã thay đổi cấu trúc HTML.'
        );
    }

    // --------------------------------------------------------
    // 3. Đọc các hàng và ô trong bảng
    // --------------------------------------------------------

    const rows = [
        ...table.matchAll(
            /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
        )
    ].map(match => {
        const cells = [
            ...match[1].matchAll(
                /<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi
            )
        ].map(cell => ({
            html: cell[1],
            text: stripHtml(cell[1])
        }));

        return {
            html: match[1],
            cells
        };
    }).filter(row => row.cells.length > 0);

    if (!rows.length) {
        throw new Error('Bảng XSMN không có hàng dữ liệu.');
    }

    // --------------------------------------------------------
    // 4. Xác định tên đài
    // --------------------------------------------------------

    const stationNames = [
        'An Giang',
        'Bạc Liêu',
        'Bến Tre',
        'Bình Dương',
        'Bình Phước',
        'Bình Thuận',
        'Cà Mau',
        'Cần Thơ',
        'Đà Lạt',
        'Đồng Nai',
        'Đồng Tháp',
        'Hậu Giang',
        'Kiên Giang',
        'Long An',
        'Sóc Trăng',
        'Tây Ninh',
        'Tiền Giang',
        'TP. HCM',
        'Trà Vinh',
        'Vĩnh Long',
        'Vũng Tàu'
    ];

    const normalizedName = value =>
        value.toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd')
            .replace(/\s+/g, ' ')
            .trim();

    let stationRowIndex = -1;
    let stations = [];

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        const found = [];

        for (const cell of row.cells) {
            const text = cell.text.trim();

            const station = stationNames.find(name =>
                normalizedName(name) === normalizedName(text)
            );

            if (station && !found.includes(station)) {
                found.push(station);
            }
        }

        if (found.length >= 2) {
            stationRowIndex = i;
            stations = found;
            break;
        }
    }

    if (!stations.length) {
        throw new Error(
            'Không xác định được tên các đài trong bảng XSMN.'
        );
    }

    // --------------------------------------------------------
    // 5. Ánh xạ giải thưởng
    // --------------------------------------------------------

    const prizeConfig = {
        '100N': {
            code: 'G8',
            count: 1,
            length: 2
        },
        '200N': {
            code: 'G7',
            count: 1,
            length: 3
        },
        '400N': {
            code: 'G6',
            count: 3,
            length: 4
        },
        '1TR': {
            code: 'G5',
            count: 1,
            length: 4
        },
        '3TR': {
            code: 'G4',
            count: 7,
            length: 5
        },
        '10TR': {
            code: 'G3',
            count: 2,
            length: 5
        },
        '15TR': {
            code: 'G2',
            count: 1,
            length: 5
        },
        '30TR': {
            code: 'G1',
            count: 1,
            length: 5
        },
        '2TỶ': {
            code: 'DB',
            count: 1,
            length: 6
        }
    };

    const result = {};

    for (const station of stations) {
        result[station] = {};
    }

    // --------------------------------------------------------
    // 6. Đọc kết quả từng giải
    // --------------------------------------------------------

    for (const row of rows) {
        const firstCell = row.cells[0]?.text
            .toUpperCase()
            .replace(/\s+/g, '')
            .replace(/[.,]/g, '');

        const config = prizeConfig[firstCell];

        if (!config) continue;

        const valueCells = row.cells.slice(1);

        if (valueCells.length !== stations.length) {
            throw new Error(
                `${firstCell}: số cột kết quả (${valueCells.length}) ` +
                `không khớp số đài (${stations.length}).`
            );
        }

        for (let i = 0; i < stations.length; i++) {
            const station = stations[i];
            const cellText = valueCells[i].text;

            const numbers = cellText.match(/\d+/g) || [];

            if (numbers.length !== config.count) {
                throw new Error(
                    `${station} - ${config.code}: ` +
                    `cần ${config.count} số, nhận ${numbers.length}. ` +
                    `Nội dung ô: "${cellText}"`
                );
            }

            for (const number of numbers) {
                if (
                    number.length !== config.length ||
                    !/^\d+$/.test(number)
                ) {
                    throw new Error(
                        `${station} - ${config.code}: ` +
                        `số không hợp lệ "${number}".`
                    );
                }
            }

            result[station][config.code] = numbers;
        }
    }

    // --------------------------------------------------------
    // 7. Validate đầy đủ dữ liệu
    // --------------------------------------------------------

    for (const station of stations) {
        for (const config of Object.values(prizeConfig)) {
            const numbers = result[station][config.code];

            if (
                !Array.isArray(numbers) ||
                numbers.length !== config.count
            ) {
                throw new Error(
                    `${station}: thiếu hoặc sai dữ liệu giải ${config.code}.`
                );
            }
        }
    }

    console.log(
        `XSMN: phân tích thành công ${stations.length} đài.`
    );

    return result;
}


// ============================================================
// 6. PARSE VIETLOTT MEGA 6/45 - POWER 6/55
// ============================================================

function parseVietlott(html, cfg) {
    if (!html || typeof html !== 'string') {
        throw new Error('HTML Vietlott rỗng.');
    }

    const lines = toLines(html);
    const text = lines.join('\n');

    const kyMatch = text.match(
        /Kỳ\s*(?:vé|quay)?\s*[:#]?\s*#?\s*(\d+)/i
    );

    const dateMatch = text.match(
        /(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/
    );

    if (!kyMatch) {
        return [];
    }

    const ky = kyMatch[1];

    let numbers = [];

    // Ưu tiên lấy số từ các thẻ HTML có thuộc tính data.
    const dataNumbers = extractNumbers(html);

    if (dataNumbers.length >= cfg.main) {
        numbers = dataNumbers;
    }

    // Dự phòng: lấy các dãy số trong nội dung text.
    if (numbers.length < cfg.main) {
        numbers = text.match(/\b\d{1,2}\b/g) || [];
    }

    numbers = numbers
        .map(value => Number(value))
        .filter(value =>
            Number.isInteger(value) &&
            value >= 1 &&
            value <= (cfg.special ? 55 : 45)
        );

    // Loại trùng nhưng vẫn giữ thứ tự.
    numbers = [...new Set(numbers)];

    if (numbers.length < cfg.main) {
        throw new Error(
            `Kỳ ${ky}: không tìm thấy đủ ${cfg.main} số chính.`
        );
    }

    const result = {
        ky,
        time: cfg.time,
        numbers: numbers.slice(0, cfg.main).map(
            number => String(number).padStart(2, '0')
        ),
    };

    if (cfg.special) {
        const specialCandidates = numbers.slice(cfg.main);

        if (specialCandidates.length > 0) {
            result.special = String(
                specialCandidates[0]
            ).padStart(2, '0');
        }
    }

    if (dateMatch) {
        const [, day, month, year] = dateMatch;

        result.date =
            `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }

    return [result];
}

// ============================================================
// 7. VIETLOTT MAX 3D / MAX 3D PRO / KENO
// Nguồn: vietvudanh/vietlott-data
// ============================================================

async function getDatasetRecords(file) {
    const url = `${VIETLOTT_DATA_URL}/${file}`;

    console.log(`Đọc dữ liệu: ${url}`);

    const response = await fetch(url, {
        headers: {
            'User-Agent':
                'Mozilla/5.0 (compatible; lottery-dashboard/1.0)',

            Accept: 'application/x-ndjson, text/plain, */*',
        },

        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });

    if (!response.ok) {
        throw new Error(
            `HTTP ${response.status}: ${url}`
        );
    }

    const content = await response.text();

    if (!content.trim()) {
        throw new Error(
            `Nguồn dữ liệu rỗng: ${file}`
        );
    }

    const records = [];

    for (const [index, line] of content.split(/\r?\n/).entries()) {
        if (!line.trim()) continue;

        try {
            records.push(JSON.parse(line));
        } catch {
            throw new Error(
                `${file}: JSON lỗi tại dòng ${index + 1}.`
            );
        }
    }

    return records;
}

function normalizeMax3D(record, cfg) {
    const result = record.result;

    if (
        !result ||
        typeof result !== 'object' ||
        Array.isArray(result)
    ) {
        throw new Error(
            `${cfg.type} kỳ ${record.id}: kết quả không hợp lệ.`
        );
    }

    const prizes = {};

    const expectedCounts = {
        'Giải Đặc biệt': 2,
        'Giải Nhất': 4,
        'Giải Nhì': 6,
        'Giải ba': 8,
    };

    for (const [name, expectedCount] of Object.entries(expectedCounts)) {
        const values = result[name];

        if (!Array.isArray(values)) {
            throw new Error(
                `${cfg.type} kỳ ${record.id}: thiếu ${name}.`
            );
        }

        if (values.length !== expectedCount) {
            throw new Error(
                `${cfg.type} kỳ ${record.id}: ${name} cần ${expectedCount} số, nhận ${values.length}.`
            );
        }

        const numbers = values.map(value =>
            String(value).padStart(3, '0')
        );

        for (const number of numbers) {
            if (!/^\d{3}$/.test(number)) {
                throw new Error(
                    `${cfg.type} kỳ ${record.id}: số không hợp lệ ${number}.`
                );
            }
        }

        prizes[name] = numbers;
    }

    return {
        ky: String(record.id),
        time: cfg.time,
        result: prizes,
        date: record.date,
    };
}

function normalizeKeno(record) {
    if (
        !Array.isArray(record.result) ||
        record.result.length !== 20
    ) {
        throw new Error(
            `Keno kỳ ${record.id}: cần đúng 20 số.`
        );
    }

    const numbers = record.result.map(value =>
        String(value).padStart(2, '0')
    );

    for (const number of numbers) {
        const value = Number(number);

        if (
            !/^\d{2}$/.test(number) ||
            value < 1 ||
            value > 80
        ) {
            throw new Error(
                `Keno kỳ ${record.id}: số không hợp lệ ${number}.`
            );
        }
    }

    return {
        ky: String(record.id),
        numbers,
        date: record.date,
    };
}

async function fetchNewVietlottProduct(product, date) {
    const cfg = DATASET_PRODUCTS[product];

    if (!cfg) {
        throw new Error(
            `Sản phẩm không hợp lệ: ${product}`
        );
    }

    const records = await getDatasetRecords(cfg.file);

    const matches = records.filter(record =>
        record.date === date
    );

    if (!matches.length) {
        console.warn(
            `${product}: nguồn chưa có dữ liệu ngày ${date}, bỏ qua.`
        );

        return [];
    }

    const normalized = matches.map(record => {
        if (!record.id || !record.date) {
            throw new Error(
                `${product}: thiếu mã kỳ hoặc ngày quay.`
            );
        }

        if (product === 'keno') {
            return normalizeKeno(record);
        }

        return normalizeMax3D(record, cfg);
    });

    const unique = new Map();

    for (const item of normalized) {
        unique.set(String(item.ky), item);
    }

    return [...unique.values()].sort((a, b) =>
        a.ky.localeCompare(b.ky, 'en', {
            numeric: true,
        })
    );
}

async function updateNewVietlottProduct(data, product, date) {
    const records = await fetchNewVietlottProduct(
        product,
        date
    );

    if (!records.length) {
        return 0;
    }

    data.vietlott[date] ??= {};

    const previous = data.vietlott[date][product];

    const merged = new Map();

    if (Array.isArray(previous)) {
        for (const item of previous) {
            if (item?.ky) {
                merged.set(String(item.ky), item);
            }
        }
    }

    for (const item of records) {
        merged.set(String(item.ky), item);
    }

    data.vietlott[date][product] = [
        ...merged.values(),
    ].sort((a, b) =>
        a.ky.localeCompare(b.ky, 'en', {
            numeric: true,
        })
    );

    console.log(
        `${product} ${date}: ${records.length} kỳ mới/cập nhật; ` +
        `tổng ${data.vietlott[date][product].length} kỳ.`
    );

    return records.length;
}

// ============================================================
// 8. MERGE DỮ LIỆU
// ============================================================

function mergeDraws(previous, incoming) {
    const merged = new Map();

    if (Array.isArray(previous)) {
        for (const item of previous) {
            if (item?.ky != null) {
                merged.set(String(item.ky), item);
            }
        }
    }

    for (const item of incoming) {
        if (item?.ky != null) {
            merged.set(String(item.ky), item);
        }
    }

    return [...merged.values()].sort((a, b) =>
        String(a.ky).localeCompare(String(b.ky), 'en', {
            numeric: true,
        })
    );
}

// ============================================================
// 9. UPDATE MEGA / POWER
// ============================================================

function getWeekday(date) {
    return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

async function updateClassicVietlott(data, product, date) {
    const cfg = PRODUCTS[product];

    if (!cfg) {
        throw new Error(
            `Không tìm thấy cấu hình ${product}.`
        );
    }

    const weekday = getWeekday(date);

    // Không phải ngày quay thì bỏ qua.
    if (!cfg.drawDays.includes(weekday)) {
        console.log(
            `${product}: ngày ${date} không có lịch quay, bỏ qua.`
        );

        return 0;
    }

    const html = await get(cfg.url);
    const list = parseVietlott(html, cfg);

    if (!list.length) {
        throw new Error(
            `${product}: hôm nay có lịch quay nhưng không lấy được kết quả.`
        );
    }

    data.vietlott[date] ??= {};

    data.vietlott[date][product] = mergeDraws(
        data.vietlott[date][product],
        list
    );

    console.log(
        `${product} ${date}: cập nhật ${list.length} kỳ.`
    );

    return list.length;
}

// ============================================================
// 10. LOAD / SAVE JSON
// ============================================================

async function loadData() {
    try {
        const content = await readFile(
            DATA_FILE,
            'utf8'
        );

        const data = JSON.parse(content);

        data.xsmn ??= {};
        data.vietlott ??= {};

        return data;
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw new Error(
                `Không đọc được ${DATA_FILE}: ${error.message}`
            );
        }

        console.log(
            'Chưa có results.json, khởi tạo dữ liệu mới.'
        );

        return {
            updatedAt: null,
            xsmn: {},
            vietlott: {},
        };
    }
}

async function saveData(data) {
    await mkdir(path.dirname(DATA_FILE), {
        recursive: true,
    });

    await writeFile(
        DATA_FILE,
        JSON.stringify(data, null, 2) + '\n',
        'utf8'
    );

    console.log(
        `Đã lưu dữ liệu: ${DATA_FILE}`
    );
}

// ============================================================
// 11. DỌN DỮ LIỆU CŨ
// ============================================================

function cleanOldData(data) {
    const cutoff =
        Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;

    for (const key of ['xsmn', 'vietlott']) {
        for (const date of Object.keys(data[key])) {
            const timestamp = Date.parse(
                `${date}T00:00:00.000Z`
            );

            if (
                Number.isFinite(timestamp) &&
                timestamp < cutoff
            ) {
                delete data[key][date];
            }
        }
    }
}

// ============================================================
// 12. MAIN
// ============================================================

async function main() {
    console.log('========================================');
    console.log('      LOTTERY DATA UPDATE');
    console.log('========================================');

    console.log(`Loại cập nhật : ${kind}`);
    console.log(`Ngày dữ liệu  : ${dateISO}`);
    console.log(`Node.js       : ${process.version}`);
    console.log('----------------------------------------');

    if (!ALLOWED_KINDS.includes(kind)) {
        throw new Error(
            `Loại cập nhật không hợp lệ: ${kind}\n` +
            `Cho phép: ${ALLOWED_KINDS.join(', ')}`
        );
    }

    validateDate(dateISO);

    const data = await loadData();

    const updateXsmn =
        kind === 'xsmn' || kind === 'all';

    const updateAllVietlott =
        kind === 'vietlott' || kind === 'all';

    // --------------------------------------------------------
    // XSMN
    // --------------------------------------------------------

    if (updateXsmn) {
        console.log('\n[1/2] CẬP NHẬT XSMN');

        const html = await get(XSMN_URL);
        const result = parseXsmn(html);

        data.xsmn[dateISO] = result;

        console.log(
            `XSMN ${dateISO}: ${Object.keys(result).length} đài.`
        );
    }

    // --------------------------------------------------------
    // VIETLOTT MEGA / POWER
    // --------------------------------------------------------

    
if (updateXsmn) {
    console.log('\n[1/2] CẬP NHẬT XSMN');

    const html = await get(XSMN_URL);
    const actualDate = getActualXsmnDate(html);

    if (actualDate && actualDate !== dateISO) {
        console.warn(
            `XSMN: nguồn đang trả dữ liệu ngày ${actualDate}, ` +
            `trong khi yêu cầu là ${dateISO}.`
        );

        console.warn(
            'Kết quả ngày yêu cầu chưa được công bố. Bỏ qua XSMN.'
        );
    } else {
        const result = parseXsmn(html);

        data.xsmn[dateISO] = result;

        console.log(
            `XSMN ${dateISO}: ${Object.keys(result).length} đài.`
        );
    }
}


    // --------------------------------------------------------
    // MAX 3D / MAX 3D PRO / KENO
    // --------------------------------------------------------

    const datasetProducts = updateAllVietlott
        ? Object.keys(DATASET_PRODUCTS)
        : DATASET_PRODUCTS[kind]
            ? [kind]
            : [];

    for (const product of datasetProducts) {
        console.log(`\nCẬP NHẬT ${product.toUpperCase()}`);

        await updateNewVietlottProduct(
            data,
            product,
            dateISO
        );
    }

    // --------------------------------------------------------
    // CẬP NHẬT MỘT SẢN PHẨM MEGA / POWER
    // --------------------------------------------------------

    if (
        !updateAllVietlott &&
        (kind === 'mega645' || kind === 'power655')
    ) {
        console.log(`\nCẬP NHẬT ${kind.toUpperCase()}`);

        data.vietlott[dateISO] ??= {};

        await updateClassicVietlott(
            data,
            kind,
            dateISO
        );
    }

    // --------------------------------------------------------
    // CLEAN / SAVE
    // --------------------------------------------------------

    cleanOldData(data);

    data.updatedAt = new Date().toISOString();

    await saveData(data);

    console.log('\n========================================');
    console.log('       UPDATE COMPLETED');
    console.log('========================================');
}

main().catch(error => {
    console.error('\n========================================');
    console.error('       UPDATE FAILED');
    console.error('========================================');
    console.error(error.stack || error.message || error);

    process.exitCode = 1;
});
