/**
 * /dev 커맨드 스키마 정의
 * cmd: 필수, args: 선택
 */
export function defineDevCommand() {
    return {
        key: "dev",
        discord: {
            name: "dev",
            description: "개발 명령 라우터",
            options: [
                {
                    type: 3, // STRING
                    name: "cmd",
                    description: "실행할 개발 명령",
                    required: true,
                },
                {
                    type: 3, // STRING
                    name: "args",
                    description: "명령 인자(선택)",
                    required: false,
                },
            ],
        },
        route: {
            bus: "sns",
        },
    };
}
