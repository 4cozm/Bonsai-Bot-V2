---
name: 버그 신고
about: 건물 공격 알림 - 긴 다운타임 후 재시작 시 과거 알림 무차별 전송
title: "[버그] 건물 공격 알림: 오래만에 재시작하면 과거 공격 알림까지 전부 전송됨"
labels: ["bug", "버그"]
assignees: []
---

## 버그 설명

건물 공격 알림 스케줄러(`structureAttackAlertScheduler.js`, 10분 cron)는 Redis에 저장된
`max_notification_id`를 기준으로 그보다 **id가 큰 알림을 전부 전송**한다. `notification_id`는
단조 증가라 멱등성 자체는 정확하지만, "마지막 처리 이후의 모든 알림을 따라잡는(catch-up)" 동작이
곧 기능이라는 점이 문제다.

서버가 단순 오류 등으로 **오랫동안 꺼져 있다가 재시작**되면, ESI notifications 엔드포인트는 과거
수일치 알림을 그대로 들고 있으므로 `id > maxId`에 해당하는 알림이 한꺼번에 수십 개가 된다. 그 결과
**이미 한참 전에 끝난 공격 알림까지 전부 Discord로 쏟아진다.** (며칠 전 공격 알림은 현 시점에서
아무 의미 없는 노이즈)

## 재현 방법

1. 워커가 정상 동작하여 Redis `bonsai:structure_alert:max_notification_id:{tenant}:{char}`가
   특정 id로 갱신된 상태.
2. 워커 프로세스를 장시간(예: 수일) 중단.
3. 그 사이 EVE에서 건물/포스 공격 관련 알림이 여러 건 발생.
4. 워커 재시작 → 다음 cron 실행 시 `id > maxId` 인 과거 알림이 한꺼번에 전송됨.

## 예상 동작

재시작 시점 기준 **최근 알림만** 전송되고, 오래된 알림은 무시되어야 한다. 단, 짧은 배포/재시작에서
놓친 최근 알림(catch-up)은 정상적으로 전송되어야 한다.

## 실제 동작

긴 다운타임 후 재시작하면 며칠 전 공격 알림까지 전부 `@everyone` 멘션과 함께 전송된다.

## 원인

`processCharacterNotifications`의 전송 루프가 `notification_id` 크기 비교만 수행하고 알림의
**발생 시각(`timestamp`)을 전혀 고려하지 않기 때문**.

```js
for (const notification of data) {
    if (notification.notification_id <= maxId) break; // id만 비교 → 다운타임 동안 쌓인 것 전부 전송
    await sendAlertEmbed(...);
    processedMax = Math.max(processedMax, notification.notification_id);
}
```

## 해결 방안 (채택)

**"이벤트 나이 상한(MAX_AGE)" 필터**를 추가한다. (대안인 "서버 시작 시 baseline 재설정"은 모든
재시작에서 catch-up을 죽여 짧은 배포 중 발생한 진짜 알림까지 누락시키므로 채택하지 않음.)

- `id > maxId` 이고 `timestamp >= (now - MAX_AGE)` → 전송
- `id > maxId` 이고 `timestamp <  (now - MAX_AGE)` → 전송 스킵, 단 **멱등 baseline은 전진**시켜
  다음 실행에서 다시 평가하지 않도록 함.
- `MAX_AGE = 60분`. (cron 10분 + ESI 10분 캐싱 + 여유. 너무 짧게 잡으면 정상 경로에서 살짝 늦게
  도착한 알림을 떨어뜨릴 수 있음.)
- timestamp 파싱 실패(`NaN`) 시: critical 알림을 놓치지 않도록 **fail-open(전송)**. id 비교에서
  이미 "새 알림"임은 보장됨.

### 검증된 전제

ESI notifications의 `timestamp`는 swagger 기준 `format: date-time`(RFC 3339)로, 타임존
오프셋(`Z`, UTC)이 항상 포함된다. `Date.parse(...)`(UTC epoch ms)와 `Date.now()`(UTC epoch ms)는
**별도 단위 일치 작업 없이 직접 비교 가능**하다. 코드베이스에서도 `fuel.js`가 동일한 ESI date-time
(`fuel_expires`)을 `new Date(...)`로 직접 파싱해 운영 중이다.

## 효과

| 상황                | 변경 전                | 변경 후                          |
| ------------------- | ---------------------- | -------------------------------- |
| 30초 배포 재시작    | 놓친 최근 알림 전송 ✅ | 동일 (catch-up 유지) ✅          |
| 수일 다운 후 재시작 | 과거 알림 전부 전송 ❌ | 60분 이내만 전송, 나머지 무시 ✅ |

## 환경

- 앱/서비스: ESI 연동 워커 (건물 공격 알림 cron)
- 환경: 프로덕션

## 관련 파일

- `packages/worker/src/schedulers/structureAttackAlertScheduler.js`
- `.cursor/docs/structure-attack-alert.md`
