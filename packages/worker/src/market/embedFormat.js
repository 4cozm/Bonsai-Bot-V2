/**
 * 시세 임베드 공통 포맷: ISK 정수(콤마), Spread%, 아이템명 축약, 단일 코드블록 표.
 * 표 정렬/자르기는 화면 칸수(display width) 기준: 한글·CJK·전각 = 2, 나머지 = 1.
 */

/**
 * 한글/전각 문자를 폭 2로 계산하는 화면 칸수.
 * @param {string} s
 * @returns {number}
 */
export function displayWidth(s) {
    let w = 0;
    const str = String(s ?? "");
    for (let i = 0; i < str.length; ) {
        const cp = str.codePointAt(i);
        const wide =
            (cp >= 0x1100 && cp <= 0x11ff) ||
            (cp >= 0x2e80 && cp <= 0x9fff) ||
            (cp >= 0xac00 && cp <= 0xd7af) ||
            (cp >= 0xf900 && cp <= 0xfaff) ||
            (cp >= 0xff01 && cp <= 0xff60);
        w += wide ? 2 : 1;
        i += cp > 0xffff ? 2 : 1;
    }
    return w;
}

/**
 * @param {string} s
 * @param {number} width
 * @returns {string}
 */
export function padEndWide(s, width) {
    const w = displayWidth(s);
    if (w >= width) return s;
    return s + " ".repeat(width - w);
}

/**
 * @param {string} s
 * @param {number} width
 * @returns {string}
 */
export function padStartWide(s, width) {
    const w = displayWidth(s);
    if (w >= width) return s;
    return " ".repeat(width - w) + s;
}

/**
 * 표시폭 기준 자르기 + ellipsis(…). maxWidth 초과 시 잘리고 "…" 붙음.
 * @param {string} s
 * @param {number} maxWidth
 * @returns {string}
 */
export function sliceWide(s, maxWidth) {
    const str = String(s ?? "");
    let w = 0;
    let out = "";
    for (let i = 0; i < str.length; ) {
        const cp = str.codePointAt(i);
        const wide =
            (cp >= 0x1100 && cp <= 0x11ff) ||
            (cp >= 0x2e80 && cp <= 0x9fff) ||
            (cp >= 0xac00 && cp <= 0xd7af) ||
            (cp >= 0xf900 && cp <= 0xfaff) ||
            (cp >= 0xff01 && cp <= 0xff60);
        const cw = wide ? 2 : 1;
        if (w + cw > maxWidth) break;
        out += String.fromCodePoint(cp);
        w += cw;
        i += cp > 0xffff ? 2 : 1;
    }
    if (displayWidth(out) < displayWidth(str) && maxWidth >= 1) {
        // maxWidth-1 폭까지만 남기고 "…"(1칸) 붙임. 재귀 대신 prefix만 다시 계산.
        let w2 = 0;
        out = "";
        for (let i = 0; i < str.length; ) {
            const cp = str.codePointAt(i);
            const wide =
                (cp >= 0x1100 && cp <= 0x11ff) ||
                (cp >= 0x2e80 && cp <= 0x9fff) ||
                (cp >= 0xac00 && cp <= 0xd7af) ||
                (cp >= 0xf900 && cp <= 0xfaff) ||
                (cp >= 0xff01 && cp <= 0xff60);
            const cw = wide ? 2 : 1;
            if (w2 + cw > maxWidth - 1) break;
            out += String.fromCodePoint(cp);
            w2 += cw;
            i += cp > 0xffff ? 2 : 1;
        }
        out += "…";
    }
    return out;
}

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
 * Fullerite: "Fullerite-" 또는 "풀러라이트-" 제거 → C50 등. Mineral: "압축된 " 제거. 그 외: 12자 제한 + ….
 * @param {string} name
 * @param {"fullerite"|"mineral"|"ice"} [category]
 * @returns {string}
 */
export function shortenItemName(name, category = "mineral") {
    let s = String(name ?? "").trim() || "—";
    if (category === "fullerite") {
        if (s.startsWith("Fullerite-")) s = s.slice("Fullerite-".length);
        else if (s.startsWith("풀러라이트-")) s = s.slice("풀러라이트-".length);
    } else if (category === "mineral" && s.startsWith("압축된 ")) {
        s = s.slice("압축된 ".length);
    }
    // 표(3열 필드) 내부는 formatMarketEmbedFields에서 sliceWide로 표시폭 기준 자름.
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

/** 임베드 3열 필드용: 아이템명 최대 표시폭(초과 시 …). field value 1024 제한, Top 12 기준 */
const ITEM_FIELD_MAX_WIDTH = 20;

/**
 * 시세 임베드용 3개 필드 값 생성. fields 3개 모두 inline: true 로 사용.
 * - Item: 아이템명 Top N줄 (길면 sliceWide로 축약)
 * - Sell/Buy: "16,200 / 9,304" 형식 (sell / buy, sprd 제거)
 * - ISK·m³: "101,250" 형식. 숫자 콤마, k 단위 금지.
 * @param {{ item: string, sell: number|null, buy: number|null, iskm3: number|null }[]} rows
 * @returns {{ itemValue: string, sellBuyValue: string, iskm3Value: string }}
 */
export function formatMarketEmbedFields(rows) {
    const fmtISK = (n) => (n != null && Number.isFinite(n) ? fmtIskInteger(n) : "—");

    const itemValue = rows.map((r) => sliceWide(r.item ?? "—", ITEM_FIELD_MAX_WIDTH)).join("\n");
    const sellBuyValue = rows.map((r) => `${fmtISK(r.sell)} / ${fmtISK(r.buy)}`).join("\n");
    const iskm3Value = rows.map((r) => fmtISK(r.iskm3)).join("\n");

    return { itemValue, sellBuyValue, iskm3Value };
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
