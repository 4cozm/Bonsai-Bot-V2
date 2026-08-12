// packages/api/tests/server.test.js
import { describe, expect, test } from "@jest/globals";
import { createApp } from "../src/server.js";

describe("api/server", () => {
    test("GET /health → ok:true", async () => {
        const log = { info: () => {}, warn: () => {}, error: () => {} };
        const app = createApp({ redis: {}, log });
        const server = app.listen(0);
        const { port } = server.address();

        try {
            const res = await fetch(`http://127.0.0.1:${port}/health`);
            const body = await res.json();
            expect(res.status).toBe(200);
            expect(body).toEqual({ ok: true, service: "bonsai-api" });
        } finally {
            server.close();
        }
    });
});
