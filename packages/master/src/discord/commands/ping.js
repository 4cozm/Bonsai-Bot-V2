/**
 * ping 커맨드 스키마 정의
 * - 처리 로직은 워커(또는 라우터)로 보내도 되고, master에서 바로 응답해도 됨
 */
export function definePingCommand() {
    return {
        key: "ping",
        discord: {
            name: "ping",
            description: "핑 테스트",
            options: [],
        },
        route: {
            bus: "internal", // 지금은 예시. 원하면 "redis"로 보내도 됨
        },
    };
}
