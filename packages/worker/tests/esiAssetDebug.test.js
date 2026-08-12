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
                : { ok: false };
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
