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
    });
});
