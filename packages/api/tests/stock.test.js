// packages/api/tests/stock.test.js
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockVerifySessionJwt = jest.fn();
const mockGetPrisma = jest.fn();

await jest.unstable_mockModule("@bonsai/shared", () => ({
    verifySessionJwt: mockVerifySessionJwt,
    // server.js가 auth 라우터도 같이 조립해서, 그쪽이 쓰는 export도 있어야 모듈
    // 그래프가 풀린다(이 테스트 파일에서 실제로 쓰이진 않음).
    consumeMagicLinkToken: jest.fn(),
    signSessionJwt: jest.fn(),
}));

await jest.unstable_mockModule("@bonsai/shared/db", () => ({
    getPrisma: mockGetPrisma,
}));

const { createApp } = await import("../src/server.js");
const { SESSION_COOKIE_NAME } = await import("../src/auth/session.js");

function startTestApp() {
    const log = { info: () => {}, warn: () => {}, error: () => {} };
    const app = createApp({ redis: {}, log });
    const server = app.listen(0);
    const { port } = server.address();
    return { server, baseUrl: `http://127.0.0.1:${port}` };
}

const AUTH_HEADERS = { cookie: `${SESSION_COOKIE_NAME}=valid-token` };

describe("api/routes/stock", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.STOCK_SESSION_JWT_SECRET = "test-secret";
        mockVerifySessionJwt.mockReturnValue({ discordId: "111", tenantKey: "CAT" });
    });

    test("세션 쿠키 없으면 어떤 /v1/stock/* 라우트든 401", async () => {
        const { server, baseUrl } = startTestApp();
        try {
            const res = await fetch(`${baseUrl}/v1/stock/structures`);
            expect(res.status).toBe(401);
        } finally {
            server.close();
        }
    });

    describe("GET /v1/stock/structures", () => {
        test("세션의 tenantKey로 getPrisma를 호출하고 활성 구조물만 돌려준다", async () => {
            const findMany = jest
                .fn()
                .mockResolvedValue([{ structureId: 1051025995560n, displayName: "SAVE CAT" }]);
            mockGetPrisma.mockReturnValue({ trackedStructure: { findMany } });
            const { server, baseUrl } = startTestApp();
            try {
                const res = await fetch(`${baseUrl}/v1/stock/structures`, {
                    headers: AUTH_HEADERS,
                });
                const body = await res.json();

                expect(mockGetPrisma).toHaveBeenCalledWith("CAT");
                expect(findMany).toHaveBeenCalledWith({
                    where: { active: true },
                    orderBy: { displayName: "asc" },
                });
                expect(res.status).toBe(200);
                expect(body).toEqual({
                    ok: true,
                    structures: [{ structureId: "1051025995560", displayName: "SAVE CAT" }],
                });
            } finally {
                server.close();
            }
        });
    });

    describe("GET /v1/stock/structures/:structureId/items", () => {
        test("structureId가 정수 형태가 아니면 400", async () => {
            const { server, baseUrl } = startTestApp();
            try {
                const res = await fetch(`${baseUrl}/v1/stock/structures/not-a-number/items`, {
                    headers: AUTH_HEADERS,
                });
                expect(res.status).toBe(400);
                expect(mockGetPrisma).not.toHaveBeenCalled();
            } finally {
                server.close();
            }
        });

        test("구조물이 이 테넌트 DB에 없으면 404", async () => {
            mockGetPrisma.mockReturnValue({
                trackedStructure: { findUnique: jest.fn().mockResolvedValue(null) },
            });
            const { server, baseUrl } = startTestApp();
            try {
                const res = await fetch(`${baseUrl}/v1/stock/structures/12345/items`, {
                    headers: AUTH_HEADERS,
                });
                expect(res.status).toBe(404);
            } finally {
                server.close();
            }
        });

        test("typeId별로 최신 재고(stocked)와 목표(target), 최근 이력을 묶어서 반환한다", async () => {
            const structureId = 1051025995560n;
            const findUnique = jest
                .fn()
                .mockResolvedValue({ structureId, displayName: "SAVE CAT" });
            const t1 = new Date("2026-08-13T10:00:00.000Z");
            const t2 = new Date("2026-08-13T11:00:00.000Z");
            const stockLogFindMany = jest.fn().mockResolvedValue([
                { typeId: 100, quantity: 5, sampledAt: t1 },
                { typeId: 100, quantity: 8, sampledAt: t2 },
                { typeId: 200, quantity: 3, sampledAt: t2 },
            ]);
            const stockTargetFindMany = jest
                .fn()
                .mockResolvedValue([{ typeId: 100, targetQty: 20 }]);
            mockGetPrisma.mockReturnValue({
                trackedStructure: { findUnique },
                stockLog: { findMany: stockLogFindMany },
                stockTarget: { findMany: stockTargetFindMany },
            });

            const { server, baseUrl } = startTestApp();
            try {
                const res = await fetch(`${baseUrl}/v1/stock/structures/${structureId}/items`, {
                    headers: AUTH_HEADERS,
                });
                const body = await res.json();

                expect(res.status).toBe(200);
                expect(body.structure).toEqual({
                    structureId: "1051025995560",
                    displayName: "SAVE CAT",
                    syncedAt: t2.toISOString(),
                    nextSyncAt: null,
                });

                const item100 = body.items.find((i) => i.typeId === 100);
                expect(item100.stocked).toBe(8);
                expect(item100.target).toBe(20);
                // 5 → 8 은 감소가 아니라 보급이라 소비 속도가 없다 — daysLeft는 null.
                expect(item100.daysLeft).toBeNull();
                expect(item100.recentHistory).toEqual([
                    { sampledAt: t1.toISOString(), quantity: 5 },
                    { sampledAt: t2.toISOString(), quantity: 8 },
                ]);

                const item200 = body.items.find((i) => i.typeId === 200);
                expect(item200.stocked).toBe(3);
                expect(item200.target).toBeNull();
                expect(item200.daysLeft).toBeNull();
            } finally {
                server.close();
            }
        });

        test("TrackedStructure.nextSyncAt이 있으면 그대로 전달한다", async () => {
            const structureId = 1051025995560n;
            const nextSyncAt = new Date("2026-08-16T12:30:00.000Z");
            const findUnique = jest.fn().mockResolvedValue({
                structureId,
                displayName: "SAVE CAT",
                nextSyncAt,
            });
            mockGetPrisma.mockReturnValue({
                trackedStructure: { findUnique },
                stockLog: { findMany: jest.fn().mockResolvedValue([]) },
                stockTarget: { findMany: jest.fn().mockResolvedValue([]) },
            });

            const { server, baseUrl } = startTestApp();
            try {
                const res = await fetch(`${baseUrl}/v1/stock/structures/${structureId}/items`, {
                    headers: AUTH_HEADERS,
                });
                const body = await res.json();

                expect(res.status).toBe(200);
                expect(body.structure.nextSyncAt).toBe(nextSyncAt.toISOString());
            } finally {
                server.close();
            }
        });

        test("실제로 감소 추세면 daysLeft가 계산돼서 나온다", async () => {
            const structureId = 1051025995560n;
            const findUnique = jest
                .fn()
                .mockResolvedValue({ structureId, displayName: "SAVE CAT" });
            const dayMs = 24 * 60 * 60 * 1000;
            const now = Date.now();
            const stockLogFindMany = jest.fn().mockResolvedValue([
                { typeId: 300, quantity: 100, sampledAt: new Date(now - 4 * dayMs) },
                { typeId: 300, quantity: 60, sampledAt: new Date(now - 2 * dayMs) },
            ]);
            mockGetPrisma.mockReturnValue({
                trackedStructure: { findUnique },
                stockLog: { findMany: stockLogFindMany },
                stockTarget: { findMany: jest.fn().mockResolvedValue([]) },
            });

            const { server, baseUrl } = startTestApp();
            try {
                const res = await fetch(`${baseUrl}/v1/stock/structures/${structureId}/items`, {
                    headers: AUTH_HEADERS,
                });
                const body = await res.json();

                const item300 = body.items.find((i) => i.typeId === 300);
                // 100→60, 2일 걸림 → 하루 20 소진, 남은 60개면 3일치.
                expect(item300.daysLeft).toBeCloseTo(3, 5);
            } finally {
                server.close();
            }
        });
    });

    describe("GET /v1/stock/structures/:structureId/divisions", () => {
        test("tracked:true인 규칙만 division/containerName 순으로 반환한다", async () => {
            const structureId = 1051025995560n;
            const findUnique = jest
                .fn()
                .mockResolvedValue({ structureId, displayName: "SAVE CAT" });
            const findMany = jest.fn().mockResolvedValue([
                { division: 2, containerName: "", displayName: "핸드아웃", tracked: true },
                { division: 4, containerName: "드론", displayName: "드론", tracked: true },
            ]);
            mockGetPrisma.mockReturnValue({
                trackedStructure: { findUnique },
                stockDivisionRule: { findMany },
            });

            const { server, baseUrl } = startTestApp();
            try {
                const res = await fetch(`${baseUrl}/v1/stock/structures/${structureId}/divisions`, {
                    headers: AUTH_HEADERS,
                });
                const body = await res.json();

                expect(res.status).toBe(200);
                expect(findMany).toHaveBeenCalledWith({
                    where: { structureId, tracked: true },
                    orderBy: [{ division: "asc" }, { containerName: "asc" }],
                });
                expect(body).toEqual({
                    ok: true,
                    divisions: [
                        { division: 2, containerName: null, displayName: "핸드아웃" },
                        { division: 4, containerName: "드론", displayName: "드론" },
                    ],
                });
            } finally {
                server.close();
            }
        });

        test("구조물이 없으면 404", async () => {
            mockGetPrisma.mockReturnValue({
                trackedStructure: { findUnique: jest.fn().mockResolvedValue(null) },
            });
            const { server, baseUrl } = startTestApp();
            try {
                const res = await fetch(`${baseUrl}/v1/stock/structures/12345/divisions`, {
                    headers: AUTH_HEADERS,
                });
                expect(res.status).toBe(404);
            } finally {
                server.close();
            }
        });
    });

    describe("GET /v1/stock/structures/:structureId/items?division=", () => {
        test("division 필터를 주면 다른 division의 같은 typeId는 안 섞인다", async () => {
            const structureId = 1051025995560n;
            const findUnique = jest
                .fn()
                .mockResolvedValue({ structureId, displayName: "SAVE CAT" });
            const t1 = new Date("2026-08-13T10:00:00.000Z");
            const allRows = [
                { typeId: 100, quantity: 5, sampledAt: t1, division: 3, containerName: null },
                { typeId: 100, quantity: 12, sampledAt: t1, division: 4, containerName: "드론" },
            ];
            // division/container 필터가 이제 SQL where로 내려가므로(실 MySQL이 걸러서
            // 반환) 목도 where 인자를 보고 같은 방식으로 걸러야 한다 — 안 그러면
            // "라우트가 필터를 안 거는데도 우연히 맞는 값이 나오는" 거짓양성이 생긴다.
            const stockLogFindMany = jest
                .fn()
                .mockImplementation((args) =>
                    Promise.resolve(
                        allRows.filter(
                            (r) =>
                                (args?.where?.division == null ||
                                    r.division === args.where.division) &&
                                (args?.where?.containerName == null ||
                                    r.containerName === args.where.containerName)
                        )
                    )
                );
            mockGetPrisma.mockReturnValue({
                trackedStructure: { findUnique },
                stockLog: { findMany: stockLogFindMany },
                stockTarget: { findMany: jest.fn().mockResolvedValue([]) },
            });

            const { server, baseUrl } = startTestApp();
            try {
                const res = await fetch(
                    `${baseUrl}/v1/stock/structures/${structureId}/items?division=4&container=드론`,
                    { headers: AUTH_HEADERS }
                );
                const body = await res.json();

                expect(res.status).toBe(200);
                expect(body.items).toHaveLength(1);
                expect(body.items[0]).toMatchObject({ typeId: 100, stocked: 12 });
            } finally {
                server.close();
            }
        });

        test("division 필터 없으면 같은 typeId의 여러 division 값을 시점별로 합산한다", async () => {
            const structureId = 1051025995560n;
            const findUnique = jest
                .fn()
                .mockResolvedValue({ structureId, displayName: "SAVE CAT" });
            const t1 = new Date("2026-08-13T10:00:00.000Z");
            const stockLogFindMany = jest.fn().mockResolvedValue([
                { typeId: 100, quantity: 5, sampledAt: t1, division: 3, containerName: null },
                { typeId: 100, quantity: 12, sampledAt: t1, division: 4, containerName: "드론" },
            ]);
            mockGetPrisma.mockReturnValue({
                trackedStructure: { findUnique },
                stockLog: { findMany: stockLogFindMany },
                stockTarget: { findMany: jest.fn().mockResolvedValue([]) },
            });

            const { server, baseUrl } = startTestApp();
            try {
                const res = await fetch(`${baseUrl}/v1/stock/structures/${structureId}/items`, {
                    headers: AUTH_HEADERS,
                });
                const body = await res.json();

                expect(body.items).toHaveLength(1);
                expect(body.items[0]).toMatchObject({ typeId: 100, stocked: 17 });
            } finally {
                server.close();
            }
        });

        test("division 없이 container만 줘도 그 컨테이너로만 좁힌다", async () => {
            const structureId = 1051025995560n;
            const findUnique = jest
                .fn()
                .mockResolvedValue({ structureId, displayName: "SAVE CAT" });
            const t1 = new Date("2026-08-13T10:00:00.000Z");
            const allRows = [
                { typeId: 100, quantity: 5, sampledAt: t1, division: 3, containerName: null },
                { typeId: 100, quantity: 12, sampledAt: t1, division: 4, containerName: "드론" },
            ];
            const stockLogFindMany = jest
                .fn()
                .mockImplementation((args) =>
                    Promise.resolve(
                        allRows.filter(
                            (r) =>
                                (args?.where?.division == null ||
                                    r.division === args.where.division) &&
                                (args?.where?.containerName == null ||
                                    r.containerName === args.where.containerName)
                        )
                    )
                );
            mockGetPrisma.mockReturnValue({
                trackedStructure: { findUnique },
                stockLog: { findMany: stockLogFindMany },
                stockTarget: { findMany: jest.fn().mockResolvedValue([]) },
            });

            const { server, baseUrl } = startTestApp();
            try {
                const res = await fetch(
                    `${baseUrl}/v1/stock/structures/${structureId}/items?container=드론`,
                    { headers: AUTH_HEADERS }
                );
                const body = await res.json();

                expect(body.items).toHaveLength(1);
                expect(body.items[0]).toMatchObject({ typeId: 100, stocked: 12 });
            } finally {
                server.close();
            }
        });

        // 회귀 테스트: division/container 필터를 30일치 전체를 긁은 뒤 JS에서
        // 거르지 않고 SQL where로 직접 내려서, 아이템이 많은 구조물에서 특정
        // 행어만 볼 때 DB가 애초에 좁혀서 반환하게 한다(성능 문제 실측 후 개선).
        test("division/container 필터가 stockLog.findMany where절에 그대로 실린다", async () => {
            const structureId = 1051025995560n;
            const findUnique = jest
                .fn()
                .mockResolvedValue({ structureId, displayName: "SAVE CAT" });
            const stockLogFindMany = jest.fn().mockResolvedValue([]);
            mockGetPrisma.mockReturnValue({
                trackedStructure: { findUnique },
                stockLog: { findMany: stockLogFindMany },
                stockTarget: { findMany: jest.fn().mockResolvedValue([]) },
            });

            const { server, baseUrl } = startTestApp();
            try {
                await fetch(
                    `${baseUrl}/v1/stock/structures/${structureId}/items?division=4&container=드론`,
                    { headers: AUTH_HEADERS }
                );

                expect(stockLogFindMany).toHaveBeenCalledWith(
                    expect.objectContaining({
                        where: expect.objectContaining({
                            structureId,
                            division: 4,
                            containerName: "드론",
                        }),
                    })
                );
            } finally {
                server.close();
            }
        });

        test("필터가 없으면 stockLog.findMany where절에 division/containerName이 안 실린다", async () => {
            const structureId = 1051025995560n;
            const findUnique = jest
                .fn()
                .mockResolvedValue({ structureId, displayName: "SAVE CAT" });
            const stockLogFindMany = jest.fn().mockResolvedValue([]);
            mockGetPrisma.mockReturnValue({
                trackedStructure: { findUnique },
                stockLog: { findMany: stockLogFindMany },
                stockTarget: { findMany: jest.fn().mockResolvedValue([]) },
            });

            const { server, baseUrl } = startTestApp();
            try {
                await fetch(`${baseUrl}/v1/stock/structures/${structureId}/items`, {
                    headers: AUTH_HEADERS,
                });

                const call = stockLogFindMany.mock.calls[0][0];
                expect(call.where).not.toHaveProperty("division");
                expect(call.where).not.toHaveProperty("containerName");
            } finally {
                server.close();
            }
        });

        test("division 쿼리가 정수가 아니면 400", async () => {
            const { server, baseUrl } = startTestApp();
            try {
                const res = await fetch(
                    `${baseUrl}/v1/stock/structures/1051025995560/items?division=abc`,
                    { headers: AUTH_HEADERS }
                );
                expect(res.status).toBe(400);
            } finally {
                server.close();
            }
        });
    });

    describe("GET /v1/stock/structures/:structureId/items — 함선 개별 이름(itemName)", () => {
        test("같은 typeId라도 itemName이 다르면 서로 다른 품목으로 나뉘고, 각자 이름에 맞는 target을 받는다", async () => {
            const structureId = 1051025995560n;
            const findUnique = jest
                .fn()
                .mockResolvedValue({ structureId, displayName: "SAVE CAT" });
            const t1 = new Date("2026-08-13T10:00:00.000Z");
            const stockLogFindMany = jest.fn().mockResolvedValue([
                { typeId: 22456, quantity: 1, sampledAt: t1, division: 3, itemName: "에태클" },
                { typeId: 22456, quantity: 1, sampledAt: t1, division: 3, itemName: "특수임무용" },
            ]);
            const stockTargetFindMany = jest.fn().mockResolvedValue([
                { typeId: 22456, itemName: "에태클", targetQty: 5 },
                { typeId: 22456, itemName: "", targetQty: 999 }, // 일반(이름없음) 목표 — 섞이면 안 됨
            ]);
            mockGetPrisma.mockReturnValue({
                trackedStructure: { findUnique },
                stockLog: { findMany: stockLogFindMany },
                stockTarget: { findMany: stockTargetFindMany },
            });

            const { server, baseUrl } = startTestApp();
            try {
                const res = await fetch(`${baseUrl}/v1/stock/structures/${structureId}/items`, {
                    headers: AUTH_HEADERS,
                });
                const body = await res.json();

                expect(body.items).toHaveLength(2);
                const etackle = body.items.find((i) => i.itemName === "에태클");
                const special = body.items.find((i) => i.itemName === "특수임무용");
                expect(etackle.target).toBe(5);
                expect(special.target).toBeNull(); // "특수임무용"용 target row가 없으니 null이어야 함(에태클의 999가 새면 안 됨)
            } finally {
                server.close();
            }
        });

        test('일반(이름 없는) 품목은 로그의 null과 타겟의 ""가 정규화돼서 정상 매칭된다(회귀)', async () => {
            const structureId = 1051025995560n;
            const findUnique = jest
                .fn()
                .mockResolvedValue({ structureId, displayName: "SAVE CAT" });
            const t1 = new Date("2026-08-13T10:00:00.000Z");
            const stockLogFindMany = jest
                .fn()
                .mockResolvedValue([
                    { typeId: 100, quantity: 5, sampledAt: t1, division: 3, itemName: null },
                ]);
            const stockTargetFindMany = jest
                .fn()
                .mockResolvedValue([{ typeId: 100, itemName: "", targetQty: 20 }]);
            mockGetPrisma.mockReturnValue({
                trackedStructure: { findUnique },
                stockLog: { findMany: stockLogFindMany },
                stockTarget: { findMany: stockTargetFindMany },
            });

            const { server, baseUrl } = startTestApp();
            try {
                const res = await fetch(`${baseUrl}/v1/stock/structures/${structureId}/items`, {
                    headers: AUTH_HEADERS,
                });
                const body = await res.json();

                expect(body.items).toHaveLength(1);
                expect(body.items[0].target).toBe(20);
                expect(body.items[0].itemName).toBeNull();
            } finally {
                server.close();
            }
        });
    });

    describe("GET /v1/stock/structures/:structureId/items/:typeId/history", () => {
        test("days 쿼리 파라미터로 조회 범위를 좁히고, 기본값은 90일이다", async () => {
            const structureId = 1051025995560n;
            const findUnique = jest
                .fn()
                .mockResolvedValue({ structureId, displayName: "SAVE CAT" });
            const t1 = new Date("2026-08-01T00:00:00.000Z");
            const stockLogFindMany = jest
                .fn()
                .mockResolvedValue([{ typeId: 100, quantity: 42, sampledAt: t1 }]);
            mockGetPrisma.mockReturnValue({
                trackedStructure: { findUnique },
                stockLog: { findMany: stockLogFindMany },
            });

            const { server, baseUrl } = startTestApp();
            try {
                const res = await fetch(
                    `${baseUrl}/v1/stock/structures/${structureId}/items/100/history?days=30`,
                    { headers: AUTH_HEADERS }
                );
                const body = await res.json();

                expect(res.status).toBe(200);
                expect(body.days).toBe(30);
                expect(body.typeId).toBe(100);
                expect(body.history).toEqual([{ sampledAt: t1.toISOString(), quantity: 42 }]);

                const call = stockLogFindMany.mock.calls[0][0];
                expect(call.where.structureId).toBe(structureId);
                expect(call.where.typeId).toBe(100);
            } finally {
                server.close();
            }
        });

        test("days가 범위를 벗어나면 1~365로 clamp한다", async () => {
            const structureId = 1051025995560n;
            mockGetPrisma.mockReturnValue({
                trackedStructure: {
                    findUnique: jest.fn().mockResolvedValue({ structureId, displayName: "x" }),
                },
                stockLog: { findMany: jest.fn().mockResolvedValue([]) },
            });

            const { server, baseUrl } = startTestApp();
            try {
                const res = await fetch(
                    `${baseUrl}/v1/stock/structures/${structureId}/items/100/history?days=9999`,
                    { headers: AUTH_HEADERS }
                );
                const body = await res.json();
                expect(body.days).toBe(365);
            } finally {
                server.close();
            }
        });

        test("itemName 쿼리가 있으면 그 이름의 함선 이력만 조회한다", async () => {
            const structureId = 1051025995560n;
            const stockLogFindMany = jest.fn().mockResolvedValue([]);
            mockGetPrisma.mockReturnValue({
                trackedStructure: {
                    findUnique: jest.fn().mockResolvedValue({ structureId, displayName: "x" }),
                },
                stockLog: { findMany: stockLogFindMany },
            });

            const { server, baseUrl } = startTestApp();
            try {
                await fetch(
                    `${baseUrl}/v1/stock/structures/${structureId}/items/22456/history?itemName=에태클`,
                    { headers: AUTH_HEADERS }
                );
                const call = stockLogFindMany.mock.calls[0][0];
                expect(call.where.itemName).toBe("에태클");
            } finally {
                server.close();
            }
        });

        test("itemName 쿼리가 없으면 itemName으로 필터하지 않는다(일반 품목과 동일)", async () => {
            const structureId = 1051025995560n;
            const stockLogFindMany = jest.fn().mockResolvedValue([]);
            mockGetPrisma.mockReturnValue({
                trackedStructure: {
                    findUnique: jest.fn().mockResolvedValue({ structureId, displayName: "x" }),
                },
                stockLog: { findMany: stockLogFindMany },
            });

            const { server, baseUrl } = startTestApp();
            try {
                await fetch(`${baseUrl}/v1/stock/structures/${structureId}/items/100/history`, {
                    headers: AUTH_HEADERS,
                });
                const call = stockLogFindMany.mock.calls[0][0];
                expect(call.where.itemName).toBeUndefined();
            } finally {
                server.close();
            }
        });
    });

    describe("PATCH /v1/stock/structures/:structureId/targets", () => {
        function patch(baseUrl, structureId, body) {
            return fetch(`${baseUrl}/v1/stock/structures/${structureId}/targets`, {
                method: "PATCH",
                headers: { ...AUTH_HEADERS, "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
        }

        test("세션 없으면 401", async () => {
            const { server, baseUrl } = startTestApp();
            try {
                const res = await fetch(`${baseUrl}/v1/stock/structures/1051025995560/targets`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ typeId: 100, targetQty: 10 }),
                });
                expect(res.status).toBe(401);
            } finally {
                server.close();
            }
        });

        test("구조물이 없으면 404", async () => {
            mockGetPrisma.mockReturnValue({
                trackedStructure: { findUnique: jest.fn().mockResolvedValue(null) },
            });
            const { server, baseUrl } = startTestApp();
            try {
                const res = await patch(baseUrl, 1051025995560n, { typeId: 100, targetQty: 10 });
                expect(res.status).toBe(404);
            } finally {
                server.close();
            }
        });

        test("typeId가 올바르지 않으면 400", async () => {
            mockGetPrisma.mockReturnValue({
                trackedStructure: {
                    findUnique: jest.fn().mockResolvedValue({ structureId: 1051025995560n }),
                },
            });
            const { server, baseUrl } = startTestApp();
            try {
                const res = await patch(baseUrl, 1051025995560n, { typeId: -1, targetQty: 10 });
                expect(res.status).toBe(400);
            } finally {
                server.close();
            }
        });

        test('targetQty>0이면 upsert로 저장한다(itemName 생략시 "" 로 정규화)', async () => {
            const structureId = 1051025995560n;
            const upsert = jest.fn().mockResolvedValue({});
            mockGetPrisma.mockReturnValue({
                trackedStructure: {
                    findUnique: jest.fn().mockResolvedValue({ structureId }),
                },
                stockTarget: { upsert },
            });
            const { server, baseUrl } = startTestApp();
            try {
                const res = await patch(baseUrl, structureId, { typeId: 100, targetQty: 20 });
                const body = await res.json();

                expect(res.status).toBe(200);
                expect(body).toEqual({ ok: true });
                expect(upsert).toHaveBeenCalledWith({
                    where: {
                        structureId_typeId_itemName: { structureId, typeId: 100, itemName: "" },
                    },
                    create: { structureId, typeId: 100, itemName: "", targetQty: 20 },
                    update: { targetQty: 20 },
                });
            } finally {
                server.close();
            }
        });

        test("itemName을 주면 그대로 upsert에 실린다(함선 개별 목표)", async () => {
            const structureId = 1051025995560n;
            const upsert = jest.fn().mockResolvedValue({});
            mockGetPrisma.mockReturnValue({
                trackedStructure: {
                    findUnique: jest.fn().mockResolvedValue({ structureId }),
                },
                stockTarget: { upsert },
            });
            const { server, baseUrl } = startTestApp();
            try {
                await patch(baseUrl, structureId, {
                    typeId: 22456,
                    itemName: "에태클",
                    targetQty: 3,
                });

                expect(upsert).toHaveBeenCalledWith(
                    expect.objectContaining({
                        create: { structureId, typeId: 22456, itemName: "에태클", targetQty: 3 },
                    })
                );
            } finally {
                server.close();
            }
        });

        test("targetQty<=0이면 deleteMany로 지운다(delete가 아님 — 없는 행이어도 성공해야 함)", async () => {
            const structureId = 1051025995560n;
            const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
            mockGetPrisma.mockReturnValue({
                trackedStructure: {
                    findUnique: jest.fn().mockResolvedValue({ structureId }),
                },
                stockTarget: { deleteMany },
            });
            const { server, baseUrl } = startTestApp();
            try {
                const res = await patch(baseUrl, structureId, { typeId: 100, targetQty: 0 });
                const body = await res.json();

                expect(res.status).toBe(200);
                expect(body).toEqual({ ok: true });
                expect(deleteMany).toHaveBeenCalledWith({
                    where: { structureId, typeId: 100, itemName: "" },
                });
            } finally {
                server.close();
            }
        });

        test("targetQty가 숫자가 아니면 400", async () => {
            mockGetPrisma.mockReturnValue({
                trackedStructure: {
                    findUnique: jest.fn().mockResolvedValue({ structureId: 1051025995560n }),
                },
            });
            const { server, baseUrl } = startTestApp();
            try {
                const res = await patch(baseUrl, 1051025995560n, {
                    typeId: 100,
                    targetQty: "abc",
                });
                expect(res.status).toBe(400);
            } finally {
                server.close();
            }
        });
    });

    describe("GET /v1/stock/structures/:structureId/fittings", () => {
        test("세션 없으면 401", async () => {
            const { server, baseUrl } = startTestApp();
            try {
                const res = await fetch(`${baseUrl}/v1/stock/structures/1051025995560/fittings`);
                expect(res.status).toBe(401);
            } finally {
                server.close();
            }
        });

        test("구조물이 없으면 404", async () => {
            mockGetPrisma.mockReturnValue({
                trackedStructure: { findUnique: jest.fn().mockResolvedValue(null) },
            });
            const { server, baseUrl } = startTestApp();
            try {
                const res = await fetch(`${baseUrl}/v1/stock/structures/1051025995560/fittings`, {
                    headers: AUTH_HEADERS,
                });
                expect(res.status).toBe(404);
            } finally {
                server.close();
            }
        });

        test("저장된 피팅을 items 그대로 반환한다", async () => {
            const structureId = 1051025995560n;
            const updatedAt = new Date("2026-08-19T10:00:00.000Z");
            mockGetPrisma.mockReturnValue({
                trackedStructure: {
                    findUnique: jest.fn().mockResolvedValue({ structureId }),
                },
                shipFitting: {
                    findMany: jest.fn().mockResolvedValue([
                        {
                            typeId: 22456,
                            itemName: "에태클",
                            items: [{ typeId: 2488, qty: 4 }],
                            updatedAt,
                        },
                    ]),
                },
            });
            const { server, baseUrl } = startTestApp();
            try {
                const res = await fetch(`${baseUrl}/v1/stock/structures/${structureId}/fittings`, {
                    headers: AUTH_HEADERS,
                });
                const body = await res.json();

                expect(res.status).toBe(200);
                expect(body).toEqual({
                    ok: true,
                    fittings: [
                        {
                            typeId: 22456,
                            itemName: "에태클",
                            items: [{ typeId: 2488, qty: 4 }],
                            updatedAt: updatedAt.toISOString(),
                        },
                    ],
                });
            } finally {
                server.close();
            }
        });
    });

    describe("PATCH /v1/stock/structures/:structureId/fittings", () => {
        function patch(baseUrl, structureId, body) {
            return fetch(`${baseUrl}/v1/stock/structures/${structureId}/fittings`, {
                method: "PATCH",
                headers: { ...AUTH_HEADERS, "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
        }

        test("세션 없으면 401", async () => {
            const { server, baseUrl } = startTestApp();
            try {
                const res = await fetch(`${baseUrl}/v1/stock/structures/1051025995560/fittings`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        typeId: 22456,
                        itemName: "에태클",
                        items: [{ typeId: 2488, qty: 4 }],
                    }),
                });
                expect(res.status).toBe(401);
            } finally {
                server.close();
            }
        });

        test("구조물이 없으면 404", async () => {
            mockGetPrisma.mockReturnValue({
                trackedStructure: { findUnique: jest.fn().mockResolvedValue(null) },
            });
            const { server, baseUrl } = startTestApp();
            try {
                const res = await patch(baseUrl, 1051025995560n, {
                    typeId: 22456,
                    itemName: "에태클",
                    items: [{ typeId: 2488, qty: 4 }],
                });
                expect(res.status).toBe(404);
            } finally {
                server.close();
            }
        });

        test("typeId가 올바르지 않으면 400", async () => {
            mockGetPrisma.mockReturnValue({
                trackedStructure: {
                    findUnique: jest.fn().mockResolvedValue({ structureId: 1051025995560n }),
                },
            });
            const { server, baseUrl } = startTestApp();
            try {
                const res = await patch(baseUrl, 1051025995560n, {
                    typeId: -1,
                    itemName: "에태클",
                    items: [{ typeId: 2488, qty: 4 }],
                });
                expect(res.status).toBe(400);
            } finally {
                server.close();
            }
        });

        test("itemName이 비어있으면 400(일반 품목엔 피팅 개념이 없음)", async () => {
            mockGetPrisma.mockReturnValue({
                trackedStructure: {
                    findUnique: jest.fn().mockResolvedValue({ structureId: 1051025995560n }),
                },
            });
            const { server, baseUrl } = startTestApp();
            try {
                const res = await patch(baseUrl, 1051025995560n, {
                    typeId: 22456,
                    itemName: "  ",
                    items: [{ typeId: 2488, qty: 4 }],
                });
                expect(res.status).toBe(400);
            } finally {
                server.close();
            }
        });

        test("items가 배열이 아니면 400", async () => {
            mockGetPrisma.mockReturnValue({
                trackedStructure: {
                    findUnique: jest.fn().mockResolvedValue({ structureId: 1051025995560n }),
                },
            });
            const { server, baseUrl } = startTestApp();
            try {
                const res = await patch(baseUrl, 1051025995560n, {
                    typeId: 22456,
                    itemName: "에태클",
                    items: "not-an-array",
                });
                expect(res.status).toBe(400);
            } finally {
                server.close();
            }
        });

        test("items 항목의 typeId/qty가 양의 정수가 아니면 400", async () => {
            mockGetPrisma.mockReturnValue({
                trackedStructure: {
                    findUnique: jest.fn().mockResolvedValue({ structureId: 1051025995560n }),
                },
            });
            const { server, baseUrl } = startTestApp();
            try {
                const res = await patch(baseUrl, 1051025995560n, {
                    typeId: 22456,
                    itemName: "에태클",
                    items: [{ typeId: 2488, qty: 0 }],
                });
                expect(res.status).toBe(400);
            } finally {
                server.close();
            }
        });

        test("items가 있으면 upsert로 저장한다", async () => {
            const structureId = 1051025995560n;
            const upsert = jest.fn().mockResolvedValue({});
            mockGetPrisma.mockReturnValue({
                trackedStructure: {
                    findUnique: jest.fn().mockResolvedValue({ structureId }),
                },
                shipFitting: { upsert },
            });
            const { server, baseUrl } = startTestApp();
            try {
                const res = await patch(baseUrl, structureId, {
                    typeId: 22456,
                    itemName: "에태클",
                    items: [{ typeId: 2488, qty: 4 }],
                });
                const body = await res.json();

                expect(res.status).toBe(200);
                expect(body).toEqual({ ok: true });
                expect(upsert).toHaveBeenCalledWith({
                    where: {
                        structureId_typeId_itemName: {
                            structureId,
                            typeId: 22456,
                            itemName: "에태클",
                        },
                    },
                    create: {
                        structureId,
                        typeId: 22456,
                        itemName: "에태클",
                        items: [{ typeId: 2488, qty: 4 }],
                    },
                    update: { items: [{ typeId: 2488, qty: 4 }] },
                });
            } finally {
                server.close();
            }
        });

        test("items가 빈 배열이면 deleteMany로 지운다(delete가 아님 — 없는 행이어도 성공해야 함)", async () => {
            const structureId = 1051025995560n;
            const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
            mockGetPrisma.mockReturnValue({
                trackedStructure: {
                    findUnique: jest.fn().mockResolvedValue({ structureId }),
                },
                shipFitting: { deleteMany },
            });
            const { server, baseUrl } = startTestApp();
            try {
                const res = await patch(baseUrl, structureId, {
                    typeId: 22456,
                    itemName: "에태클",
                    items: [],
                });
                const body = await res.json();

                expect(res.status).toBe(200);
                expect(body).toEqual({ ok: true });
                expect(deleteMany).toHaveBeenCalledWith({
                    where: { structureId, typeId: 22456, itemName: "에태클" },
                });
            } finally {
                server.close();
            }
        });
    });
});
