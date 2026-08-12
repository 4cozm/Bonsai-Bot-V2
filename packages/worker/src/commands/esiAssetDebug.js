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

// location_type: "solar_system" 인데 콥 행어(CorpSAG) 자체가 있을 수 없는 type_id.
// 실측으로 확인함(2026-08-12) — 2233 은 세관 사무소(POCO, 행성 세금 수취 용도라
// 인벤토리 개념이 아예 없음), 12235/20060 은 아마르 관제타워(구식 POS, 종족·크기별로
// type_id 가 다 다르다 — Upwell 구조물이 아니라 CorpSAG 체계 자체를 안 씀). 다른
// 종족/크기 관제타워나 다른 세관 사무소 변형이 나오면 여기 추가한다.
const NON_HANGAR_STRUCTURE_TYPE_IDS = new Set([2233, 12235, 20060]);

// 구조물 옵션에 이 값을 넣으면 특정 구조물 하나가 아니라 후보 전부를 한 번에
// 스캔한다 — 10개를 하나씩 손으로 드릴다운하지 않아도 되게 하려는 용도.
const ALL_STRUCTURES_TRIGGERS = new Set(["전체", "all", "ALL"]);

// CorpSAG1~7/OfficeFolder 말고도 콥 소유 자산이 걸릴 수 있는 flag들 — 공식
// location_flag enum 전체를 확인해서 뽑았다. Impounded(오피스 임대 문제 등으로
// 강제 압류), AssetSafety(구조물 파괴/철거 시 자산 보호소로 이동)면 콥 행어에
// 실제로 넣어둔 물건이라도 CorpSAG가 아니라 이 flag들로 나타난다.
const HANGAR_ADJACENT_FLAGS = new Set([
    "OfficeFolder",
    "Impounded",
    "AssetSafety",
    "CorpDeliveries",
    "CorporationGoalDeliveries",
    "InfrastructureHangar",
    "FleetHangar",
    "Hangar",
    "HangarAll",
]);
function isHangarAdjacentFlag(flag) {
    return HANGAR_ADJACENT_FLAGS.has(flag) || String(flag ?? "").startsWith("CorpSAG");
}

// group_id: 1406 = Refinery(Tatara/Athanor). 이 구조물 종류는 CCP 가 애초에 콥
// 행어(오피스) 기능을 넣지 않았다 — Corporate Hangar Array 를 어떻게 붙이든 구조적
// 으로 CorpSAG 가 나올 수 없다. Citadel/Engineering Complex 와 달리 "서비스를
// 안 붙여서"가 아니라 "이 구조물 종류 자체가 지원 안 함"이라 스캔 결과에 이유를
// 같이 적어 준다.
const REFINERY_GROUP_ID = 1406;

/**
 * 콥 자산 안에서 "구조물(건물)로 보이는" 후보를 찾는다.
 *
 * ESI location_type enum에는 "structure"가 따로 없다 — 구조물 자체는
 * location_type: "solar_system" 인 행 하나로 나타난다(그 구조물의 item_id를
 * 갖는다). 그 구조물 **안**의 콥 행어는 정거장과 똑같이 location_flag:
 * CorpSAG1~7 을 쓰지만, location_id 가 정거장 ID가 아니라 이 구조물의
 * item_id를 가리키는 자식 행들로 나타난다 — 그래서 한 단계 더 파야 한다.
 *
 * 다만 solar_system 타입이 전부 "행어 있는 건물"은 아니다 — POCO나 구식 POS
 * 관제타워도 여기 같이 잡히는데, 이것들은 애초에 CorpSAG 자체가 없는 구조라
 * 후보에서 뺀다.
 *
 * Citadel/Engineering Complex(아즈벨·포티자 등)는 콥 행어가 별도 서비스 모듈 없이
 * 내장 기능이다 — 그래서 "설치가 안 됐다"가 아니라 "그 행어 탭에 물건을 하나도
 * 안 넣어놨다"가 CorpSAG 0건의 실제 의미다. ESI 는 빈 division 에 대해 아무 행도
 * 만들지 않는다(placeholder 없음). Refinery(타타라·아타노르, group_id=1406)는
 * 예외 — 이 종류는 콥/오피스 기능 자체가 없어 항상 CorpSAG 가 있을 수 없다.
 */
