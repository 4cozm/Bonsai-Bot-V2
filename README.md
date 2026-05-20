# Bonsai-Bot-V2 (Backend / Discord Operations)

[![Node.js](https://img.shields.io/badge/Node.js-v20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Redis](https://img.shields.io/badge/Redis-v7-DC382D?logo=redis&logoColor=white)](https://redis.io/)
[![AWS SQS](https://img.shields.io/badge/AWS%20SQS-Service-FF9900?logo=amazon-aws&logoColor=white)](https://aws.amazon.com/sqs/)
[![MySQL](https://img.shields.io/badge/MySQL-v8-4479A1?logo=mysql&logoColor=white)](https://www.mysql.com/)
[![Prisma](https://img.shields.io/badge/Prisma-v6-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/)
[![Azure Key Vault](https://img.shields.io/badge/Azure%20Key%20Vault-Security-0078D4?logo=microsoft-azure&logoColor=white)](https://azure.microsoft.com/services/key-vault/)

> **EVE Online의 실시간 인게임 이벤트를 Discord로 중계하고, 다중 코퍼레이션(Multi-Tenant) 환경에서 인게임 접속 없이 운영을 자동화하는 비동기 이벤트 기반 백엔드 시스템입니다.**  
> _본 저장소는 실시간 3초 응답 보장, 물리적/논리적 테넌트 격리, 로컬-클라우드 간 하이브리드 디버깅 인프라 구축 등 엔지니어링 사례 중심으로 작성되었습니다._

---

## 1. 아키텍처 및 데이터 파이프라인

본 시스템은 플랫폼 정책인 'Discord Interaction 3초 제한'을 무조건 충족하면서, 무거운 외부 ESI API 연동과 대량의 마켓 분석 쿼리를 안정적으로 수행하기 위해 **메시징 기반의 완전 비동기 이벤트 분산 아키텍처**를 채택했습니다.

### 전체 시스템 구성도 (System Overview)

```mermaid
graph LR
    subgraph Client["Client (Discord)"]
        D["Discord App"]
    end
    subgraph Master["Master Layer (ECS/EC2)"]
        Router["Interaction Router"]
        ProdBridge["Prod Bridge (Result Listener)"]
    end
    subgraph EventBus["Event Bus & Queue Layer"]
        RStream["Redis Streams (bonsai:cmd:tenant)"]
        RList["Redis List (bonsai:ac:tenant)"]
        SQS["AWS SQS (Dev Result Queue)"]
    end
    subgraph Worker["Worker Layer (ECS/EC2)"]
        WCommand["Command Consumer"]
        WAC["Autocomplete Consumer"]
        Cron["Cron Scheduler"]
    end
    subgraph Storage["Storage & External API"]
        Prisma["Prisma ORM (MySQL)"]
        ESI["EVE Online ESI API"]
        KeyVault["Azure Key Vault"]
    end

    D -- "Interactions" --> Router
    Router -- "1. Defer Reply" --> D
    Router -- "2. Publish Command" --> RStream
    Router -- "2. Fast-Path Autocomplete" --> RList

    RStream --> WCommand
    RList --> WAC

    WCommand -- "3. Query / Mutation" --> Prisma
    WCommand -- "3. ESI Fetch" --> ESI
    WAC -- "3. Fast Search" --> Prisma

    WCommand -- "4. Publish Result" --> RStream
    WAC -- "4. Fast Write" --> RList

    ProdBridge -- "5. Polling / Consume" --> RStream
    ProdBridge -- "5. Polling Dev Queue" --> SQS
    ProdBridge -- "6. Edit Reply" --> D
```

### 1.1 핵심 데이터 흐름 (Core Data Flow)

일반적인 슬래시 명령어 입력 시 수행되는 비동기 라이프사이클과, 타임아웃 극복을 위해 설계된 Autocomplete 초고속 경로(Fast-Path)의 처리 흐름은 아래와 같습니다.

```mermaid
sequenceDiagram
    autonumber
    actor User as Discord User
    participant Discord as Discord Server
    participant Master as Master Tenant (EC2)
    participant Redis as Redis (Streams / List)
    participant Worker as Worker Tenant (EC2)
    participant DB as MySQL (Prisma)

    %% 일반 명령어 처리 흐름 (Deferred Command Flow)
    rect rgb(230, 245, 255)
        note right of User: 일반 명령어 처리 흐름 (비동기 Deferred Flow)
        User->>Discord: /명령어 입력 (예: /캐릭터 정보)
        Discord->>Master: Interaction (ChatInputCommand)
        Master->>Discord: 1. Defer Reply (3초 제한 돌파, 대기 상태 설정)
        Master->>Redis: 2. XADD bonsai:cmd:{tenantKey} (Envelope 발행)
        Note over Master, Redis: Master는 pendingMap에 Interaction을 등록하고 대기

        Redis->>Worker: 3. XREADGROUP (Command Consumer)
        Worker->>DB: 4. 비즈니스 로직 처리 (조회 / 갱신)
        Worker->>Redis: 5. XADD bonsai:result (Result Envelope 발행)
        Worker->>Redis: 6. XACK (명령 스트림 소비 완료)

        Redis->>Master: 7. XREADGROUP (Result Consumer 결과 획득)
        Master->>Discord: 8. editReply (최종 응답 전달)
        Discord->>User: 결과 화면 렌더링
    end

    %% Autocomplete Fast-Path 흐름
    rect rgb(240, 255, 240)
        note right of User: Autocomplete 초고속 경로 (Fast-Path Flow)
        User->>Discord: 입력창에 타이핑 시작 (포커스 값 변경)
        Discord->>Master: Interaction (Autocomplete)
        Master->>Redis: 1. RPUSH bonsai:ac:{tenantKey} (Fast-Path 요청)

        Note over Master, Redis: Master는 50ms 간격으로 결과 캐시 폴링 시작 (최대 2.5초)
        Redis->>Worker: 2. BLPOP (Autocomplete Consumer 즉시 획득)
        Worker->>DB: 3. DB 캐릭터명/인덱스 기반 빠른 검색
        Worker->>Redis: 4. SET bonsai:ac:res:{requestId} (결과 임시 캐싱, EX 10)

        Redis->>Master: 5. GET 결과 확인 (폴링 성공)
        Master->>Discord: 6. respond(choices) (즉각 응답)
        Discord->>User: 입력창 아래 추천 검색어 리스트 노출
    end
```

---

## 2. 주요 엔지니어링 챌린지

### Case 1. Multi-Tenant 논리 격리 및 분산 락 기반 무중단 동적 마이그레이션 아키텍처

- **배경 & 문제**: 단일 코드베이스에서 여러 테넌트(EVE Online 얼라이언스)를 격리 관리하기 위해 멀티 테넌트 아키텍처를 도입했습니다. 신규 테넌트의 가입이나 스키마 패치 시, 각 테넌트 DB의 유무 확인 및 마이그레이션을 자동화해야 했습니다. 그러나 다중 복제된 워커 인스턴스(예: PM2 클러스터, 컨테이너 스케일 아웃)가 동시에 실행될 때, 여러 워커가 동일한 테넌트 DB에 마이그레이션을 중복 실행하여 **스키마 충돌(Schema Collision)** 및 **DB 데드락**이 기동 시점에 유발되었습니다. 또한 관리자의 환경 설정 실수로 특정 워커가 잘못된 테넌트의 DB에 오연동되어 데이터가 유실되거나 노출되는 **격리 파괴(Data Leak) 리스크**가 상존했습니다.

    **[문제 구조] 다중 프로세스의 마이그레이션 중복 충돌**

    ```mermaid
    graph TD
        subgraph MultiInstance["다중 워커 동시 기동 시점"]
            W1["Worker Instance 1"]
            W2["Worker Instance 2"]
        end
        subgraph DB["Target Tenant DB"]
            Schema["Prisma Schema / Database"]
        end

        W1 -- "1. prisma migrate deploy (실행)" --> Schema
        W2 -- "2. prisma migrate deploy (동시 실행)" --> Schema
        Schema -- "3. 중복 DDL 수행" --> Crash["❌ DB Lock & 스키마 충돌 발생"]
    ```

- **기술적 해결 전략**:
    1. **동적 DB URL 결정 및 캐싱**: `getPrisma(tenantKey)`를 통해 런타임에 테넌트별 독립적인 PrismaClient를 동적으로 할당하고 메모리에 캐싱하여 커넥션 풀을 효율적으로 관리하도록 설계했습니다.
    2. **Redis 분산 락을 통한 동시 마이그레이션 제어**: `bonsai:migrate:lock:{tenantKey}` 락을 획득한 하나의 프로세스만 마이그레이션을 수행하고, 나머지는 락 획득 실패 시 에러를 던져 중복 실행을 원천 차단했습니다.
    3. **Fail-Fast 테넌트 메타 검증**: 런타임에 DB 내부 `TenantMeta` 테이블에 기록된 `tenantKey`와 현재 워커의 `tenantKey`를 일치 검증(Fail-Fast)하여, 불일치할 시 프로세스를 강제 종료(`process.exit(1)`)하도록 보완장치를 설계했습니다.

    `packages/worker/src/db/prisma.js`

    ```javascript
    // 1. Redis 분산 락 획득을 통한 동시 마이그레이션 차단
    async function acquireMigrateLock(redis, tenantKey, log) {
        const key = MIGRATE_LOCK_KEY_PREFIX + tenantKey;
        const ok = await redis.set(key, process.pid + "", { NX: true, EX: MIGRATE_LOCK_TTL_SEC });
        if (!ok) {
            log.warn("[db] migrate 락 획득 실패(다른 프로세스가 실행 중?)", { tenantKey });
            throw new Error("테넌트 DB migrate 락 획득 실패. 잠시 후 재시도하세요.");
        }
    }

    // 2. 테넌트 불일치 시 프로세스 강제 종료 (Fail-Fast 안전장치)
    async function ensureAndValidateTenantMeta(prisma, tenantKey, log) {
        await prisma.tenantMeta.upsert({
            where: { tenantKey },
            create: { tenantKey },
            update: {},
        });
        const row = await prisma.tenantMeta.findFirst();
        if (!row || row.tenantKey !== tenantKey) {
            log.error("[db] fail-fast: 연결된 DB의 tenantKey가 이 워커와 불일치", {
                expected: tenantKey,
                got: row?.tenantKey ?? null,
            });
            process.exit(1);
        }
    }
    ```

- **결과**:
    - 인프라 복제 수량과 관계없이 단 1회만 안전하게 DB 마이그레이션이 무중단 적용됩니다.
    - 잘못 설정된 테넌트의 기동을 부팅 단계에서 즉각 차단하여 테넌트 간의 잠재적 데이터 혼선을 원천 배제하고 무결성을 유지할 수 있도록 하였습니다.

---

### Case 2. Discord Autocomplete API 3초 한계 극복을 위한 Fast-Path 라우팅 설계

- **배경 & 문제**: Discord의 `autocomplete` 기능은 유저가 글자를 칠 때마다 즉각 추천 단어(캐릭터명, 아이템 등)를 제시해야 하므로 3초 내에 응답을 반환해야 합니다. 하지만 일반 명령어 처리는 무거운 ESI 외부 API 조회, 복잡한 비즈니스 쿼리로 인해 수 초간 지연될 수 있습니다. 일반 명령 큐(Redis Streams)에 Autocomplete 요청이 함께 대기할 경우, 앞선 무거운 작업들이 큐를 점유함에 따라 **Head-of-Line (HoL) Blocking**이 발생하여 Autocomplete 응답이 3초의 플랫폼 타임아웃을 빈번히 초과해 실패했습니다.

    **[문제 구조] 단일 메시지 큐의 병목으로 인한 타임아웃**

    ```mermaid
    sequenceDiagram
        participant Queue as 단일 Redis Streams 큐
        participant Worker as Worker

        note over Queue: [무거운 ESI API 명령어] -> [무거운 통계 명령어] -> [Autocomplete 요청]
        Queue->>Worker: 1. 무거운 ESI API 명령어 처리 중 (2.5초 소요)
        Queue->>Worker: 2. 무거운 통계 명령어 처리 중 (1.8초 소요)
        Note over Queue: Autocomplete 요청이 큐 뒤편에서 지연됨 (HoL Blocking)
        Queue->>Worker: 3. Autocomplete 요청 도달 (이미 4초 경과)
        Note over Worker: ❌ Discord Autocomplete 3초 타임아웃 초과로 실패
    ```

- **기술적 해결 전략**:
    1. **초고속 Fast-Path 전용 큐 설계**: 일반 비즈니스 큐와 물리적으로 분리된 `RPUSH bonsai:ac:{tenantKey}` (Redis List) 기반의 Fast-Path 큐를 생성했습니다.
    2. **독립된 Redis Client 및 BLPOP 소비**: 자동완성 전용 `acRedis` 인스턴스를 추가 개설하여 일반 명령어용 `XREAD BLOCK` 대기와 무관하게 즉시 `BLPOP`으로 소비하도록 분리했습니다.
    3. **임시 결과 키 폴링 브릿지**: Master가 요청을 큐에 삽입한 후, 50ms 간격으로 `bonsai:ac:res:{requestId}`의 임시 키 값을 동기식으로 폴링하여 결과가 생성되는 즉시 반환하도록 설계했습니다.

    `packages/master/src/usecases/handleAutocomplete.js`

    ```javascript
    export async function handleAutocomplete(interaction, { redis }) {
        const channelId = String(interaction.channelId ?? "").trim();
        const tenantKey = resolveTenantKey(channelId);
        if (!tenantKey) return [];

        const commandName = String(interaction.commandName ?? "").trim();
        const discordUserId = String(interaction.user?.id ?? "").trim();
        const focusedValue = String(interaction.options?.getFocused?.() ?? "").trim();

        const requestId = randomUUID();
        const listKey = `bonsai:ac:${tenantKey}`;
        const resKey = `bonsai:ac:res:${requestId}`;

        const payload = JSON.stringify({ requestId, commandName, discordUserId, focusedValue });
        // Fast-Path List 큐에 즉시 푸시
        await redis.rPush(listKey, payload);

        // 50ms 간격 초고속 폴링 (최대 2.5초 타임아웃 적용)
        const deadline = Date.now() + POLL_TIMEOUT_MS;
        while (Date.now() < deadline) {
            const raw = await redis.get(resKey);
            if (raw != null) {
                redis.del(resKey).catch(() => {});
                try {
                    const choices = JSON.parse(raw);
                    return Array.isArray(choices) ? choices : [];
                } catch {
                    return [];
                }
            }
            await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        }
        redis.del(resKey).catch(() => {});
        return [];
    }
    ```

- **결과**:
    - 일반 백엔드 비즈니스 로직에 병목이 발생하여 큐가 밀리더라도, Autocomplete 요청은 일반 명령어 큐의 점유 상태와 무관하게 별도 채널을 통해 독립 처리되어, 3초 플랫폼 타임아웃 내에 안정적으로 응답하도록 동작하게 되었습니다.

---

### Case 3. 하이브리드 이벤트 리스너(Redis Streams & AWS SQS)를 통한 로컬-클라우드 간 디버깅 격리 인프라

- **배경 & 문제**: EVE Online의 OAuth2 및 실시간 ESI API는 엄격한 보안 제약과 인증 토큰 구조를 갖추고 있습니다. 개발자의 로컬 환경에서 백엔드 로직을 개발하고 디버깅하려면 실제 Discord 연동 테스트가 필수적이나, 방화벽 제약 등으로 로컬 환경과 클라우드 운영 환경 간 직접적인 통신(Direct Connection) 구축이 어려웠습니다. 또한 로컬 개발 중인 워커가 운영계 큐의 명령을 가로채거나 데이터 오염을 유발할 위험이 있었고, 협업 개발을 진행할 때마다 각자의 로컬 비밀키 설정 및 관리 복잡도가 매우 높았습니다.

    **[문제 구조] 로컬 환경과 퍼블릭 클라우드 간의 직접 네트워크 단절**

    ```mermaid
    graph TD
        subgraph CloudEnv["Cloud Production Env"]
            MasterProd["Prod Master (EC2)"]
        end
        subgraph LocalEnv["Local Development Env"]
            WorkerDev["Developer Local Worker"]
        end
        MasterProd -. "❌ Direct Connection Blocked" .-> WorkerDev
    ```

- **기술적 해결 전략**:
    1. **하이브리드 결과 리스너 도입**: 운영 Master에 Redis Streams (`bonsai:result`)뿐만 아니라, AWS SQS (`PROD_SQS_RESULT_QUEUE_URL`)로부터 메시지를 동시 획득할 수 있는 하이브리드 리스너(`startProdBridge`)를 구축했습니다.
    2. **브릿지 라우터 및 Dev/Prod 격리**: `/dev` 슬래시 명령어 입력 시 개발자 고유 권한(`resolveTargetDev`)을 식별하여 해당 개발자의 AWS SQS를 통해 로컬 환경의 워커로 라우팅되도록 환경을 격리했습니다.
    3. **Idempotent Acknowledgment (멱등성 보장 유실 방지)**: SQS에서 가져온 결과가 현재 이 Master 인스턴스의 메모리 `pendingMap`에 존재하지 않을 경우(즉, 다른 복제본 Master가 보낸 요청이거나 이미 타임아웃된 경우), 큐에서 메시지를 강제로 지우지(Delete) 않고 보존하여 데이터 정합성 유실을 방지했습니다.

    `packages/master/src/initialize/startProdBridge.js`

    ```javascript
    // 1. 하이브리드 결과 수신 (Redis Stream + SQS Multi-Channel Listen)
    export async function startProdBridge({ redis, pendingMap, signal } = {}) {
        const redisLoop = runRedisStreamsResultConsumer({
            redis,
            signal,
            group: "bonsai-prodmaster",
            consumer: `prodmaster-${process.pid}`,
            onResult: async (resultEnv) => {
                await handleResult({ resultEnv, pendingMap, source: "redis" });
            },
        });

        const sqsEnabled =
            String(process.env.AWS_REGION ?? "").trim() &&
            String(process.env.PROD_SQS_RESULT_QUEUE_URL ?? "").trim();

        const sqsLoop = sqsEnabled
            ? startSqsResultPolling({ pendingMap, signal })
            : (async () => {
                  log.info("[prodBridge] SQS(result) 비활성");
              })();

        await Promise.allSettled([redisLoop, sqsLoop]);
    }

    // 2. 멱등성 및 정합성 보장 큐 클린업
    const handled = await handleResult({ resultEnv, pendingMap, source: "sqs" });
    if (handled && receipt) {
        // 본인이 처리 완료한 결과인 경우에만 SQS 큐에서 최종 삭제하여 유실 방지
        await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receipt }));
    }
    ```

- **결과**:
    - 로컬 개발 환경에서 퍼블릭 클라우드에 연동된 Discord 봇을 활용한 E2E 흐름 전반을 디버깅할 수 있는 환경이 갖춰졌습니다.
    - 여러 명의 개발자가 각자의 로컬 PC에서 상호 간섭이나 운영 서버 중단 없이 안전하게 협업하는 하이브리드 멀티 테넌트 개발 인프라가 안착되었습니다.

---

## 3. 핵심 기술적 트레이드오프

### 3.1 단일 프로세스 논리 격리 vs 물리 컨테이너 격리

- **의사결정**: 비용 효율성과 초기 아키텍처 단순화를 위해 하나의 프로세스(PM2) 내에서 테넌트별 채널 ID를 식별하여 논리적으로 분기하고 DB 커넥션을 동적 캐싱하는 **논리 격리 방식**을 선택했습니다.
- **트레이드오프**:
    - _얻은 이점 (Gain)_: 신규 얼라이언스 테넌트가 추가될 때마다 별도의 봇 인스턴스나 컨테이너를 증설하지 않아도 되므로 인프라 리소스 관리 비용이 획기적으로 절감됩니다.
    - _고려해야 할 리스크 (Loss)_: 특정 테넌트의 비정상적인 트래픽이나 무거운 DB 쿼리가 프로세스 전체의 리소스를 선점할 경우, 다른 테넌트의 응답 지연을 유발할 수 있습니다.
    - _보완책 (Mitigation)_: Redis Streams와 Fast-Path Autocomplete 전용 큐를 물리 격리 설계하여 병목을 분산시켰으며, 향후 부하가 급증하는 특정 테넌트에 대해서는 해당 `tenantKey`만을 필터링하는 전용 독립 워커 컨테이너를 언제든 유연하게 분할할 수 있도록 느슨하게 결합하도록 설계했습니다.

### 3.2 임시 캐시 폴링 vs 웹소켓 양방향 커넥션

- **의사결정**: Autocomplete 응답을 처리할 때, Master-Worker 간 양방향 웹소켓 커넥션을 유지하는 대신, Worker가 결과를 Redis 임시 캐시에 쓰고 Master가 이를 50ms 주기로 폴링(Polling)하는 **임시 캐시 폴링 방식**을 채택했습니다.
- **트레이드오프**:
    - _얻은 이점 (Gain)_: Master와 Worker 간의 복잡한 커넥션 생명주기 관리, 핸드셰이크, 커넥션 유실 시의 재연결 및 재시도 로직 등 상태 유지(Stateful)의 복잡성을 완전히 배제하고 서버를 무상태(Stateless) 구조로 단순하게 유지할 수 있습니다.
    - _고려해야 할 리스크 (Loss)_: 50ms 단위의 짧은 폴링 주기로 인해 Redis 서버에 미세한 읽기 오버헤드가 발생하며, 응답 시 최대 50ms의 대기 Latency가 이론적으로 추가됩니다.
    - _보완책 (Mitigation)_: Autocomplete 요청에 한하여 임시 결과 키의 TTL을 10초로 설정해 메모리 누수를 차단했습니다. Redis에 대한 추가 읽기 오버헤드는 트래픽 규모 대비 미미한 수준으로, 아키텍처 단순함을 확보하는 것과의 상충 비용으로 수용 가능하다고 판단했습니다.

---

## 4. 기술 스택

| 구분                | 기술                                    | 역할                                                                   |
| ------------------- | --------------------------------------- | ---------------------------------------------------------------------- |
| **Core Backend**    | Node.js (v20+ ES Module)                | 전체 서버 구동 및 런타임 환경 제공                                     |
| **Messaging**       | Redis (Streams, List, Distributed Lock) | E2E 요청-응답 비동기 큐, 자동완성 Fast-Path, DB 마이그레이션 상호 배제 |
| **Cloud Bridge**    | AWS SQS, AWS SNS                        | 로컬 디바이스 디버깅 중계 및 비동기 이벤트 분산 전달                   |
| **Database**        | Prisma Client, MySQL                    | 테넌트 격리형 관계형 데이터 보존 및 동적 런타임 스키마 마이그레이션    |
| **Configuration**   | Azure Key Vault, dotenv                 | 분산 환경 변수 중앙식 제어 및 런타임 비밀 정보 주입                    |
| **Process Control** | PM2                                     | 프로세스 영속 보장 및 무중단 리로드 지원                               |

---

## 부록: 개발 환경 셋업

### 1. 환경 변수 (.env)

중앙 집중식 비밀 관리를 위해 `Azure Key Vault`를 사용하므로 로컬 환경 셋업을 위해 아래 항목만을 정의합니다.

```env
isDev=true
TENANT=global  # 또는 특정 테넌트 키
DATABASE_URL=mysql://app_user:password@localhost:3306/bonsai_dev
MYSQL_ADMIN_URL=mysql://root:root_password@localhost:3306/
```

### 2. 패키지 설치 및 빌드

모노레포 환경으로 설계되어 루트 디렉토리에서 한 번의 명령어로 전체 의존성을 획득합니다.

```bash
npm install
npm run db:generate
```

### 3. 로컬 워커 구동

```bash
npm run dev
```
