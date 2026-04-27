# Bonsai-Bot-V2

EVE Online의 실시간 게임 이벤트를 Discord로 중계하고 대규모 코퍼레이션 운영을 자동화하는 지원 시스템. 단순히 명령에 응답하는 봇을 넘어, 다중 코퍼레이션(Multi-Tenant) 환경에서 인게임 접속 없이도 자산 관리 및 공격 알림을 실시간으로 처리하는 운영 인프라의 역할을 수행한다.

## 1. 왜 이 프로젝트가 필요한가

- **생체 봇 기반의 수동 운영**: EVE Online은 매일 정기 점검을 수행하며, 서버 재오픈 시점을 확인하기 위해 유저들이 직접 게임에 반복 접속해야 하는 번거로움이 있었음.
- **치명적인 이벤트 알림 부재**: 구조물 연료 고갈, 적대 세력의 공격 등은 인게임에 접속하지 않으면 외부에서 인지할 수 없으며, 대응 지연은 심각한 자산 손실로 이어짐.
- **모노리스 구조의 한계**: 단일 코퍼레이션용으로 설계된 기존 시스템은 여러 코퍼레이션이 하나의 Discord 서버를 공유하는 환경에서 권한 분리와 데이터 격리가 불가능했음.

## 2. 핵심 제약

- **Discord Interaction 3초 제한**: 사용자 명령에 대해 3초 이내에 수신 확인 및 응답이 완료되어야 하는 플랫폼 정책 준수 필요.
- **ESI API 테스트 한계**: 특정 유저의 데이터를 조회하기 위해 OAuth2 토큰이 필수적이나, 테스트 환경에서 매번 실제 유저의 토큰을 확보하여 검증하는 것이 현실적으로 불가능함.
- **멀티 테넌트 관리 효율**: 코퍼레이션이 추가되거나 제거될 때마다 별도의 봇 인스턴스를 띄우는 방식은 관리 비용과 모니터링 복잡도를 선형적으로 증가시킴.

## 3. 해결 전략

- **메시징 기반 분산 처리 (Redis Streams)**: Discord 명령 수신부(Master)와 실제 로직 처리부(Worker)를 분리. Redis Streams를 통해 명령을 전달하고 결과 응답을 기다리는 비동기 구조를 채택하여 Discord 3초 응답 제한 문제를 해결.
- **논리적 테넌트 격리 및 라우팅**: 명령이 발화된 채널 ID를 기반으로 `tenantKey`를 결정하는 디스패처를 구현. 단일 봇 인스턴스로 여러 코퍼레이션을 수용하면서도 데이터 접근 권한을 엄격히 분리.
- **개발 환경용 브릿지 라우팅 (AWS SQS)**: 테스트용 OAuth2 토큰 제약을 해결하기 위해, 프로덕션 마스터가 `/dev` 명령어를 수신하면 AWS SQS를 통해 특정 개발자의 로컬 환경으로 작업을 라우팅하고 처리 결과를 다시 Discord로 중계하는 구조 구축.
- **운영 안정성 최적화**:
    - **Azure Key Vault**: 분산된 개발 환경 간의 환경변수 정합성을 유지하기 위해 중앙 집중식 비밀 관리 도입.
    - **전용 Redis 클라이언트 운용**: 블로킹(XREAD BLOCK) 작업이 자동완성(Autocomplete) 기능의 응답 속도에 영향을 주지 않도록 Redis 커넥션을 용도별로 분리.

## 4. 아키텍처 / 데이터 흐름

```text
[Discord User]
      | (1) Interaction (Cmd / Autocomplete)
      v
[Master Tenant (EC2)] ----------------------------> [AWS SQS (Dev Queue)]
      | (2) Defer (3s Limit)                              |
      | (3) Publish Envelope (Redis Streams)              | (4) Forward /dev Cmd
      v                                                   v
[Worker / Tenant Logic] <------------------------- [Developer Local Env]
      | (5) Processing (ESI API / DB)                     |
      | (6) Publish Result (Redis Streams)                |
      v                                                   |
[Master Tenant (EC2)] <-----------------------------------
      | (7) Edit Interaction Reply
      v
[Discord API]
```

## 5. 주요 구현 포인트

### Redis Streams 기반의 메시지 버스

- `bonsai:cmd:${tenantKey}`와 `bonsai:result` 스트림을 활용한 요청-응답 패턴.
- 커널 레벨의 대기(BLOCK)와 Consumer Group 기능을 통해 작업 누락 방지 및 효율적인 리소스 점유 구현.

### 채널 매핑 기반 테넌트 라우팅

- `resolveTenantKey(channelId)` 로직을 통해 유입 경로별로 대상 코퍼레이션 테넌트를 판별.
- 인프라 확장 없이 설정 추가만으로 신규 테넌트 수용이 가능한 일관성 있는 구조 확보.

### Azure Key Vault 통합

- `loadVaultSecrets`를 통한 런타임 환경변수 자동 주입으로 개발 환경과 운영 환경의 설정 동기화 오버헤드 제거.

## 6. 운영 관점에서 중요했던 점

- **장애 전파 격리**: 마스터 테넌트와 작업 처리부의 분리를 통해 특정 코퍼레이션의 로직 장애나 API 지연이 시스템 전체의 중단으로 이어지지 않도록 격리.
- **실시간 장애 알림**: 심각한 런타임 에러 발생 시 Discord Webhook을 통해 에러 로그를 즉각 전파하여 관리자가 즉시 대응할 수 있는 가시성 확보.
- **협업 및 온보딩 인프라**:
    - **Git Project (Kanban)**: 작업 우선순위 및 가시성 확보.
    - **Onboarding Wiki**: 신규 개발자 및 운영자를 위한 설계 문서 및 운영 가이드라인 제공.
    - **Azure Key Vault**: 무상 참여 개발자들의 로컬 환경 설정 진입 장벽 제거.

## 7. 트레이드오프와 한계

- **논리적 테넌트 vs 물리적 격리**: 현재는 비용 효율을 위해 단일 인스턴스 내 논리적 격리를 수행 중이나, 부하 증가 시 Redis Streams 구조를 유지한 채 워커 인스턴스만 물리적으로 분리할 수 있는 확장성을 전제함.
- **Observability**: 전문적인 매트릭 대시보드 대신 Webhook 기반의 실시간 알림을 채택하여 운영 비용과 즉각적인 대응 사이의 균형을 유지.
- **테스트 제약**: 멀티 테넌트 간의 복잡한 상호작용 및 외부 API 의존성으로 인해 유닛 테스트보다 SQS Bridge를 통한 실제 흐름 검증에 집중.

## 8. 사용 기술

- **Backend**: Node.js, TypeScript
- **Messaging**: Redis Streams, AWS SQS/SNS
- **Storage**: MariaDB (Prisma ORM)
- **Infra**: EC2, Azure Key Vault, PM2, GitHub Actions
- **Communication**: Discord API, WebSocket (ESI Event)

## 9. 참고 링크

- **Documentation**: 프로젝트 내 온보딩 Wiki 및 설계 문서 포함.
