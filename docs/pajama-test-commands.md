# 잠옷 모니터 테스트 명령어

## 개발 환경 .env 설정

테스트 시 아래 항목을 `.env`에 추가할 것.

| 항목 | 예시 값 | 설명 |
|---|---|---|
| `PAJAMA_TEST_STRUCTURE_IDS` | `1051025995560` | 앵커콥 ESI 없이 모니터링 스트럭쳐를 고정값으로 설정 |
| `PAJAMA_TARGET_POLL_MS` | `6000` | targetPoller 폴링 간격 단축 (기본 10분 → 6초) |

> 개발 환경(`isDev=true`)에서는 오케스트레이터 스케줄러가 동작하지 않으므로,
> hot 유저 분류는 `startPajamaTest.mjs` 스크립트로 수동 실행할 것.

---

## 프로젝트 실행

| 명령어 | 설명 |
|---|---|
| `npm run dev` | pm2로 전체 개발 서버 시작 |
| `npm start` | 프로덕션 서버 시작 |
| `npm run stop` | 전체 pm2 프로세스 종료 |
| `npm run restart` | 전체 pm2 프로세스 재시작 |
| `npm run logs` | 전체 pm2 로그 실시간 출력 |
| `pm2 restart CAT` | CAT 워커만 재시작 |
| `pm2 restart global` | 오케스트레이터만 재시작 |
| `pm2 logs CAT` | CAT 워커 로그 실시간 확인 |

---

## 스크립트

| 명령어 | 설명 |
|---|---|
| `node --env-file=.env scripts/issueEsiLink.mjs [tenantKey]` | EVE OAuth URL 발급 (브라우저에서 직접 인증) |
| `node --env-file=.env scripts/startPajamaTest.mjs [tenantKey]` | Redis pajama 상태 초기화 + hot 유저 분류 즉시 실행 |
| `node --env-file=.env scripts/resetEsiTest.mjs` | EveCharacter·EsiRegistration DB 삭제 + Redis online/docking/nonces 초기화 |

---

## Redis 상태 조회

| 명령어 | 설명 |
|---|---|
| `docker exec bonsai-redis-test redis-cli get bonsai:CAT:pajama:hot` | hot 유저 목록 확인 |
| `docker exec bonsai-redis-test redis-cli get bonsai:CAT:pajama:target` | CA 임플 보유 타겟 목록 확인 |
| `docker exec bonsai-redis-test redis-cli get bonsai:CAT:pajama:online` | 현재 온라인 유저 목록 확인 |
| `docker exec bonsai-redis-test redis-cli get bonsai:CAT:pajama:docking` | 현재 도킹 중인 유저 목록 확인 |
| `docker exec bonsai-redis-test redis-cli get bonsai:CAT:pajama:structures` | 모니터링 스트럭쳐 목록 확인 |
| `docker exec bonsai-redis-test redis-cli flushall` | Redis 전체 초기화 |

---

## Redis 값 직접 설정

| 명령어 | 설명 |
|---|---|
| `docker exec bonsai-redis-test redis-cli set bonsai:CAT:pajama:hot '["charId1","charId2"]'` | hot 유저 수동 설정 |
| `docker exec bonsai-redis-test redis-cli set bonsai:CAT:pajama:structures '["structureId"]'` | 모니터링 스트럭쳐 수동 설정 |
| `docker exec bonsai-redis-test redis-cli set bonsai:CAT:pajama:online '[]'` | online 리스트 초기화 |
| `docker exec bonsai-redis-test redis-cli set bonsai:CAT:pajama:docking '[]'` | docking 리스트 초기화 |
| `docker exec bonsai-redis-test redis-cli set bonsai:CAT:pajama:target '[]'` | target 리스트 초기화 |
| `docker exec bonsai-redis-test redis-cli del bonsai:CAT:pajama:hot` | 특정 키 삭제 |
