// packages/worker/src/commands/esiAssetDebug.js
import { getAccessTokenForCharacter, logger } from "@bonsai/shared";

const log = logger();

const ESI_BASE = "https://esi.evetech.net/latest";

// 임시 진단 명령이라 하드코딩. 재고 시스템 정식 기능(스키마 설계 참고)이 붙으면
// 테넌트별 관리자 배열(환경변수/Key Vault)로 옮기고 이 파일은 지운다.
const ALLOWED_DISCORD_IDS = new Set(["378543198953406464"]);

/**
 * 콤마/공백 없이 순수 숫자 문자열인지 — location_flag 필터로 온 값이 아니라
 * 진짜 콤마 구분 flag 목록인지 정도만 가볍게 검증할 때 재사용.
 */
function parseArgs(rawArgs) {
    try {
        const obj = JSON.parse(String(rawArgs ?? "").trim() || "{}");
        return obj && typeof obj === "object" ? obj : {};
    } catch {
        return {};
    }
}

/**
 * 콥 자산을 페이지네이션 끝까지 받는다. ESI 는 station/system 단위 서버측 필터를
 * 제공하지 않는다(공식 스펙에 query 파라미터가 page 하나뿐 — 확인함) — 그래서 항상
 * 전체를 받아 이후 단계에서 클라이언트 측으로 걸러야 한다.
 *
 * @returns {Promise<{ok: true, assets: any[]} | {ok: false, status: number, body: string}>}
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
        description: "[임시/관리자 전용] ESI 콥 자산 응답 구조 확인용 디버그 명령",
        type: 1,
        options: [
            {
                type: 3, // STRING
                name: "캐릭터",
                description: "사용할 연동 캐릭터명 (생략 시 메인 캐릭터, Director 권한 필요)",
                required: false,
            },
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

        const { 캐릭터: charNameOpt, 행어: hangarFilter } = parseArgs(envelope?.args);

        const charRow = charNameOpt
            ? await prisma.eveCharacter.findFirst({
                  where: { discordUserId, characterName: String(charNameOpt) },
              })
            : await prisma.eveCharacter.findFirst({
                  where: { discordUserId },
                  orderBy: [{ isMain: "desc" }],
              });

        if (!charRow) {
            return {
                ok: false,
                data: {
                    error: charNameOpt
                        ? `연동된 캐릭터 중 "${charNameOpt}"를 찾지 못했습니다.`
                        : "연동된 캐릭터가 없습니다. /캐릭터목록 으로 확인하세요.",
                    ephemeralReply: true,
                },
            };
        }

        const accessToken = await getAccessTokenForCharacter(prisma, charRow.characterId, { log });
        if (!accessToken) {
            return {
                ok: false,
                data: {
                    error: `${charRow.characterName} 의 ESI 토큰을 가져오지 못했습니다(만료/미등록).`,
                    ephemeralReply: true,
                },
            };
        }

        // corporation_id — 공개 엔드포인트(인증 불필요), 캐릭터 정보에서 얻는다.
        const charInfoRes = await fetch(
            `${ESI_BASE}/characters/${charRow.characterId}/?datasource=tranquility`
        );
        if (!charInfoRes.ok) {
            return {
                ok: false,
                data: {
                    error: `캐릭터 공개정보 조회 실패 (${charInfoRes.status})`,
                    ephemeralReply: true,
                },
            };
        }
        const charInfo = await charInfoRes.json();
        const corporationId = charInfo.corporation_id;

        const result = await fetchAllCorpAssets(corporationId, accessToken);
        if (!result.ok) {
            // x-required-roles: ["Director"] — 콥 자산 조회는 Director 권한이 있어야 한다.
            // 403 이 뜨면 거의 이 문제다.
            return {
                ok: false,
                data: {
                    error: `ESI 자산 조회 실패 (${result.status}). Director 권한이 있는 캐릭터인지 확인하세요.\n${result.body}`,
                    ephemeralReply: true,
                },
            };
        }

        const { assets, totalPages } = result;

        // 서버 로그에 원본 전체를 남긴다 — Discord 임베드는 필드당 1024자 제한이라
        // 요약만 보내고, 실제 구조 확인은 워커 로그(pm2 logs)에서 한다.
        log.info(
            `[cmd:자산진단] 원본 dump corporationId=${corporationId} character=${charRow.characterName} count=${assets.length} pages=${totalPages}`,
            { assets }
        );

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

        const sample = filtered.slice(0, 3);
        const sampleText = JSON.stringify(sample, null, 2);

        return {
            ok: true,
            data: {
                embed: true,
                title: "ESI 자산 진단" + (hangarFilter ? ` — ${hangarFilter}` : ""),
                description: `corporation_id=${corporationId} · 캐릭터=${charRow.characterName}`,
                fields: [
                    { name: "총 항목 수", value: String(filtered.length), inline: true },
                    { name: "is_singleton=true", value: String(singletonCount), inline: true },
                    { name: "페이지", value: String(totalPages), inline: true },
                    { name: "location_type 분포", value: typeLine, inline: false },
                    { name: "location_flag 분포 (상위 12)", value: topFlags, inline: false },
                    {
                        name: `샘플 (앞 ${sample.length}개, 전체는 워커 로그)`,
                        value: "```json\n" + sampleText.slice(0, 950) + "\n```",
                        inline: false,
                    },
                ],
                footer: "필터: /자산진단 행어:CorpSAG1 처럼 location_flag 로 좁힐 수 있습니다.",
                color: 0xe8a33d,
                ephemeralReply: true,
            },
        };
    },
};
