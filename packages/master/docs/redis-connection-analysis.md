# Master Redis 커넥션 사용 분석

## 현재 구조 (apps/master/src/app.js)

- **redis**: `createRedisClient()` 1개
- **acRedis**: `createRedisClient()` 1개 (Autocomplete 전용 주석 있음)

## Redis 사용처

| 연결        | 사용처                                                                | 명령                               | 블로킹 여부            |
| ----------- | --------------------------------------------------------------------- | ---------------------------------- | ---------------------- |
| **redis**   | `startProdBridge` → `runRedisStreamsResultConsumer`                   | `xReadGroup(..., { BLOCK: 5000 })` | **예** (최대 5초 대기) |
| **redis**   | `routeInteraction` → `publishProdCommand` → `publishCmdToRedisStream` | `xAdd`                             | 아니오                 |
| **acRedis** | `routeInteraction` (autocomplete) → `handleAutocomplete`              | `rPush`, `get`, `del`              | 아니오                 |

## 문제점

**동일한 `redis` 커넥션이 블로킹 용도와 비블로킹 용도에 동시에 사용됨.**

- `runRedisStreamsResultConsumer`가 **같은 redis**로 `xReadGroup(..., BLOCK: 5000)`을 반복 호출하면, 그 커넥션은 최대 5초까지 블로킹됨.
- 이때 사용자가 슬래시 명령을 치면 `publishProdCommand`가 **같은 redis**로 `xAdd`를 호출함.
- node-redis에서는 블로킹 호출이 끝나기 전까지 같은 커넥션에 쌓인 명령이 실행되지 않으므로, **명령 발행이 최대 약 5초까지 지연**될 수 있음.

즉, **result 소비용 BLOCK과 명령 발행용 xAdd가 한 커넥션을 공유**해서, 블로킹 구간 동안 발행이 밀리는 문제가 있음.

## Worker 쪽과의 대비

- Worker는 **redis**(XREAD BLOCK용)와 **acRedis**(autocomplete BLPOP/SET용)를 분리해 두어 블로킹과 즉시 응답이 한 커넥션을 같이 쓰지 않도록 되어 있음.
- Master는 autocomplete만 acRedis로 분리하고, **result 소비(BLOCK)와 명령 발행(xAdd)은 둘 다 redis**를 쓰고 있음.

## 권장 수정

- **result 소비**: `redis`만 사용 (변경 없음).
- **명령 발행 (publishProdCommand)**: `redis` 대신 **acRedis** 사용.
    - 즉 `routeInteraction`에서 슬래시 명령(prod) 처리 시 `publishProdCommand(..., { redis: acRedis })`로 넘기면, BLOCK과 xAdd가 서로 다른 커넥션을 쓰게 되어 블로킹으로 인한 발행 지연이 사라짐.
- acRedis는 이미 autocomplete에서만 쓰이므로, 여기에 prod 명령 발행까지 묶어도 동시 사용량이 크게 늘지 않음.

수정 위치: `packages/master/src/discord/interactionRouter.js`  
prod 경로에서 `publishProdCommand` 호출 시 두 번째 인자를 `{ redis: acRedis ?? redis }`(발행용 `pubRedis`)로 변경해 적용함. result 소비는 `redis`만, 명령 발행은 `acRedis`(있을 때)만 사용.
