// packages/worker/src/pajama/esiCalls.js
//
// 잠옷(CA 임플란트) 모니터링에 필요한 ESI API 헬퍼.
//
// 필요 ESI scope (콥원 개인 토큰):
//   - esi-clones.read_clones.v1
//   - esi-clones.read_implants.v1
//   - esi-location.read_location.v1
//   - esi-location.read_online.v1
//   - esi-ui.open_window.v1
//
import { logger } from "@bonsai/shared";

const log = logger();
const ESI_BASE = "https://esi.evetech.net/latest";

// ─── 1) 온라인 상태 + 마지막 접속 시각 ──────────────────────────────────

/**
 * `GET /characters/{characterId}/online/`
 *
 * @param {string} accessToken
 * @param {string|number|bigint} characterId
 * @returns {Promise<{ online: boolean, last_login?: string, last_logout?: string, logins?: number } | null>}
 */
export async function getCharacterOnline(accessToken, characterId) {
    const cid = String(characterId);
    const url = `${ESI_BASE}/characters/${cid}/online/`;

    try {
        const res = await fetch(url, {
            method: "GET",
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        const bodyText = await res.text();

        if (!res.ok) {
            log.warn("[pajama:esi] getCharacterOnline 실패", {
                characterId: cid,
                status: res.status,
                body: bodyText.slice(0, 500),
            });
            return null;
        }
        return bodyText ? JSON.parse(bodyText) : null;
    } catch (err) {
        log.warn("[pajama:esi] getCharacterOnline 예외", {
            characterId: cid,
            message: err?.message ?? String(err),
        });
        return null;
    }
}

// ─── 2) 점프 클론 목록 ───────────────────────────────────────────────────

/**
 * `GET /characters/{characterId}/clones/`
 *
 * @param {string} accessToken
 * @param {string|number|bigint} characterId
 * @returns {Promise<{ jump_clones: Array<{ jump_clone_id: number, implants: number[], location_id: number, location_type: string, name: string }> } | null>}
 */
export async function getCharacterClones(accessToken, characterId) {
    const cid = String(characterId);
    const url = `${ESI_BASE}/characters/${cid}/clones/`;

    try {
        const res = await fetch(url, {
            method: "GET",
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        const bodyText = await res.text();

        if (!res.ok) {
            log.warn("[pajama:esi] getCharacterClones 실패", {
                characterId: cid,
                status: res.status,
                body: bodyText.slice(0, 500),
            });
            return null;
        }
        return bodyText ? JSON.parse(bodyText) : null;
    } catch (err) {
        log.warn("[pajama:esi] getCharacterClones 예외", {
            characterId: cid,
            message: err?.message ?? String(err),
        });
        return null;
    }
}

// ─── 3) 현재 활성 임플란트 목록 ─────────────────────────────────────────

/**
 * `GET /characters/{characterId}/implants/`
 *
 * @param {string} accessToken
 * @param {string|number|bigint} characterId
 * @returns {Promise<number[] | null>}  활성 임플란트 typeId 배열
 */
export async function getCharacterImplants(accessToken, characterId) {
    const cid = String(characterId);
    const url = `${ESI_BASE}/characters/${cid}/implants/`;

    try {
        const res = await fetch(url, {
            method: "GET",
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        const bodyText = await res.text();

        if (!res.ok) {
            log.warn("[pajama:esi] getCharacterImplants 실패", {
                characterId: cid,
                status: res.status,
                body: bodyText.slice(0, 500),
            });
            return null;
        }
        return bodyText ? JSON.parse(bodyText) : [];
    } catch (err) {
        log.warn("[pajama:esi] getCharacterImplants 예외", {
            characterId: cid,
            message: err?.message ?? String(err),
        });
        return null;
    }
}

// ─── 4) 현재 위치 ────────────────────────────────────────────────────────

/**
 * `GET /characters/{characterId}/location/`
 *
 * @param {string} accessToken
 * @param {string|number|bigint} characterId
 * @returns {Promise<{ solar_system_id: number, station_id?: number, structure_id?: number } | null>}
 */
export async function getCharacterLocation(accessToken, characterId) {
    const cid = String(characterId);
    const url = `${ESI_BASE}/characters/${cid}/location/`;

    try {
        const res = await fetch(url, {
            method: "GET",
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        const bodyText = await res.text();

        if (!res.ok) {
            log.warn("[pajama:esi] getCharacterLocation 실패", {
                characterId: cid,
                status: res.status,
                body: bodyText.slice(0, 500),
            });
            return null;
        }
        return bodyText ? JSON.parse(bodyText) : null;
    } catch (err) {
        log.warn("[pajama:esi] getCharacterLocation 예외", {
            characterId: cid,
            message: err?.message ?? String(err),
        });
        return null;
    }
}

// ─── 5) 인게임 메일 작성창 팝업 (알림) ──────────────────────────────────

/**
 * `POST /ui/openwindow/newmail/`
 *
 * 캐릭터 클라이언트에 메일 작성창을 팝업으로 띄워 언독 경고 알림.
 * (메일을 직접 전송하는 것이 아니라 작성창을 여는 것)
 *
 * @param {string} accessToken
 * @param {number|string|bigint} characterId  - 수신자(본인)
 * @param {string} subject
 * @param {string} body
 * @returns {Promise<boolean>}  성공 여부
 */
export async function openWindowNewMail(accessToken, characterId, subject, body) {
    const cid = Number(characterId);
    const url = `${ESI_BASE}/ui/openwindow/newmail/`;

    const payload = {
        body,
        recipients: [cid],
        subject,
    };

    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });
        const bodyText = await res.text();

        if (res.status === 204 || res.ok) {
            return true;
        }
        log.warn("[pajama:esi] openWindowNewMail 실패", {
            characterId: cid,
            status: res.status,
            body: bodyText.slice(0, 500),
        });
        return false;
    } catch (err) {
        log.warn("[pajama:esi] openWindowNewMail 예외", {
            characterId: cid,
            message: err?.message ?? String(err),
        });
        return false;
    }
}

// ─── 헬퍼 ────────────────────────────────────────────────────────────────

/**
 * 임플란트 typeId 배열에서 CA 임플란트 typeId를 찾아 첫 번째 것을 반환.
 *
 * @param {number[]} implantList
 * @param {number[]} caTypeIds
 * @returns {number | null}
 */
export function findCAImplantTypeId(implantList, caTypeIds) {
    if (!Array.isArray(implantList) || implantList.length === 0) return null;
    for (const id of implantList) {
        if (caTypeIds.includes(Number(id))) return Number(id);
    }
    return null;
}

/**
 * 클론 데이터의 모든 점프 클론에 걸쳐 임플란트 typeId를 평탄화하여 반환.
 *
 * @param {{ jump_clones?: Array<{ implants?: number[] }> } | null} clonesData
 * @returns {number[]}
 */
export function getAllImplantsFromClones(clonesData) {
    if (!clonesData?.jump_clones) return [];
    return clonesData.jump_clones.flatMap((clone) => clone.implants ?? []);
}
