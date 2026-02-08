// packages/worker/src/esi/fleet.js
//
// EVE ESI Fleet 관련 헬퍼.
//
// 필요 ESI scope:
//   - esi-fleets.read_fleet.v1   (GET /characters/{id}/fleet, GET /fleets/{id}/members)
//   - esi-fleets.write_fleet.v1  (PUT /fleets/{id}/members/{id})
//
import { logger } from "@bonsai/shared";

const log = logger();
const ESI_BASE = "https://esi.evetech.net/latest";

// ─── 1) 요청자 fleet 조회 ────────────────────────────────────────────

/**
 * `GET /characters/{characterId}/fleet/`
 *
 * @param {string} accessToken
 * @param {string|number|bigint} characterId
 * @returns {Promise<{ fleet_id: number, role: string, squad_id: number, wing_id: number } | null>}
 *   404(플릿 없음) 또는 오류 시 null
 */
export async function getCharacterFleet(accessToken, characterId) {
    const cid = String(characterId);
    const url = `${ESI_BASE}/characters/${cid}/fleet/`;

    try {
        const res = await fetch(url, {
            method: "GET",
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        const bodyText = await res.text();

        if (res.status === 404) {
            // 플릿에 참가하지 않은 상태
            return null;
        }
        if (!res.ok) {
            log.warn("[esi:fleet] getCharacterFleet 실패", {
                characterId: cid,
                status: res.status,
                body: bodyText.slice(0, 500),
            });
            return null;
        }
        return bodyText ? JSON.parse(bodyText) : null;
    } catch (err) {
        log.warn("[esi:fleet] getCharacterFleet 예외", {
            characterId: cid,
            message: err?.message ?? String(err),
        });
        return null;
    }
}

// ─── 2) fleet 멤버 리스트 → boss 식별 ────────────────────────────────

/**
 * `GET /fleets/{fleetId}/members/`
 *
 * @param {string} accessToken
 * @param {number|string} fleetId
 * @returns {Promise<Array<object> | null>}  멤버 배열 또는 실패 시 null
 */
export async function getFleetMembers(accessToken, fleetId) {
    const fid = String(fleetId);
    const url = `${ESI_BASE}/fleets/${fid}/members/`;

    try {
        const res = await fetch(url, {
            method: "GET",
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        const bodyText = await res.text();

        if (!res.ok) {
            log.warn("[esi:fleet] getFleetMembers 실패", {
                fleetId: fid,
                status: res.status,
                body: bodyText.slice(0, 500),
            });
            return null;
        }
        return bodyText ? JSON.parse(bodyText) : [];
    } catch (err) {
        log.warn("[esi:fleet] getFleetMembers 예외", {
            fleetId: fid,
            message: err?.message ?? String(err),
        });
        return null;
    }
}

/**
 * members 배열에서 `role_name`에 "(Boss)"가 포함된 멤버의 `character_id`를 반환.
 *
 * @param {Array<object>} members
 * @returns {{ bossCharacterId: number, bossRole: string, bossRoleName: string } | null}
 */
export function findBoss(members) {
    if (!Array.isArray(members)) return null;
    const boss = members.find((m) => String(m.role_name ?? "").includes("(Boss)"));
    if (!boss) return null;

    return {
        bossCharacterId: boss.character_id,
        bossRole: boss.role,
        bossRoleName: boss.role_name,
    };
}

// ─── 3) boss 토큰으로 요청자 승격 ────────────────────────────────────

/**
 * `PUT /fleets/{fleetId}/members/{memberId}/`
 *
 * boss(또는 권한자)의 accessToken으로 memberId의 role을 변경한다.
 *
 * @param {string} bossAccessToken
 * @param {number|string} fleetId
 * @param {number|string} memberId  - 승격 대상(요청자) characterId
 * @param {{ role: string, wing_id?: number, squad_id?: number }} body
 * @returns {Promise<{ ok: boolean, status: number, error?: string }>}
 */
export async function setFleetMemberRole(bossAccessToken, fleetId, memberId, body) {
    const fid = String(fleetId);
    const mid = String(memberId);
    const url = `${ESI_BASE}/fleets/${fid}/members/${mid}/`;

    try {
        const res = await fetch(url, {
            method: "PUT",
            headers: {
                Authorization: `Bearer ${bossAccessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        });

        const bodyText = await res.text();

        if (res.status === 204 || res.ok) {
            return { ok: true, status: res.status };
        }

        log.warn("[esi:fleet] setFleetMemberRole 실패", {
            fleetId: fid,
            memberId: mid,
            status: res.status,
            body: bodyText.slice(0, 500),
        });
        return { ok: false, status: res.status, error: bodyText.slice(0, 500) };
    } catch (err) {
        log.warn("[esi:fleet] setFleetMemberRole 예외", {
            fleetId: fid,
            memberId: mid,
            message: err?.message ?? String(err),
        });
        return { ok: false, status: 0, error: err?.message ?? String(err) };
    }
}

// ─── 4) universe/names → 캐릭터 이름 조회 ────────────────────────────

/**
 * `POST /universe/names/`
 *
 * @param {Array<number|string>} ids
 * @returns {Promise<Array<{category: string, id: number, name: string}>>}
 */
export async function resolveNames(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const url = `${ESI_BASE}/universe/names/`;

    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(ids.map(Number)),
        });
        const bodyText = await res.text();

        if (!res.ok) {
            log.warn("[esi:fleet] resolveNames 실패", {
                status: res.status,
                body: bodyText.slice(0, 500),
            });
            return [];
        }
        return bodyText ? JSON.parse(bodyText) : [];
    } catch (err) {
        log.warn("[esi:fleet] resolveNames 예외", { message: err?.message ?? String(err) });
        return [];
    }
}
