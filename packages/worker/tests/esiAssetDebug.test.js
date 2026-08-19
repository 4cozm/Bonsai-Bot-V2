// packages/worker/tests/esiAssetDebug.test.js
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockGetAccessTokenForCharacter = jest.fn();
const mockParseAnchorCharIds = jest.fn();

await jest.unstable_mockModule("@bonsai/shared", () => ({
    parseAnchorCharIds: mockParseAnchorCharIds,
    getAccessTokenForCharacter: mockGetAccessTokenForCharacter,
    logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

const { default: esiAssetDebug } = await import("../src/commands/esiAssetDebug.js");

const ALLOWED_DISCORD_ID = "378543198953406464";
const CORP_ID = 98705746;

function jwtWithScopes(scopes) {
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ scp: scopes })).toString("base64url");
    return `${header}.${payload}.sig`;
}

const STRUCTURE_ITEM_ID = 1051025995560;
const OFFICE_ITEM_ID = 999888777;

// 구조물 바로 밑(1단계)이 아니라 사무실 컨테이너를 한 단계 더 거쳐 CorpSAG 행이
// 붙어 있는 실제 케이스를 재현한다 — 이게 이전 버전(location_id 직접 비교)에서
// 0건으로 잘못 나오던 원인이다.
function buildNestedAssets() {
    return [
        {
            item_id: STRUCTURE_ITEM_ID,
            type_id: 35833,
            location_id: 30000142,
            location_type: "solar_system",
            location_flag: "AutoFit",
            is_singleton: true,
        },
        {
            item_id: OFFICE_ITEM_ID,
            type_id: 27,
            location_id: STRUCTURE_ITEM_ID,
            location_type: "item",
            location_flag: "OfficeFolder",
            is_singleton: true,
        },
        {
            item_id: 1,
            type_id: 34,
            location_id: OFFICE_ITEM_ID,
            location_type: "item",
            location_flag: "CorpSAG1",
            is_singleton: false,
        },
        {
            item_id: 2,
            type_id: 35,
            location_id: OFFICE_ITEM_ID,
            location_type: "item",
            location_flag: "CorpSAG1",
            is_singleton: false,
        },
    ];
}

function mockFetchSequence({ assets, divisionsOk = true, namesOk = true }) {
    global.fetch = jest.fn(async (url) => {
        const u = String(url);
        if (u.includes("/assets/?")) {
            return {
                ok: true,
                headers: { get: () => "1" },
                json: async () => assets,
            };
        }
        if (u.includes("/divisions/?")) {
            return divisionsOk
                ? { ok: true, json: async () => ({ hangar: [{ division: 1, name: "탄약" }] }) }
                : { ok: false, status: 403 };
        }
        if (u.includes("/assets/names/")) {
            return namesOk
                ? { ok: true, json: async () => [{ item_id: STRUCTURE_ITEM_ID, name: "포티자" }] }
                : {
                      ok: false,
                      status: 404,
                      text: async () => '{"error":"Invalid IDs in the request"}',
                  };
        }
        if (u.includes("/universe/types/")) {
            return { ok: true, json: async () => ({ name: "Fortizar", group_id: 1657 }) };
        }
        return { ok: false, status: 404, text: async () => "" };
    });
}

