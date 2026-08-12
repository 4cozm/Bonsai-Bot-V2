// packages/worker/src/commands/esiAssetDebug.js
import { getAccessTokenForCharacter, logger, parseAnchorCharIds } from "@bonsai/shared";

const log = logger();

const ESI_BASE = "https://esi.evetech.net/latest";
const REQUIRED_SCOPE = "esi-assets.read_corporation_assets.v1";
const FIELD_MAX = 950; // Discord 임베드 필드 실제 한도(1024)보다 여유를 둔다

// 임시 진단 명령이라 하드코딩. 재고 시스템 정식 기능이 붙으면
// 테넌트별 관리자 배열(환경변수/Key Vault)로 옮기고 이 파일은 지운다.
const ALLOWED_DISCORD_IDS = new Set(["378543198953406464"]);

function parseArgs(rawArgs) {
    try {
        const obj = JSON.parse(String(rawArgs ?? "").trim() || "{}");
        return obj && typeof obj === "object" ? obj : {};
    } catch {
        return {};
    }
}

/** 중략 처리 — 끝까지 다 못 보여줄 땐 잘렸다는 걸 명시적으로 남긴다(조용히 자르지 않는다). */
function truncate(text, max = FIELD_MAX) {
    const s = String(text ?? "");
    if (s.length <= max) return s;
    return s.slice(0, max - 20) + `\n…(중략, 전체 ${s.length}자)`;
}

/**
 * accessToken(JWT)의 scp 클레임을 읽어 부여된 스코프 목록을 반환한다.
 * 서명 검증은 하지 않는다 — 우리 DB에 저장된 토큰이라 신뢰 경계가 아니라
 * "이 토큰에 실제로 무슨 스코프가 실려 있나"만 보는 용도다.
 *
 * .env 의 EVE_ESI_SCOPE 요청 목록에 있다고 해서 이 토큰이 그 스코프를 실제로
 * 들고 있다는 보장은 없다 — 스코프 목록에 추가되기 전에 이미 동의한 토큰이면
 * 재동의 전까지 새 스코프가 없다. 그래서 목록이 아니라 토큰 자체를 깐다.
 */
function decodeJwtScopes(accessToken) {
    try {
        const parts = String(accessToken ?? "").split(".");
        if (parts.length !== 3) return null;
        let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const pad = b64.length % 4;
        if (pad) b64 += "=".repeat(4 - pad);
        const payload = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
        const scp = payload?.scp;
        if (scp == null) return [];
        return Array.isArray(scp) ? scp : [scp];
    } catch {
        return null; // 디코딩 실패 — 스코프 확인 불가로 표시하고 자산 호출은 그래도 시도한다
    }
}

/**
 * 콥 자산을 페이지네이션 끝까지 받는다. ESI 는 station/system 단위 서버측 필터를
 * 제공하지 않는다(공식 스펙 확인 — query 파라미터가 page 하나뿐) — 전체를 받아
 * 클라이언트 측으로 걸러야 한다.
 */
async function fetchAllCorpAssets(corporationId, accessToken) {
    const assets = [];
    let page = 1;
    let totalPages = 1;

    do {
        const res = await fetch(
            `${ESI_BASE}/corporations/${corporationId}/assets/?datasource=tranquility&page=${page}`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            return { ok: false, status: res.status, body: body.slice(0, 300) };
        }
        totalPages = Number(res.headers.get("x-pages") ?? 1) || 1;
        const items = await res.json();
        assets.push(...items);
        page += 1;
    } while (page <= totalPages);

    return { ok: true, assets, totalPages };
}

