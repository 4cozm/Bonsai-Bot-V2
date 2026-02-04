# 아키텍처 검증 지침

## 1. Master – 라우팅 + interaction 수명만

- **interactionRouter.js**: `deferReply` → `publishProdCommand` / `publishDevCommand` → `pendingMap.set(res.envelopeId, { interaction })` → 첫 응답은 `editReply`로만 처리.
- **커맨드 해석/실행**: 없음. 슬래시는 `commandName` → `cmd`, 버튼은 `custom_id` prefix `esi-approve:` → `cmd: "esi-approve"`, `args: { registrationId }`로만 매핑. “어떤 cmd로 갈지”만 정하고, 유효성/실행은 Worker에 위임.
- **비고**: Master는 버튼 payload를 역직렬화하여 cmd/args를 그대로 전달만 하며, cmd 선택·args 기본값 부여·정책/유효성 판단 등 의미 부여는 하지 않는다(SoT는 Worker).
- **replyTo / pendingMap 예외**: `handleResult`에 “replyTo가 schedule이면…” 같은 도메인 분기 없음. `inReplyTo`로만 `pendingMap` 조회하고, 없으면 로그 후 스킵.

→ **지침 준수.**

---

## 2. Tenant Worker – 명령 SoT, unknown cmd 반환 형식

- **redisStreamsCommandConsumer.js**:  
  `cmd` 없음 → `execOk = false`, `execData = { error: "cmd가 비어있음" }`.  
  `commandMap`에 없음 → `execData = { error: \`unknown cmd: ${cmdName}\` }`.  
그대로 `buildResultEnvelope({ ok: execOk, data: execData })`로 반환.
- **esiSignup / esiApprove / dev**: 실패 시 모두 `{ ok: false, data: { error: "…" } }` 형태.

→ **지침 준수 (ok=false + data.error).**

---

## 3. Global Orchestrator – 전역 1회, pendingMap 미사용

- **부팅**: `initializeOrchestrator`에서 Redis 생성 후 `startEsiCallbackServer`, (prod) `startDtScheduler`, `runRedisStreamsGlobalConsumer` 순으로 시작. cron을 cmd로 트리거하지 않음.
- **DT 스케줄러**: `scheduleDailyAt` + `setInterval`로 in-process 폴링. 부팅 시 ESI `/status` 1회로 `baselineVersion` 캐시. `vipDedupKey` / `openDedupKey`에 Redis **SET NX EX** 날짜 단위 dedup. VIP 알림 1회, 정식 오픈 알림 1회 후 `clearInterval`. `server_version` 증가 시 VPN 문구 반영 후 `baselineVersion` 갱신. 화요일(`day === 2`)에 `alertSkillPointIfTuesday()`로 별도 웹훅.
- **ESI 콜백**: `esiCallbackServer.js`에서 Discord 버튼 메시지는 봇 토큰으로 `POST /channels/:id/messages`만 사용. 주석대로 pendingMap과 연결하지 않음.
- **글로벌 consumer**: `replyTo` 없는 cmd도 result를 스트림에 남기지만, Master는 `inReplyTo`로만 pendingMap을 찾으므로 해당 결과는 “pending 없음”으로 로그만 하고 editReply 하지 않음.

→ **지침 준수.**

---

## 4. replyTo / pendingMap (중요)

- **envelope.js**: “디스코드 인터랙션과 무관한(백그라운드/스케줄) cmd는 replyTo가 없을 수 있다”고 명시, `replyTo` 옵션 처리.
- 백그라운드 전역 작업은 `inReplyTo`/`replyTo`를 넣지 않고, Master를 통해 응답을 닫지 않음.
- Master에는 “replyTo가 schedule이면 예외” 같은 로직 없음.

**비고**: Global Orchestrator는 Discord interaction 응답 채널(bonsai:result)로 결과를 publish하지 않는다. 전역 작업은 replyTo/inReplyTo를 생성하지 않으며, 결과 전송은 전용 sink(예: Discord Webhook) 또는 별도 스트림/채널을 사용한다. bonsai:result는 Master↔Worker의 ‘Discord interaction 종료’ 경로에만 사용한다.

→ **지침 준수.**

---

## 5. 환경변수 / keys

- **keys.js global.prod**: `DISCORD_DT_WEBHOOK_URL`, `DISCORD_ALERT_WEBHOOK_URL`, `DT_CHECK_*`, `DT_POLL_*`는 지침과 일치. `DISCORD_IT_PING_WEBHOOK_URL`는 지침 목록 밖이지만, 전역 웹훅 추가용으로 두어도 역할 분리에는 영향 없음.
- **DT 기본값**: `DT_CHECK_HOUR` 11, `DT_CHECK_MINUTE` 0, `DT_POLL_MS` 30000은 코드에서 기본값으로 처리 가능.
- **TZ**: `toLocalDateKey`, `alertSkillPointIfTuesday`의 `getDay()`는 `Date()` 기준이라, PM2 등에서 `TZ=Asia/Seoul` 설정 시 KST 기준으로 동작.
- **tenantKey(TENANT 또는 TENANT_KEY)**: PM2 ecosystem(프로세스 단위 env)에서 주입되며, Worker가 이를 SoT로 사용한다.

→ **지침 준수.**

---

## 6. 코드 위치·Redis·로깅

- **apps/global**: 글로벌 엔트리에서 `initializeOrchestrator` 호출.
- **packages/orchestrator**: `initialize`, `schedulers/dtScheduler.js`, `utils/getServerStatus.js`, `postDiscordWebhook.js`, `alertSkillPoint.js` 등 지침에서 말한 위치와 일치.
- Redis는 `@bonsai/external`의 `createRedisClient`, DT 스케줄러는 `redis` 인자로 받아 dedup 키 관리.
- 로깅은 `@bonsai/shared`의 `logger()` 사용.

---

## 7. 아키텍처 고정 원칙

- 커맨드 존재/해석/실행: Worker가 단일 진실.
- Master: 라우팅 + 수명관리만.
- 전역 1회/집계: Global Orchestrator.
- 전역 작업 멱등/중복 제거: Master가 아니라 오케스트레이터(Redis SET NX EX)에서 처리.