describe("worker/commands/esiAssetDebug", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.EVE_ANCHOR_CHARIDS = `${CORP_ID}:2118088983`;
        mockParseAnchorCharIds.mockReturnValue([
            { corporationId: CORP_ID, characterId: 2118088983n },
        ]);
        mockGetAccessTokenForCharacter.mockResolvedValue(
            jwtWithScopes(["esi-assets.read_corporation_assets.v1"])
        );
    });

    test("허용되지 않은 유저 → ok:false, ephemeral", async () => {
        const ctx = { prisma: {} };
        const envelope = { meta: { discordUserId: "111" }, args: "{}" };
        const out = await esiAssetDebug.execute(ctx, envelope);
        expect(out.ok).toBe(false);
        expect(out.data.ephemeralReply).toBe(true);
    });

    test("토큰 확보 실패: eveCharacter row 자체가 없으면 그 이유를 명시한다", async () => {
        mockGetAccessTokenForCharacter.mockResolvedValue(null);
        const ctx = {
            prisma: { eveCharacter: { findUnique: jest.fn().mockResolvedValue(null) } },
        };
        const envelope = { meta: { discordUserId: ALLOWED_DISCORD_ID }, args: "{}" };

        const out = await esiAssetDebug.execute(ctx, envelope);

        expect(out.ok).toBe(false);
        expect(out.data.description).toContain("row 자체가 없음");
    });

    test("토큰 확보 실패: row는 있는데 토큰 필드가 비어있으면 그 이유를 명시한다", async () => {
        mockGetAccessTokenForCharacter.mockResolvedValue(null);
        const ctx = {
            prisma: {
                eveCharacter: {
                    findUnique: jest.fn().mockResolvedValue({
                        characterId: 2118088983n,
                        accessToken: null,
                        refreshToken: null,
                        tokenExpiresAt: null,
                    }),
                },
            },
        };
        const envelope = { meta: { discordUserId: ALLOWED_DISCORD_ID }, args: "{}" };

        const out = await esiAssetDebug.execute(ctx, envelope);

        expect(out.ok).toBe(false);
        expect(out.data.description).toContain("토큰 필드가 비어있음");
    });

    test("구조물 필터: 사무실 컨테이너를 한 단계 더 거친 CorpSAG 항목도 찾는다(깊이 무관 BFS)", async () => {
        mockFetchSequence({ assets: buildNestedAssets() });
        const ctx = { prisma: {} };
        const envelope = {
            meta: { discordUserId: ALLOWED_DISCORD_ID },
            args: JSON.stringify({ 구조물: String(STRUCTURE_ITEM_ID) }),
        };

        const out = await esiAssetDebug.execute(ctx, envelope);

        expect(out.ok).toBe(true);
        const summary = out.data.fields.find((f) => f.name === "6단계 · 분포 요약");
        expect(summary.value).toContain("CorpSAG(행어) 계열 합계: 2건");
        expect(summary.value).toContain("대상 3건");
    });

    test("구조물:전체 → 후보별 CorpSAG 합계를 스캔해서 보여준다", async () => {
        mockFetchSequence({ assets: buildNestedAssets() });
        const ctx = { prisma: {} };
        const envelope = {
            meta: { discordUserId: ALLOWED_DISCORD_ID },
            args: JSON.stringify({ 구조물: "전체" }),
        };

        const out = await esiAssetDebug.execute(ctx, envelope);

        expect(out.ok).toBe(true);
        const scan = out.data.fields.find((f) => f.name.startsWith("6단계 · 구조물 전체 스캔"));
        expect(scan).toBeDefined();
        expect(scan.value).toContain(`item_id=${STRUCTURE_ITEM_ID}`);
        expect(scan.value).toContain("CorpSAG 2건");
    });

    test("행어·오피스 계열 전수 검색: top-12 컷과 무관하게 전체에서 직접 찾는다", async () => {
        mockFetchSequence({ assets: buildNestedAssets() });
        const ctx = { prisma: {} };
        const envelope = { meta: { discordUserId: ALLOWED_DISCORD_ID }, args: "{}" };

        const out = await esiAssetDebug.execute(ctx, envelope);

        expect(out.ok).toBe(true);
        const officeScan = out.data.fields.find((f) =>
            f.name.startsWith("행어·오피스 계열 전수 검색")
        );
        expect(officeScan).toBeDefined();
        expect(officeScan.name).toContain("3건");
        expect(officeScan.value).toContain(`item_id=${OFFICE_ITEM_ID}`);
        expect(officeScan.value).toContain("CorpSAG1");
    });

    // 회귀 테스트: 조립 안 된(포장, is_singleton=false) 함선은 타입명만 표시되고
    // 커스텀명 있는 조립된 함선과는 별개로 잡힌다 — 실제로 이걸 못 찾아서
    // "인게임엔 5개인데 사이트엔 4개"로 보이는 문제를 진단하다가 검색 필터를
    // 추가했다. 건수가 많아 필드가 잘려도 검색어로 원하는 것만 볼 수 있어야 한다.
    test("검색 옵션: 타입명/커스텀명 부분일치로 좁히고, 매칭 안 되는 항목은 안 보여준다", async () => {
        const PACKAGED_ISHTAR_ID = 601;
        const PACKAGED_LOKI_ID = 602;
        const assets = [
            ...buildNestedAssets(),
            {
                item_id: PACKAGED_ISHTAR_ID,
                type_id: 12005, // Ishtar
                location_id: OFFICE_ITEM_ID,
                location_type: "item",
                location_flag: "CorpSAG5",
                is_singleton: false, // 조립 안 됨(포장) — 이름 지정 불가
                quantity: 1,
            },
            {
                item_id: PACKAGED_LOKI_ID,
                type_id: 29990, // Loki
                location_id: OFFICE_ITEM_ID,
                location_type: "item",
                location_flag: "CorpSAG5",
                is_singleton: false,
                quantity: 1,
            },
        ];
        global.fetch = jest.fn(async (url) => {
            const u = String(url);
            if (u.includes("/assets/?")) {
                return { ok: true, headers: { get: () => "1" }, json: async () => assets };
            }
            if (u.includes("/divisions/")) {
                return { ok: true, json: async () => ({ hangar: [] }) };
            }
            if (u.includes("/assets/names/")) {
                return { ok: true, json: async () => [] };
            }
            if (u.includes("/universe/types/12005/")) {
                return { ok: true, json: async () => ({ name: "Ishtar", group_id: 26 }) };
            }
            if (u.includes("/universe/types/29990/")) {
                return { ok: true, json: async () => ({ name: "Loki", group_id: 358 }) };
            }
            if (u.includes("/universe/types/")) {
                return { ok: true, json: async () => ({ name: "Fortizar", group_id: 1657 }) };
            }
            return { ok: false, status: 404, text: async () => "" };
        });
        const ctx = { prisma: {} };
        const envelope = {
            meta: { discordUserId: ALLOWED_DISCORD_ID },
            args: JSON.stringify({ 검색: "ishtar" }), // 대소문자 무시 확인 겸 소문자로
        };

        const out = await esiAssetDebug.execute(ctx, envelope);

        expect(out.ok).toBe(true);
        const officeScan = out.data.fields.find((f) =>
            f.name.startsWith("행어·오피스 계열 전수 검색")
        );
        expect(officeScan.name).toContain("검색:ishtar");
        expect(officeScan.name).toContain("1건");
        expect(officeScan.value).toContain(`item_id=${PACKAGED_ISHTAR_ID}`);
        expect(officeScan.value).toContain("Ishtar");
        expect(officeScan.value).not.toContain(`item_id=${PACKAGED_LOKI_ID}`);
        expect(officeScan.value).not.toContain("Loki");
    });

    // 회귀 테스트: 표시는 language=ko라 타입명이 "이슈타르"처럼 한글로 나오는데,
    // 실제로 콥원들은 "Ishtar"처럼 영문으로 검색한다 — 한글 라벨만 매칭하면
    // 진짜 있는데도 0건으로 나오는 문제를 실측으로 겪고 고쳤다.
    test("검색 옵션: 표시는 한글이어도 영문 타입명으로 검색하면 매칭된다", async () => {
        const PACKAGED_ISHTAR_ID = 601;
        const assets = [
            ...buildNestedAssets(),
            {
                item_id: PACKAGED_ISHTAR_ID,
                type_id: 12005, // Ishtar
                location_id: OFFICE_ITEM_ID,
                location_type: "item",
                location_flag: "CorpSAG5",
                is_singleton: false,
                quantity: 1,
            },
        ];
        global.fetch = jest.fn(async (url) => {
            const u = String(url);
            if (u.includes("/assets/?")) {
                return { ok: true, headers: { get: () => "1" }, json: async () => assets };
            }
            if (u.includes("/divisions/")) {
                return { ok: true, json: async () => ({ hangar: [] }) };
            }
            if (u.includes("/assets/names/")) {
                return { ok: true, json: async () => [] };
            }
            if (u.includes("/universe/types/12005/") && u.includes("language=ko")) {
                return { ok: true, json: async () => ({ name: "이슈타르", group_id: 26 }) };
            }
            if (u.includes("/universe/types/12005/") && u.includes("language=en")) {
                return { ok: true, json: async () => ({ name: "Ishtar", group_id: 26 }) };
            }
            if (u.includes("/universe/types/")) {
                return { ok: true, json: async () => ({ name: "Fortizar", group_id: 1657 }) };
            }
            return { ok: false, status: 404, text: async () => "" };
        });
        const ctx = { prisma: {} };
        const envelope = {
            meta: { discordUserId: ALLOWED_DISCORD_ID },
            args: JSON.stringify({ 검색: "Ishtar" }),
        };

        const out = await esiAssetDebug.execute(ctx, envelope);

        expect(out.ok).toBe(true);
        const officeScan = out.data.fields.find((f) =>
            f.name.startsWith("행어·오피스 계열 전수 검색")
        );
        expect(officeScan.name).toContain("1건");
        expect(officeScan.value).toContain(`item_id=${PACKAGED_ISHTAR_ID}`);
        expect(officeScan.value).toContain("이슈타르"); // 표시 라벨은 여전히 한글
    });

    // 회귀 테스트: 실측으로 겪은 버그 — 커스텀명에 밑줄(_)이 하나씩만 있어도, 한
    // 필드 안에 그런 줄이 여러 개 섞이면 Discord가 줄을 넘나들며 밑줄들을 기울임
    // 마크다운 시작/끝으로 짝지어 먹어버려서 실제로 있는 밑줄이 화면에서 사라져
    // 보였다("이_드론용"이 "이드론용"으로 보임). 밑줄 앞에 백슬래시를 붙여
    // 이스케이프하면 Discord가 문자 그대로 보여준다.
    test("커스텀명에 마크다운 특수문자(밑줄)가 있으면 이스케이프해서 보여준다", async () => {
        const SHIP_A_ID = 701;
        const SHIP_B_ID = 702;
        const assets = [
            ...buildNestedAssets(),
            {
                item_id: SHIP_A_ID,
                type_id: 12005,
                location_id: OFFICE_ITEM_ID,
                location_type: "item",
                location_flag: "CorpSAG5",
                is_singleton: true,
                quantity: 1,
            },
            {
                item_id: SHIP_B_ID,
                type_id: 12005,
                location_id: OFFICE_ITEM_ID,
                location_type: "item",
                location_flag: "CorpSAG5",
                is_singleton: true,
                quantity: 1,
            },
        ];
        global.fetch = jest.fn(async (url, opts) => {
            const u = String(url);
            if (u.includes("/assets/?")) {
                return { ok: true, headers: { get: () => "1" }, json: async () => assets };
            }
            if (u.includes("/divisions/")) {
                return { ok: true, json: async () => ({ hangar: [] }) };
            }
            if (u.includes("/assets/names/")) {
                const ids = JSON.parse(opts.body);
                const rows = [];
                if (ids.includes(SHIP_A_ID)) rows.push({ item_id: SHIP_A_ID, name: "이_드론용" });
                if (ids.includes(SHIP_B_ID)) rows.push({ item_id: SHIP_B_ID, name: "이_드론용2" });
                return { ok: true, json: async () => rows };
            }
            if (u.includes("/universe/types/12005/")) {
                return { ok: true, json: async () => ({ name: "이슈타르", group_id: 26 }) };
            }
            return { ok: false, status: 404, text: async () => "" };
        });
        const ctx = { prisma: {} };
        const envelope = {
            meta: { discordUserId: ALLOWED_DISCORD_ID },
            args: JSON.stringify({ 검색: "이슈타르" }),
        };

        const out = await esiAssetDebug.execute(ctx, envelope);

        expect(out.ok).toBe(true);
        const officeScan = out.data.fields.find((f) =>
            f.name.startsWith("행어·오피스 계열 전수 검색")
        );
        expect(officeScan.name).toContain("2건");
        // 밑줄 앞에 백슬래시가 붙어 이스케이프된 형태로 나와야 한다.
        expect(officeScan.value).toContain('이\\_드론용2"');
        expect(officeScan.value).toContain('이\\_드론용"');
        // 이스케이프 안 된 원본 그대로(바로 뒤에 닫는 따옴표)는 없어야 한다 —
        // "이_드론용2" 안에 "이_드론용"이 부분 문자열로 겹쳐서, 딱 그 형태(뒤에
        // 바로 "가 오는)로 정확히 매칭되는지를 확인해야 이스케이프 여부를 가릴 수 있다.
        expect(officeScan.value).not.toContain('이_드론용"');
    });

    test("검색 옵션: 매칭되는 게 없으면 0건이라고 명시한다", async () => {
        mockFetchSequence({ assets: buildNestedAssets() });
        const ctx = { prisma: {} };
        const envelope = {
            meta: { discordUserId: ALLOWED_DISCORD_ID },
            args: JSON.stringify({ 검색: "존재하지않는이름ZZZ" }),
        };

        const out = await esiAssetDebug.execute(ctx, envelope);

        expect(out.ok).toBe(true);
        const officeScan = out.data.fields.find((f) =>
            f.name.startsWith("행어·오피스 계열 전수 검색")
        );
        expect(officeScan.value).toContain("존재하지않는이름ZZZ");
        expect(officeScan.value).toContain("검색 결과 0건");
    });

    test("함선처럼 커스텀 이름이 붙은 아이템은 타입 이름과 커스텀 이름을 같이 보여준다", async () => {
        const SHIP_ITEM_ID = 777000111;
        const assets = [
            ...buildNestedAssets(),
            {
                item_id: SHIP_ITEM_ID,
                type_id: 47466, // Praxis
                location_id: OFFICE_ITEM_ID,
                location_type: "item",
                location_flag: "CorpSAG6",
                is_singleton: true,
                quantity: 1,
            },
        ];
        global.fetch = jest.fn(async (url) => {
            const u = String(url);
            if (u.includes("/assets/?")) {
                return { ok: true, headers: { get: () => "1" }, json: async () => assets };
            }
            if (u.includes("/divisions/")) {
                return { ok: true, json: async () => ({ hangar: [] }) };
            }
            if (u.includes("/assets/names/")) {
                return {
                    ok: true,
                    json: async () => [{ item_id: SHIP_ITEM_ID, name: "Praxis - Shield RR" }],
                };
            }
            if (u.includes("/universe/types/")) {
                return { ok: true, json: async () => ({ name: "Praxis", group_id: 513 }) };
            }
            return { ok: false, status: 404, text: async () => "" };
        });
        const ctx = { prisma: {} };
        const envelope = { meta: { discordUserId: ALLOWED_DISCORD_ID }, args: "{}" };

        const out = await esiAssetDebug.execute(ctx, envelope);

        expect(out.ok).toBe(true);
        const officeScan = out.data.fields.find((f) =>
            f.name.startsWith("행어·오피스 계열 전수 검색")
        );
        expect(officeScan.value).toContain(`Praxis · 커스텀명:"Praxis - Shield RR"`);
    });

    test("ESI가 이름 목록에서 그 item_id를 아예 안 준 경우와 이름이 기본값 그대로인 경우를 구분한다", async () => {
        const NO_NAME_ITEM_ID = 777000222;
        const DEFAULT_NAME_ITEM_ID = 777000333;
        const assets = [
            ...buildNestedAssets(),
            {
                item_id: NO_NAME_ITEM_ID,
                type_id: 47466,
                location_id: OFFICE_ITEM_ID,
                location_type: "item",
                location_flag: "CorpSAG6",
                is_singleton: true,
                quantity: 1,
            },
            {
                item_id: DEFAULT_NAME_ITEM_ID,
                type_id: 47466,
                location_id: OFFICE_ITEM_ID,
                location_type: "item",
                location_flag: "CorpSAG6",
                is_singleton: true,
                quantity: 1,
            },
        ];
        global.fetch = jest.fn(async (url) => {
            const u = String(url);
            if (u.includes("/assets/?")) {
                return { ok: true, headers: { get: () => "1" }, json: async () => assets };
            }
            if (u.includes("/divisions/")) {
                return { ok: true, json: async () => ({ hangar: [] }) };
            }
            if (u.includes("/assets/names/")) {
                // NO_NAME_ITEM_ID는 응답 배열에 아예 없음 — DEFAULT_NAME_ITEM_ID만
                // 타입명과 똑같은 이름으로 옴(개명 안 한 함선의 실제 ESI 동작 재현).
                return {
                    ok: true,
                    json: async () => [{ item_id: DEFAULT_NAME_ITEM_ID, name: "Praxis" }],
                };
            }
            if (u.includes("/universe/types/")) {
                return { ok: true, json: async () => ({ name: "Praxis", group_id: 513 }) };
            }
            return { ok: false, status: 404, text: async () => "" };
        });
        const ctx = { prisma: {} };
        const envelope = { meta: { discordUserId: ALLOWED_DISCORD_ID }, args: "{}" };

        const out = await esiAssetDebug.execute(ctx, envelope);

        expect(out.ok).toBe(true);
        const officeScan = out.data.fields.find((f) =>
            f.name.startsWith("행어·오피스 계열 전수 검색")
        );
        expect(officeScan.value).toContain(`item_id=${NO_NAME_ITEM_ID}`);
        expect(officeScan.value).toContain("(ESI 이름 응답 없음)");
        expect(officeScan.value).toContain(`item_id=${DEFAULT_NAME_ITEM_ID}`);
        expect(officeScan.value).toContain("(기본값 그대로)");
    });

    test("스택형(is_singleton=false) 아이템은 이름 조회 대상에서 빠지고 타입명만 표시된다", async () => {
        const STACK_ITEM_ID = 777000444;
        const requestedIds = [];
        const assets = [
            ...buildNestedAssets(),
            {
                item_id: STACK_ITEM_ID,
                type_id: 34,
                location_id: OFFICE_ITEM_ID,
                location_type: "item",
                location_flag: "CorpSAG1",
                is_singleton: false,
                quantity: 500,
            },
        ];
        global.fetch = jest.fn(async (url, init) => {
            const u = String(url);
            if (u.includes("/assets/?")) {
                return { ok: true, headers: { get: () => "1" }, json: async () => assets };
            }
            if (u.includes("/divisions/")) {
                return { ok: true, json: async () => ({ hangar: [] }) };
            }
            if (u.includes("/assets/names/")) {
                requestedIds.push(...JSON.parse(init.body));
                return { ok: true, json: async () => [] };
            }
            if (u.includes("/universe/types/")) {
                return { ok: true, json: async () => ({ name: "트리튬", group_id: 18 }) };
            }
            return { ok: false, status: 404, text: async () => "" };
        });
        const ctx = { prisma: {} };
        const envelope = { meta: { discordUserId: ALLOWED_DISCORD_ID }, args: "{}" };

        const out = await esiAssetDebug.execute(ctx, envelope);

        expect(out.ok).toBe(true);
        // /assets/names/ 요청에 스택형 아이템의 item_id가 섞이면 안 된다 —
        // 섞이면 청크 전체가 404로 실패한다(실측으로 확인된 ESI 동작).
        expect(requestedIds).not.toContain(STACK_ITEM_ID);
        const officeScan = out.data.fields.find((f) =>
            f.name.startsWith("행어·오피스 계열 전수 검색")
        );
        expect(officeScan.value).toContain(`item_id=${STACK_ITEM_ID}`);
        expect(officeScan.value).not.toContain(`item_id=${STACK_ITEM_ID} (ESI 이름 응답 없음)`);
    });

    test("assets/names/ 청크가 실패하면 조용히 무시하지 않고 경고로 보여준다", async () => {
        mockFetchSequence({ assets: buildNestedAssets(), namesOk: false });
        const ctx = { prisma: {} };
        const envelope = { meta: { discordUserId: ALLOWED_DISCORD_ID }, args: "{}" };

        const out = await esiAssetDebug.execute(ctx, envelope);

        expect(out.ok).toBe(true);
        const officeScan = out.data.fields.find((f) =>
            f.name.startsWith("행어·오피스 계열 전수 검색")
        );
        expect(officeScan.value).toContain("/assets/names/ 요청");
        expect(officeScan.value).toContain("실패");
    });

    test("Impounded/AssetSafety 처럼 CorpSAG가 아닌 행어 인접 flag도 잡아낸다", async () => {
        const impoundedAssets = [
            {
                item_id: 5,
                type_id: 34,
                location_id: STRUCTURE_ITEM_ID,
                location_type: "item",
                location_flag: "Impounded",
                is_singleton: false,
                quantity: 10,
            },
        ];
        mockFetchSequence({ assets: impoundedAssets });
        const ctx = { prisma: {} };
        const envelope = { meta: { discordUserId: ALLOWED_DISCORD_ID }, args: "{}" };

        const out = await esiAssetDebug.execute(ctx, envelope);

        expect(out.ok).toBe(true);
        const officeScan = out.data.fields.find((f) =>
            f.name.startsWith("행어·오피스 계열 전수 검색")
        );
        expect(officeScan.name).toContain("1건");
        expect(officeScan.value).toContain("Impounded");
    });

    test("행어·오피스 계열이 전체 자산에 하나도 없으면 0건으로 명시한다", async () => {
        const fittingOnlyAssets = [
            {
                item_id: STRUCTURE_ITEM_ID,
                type_id: 35833,
                location_id: 30000142,
                location_type: "solar_system",
                location_flag: "AutoFit",
                is_singleton: true,
            },
            {
                item_id: 1,
                type_id: 47140,
                location_id: STRUCTURE_ITEM_ID,
                location_type: "item",
                location_flag: "FighterTube0",
                is_singleton: true,
            },
        ];
        mockFetchSequence({ assets: fittingOnlyAssets });
        const ctx = { prisma: {} };
        const envelope = { meta: { discordUserId: ALLOWED_DISCORD_ID }, args: "{}" };

        const out = await esiAssetDebug.execute(ctx, envelope);

        expect(out.ok).toBe(true);
        const officeScan = out.data.fields.find((f) =>
            f.name.startsWith("행어·오피스 계열 전수 검색")
        );
        expect(officeScan.name).toContain("0건");
        expect(officeScan.value).toContain("행어·오피스 계열 flag 항목 0건");
    });

    test("9단계: 구조물 필터 없을 때만 성계별 solar_system 자산 전체를 보여준다", async () => {
        mockFetchSequence({ assets: buildNestedAssets() });
        const ctx = { prisma: {} };
        const envelope = { meta: { discordUserId: ALLOWED_DISCORD_ID }, args: "{}" };

        const out = await esiAssetDebug.execute(ctx, envelope);

        expect(out.ok).toBe(true);
        const systemScan = out.data.fields.find((f) => f.name.startsWith("9단계"));
        expect(systemScan).toBeDefined();
        expect(systemScan.value).toContain("성계 location_id=30000142");
        expect(systemScan.value).toContain("Fortizar x1");
    });

    test("구조물 필터를 걸면 8·9단계는 생략되고, 행어·오피스 검색도 그 구조물 범위로만 좁혀진다", async () => {
        const OTHER_STRUCTURE_ID = 999999999;
        const assets = [
            ...buildNestedAssets(),
            {
                item_id: 50,
                type_id: 99,
                location_id: OTHER_STRUCTURE_ID,
                location_type: "item",
                location_flag: "Impounded",
                is_singleton: false,
                quantity: 1,
            },
        ];
        mockFetchSequence({ assets });
        const ctx = { prisma: {} };
        const envelope = {
            meta: { discordUserId: ALLOWED_DISCORD_ID },
            args: JSON.stringify({ 구조물: String(STRUCTURE_ITEM_ID) }),
        };

        const out = await esiAssetDebug.execute(ctx, envelope);

        expect(out.ok).toBe(true);
        expect(out.data.fields.find((f) => f.name.startsWith("8단계"))).toBeUndefined();
        expect(out.data.fields.find((f) => f.name.startsWith("9단계"))).toBeUndefined();
        const officeScan = out.data.fields.find((f) =>
            f.name.startsWith("행어·오피스 계열 전수 검색")
        );
        // 구조물 필터 범위 안(OfficeFolder 1 + CorpSAG1 2 = 3건)만 잡히고, 다른
        // 구조물의 Impounded 항목은 안 섞여야 한다.
        expect(officeScan.name).toContain("3건");
        expect(officeScan.value).not.toContain("Impounded");
    });

    test("캐릭터 옵션: 지정한 characterId를 공개 ESI로 조회해 그 콥 기준으로 진행한다", async () => {
        const OTHER_CHAR_ID = "2115893596";
        const OTHER_CORP_ID = 555000111;
        global.fetch = jest.fn(async (url) => {
            const u = String(url);
            if (u.includes(`/characters/${OTHER_CHAR_ID}/`)) {
                return {
                    ok: true,
                    json: async () => ({ name: "Holding Alt", corporation_id: OTHER_CORP_ID }),
                };
            }
            if (u.includes(`/corporations/${OTHER_CORP_ID}/assets/`)) {
                return {
                    ok: true,
                    headers: { get: () => "1" },
                    json: async () => buildNestedAssets(),
                };
            }
            if (u.includes("/divisions/")) {
                return { ok: true, json: async () => ({ hangar: [] }) };
            }
            if (u.includes("/universe/types/")) {
                return { ok: true, json: async () => ({ name: "Fortizar", group_id: 1657 }) };
            }
            if (u.includes("/assets/names/")) {
                return { ok: true, json: async () => [] };
            }
            return { ok: false, status: 404, text: async () => "" };
        });
        const ctx = { prisma: {} };
        const envelope = {
            meta: { discordUserId: ALLOWED_DISCORD_ID },
            args: JSON.stringify({ 캐릭터: OTHER_CHAR_ID, 상세: true }),
        };

        const out = await esiAssetDebug.execute(ctx, envelope);

        expect(out.ok).toBe(true);
        const step1 = out.data.fields.find((f) => f.name.startsWith("1단계"));
        expect(step1.name).toContain("수동 지정");
        expect(step1.value).toContain(`corporationId=${OTHER_CORP_ID}`);
        expect(step1.value).toContain("Holding Alt");
    });

    test("캐릭터 옵션: 공개 조회 실패하면 1단계에서 바로 실패 처리한다", async () => {
        global.fetch = jest.fn(async () => ({ ok: false, status: 404 }));
        const ctx = { prisma: {} };
        const envelope = {
            meta: { discordUserId: ALLOWED_DISCORD_ID },
            args: JSON.stringify({ 캐릭터: "999" }),
        };

        const out = await esiAssetDebug.execute(ctx, envelope);

        expect(out.ok).toBe(false);
        expect(out.data.title).toContain("실패");
    });
});
