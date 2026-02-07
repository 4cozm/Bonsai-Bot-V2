import dotenv from "dotenv";
import getAccessToken from "./getAccessToken.js";
import getCustomError from "../errors/index.js";
const { esiRequestError, validationError } = await getCustomError();
dotenv.config();

export const getStructureFuel = async () => {
    const corporationId = process.env.CATALIST_TOWER_CORP_ID;
    const accessToken = await getAccessToken(process.env.STRUCTURE_OWNER_DISCORD_ID, "fe in");

    try {
        if (!corporationId || !accessToken) {
            throw new validationError(
                null,
                `연료정보를 가져오는데 필요한 정보가 누락 되었습니다 \n 코퍼레이션ID:${corporationId} \n 엑세스 토큰${accessToken.slice(0, 20)}` //보안을 위해 토큰은 20자리만 출력
            );
        }
        const response = await fetch(
            `https://esi.evetech.net/latest/corporations/${corporationId}/structures/`,
            {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            }
        );

        if (!response.ok) {
            console.error(response);
            throw new esiRequestError(
                response.status,
                `연료량을 가져오기가 실패했습니다 \n getStructureFuel 에러 텍스트 ${response.statusText}`
            );
        }

        const data = await response.json();
        return data;
    } catch (error) {
        console.error("getStructureFuel에서 에러 발생:", error);
        return null;
    }
};
