import { PREFIX } from "../../config.js";
import { WarningError } from "../../errors/index.js";
import { getDeviceList } from "../../services/firebase.js";
import { getCentral } from "../../utils/centrals.js";

export default {
  name: "aparelhos",
  description: "Lista os aparelhos vinculados à central deste grupo.",
  commands: ["aparelhos", "dispositivos"],
  usage: `${PREFIX}aparelhos`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ remoteJid, isGroup, sendReply }) => {
    if (!isGroup) {
      throw new WarningError("Este comando só funciona em grupos!");
    }

    const central = getCentral(remoteJid);

    if (!central) {
      throw new WarningError(
        "Este grupo ainda não está vinculado a uma central. Use .ativarauto primeiro.",
      );
    }

    const devices = await getDeviceList(central.centralCode);

    if (!devices.length) {
      throw new WarningError("Nenhum aparelho encontrado para esta central.");
    }

    let text = `🖥️ *APARELHOS DA CENTRAL ${central.centralCode}*\n────────────────────────\n`;

    for (const device of devices) {
      const tag = device.isMaster ? "⭐ (Principal)" : "🔹";
      text += `${tag} *Dispositivo ${device.numero}:* ${device.deviceModel}\n📋 Função: ${device.role}\n\n`;
    }

    text += `💡 Use o número do dispositivo em comandos como ${PREFIX}soprati.`;

    await sendReply(text);
  },
};
