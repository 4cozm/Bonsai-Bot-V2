/**
 * 시세 임베드 공통 포맷: ISK 정수(콤마), Spread%, 아이템명 축약, 단일 코드블록 표.
 */

/**
 * ISK 정수만 표시 (콤마 구분, 소수 없음). null/비정상 → "—".
 * @param {number|null|undefined} n
 * @returns {string}
 */
export function fmtIskInteger(n) {
    if (n == null || !Number.isFinite(n) || n < 0) return "—";
    const int = Math.round(n);
    return int.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/**
 * Spread% = ((Sell - Buy) / Sell) * 100. Sell·Buy 둘 다 있을 때만 계산.
 * 음수면 WARN 로그 후 그대로 표시.
 * @param {number|null} sell
 * @param {number|null} buy
 * @param {import("@bonsai/shared").Logger} [log]
 * @returns {string}
 */
export function fmtSpreadPct(sell, buy, log) {
    if (sell == null || buy == null || !Number.isFinite(sell) || !Number.isFinite(buy)) {
        return "—";
    }
    if (sell <= 0) return "—";
    const pct = ((sell - buy) / sell) * 100;
    if (Number.isFinite(pct) && pct < 0 && log) {
        log.warn("[embedFormat] Spread% 음수(데이터 이상)", { sell, buy, pct });
    }
    return Number.isFinite(pct) ? `${pct.toFixed(1)}%` : "—";
}

const ITEM_NAME_MAX_LEN = 12;

/**
 * Fullerite: "Fullerite-" 접두어 제거 (C50, C320 등). 그 외: 12자 제한 + ….
 * @param {string} name
 * @param {"fullerite"|"mineral"|"ice"} [category]
 * @returns {string}
 */
export function shortenItemName(name, category = "mineral") {
    let s = String(name ?? "").trim() || "—";
    if (category === "fullerite" && s.startsWith("Fullerite-")) {
        s = s.slice("Fullerite-".length);
    }
    if (s.length <= ITEM_NAME_MAX_LEN) return s;
    return s.slice(0, ITEM_NAME_MAX_LEN) + "…";
}

/**
 * Unix 초 또는 Date를 KST 문자열로. 예: "YYYY-MM-DD HH:mm KST"
 * @param {number|Date} secOrDate
 * @returns {string}
 */
export function formatTimestampKST(secOrDate) {
    const ms = typeof secOrDate === "number" ? secOrDate * 1000 : secOrDate.getTime();
    const d = new Date(ms);
    const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    const y = kst.getUTCFullYear();
    const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
    const day = String(kst.getUTCDate()).padStart(2, "0");
    const h = String(kst.getUTCHours()).padStart(2, "0");
    const min = String(kst.getUTCMinutes()).padStart(2, "0");
    return `${y}-${m}-${day} ${h}:${min} KST`;
}

/** 표 컬럼 폭: Item, Sell(ISK), Buy(ISK), Sprd, ISK/m³ */
const COL_WIDTHS = [10, 12, 12, 7, 10];

/**
 * 단일 코드블록으로 고정폭 표 생성. 열 맞춤으로 모든 클라이언트에서 동일 표시.
 * @param {[string, string, string, string, string][]} rows - [Item, Sell, Buy, Spread%, ISK/m³]
 * @returns {string} ```txt\n...\n```
 */
const SEP_CHAR = "\u2500"; // ─

export function buildMarketTable(rows) {
    const [w0, w1, w2, w3, w4] = COL_WIDTHS;
    const header = [
        "Item".padEnd(w0),
        "Sell(ISK)".padStart(w1),
        "Buy(ISK)".padStart(w2),
        "Sprd".padStart(w3),
        "ISK/m³".padStart(w4),
    ].join(" ");
    const separator = [
        SEP_CHAR.repeat(w0),
        SEP_CHAR.repeat(w1),
        SEP_CHAR.repeat(w2),
        SEP_CHAR.repeat(w3),
        SEP_CHAR.repeat(w4),
    ].join(" ");
    const dataLines = rows.map(([a, b, c, d, e]) =>
        [
            String(a).padEnd(w0),
            String(b).padStart(w1),
            String(c).padStart(w2),
            String(d).padStart(w3),
            String(e).padStart(w4),
        ].join(" ")
    );
    const lines = [header, separator, ...dataLines];
    return "```txt\n" + lines.join("\n") + "\n```";
}

/**
 * 임베드 필드 값으로 쓸 txt 코드블록으로 감싼 여러 줄.
 * @param {string[]} lines
 * @returns {string}
 */
export function codeBlockTxt(lines) {
    if (!Array.isArray(lines) || lines.length === 0) return "```txt\n—\n```";
    return "```txt\n" + lines.join("\n") + "\n```";
}
