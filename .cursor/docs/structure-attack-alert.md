# 건물 공격 알림 (Structure Attack Alert)

## 개요

EVE Online ESI의 **character notifications** API를 주기적으로 조회하여, 건물(포스/스톡) 공격 관련 알림(`TowerAlertMsg`, `StructureUnderAttack`, `StructureLostShields`, `StructureLostArmor`)을 **멱등하게** 처리한 뒤 **DISCORD_ALERT_WEBHOOK_URL**로 Discord 임베드 웹후크를 전송하는 기능이다.

## 흐름

1. **실행 위치**: 각 **일반 테넌트 워커**(TENANT=CAT, FISH 등) 프로세스 내. `TENANT=global` 워커에서는 미기동.
2. **주기**: node-cron으로 **10분마다** 실행 (ESI 측 10분 캐싱에 맞춤).
3. **캐릭터**: 테넌트당 `EVE_ANCHOR_CHARIDS`에 정의된 **모든 캐릭터**를 순회하며, 캐릭터별로 `GET /characters/{character_id}/notifications/` 호출.
4. **멱등성**: Redis에 테넌트+캐릭터별 **마지막 처리 notification_id** 저장
    - 키: `bonsai:structure_alert:max_notification_id:{tenantKey}:{characterId}`
    - 매 실행 시 해당 키를 조회해 `id > maxId`인 알림만 처리 후, 처리한 최대 id를 같은 키로 갱신.
    - 해당 캐릭터 키가 없을 때(첫 실행)는 이번에 받은 목록의 최대 id만 저장하고 알림 전송 없음.
    - **나이 상한(MAX_AGE) 필터**: `id > maxId`라도 알림 `timestamp`가 `now - 60분`보다 오래됐으면
      전송을 스킵하고 **baseline(maxId)만 전진**시킨다. 긴 다운타임 후 재시작 시 ESI에 남아있는
      과거 알림이 한꺼번에 전송되는 것을 막기 위함. 짧은 배포/재시작의 catch-up(최근 알림 따라잡기)은
      그대로 유지된다. timestamp 파싱 실패 시에는 critical 알림 누락 방지를 위해 전송(fail-open).
      ESI timestamp는 RFC 3339(UTC)라 `Date.parse` 결과를 `Date.now()`와 직접 비교한다.
5. **건물 이름·위치 해석**: 알림 `text`(YAML)에서 `structureID`·`solarsystemID`를 파싱해 사람이 알아볼 정보로 변환.
    - **건물 이름**: `GET /corporations/{corporationId}/structures/` 응답에 `name`이 포함됨 → `structure_id → { name, system_id, type_id }` 맵으로 변환해 조회. `esi-corporations.read_structures.v1` 스코프만 있으면 되고, `esi-universe.read_structures.v1`/도킹 권한은 불필요. (Redis 1시간 캐싱)
    - **성계 이름**: `GET /universe/systems/{system_id}/` (공개, 인증 불필요) → `name`. (Redis 30일 캐싱)
    - `StructureUnderAttack`의 `structureID`는 YAML anchor가 붙어 `&id001 1000000000001` 형태로 오므로 끝의 숫자만 추출.
    - `TowerAlertMsg`(POS)는 Upwell 구조물이 아니라 코프 구조물 목록에 없어 **건물 이름은 해석 불가**, 성계 위치만 표시.
6. **전송**: 처리한 알림 타입별로 Discord **임베드**를 만들어 `postDiscordWebhook`로 `DISCORD_ALERT_WEBHOOK_URL`에 전송. 임베드에 건물 이름·유형·테넌트·성계 위치를 포함.

## 사용 파일 / 함수

| 구분     | 경로                                                              | 설명                                                                                                                                                                                 |
| -------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 스케줄러 | `packages/worker/src/schedulers/structureAttackAlertScheduler.js` | `startStructureAttackAlertScheduler({ redis, prisma, tenantKey, signal, log })` — 10분마다 EVE_ANCHOR_CHARIDS 전체 캐릭터에 대해 notifications 조회, Redis 멱등, 임베드 웹후크 전송. |
| 초기화   | `packages/worker/src/initialize/index.js`                         | `tenantKey !== "global" && !isDev`일 때만 `startStructureAttackAlertScheduler` 호출.                                                                                                 |
| 건물 맵  | `packages/worker/src/esi/getCorporationStructureMap.js`           | `structure_id → { name, system_id, type_id }` 맵 반환(코프 구조물 목록 기반, Redis 1시간 캐싱).                                                                                      |
| 성계명   | `packages/worker/src/esi/getSolarSystemName.js`                   | 공개 universe/systems 엔드포인트로 성계 ID → 이름(Redis 30일 캐싱).                                                                                                                  |

- **토큰**: `@bonsai/shared`의 `getAccessTokenForCharacter(prisma, characterId)` 사용.
- **웹후크**: `@bonsai/shared`의 `postDiscordWebhook({ url, payload: { embeds: [embed] } })` 사용.

## isDev 분기

`.env`의 **isDev**가 `true`이면 worker 초기화 시 건물 공격 알림 **cron 자체를 등록하지 않는다.**  
(`packages/worker/src/initialize/index.js`에서 `if (tenantKey !== "global" && !isDev)` 조건으로 스케줄러 호출.)

## 참고한 이전 구현

- **Cat4U** 프로젝트: `src/esi/reinforceAlert.js` — 알림 타입별 처리 및 디스코드 알림 패턴 참고.  
  Bonsai에서는 임베드 + Redis 멱등 + 캐릭터 전체 순회 + isDev 분기로 재구현.
