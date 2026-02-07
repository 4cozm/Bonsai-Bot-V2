import cron from "node-cron";
import { structureTypeMapping } from "../commands/utility/structureFuelAmount.js";
import { discordAlert } from "../utils/discordAlert.js";
import { getStructureFuel } from "./getStructureFuelData.js";

const alertRemainDate = 30; // 30일 이하로 떨어지면 알림

export const checkStructureFuelPerDay = () => {
    console.log("연료 잔여량 경고 체커 등록 완료");

    cron.schedule("0 12 * * *", async () => {
        try {
            const structures = await getStructureFuel();
            if (!structures || structures.length === 0) {
                await discordAlert(
                    "404",
                    "스트럭쳐 연료량 자동 검사중 스트럭쳐 정보를 가져오지 못했어요. ESI가 아플지두?..<a:Bongocat_Wave:996295763908907058>"
                );
                return;
            }

            const now = new Date();
            let alerted = false;

            for (const structure of structures) {
                const { name, fuel_expires, type_id } = structure;
                const expiresDate = new Date(fuel_expires);
                const remainingDays = Math.ceil((expiresDate - now) / (1000 * 60 * 60 * 24));

                if (remainingDays <= alertRemainDate) {
                    const buildingType = structureTypeMapping[type_id] || {
                        name: "알 수 없음",
                        emoji: ":question:",
                    };
                    const displayType = `${buildingType.emoji} ${buildingType.name}`;
                    await discordAlert(
                        "알림",
                        `연료가 ${remainingDays}일 남았습니다 ${name}(${displayType})`
                    );
                    alerted = true;
                }
            }

            if (!alerted) {
                await discordAlert(
                    "채팅",
                    "연료 검사 완료! 현재 모든 건물의 연료가 안전 범위 입니다."
                );
            }
        } catch (error) {
            await discordAlert("404", "연료 부족 알림 중 오류 발생");
        }
    });
};