function findStructureCandidates(assets) {
    return assets.filter(
        (a) => a.location_type === "solar_system" && !NON_HANGAR_STRUCTURE_TYPE_IDS.has(a.type_id)
    );
}

/**
 * rootLocationId 아래에 있는 자산을 깊이 상관없이 전부 찾는다(BFS).
 *
 * 처음엔 `location_id === 구조물 item_id`인 것만 보면 되는 줄 알았는데(1단계만),
 * 실제 데이터로 확인해보니 콥 행어에 물건이 가득 차 있는데도 이 방식으로는 0건이
 * 나오는 경우가 있었다 — 즉 구조물 바로 밑이 아니라 한 단계(또는 그 이상) 더
 * 들어간 컨테이너 밑에 실제 내용물이 걸려 있는 케이스가 있다는 뜻이다. 그래서
 * location_id 를 부모-자식 인덱스로 만들어 몇 단계든 내려가며 전부 모은다.
 */
function collectNestedAssets(rootLocationId, assets, maxDepth = 6) {
    const childrenByParent = new Map();
    for (const a of assets) {
        const key = String(a.location_id);
        if (!childrenByParent.has(key)) childrenByParent.set(key, []);
        childrenByParent.get(key).push(a);
    }

    const items = [];
    const depthCounts = [];
    const visited = new Set();
    let frontier = [String(rootLocationId)];
    let depth = 0;

    while (frontier.length > 0 && depth < maxDepth) {
        const nextFrontier = [];
        let countAtDepth = 0;
        for (const parentId of frontier) {
            for (const child of childrenByParent.get(parentId) ?? []) {
                if (visited.has(child.item_id)) continue;
                visited.add(child.item_id);
                items.push({ ...child, __depth: depth + 1 });
                countAtDepth += 1;
                nextFrontier.push(String(child.item_id));
            }
        }
        depthCounts.push(countAtDepth);
        frontier = nextFrontier;
        depth += 1;
    }

    return { items, depthCounts, maxDepthReached: depth };
}

/**
 * GET /corporations/{id}/divisions/ — 콥 행어(CorpSAG1~7)·지갑 디비전의 커스텀 이름.
 * "탄약", "모듈"처럼 콥이 직접 붙인 이름이 여기서 나온다 — CorpSAG1~7 자체는 ESI가
 * 매기는 슬롯 번호일 뿐 표시 이름이 아니다.
 *
 * 이름을 안 바꾼 디비전은 응답 배열에 아예 안 나온다(ESI 특성) — 그래서 못 찾으면
 * "실패"가 아니라 "기본 이름"으로 다룬다. 스코프(esi-corporations.read_divisions.v1)가
 * 없어도 이 단계만 건너뛰고 나머지는 계속 진행한다 — 이름 조회는 부가 정보지 자산
 * 조회의 필수 조건이 아니다.
 *
 * @returns {Promise<{ok:boolean, hangarNames?: Record<number,string>, status?: number}>}
 */
async function fetchDivisionNames(corporationId, accessToken) {
    const res = await fetch(
        `${ESI_BASE}/corporations/${corporationId}/divisions/?datasource=tranquility`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) return { ok: false, status: res.status };
    const data = await res.json();
    const hangarNames = {};
    for (const h of data?.hangar ?? []) {
        if (h?.division != null && h?.name) hangarNames[h.division] = h.name;
    }
    return { ok: true, hangarNames };
}

/** CorpSAG1 형태의 flag 를 "CorpSAG1(탄약)" 처럼 실제 디비전 이름을 붙여 표시한다. */
function labelFlag(flag, hangarNames) {
    const m = /^CorpSAG(\d)$/.exec(String(flag ?? ""));
    if (!m) return flag;
    const name = hangarNames?.[Number(m[1])];
    return name ? `${flag}(${name})` : flag;
}

