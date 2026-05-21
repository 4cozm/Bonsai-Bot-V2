# PR: 잠옷 모니터 (CA 임플란트 언독 알림)

## 개요

EVE Online 캐릭터가 **CA(Warp Core Stabilizer) 임플란트를 장착한 상태로 모니터링 스트럭쳐에서 언독**할 경우,
해당 캐릭터의 EVE 클라이언트에 인게임 팝업 알림을 띄우는 기능.

---

## 동작 흐름

```
[오케스트레이터] 시작 시 즉시 + 매일 KST 05:00
        │
        ▼ "잠옷-핫유저-분류" Redis Streams 커맨드 발행
        │
[워커] hotUserScheduler
   ├─ DB EveCharacter 조회 → 최근 30일 내 접속자 → hot 리스트 저장
   └─ EVE_ANCHOR_CHARIDS 앵커콥 토큰으로 콥 소속 스트럭쳐 목록 저장

[워커] targetPoller (10분 간격)
   └─ hot 리스트 순회 → 점프클론/활성 임플란트에 CA 있으면 target 리스트 저장

[워커] onlinePoller
   ├─ 오프라인→온라인 감지 (5초): target 중 offline → ESI /online/ 조회 → online 리스트 추가
   ├─ 온라인 재확인 (60초): online 리스트 전체 재조회 → 오프라인 전환 시 online/docking 제거
   └─ 언독 감지 (5초): docking 리스트 → ESI /location/ 조회 → 스트럭쳐 밖이면 CA 확인 후 인게임 팝업

[워커] dockingPoller (20초)
   └─ online 중 미도킹 캐릭터 → ESI /location/ 조회 → 모니터링 스트럭쳐면 docking 리스트 추가
```

---

## 신규 Key Vault 시크릿

### 테넌트 시크릿 (`{TENANT}-KEY` 형식, 예: `CAT-EVE-ANCHOR-CHARIDS`)

| Key Vault 이름 | 형식 | 설명 |
|---|---|---|
| `{TENANT}-EVE-ANCHOR-CHARIDS` | `corpId:charId,corpId:charId` | 콥 스트럭쳐 조회용 앵커콥 캐릭터 목록. 해당 캐릭터는 ESI OAuth 등록 필요. 미설정 시 스트럭쳐 목록 비워져 도킹/언독 감지 불가 (hot 분류만 동작). |

> `DISCORD_TENANT_MAP`은 기존 값 사용.

---

## 신규 ESI OAuth 스코프

봇에 ESI 등록하는 캐릭터(콥원 + 앵커콥 캐릭터)는 아래 스코프가 모두 포함된 토큰 필요.
**기존 등록 캐릭터는 재등록 필요.**

| 스코프 | 용도 |
|---|---|
| `esi-location.read_online.v1` | 온라인 상태 조회 |
| `esi-location.read_location.v1` | 현재 위치(스트럭쳐) 조회 |
| `esi-clones.read_clones.v1` | 점프클론 임플란트 조회 |
| `esi-clones.read_implants.v1` | 활성 임플란트 조회 |
| `esi-ui.open_window.v1` | 인게임 팝업 알림 전송 |

---

## Redis 상태 키

신규로 사용되는 Redis 키 (`bonsai:{tenantKey}:pajama:{type}`).

| 키 | 내용 |
|---|---|
| `hot` | 최근 30일 내 접속한 ESI 등록 캐릭터 ID 목록 |
| `target` | CA 임플란트 보유 캐릭터 ID 목록 |
| `online` | 현재 온라인 중인 타겟 캐릭터 ID 목록 |
| `docking` | 현재 모니터링 스트럭쳐에 도킹 중인 캐릭터 ID 목록 |
| `structures` | 모니터링 대상 스트럭쳐 ID 목록 |

---

## CA 임플란트 TypeID — 배포 전 확인 필요

현재 `packages/worker/src/pajama/index.js`에 하드코딩된 값:

```js
const CA_TYPE_IDS = Object.freeze([2082, 2589, 33393, 33394]);
// 2082  = Warp Core Stabilizer I
// 2589  = Warp Core Stabilizer II
// 33393 = Republic Fleet Warp Core Stabilizer
// 33394 = Domination Warp Core Stabilizer
```

> 추가할 CA 임플란트 typeId가 있는지 배포 전 확인.

---

## 변경된 파일

### 신규
| 파일 | 설명 |
|---|---|
| `packages/worker/src/pajama/index.js` | 잠옷 모니터 진입점 |
| `packages/worker/src/pajama/state.js` | Redis 상태 CRUD 헬퍼 (`getList`, `setList`) |
| `packages/worker/src/pajama/esiCalls.js` | 잠옷 관련 ESI API 헬퍼 |
| `packages/worker/src/pajama/hotUserScheduler.js` | hot 유저 분류 + 스트럭쳐 갱신 |
| `packages/worker/src/pajama/targetPoller.js` | CA 임플 보유자 → target 리스트 (10분 간격) |
| `packages/worker/src/pajama/onlinePoller.js` | 온라인/언독 감지 + 인게임 알림 (5초/60초) |
| `packages/worker/src/pajama/dockingPoller.js` | 도킹 감지 (20초 간격) |
| `packages/orchestrator/src/schedulers/pajamaHotScheduler.js` | 오케스트레이터 hot 분류 스케줄러 |
| `docs/pajama-pr.md` | 이 문서 |
| `docs/pajama-test-commands.md` | 테스트 명령어 모음 |
| `docs/pajama-prod-revert.md` | 테스트↔프로덕션 전환 가이드 |

### 수정
| 파일 | 변경 내용 |
|---|---|
| `packages/orchestrator/src/initialize/index.js` | `startPajamaHotScheduler` 호출 추가 (isDev 조건 밖) |

---

## 배포 체크리스트

- [ ] Key Vault에 `{TENANT}-EVE-ANCHOR-CHARIDS` 등록
- [ ] 앵커콥 캐릭터 ESI 등록 (신규 스코프 5개 포함)
- [ ] 콥원 ESI 재등록 (신규 스코프 5개 포함)
- [ ] CA 임플란트 TypeID 목록 최종 확인 (`packages/worker/src/pajama/index.js`)
- [ ] 배포 후 로그에서 `[pajama:hot] hot 리스트 갱신 완료` 확인
- [ ] 배포 후 로그에서 `[pajama:hot] 스트럭쳐 목록 갱신 완료` 확인