export default {
    name: "자산진단",
    discord: {
        name: "자산진단",
        description: "[임시/관리자 전용] ESI 콥 자산 응답 구조를 단계별로 확인",
        type: 1,
        options: [
            {
                type: 3, // STRING
                name: "행어",
                description: "이 행어만 보기 (예: CorpSAG1). 생략하면 전체 요약만",
                required: false,
            },
        ],
    },

    /**
     * @param {object} ctx
     * @param {import("@prisma/client").PrismaClient} ctx.prisma
     * @param {any} envelope
     * @returns {Promise<{ok:boolean, data:any}>}
     */
    async execute(ctx, envelope) {
        const discordUserId = String(envelope?.meta?.discordUserId ?? "").trim();
        if (!ALLOWED_DISCORD_IDS.has(discordUserId)) {
            log.warn(`[cmd:자산진단] 허용되지 않은 사용자 discordUserId=${discordUserId}`);
            return {
                ok: false,
                data: { error: "이 명령은 사용할 수 없습니다.", ephemeralReply: true },
            };
        }

        const prisma = ctx?.prisma;
        if (!prisma) {
            log.warn("[cmd:자산진단] prisma 주입 없음");
            return { ok: false, data: { error: "시스템 설정 오류", ephemeralReply: true } };
        }

        const { 행어: hangarFilter } = parseArgs(envelope?.args);

        // 단계별로 쌓아서, 어디서 막히든 여기까지의 결과를 그대로 회신한다.
        const steps = [];
        const fail = (title, message) => ({
            ok: false,
            data: {
                embed: true,
                title: "ESI 자산 진단 — 실패",
                description: `**${title}** 단계에서 멈췄습니다: ${message}`,
                fields: steps,
                color: 0xe05b4f,
                ephemeralReply: true,
            },
        });

        // ── 1단계: 앵커(콥 관리자) 캐릭터 확인 ──────────────────
        const anchors = parseAnchorCharIds(process.env.EVE_ANCHOR_CHARIDS);
        if (anchors.length === 0) {
            return fail("1. 앵커 확인", "EVE_ANCHOR_CHARIDS 환경변수가 비어있습니다.");
        }
        const { corporationId, characterId } = anchors[0];
        steps.push({
            name: "1단계 · 앵커 캐릭터",
            value: truncate(
                `characterId=${characterId}\ncorporationId=${corporationId}` +
                    (anchors.length > 1 ? `\n(총 ${anchors.length}개 중 첫 번째만 사용)` : "")
            ),
            inline: false,
        });

        // ── 2단계: 토큰 확보 ────────────────────────────────────
        const accessToken = await getAccessTokenForCharacter(prisma, characterId, { log });
        if (!accessToken) {
            steps.push({ name: "2단계 · 토큰", value: "❌ 확보 실패(만료/미등록)", inline: false });
            return fail("2. 토큰 확보", "getAccessTokenForCharacter 가 null을 반환했습니다.");
        }
        steps.push({ name: "2단계 · 토큰", value: "✅ 확보 성공", inline: false });

        // ── 3단계: 스코프 확인 ──────────────────────────────────
        const scopes = decodeJwtScopes(accessToken);
        if (scopes == null) {
            steps.push({
                name: "3단계 · 스코프 확인",
                value: "⚠️ JWT 디코딩 실패 — 확인 불가, 4단계는 시도함",
                inline: false,
            });
        } else {
            const hasScope = scopes.includes(REQUIRED_SCOPE);
            steps.push({
                name: "3단계 · 스코프 확인",
                value: truncate(
                    `${hasScope ? "✅" : "❌"} ${REQUIRED_SCOPE}\n` +
                        `보유 스코프 ${scopes.length}개:\n` +
                        scopes.join(", ")
                ),
                inline: false,
            });
            if (!hasScope) {
                return fail(
                    "3. 스코프 확인",
                    `이 토큰에 ${REQUIRED_SCOPE} 가 없습니다. 이 캐릭터가 마지막으로 동의한 시점 이후 스코프 목록에 추가됐다면 재동의(재로그인)가 필요합니다.`
                );
            }
        }

        // ── 4단계: 콥 자산 조회 ─────────────────────────────────
        const result = await fetchAllCorpAssets(corporationId, accessToken);
        if (!result.ok) {
            // 스코프는 있는데 403이면 거의 Director 권한 문제다(x-required-roles: ["Director"]).
            steps.push({
                name: "4단계 · 자산 조회",
                value: truncate(`❌ HTTP ${result.status}\n${result.body}`),
                inline: false,
            });
            return fail(
                "4. 콥 자산 조회",
                `HTTP ${result.status}. 이 캐릭터가 콥에서 Director 권한을 가지고 있는지 확인하세요(콥 자산 조회는 Director 필수).`
            );
        }
        const { assets, totalPages } = result;
        steps.push({
            name: "4단계 · 자산 조회",
            value: `✅ ${assets.length}건 (페이지 ${totalPages}개)`,
            inline: false,
        });

        // 원본 전체는 워커 로그에 — Discord 임베드로는 다 못 보낸다.
        log.info(
            `[cmd:자산진단] 원본 dump corporationId=${corporationId} count=${assets.length} pages=${totalPages}`,
            { assets }
        );

        // ── 5단계: 분포 요약 ────────────────────────────────────
        const filtered = hangarFilter
            ? assets.filter((a) => a.location_flag === hangarFilter)
            : assets;

        const byFlag = {};
        const byType = {};
        let singletonCount = 0;
        for (const a of filtered) {
            byFlag[a.location_flag] = (byFlag[a.location_flag] ?? 0) + 1;
            byType[a.location_type] = (byType[a.location_type] ?? 0) + 1;
            if (a.is_singleton) singletonCount += 1;
        }
        const topFlags =
            Object.entries(byFlag)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 12)
                .map(([k, v]) => `${k}: ${v}`)
                .join("\n") || "(없음)";
        const typeLine =
            Object.entries(byType)
                .map(([k, v]) => `${k}: ${v}`)
                .join(", ") || "(없음)";

        steps.push({
            name: "5단계 · 분포 요약" + (hangarFilter ? ` (필터: ${hangarFilter})` : ""),
            value: truncate(
                `대상 ${filtered.length}건 · is_singleton=true ${singletonCount}건\n` +
                    `location_type: ${typeLine}\n` +
                    `location_flag 상위 12:\n${topFlags}`
            ),
            inline: false,
        });

        // ── 6단계: 샘플 원본 ────────────────────────────────────
        const sample = filtered.slice(0, 3);
        steps.push({
            name: `6단계 · 샘플 (앞 ${sample.length}개, 전체는 워커 로그)`,
            value: truncate("```json\n" + JSON.stringify(sample, null, 2) + "\n```"),
            inline: false,
        });

        return {
            ok: true,
            data: {
                embed: true,
                title: "ESI 자산 진단" + (hangarFilter ? ` — ${hangarFilter}` : ""),
                description: `corporation_id=${corporationId} · characterId=${characterId}`,
                fields: steps,
                footer: "필터: /자산진단 행어:CorpSAG1 처럼 location_flag 로 좁힐 수 있습니다.",
                color: 0xe8a33d,
                ephemeralReply: true,
            },
        };
    },
};