/** POST /assets/names/ — 아이템(구조물·컨테이너·함선 등)의 커스텀 이름을 배치로 받는다. */
async function fetchAssetNames(corporationId, accessToken, itemIds) {
    if (itemIds.length === 0) return {};
    const res = await fetch(
        `${ESI_BASE}/corporations/${corporationId}/assets/names/?datasource=tranquility`,
        {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify(itemIds),
        }
    );
    if (!res.ok) return {};
    const rows = await res.json();
    const byId = {};
    for (const r of rows) byId[String(r.item_id)] = r.name;
    return byId;
}

/**
 * GET /universe/types/{id}/ — 공개 엔드포인트(인증 불필요). type_id 가 실제로 뭔지
 * (포티자/타타라 등)와 group_id 를 준다. 구조물 후보 목록에 type_id 숫자만 찍으면
 * 사람이 매번 따로 찾아봐야 해서, 여기서 미리 붙여 준다.
 */
async function fetchTypeInfoBatch(typeIds) {
    const unique = [...new Set(typeIds)];
    const results = await Promise.all(
        unique.map(async (id) => {
            try {
                const res = await fetch(
                    `${ESI_BASE}/universe/types/${id}/?datasource=tranquility&language=ko`
                );
                if (!res.ok) return null;
                const d = await res.json();
                return { name: d.name, groupId: d.group_id };
            } catch {
                return null;
            }
        })
    );
    const byId = {};
    unique.forEach((id, i) => {
        if (results[i]) byId[id] = results[i];
    });
    return byId;
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
            {
                type: 3, // STRING (item_id가 커서 INTEGER 옵션은 Discord 클라이언트에서 반올림될 수 있다)
                name: "구조물",
                description:
                    "이 구조물(건물) item_id 안쪽만 보기(깊이 무관). '전체' 입력 시 후보 전부 스캔",
                required: false,
            },
            {
                type: 5, // BOOLEAN
                name: "상세",
                description:
                    "이미 검증된 앵커/토큰/스코프/자산조회 단계도 매번 자세히 보기 (기본: 한 줄로 요약)",
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

        const {
            행어: hangarFilter,
            구조물: structureIdOpt,
            상세: detailed,
        } = parseArgs(envelope?.args);

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

        // 여기 도달했다는 건 1~4단계가 전부 성공했다는 뜻이다. 실패였다면 위의 각
        // fail() 호출이 그 시점까지의 steps 를 그대로 써서 이미 리턴했다 — 즉 실패
        // 경로는 이 collapse 와 무관하게 항상 자세히 나간다. 상세:true 가 아니면
        // 매번 똑같이 통과하는 이 네 단계를 한 줄로 접어서, 실제로 궁금한 5단계
        // 이후만 눈에 띄게 한다.
        if (detailed !== true) {
            steps.length = 0;
            steps.push({
                name: "1~4단계 · 사전 확인",
                value: `✅ 앵커 · 토큰 · 스코프 · 자산 조회(${assets.length}건) 전부 정상 (상세:true 로 펼쳐보기)`,
                inline: false,
            });
        }

        // ── 5단계: 행어(디비전) 실제 이름 ────────────────────────
        // CorpSAG1~7 은 ESI 가 매기는 슬롯 번호일 뿐, "탄약"/"모듈"처럼 콥이 붙인
        // 표시 이름이 아니다 — 이 단계가 그 매핑을 가져온다. 실패해도 치명적이지
        // 않으니(부가 정보) 나머지 단계는 계속 진행한다.
        const divResult = await fetchDivisionNames(corporationId, accessToken);
        const hangarNames = divResult.ok ? divResult.hangarNames : {};
        steps.push({
            name: "5단계 · 행어 이름 (divisions)",
            value: divResult.ok
                ? truncate(
                      Object.keys(hangarNames).length > 0
                          ? Object.entries(hangarNames)
                                .map(([n, name]) => `CorpSAG${n}: ${name}`)
                                .join("\n")
                          : "(이름을 바꾼 행어가 없음 — 전부 기본 이름)"
                  )
                : `⚠️ 조회 실패(HTTP ${divResult.status}) — esi-corporations.read_divisions.v1 스코프 확인 필요. CorpSAG 번호로만 표시함`,
            inline: false,
        });

        // ── 행어·오피스 계열 전수 검색 ───────────────────────────
        // ESI 공식 문서 기준 콥 행어는 "구조물 → OfficeFolder(오피스) → CorpSAG1~7
        // → 아이템" 순으로 한 단계 더 감싸져 있다. CorpSAG/OfficeFolder뿐 아니라
        // Impounded(압류)·AssetSafety(자산 보호소)처럼 콥이 넣어둔 물건이 다른
        // flag로 나타나는 경우도 있어서 HANGAR_ADJACENT_FLAGS 전체로 찾는다.
        // 분포 요약의 상위 12는 건수가 적으면 거기 밀려 안 보일 수 있으니, 필터·
        // 드릴다운과 무관하게 전체 자산에서 직접 찾아 하나도 빠짐없이 보여준다.
        const officeAndHangarAssets = assets.filter((a) => isHangarAdjacentFlag(a.location_flag));
        const officeFlagCounts = {};
        for (const a of officeAndHangarAssets) {
            officeFlagCounts[a.location_flag] = (officeFlagCounts[a.location_flag] ?? 0) + 1;
        }
        const officeSummaryLine =
            Object.entries(officeFlagCounts)
                .map(([flag, count]) => `${labelFlag(flag, hangarNames)}: ${count}건`)
                .join(", ") || "0건";
        const officeLines =
            officeAndHangarAssets
                .map(
                    (a) =>
                        `${labelFlag(a.location_flag, hangarNames)} · item_id=${a.item_id} · location_id=${a.location_id} · type_id=${a.type_id} · 수량${a.quantity}`
                )
                .join("\n") ||
            "(전체 자산 중 행어·오피스 계열 flag 항목 0건 — 이 콥 자산엔 오피스 체인 자체가 없음)";
        steps.push({
            name: `행어·오피스 계열 전수 검색 (전체 ${assets.length}건 중 ${officeAndHangarAssets.length}건)`,
            value: truncate(`요약: ${officeSummaryLine}\n${officeLines}`),
            inline: false,
        });

        // ── (구조물:전체) 후보 전체 스캔 모드 ────────────────────
        // 구조물 하나씩 손으로 넣어가며 드릴다운하는 대신, 후보 전부를 한 번에
        // 훑어서 어디에 뭐가 얼마나 있는지 표로 보여준다.
        const isAllStructuresScan =
            structureIdOpt != null && ALL_STRUCTURES_TRIGGERS.has(String(structureIdOpt).trim());
        if (isAllStructuresScan) {
            const candidates = findStructureCandidates(assets);
            const [typeInfo, nameMap] = await Promise.all([
                fetchTypeInfoBatch(candidates.map((c) => c.type_id)),
                candidates.length > 0
                    ? fetchAssetNames(
                          corporationId,
                          accessToken,
                          candidates.map((c) => c.item_id)
                      )
                    : Promise.resolve({}),
            ]);

            const lines = candidates.map((c) => {
                const nested = collectNestedAssets(c.item_id, assets);
                const corpSag = nested.items.filter((a) =>
                    String(a.location_flag).startsWith("CorpSAG")
                ).length;
                const info = typeInfo[c.type_id];
                const isRefinery = info?.groupId === REFINERY_GROUP_ID;
                const label = nameMap[String(c.item_id)] ?? info?.name ?? `type_id=${c.type_id}`;
                const note = isRefinery ? " ⚠️Refinery(콥행어 불가)" : "";
                return `**${label}**${note}\n  item_id=${c.item_id} · 총 ${nested.items.length}건 · CorpSAG ${corpSag}건`;
            });

            steps.push({
                name: `6단계 · 구조물 전체 스캔 (${candidates.length}개)`,
                value: truncate(lines.join("\n") || "(구조물 후보 없음)"),
                inline: false,
            });

            return {
                ok: true,
                data: {
                    embed: true,
                    title: "ESI 자산 진단 — 구조물 전체 스캔",
                    description: `corporation_id=${corporationId} · characterId=${characterId}`,
                    fields: steps,
                    footer: "특정 구조물 안쪽을 더 보려면 /자산진단 구조물:<item_id> 로 드릴다운",
                    color: 0xe8a33d,
                    ephemeralReply: true,
                },
            };
        }

        // ── 6단계: 분포 요약 ────────────────────────────────────
        // 두 필터를 함께 적용한다 — "구조물 X 안에서 CorpSAG1만" 처럼 조합 가능.
        // 구조물 필터는 item_id 바로 밑(1단계) 자식만 보지 않는다 — 실제로 행어에
        // 물건이 가득 차 있는데도 1단계만 보면 0건으로 나오는 경우가 확인됐다.
        // BFS로 몇 단계든 내려가며 그 밑에 걸린 자산을 전부 모은다.
        let filtered = assets;
        let nestedInfo = null;
        if (structureIdOpt) {
            nestedInfo = collectNestedAssets(structureIdOpt, assets);
            filtered = nestedInfo.items;
        }
        if (hangarFilter) {
            filtered = filtered.filter((a) => a.location_flag === hangarFilter);
        }

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
                .map(([k, v]) => `${labelFlag(k, hangarNames)}: ${v}`)
                .join("\n") || "(없음)";
        const typeLine =
            Object.entries(byType)
                .map(([k, v]) => `${k}: ${v}`)
                .join(", ") || "(없음)";

        // CorpSAG(행어) 합계는 top-12 에서 밀려 안 보일 수 있으니 항상 따로 명시한다 —
        // "행어에 뭐가 있긴 한가?"가 이 명령의 실질적인 핵심 질문이라서다.
        const corpSagTotal = Object.entries(byFlag)
            .filter(([k]) => k.startsWith("CorpSAG"))
            .reduce((sum, [, v]) => sum + v, 0);

        const filterNote =
            [structureIdOpt && `구조물:${structureIdOpt}`, hangarFilter && `행어:${hangarFilter}`]
                .filter(Boolean)
                .join(", ") || "없음";

        const depthNote = nestedInfo
            ? `\n깊이별 건수(1단계부터): ${nestedInfo.depthCounts.join(", ") || "0"} (최대 ${nestedInfo.maxDepthReached}단계까지 탐색)`
            : "";

        steps.push({
            name: "6단계 · 분포 요약",
            value: truncate(
                `필터: ${filterNote}\n` +
                    `대상 ${filtered.length}건 · is_singleton=true ${singletonCount}건${depthNote}\n` +
                    `**CorpSAG(행어) 계열 합계: ${corpSagTotal}건**\n` +
                    `location_type: ${typeLine}\n` +
                    `location_flag 상위 12:\n${topFlags}`
            ),
            inline: false,
        });

        // ── 7단계: 샘플 원본 ────────────────────────────────────
        const sample = filtered.slice(0, 3);
        steps.push({
            name: `7단계 · 샘플 (앞 ${sample.length}개, 전체는 워커 로그)`,
            value: truncate("```json\n" + JSON.stringify(sample, null, 2) + "\n```"),
            inline: false,
        });

        // ── 8단계: 구조물(건물) 후보 목록 ───────────────────────
        // 필터와 무관하게 항상 전체 assets 기준으로 찾는다 — "다음에 뭘 구조물 옵션으로
        // 넣어야 하는지" 알려주는 안내 단계라서다.
        const structureCandidates = findStructureCandidates(assets);
        const [structureNames, structureTypeInfo] = await Promise.all([
            structureCandidates.length > 0
                ? fetchAssetNames(
                      corporationId,
                      accessToken,
                      structureCandidates.map((a) => a.item_id)
                  )
                : Promise.resolve({}),
            fetchTypeInfoBatch(structureCandidates.map((a) => a.type_id)),
        ]);
        const structureLines =
            structureCandidates
                .map((a) => {
                    const customName = structureNames[String(a.item_id)];
                    const info = structureTypeInfo[a.type_id];
                    const typeLabel = info?.name ?? `type_id=${a.type_id}`;
                    const refineryNote = info?.groupId === REFINERY_GROUP_ID ? " ⚠️Refinery" : "";
                    return `${a.item_id} · ${typeLabel}${refineryNote}${customName ? ` · ${customName}` : ""}`;
                })
                .join("\n") || "(location_type=solar_system 인 항목 없음)";

        steps.push({
            name: `8단계 · 구조물 후보 (${structureCandidates.length}개)`,
            value: truncate(structureLines),
            inline: false,
        });

        // ── 9단계: 성계 내 solar_system 자산 전체(제외 필터 미적용) ──────
        // 8단계는 POCO/POS타워/Refinery 등 콥 행어가 없다고 판단한 걸 미리 뺀
        // 목록이다. 그 판단이 틀렸거나 놓친 종류가 있을 수 있으니, 필터 없이
        // location_type=solar_system 인 전체 자산을 실제 anchored된 성계
        // (location_id)별·type_id별로 집계해서 있는 그대로 보여준다.
        const allSystemAssets = assets.filter((a) => a.location_type === "solar_system");
        const allSystemTypeInfo = await fetchTypeInfoBatch(allSystemAssets.map((a) => a.type_id));
        const bySystem = {};
        for (const a of allSystemAssets) {
            const sysId = String(a.location_id);
            (bySystem[sysId] ??= []).push(a);
        }
        const systemLines =
            Object.entries(bySystem)
                .map(([sysId, items]) => {
                    const byTypeCount = {};
                    for (const a of items) {
                        const label = allSystemTypeInfo[a.type_id]?.name ?? `type_id=${a.type_id}`;
                        byTypeCount[label] = (byTypeCount[label] ?? 0) + 1;
                    }
                    const typeSummary = Object.entries(byTypeCount)
                        .map(([label, count]) => `${label} x${count}`)
                        .join(", ");
                    return `성계 location_id=${sysId} · 총 ${items.length}건\n  ${typeSummary}`;
                })
                .join("\n") || "(없음)";

        steps.push({
            name: `9단계 · 성계별 solar_system 자산 전체 (${allSystemAssets.length}건, 제외 필터 미적용)`,
            value: truncate(systemLines),
            inline: false,
        });

        // ── 10단계: Cargo/SecondaryStorage 내용물 확인 ──────────────
        // 공식 스펙엔 Cargo/SecondaryStorage 각각이 정확히 뭘 뜻하는지 설명이
        // 없다. 콥 행어 카테고리(드론/모듈/탄약/차지&스크립트/PI/마약/필라/
        // 학습지 등)와 겹치는 아이템인지, 실제 이름을 까서 직접 비교해본다.
        const cargoLikeAssets = assets.filter(
            (a) => a.location_flag === "Cargo" || a.location_flag === "SecondaryStorage"
        );
        const cargoLikeTypeInfo = await fetchTypeInfoBatch(cargoLikeAssets.map((a) => a.type_id));
        // location_id(구조물)별로 나열하면 관제타워 스트론튬처럼 "같은 아이템이
        // 구조물마다 1개씩"인 경우 줄만 잔뜩 늘어나 중략에 밀려 정작 필요한
        // 정보가 안 보인다. (flag, 아이템 이름)으로 묶어 총 개수 + 흩어진
        // 구조물 수만 압축해서 보여준다.
        const byFlagThenName = {};
        for (const a of cargoLikeAssets) {
            const byName = (byFlagThenName[a.location_flag] ??= {});
            const name = cargoLikeTypeInfo[a.type_id]?.name ?? `type_id=${a.type_id}`;
            const entry = (byName[name] ??= { count: 0, locationIds: new Set() });
            entry.count += 1;
            entry.locationIds.add(String(a.location_id));
        }
        const cargoLines =
            Object.entries(byFlagThenName)
                .map(([flag, byName]) => {
                    const nameLines = Object.entries(byName)
                        .map(
                            ([name, { count, locationIds }]) =>
                                `  ${name} x${count} (구조물 ${locationIds.size}곳)`
                        )
                        .join("\n");
                    return `${flag}:\n${nameLines}`;
                })
                .join("\n") || "(없음)";

        steps.push({
            name: `10단계 · Cargo/SecondaryStorage 내용물 (${cargoLikeAssets.length}건)`,
            value: truncate(cargoLines),
            inline: false,
        });

        return {
            ok: true,
            data: {
                embed: true,
                title: "ESI 자산 진단",
                description: `corporation_id=${corporationId} · characterId=${characterId}`,
                fields: steps,
                footer: "예: /자산진단 구조물:1038625987360 행어:CorpSAG1 — 7단계 후보의 item_id를 구조물에 넣으면 그 안쪽만 봅니다.",
                color: 0xe8a33d,
                ephemeralReply: true,
            },
        };
    },
};
