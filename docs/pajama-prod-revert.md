# 프로덕션 배포 전 체크리스트

테스트 시 임시 수정하는 항목 목록. 배포 전 반드시 원복할 것.

---

## 1. `.env`

**테스트 시 추가**:
```
PAJAMA_TEST_STRUCTURE_IDS=1051025995560
PAJAMA_TARGET_POLL_MS=6000
```

**배포 시**: 위 2줄 제거

---

## 2. `packages/worker/src/pajama/index.js`

**테스트 시**: 테스트용 CA_TYPE_IDS 활성화

```js
// const CA_TYPE_IDS = Object.freeze([2082, 2589, 33393, 33394]);  ← 주석
// 테스트용
const CA_TYPE_IDS = Object.freeze([2082, 2589, 33393, 33394, 22559, 13209]);
```

**배포 시**: 프로덕션 값으로 원복

```js
const CA_TYPE_IDS = Object.freeze([2082, 2589, 33393, 33394]);
```
