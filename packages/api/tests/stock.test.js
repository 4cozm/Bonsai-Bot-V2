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
                expect(item100.recentHistory).toEqual([
                    { sampledAt: t1.toISOString(), quantity: 5 },
                    { sampledAt: t2.toISOString(), quantity: 8 },
                ]);

                const item200 = body.items.find((i) => i.typeId === 200);
                expect(item200.stocked).toBe(3);
                expect(item200.target).toBeNull();
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
