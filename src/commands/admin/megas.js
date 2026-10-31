// src/commands/admin/megas.js  (pasta admin: só administradores)
import { PREFIX } from "../../config.js";
import { InvalidParameterError, WarningError } from "../../errors/index.js";
import { resolveDeviceByNumber } from "../../services/firebase.js";
import { getCentral } from "../../utils/centrals.js";
import {
  caixa,
  fmtMegas,
  lerDispositivo,
  parseMegas,
  setMegas,
} from "../../utils/limites.js";

export default {
  name: "megas",
  description: "Define os megas disponíveis em cada SIM de um dispositivo.",
  commands: ["megas"],
  usage: `${PREFIX}megas [dispositivo] [SIM1]/[SIM2]\nEx: ${PREFIX}megas 2 50gb/900mb`,

  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ fullArgs, remoteJid, isGroup, sendReply }) => {
    if (!isGroup) throw new WarningError("Este comando só funciona em grupos!");

    const central = getCentral(remoteJid);
    if (!central) {
      throw new WarningError("Este grupo ainda não está vinculado a uma central.");
    }

    const uso = `Use: ${PREFIX}megas [dispositivo] [SIM1]/[SIM2]\nEx: ${PREFIX}megas 2 50gb/900mb`;

    const a = lerDispositivo(fullArgs);
    if (!a) throw new InvalidParameterError(uso);

    const valores = parseMegas(a.resto);
    if (!valores) throw new InvalidParameterError(`Valores inválidos.\n${uso}`);

    const device = await resolveDeviceByNumber(central.centralCode, a.disp);
    if (!device) {
      throw new WarningError(
        `Dispositivo ${a.disp} não encontrado! Use ${PREFIX}aparelhos para ver a lista.`,
      );
    }

    setMegas(central.centralCode, a.disp, valores);

    await sendReply(
      caixa("✅", "MEGAS DEFINIDOS", [
        `📱 Dispositivo ${a.disp}: ${device.deviceModel || "?"}`,
        "",
        `🔹 SIM 1: ${fmtMegas(valores[0])}`,
        `🔹 SIM 2: ${fmtMegas(valores[1])}`,
      ]),
    );
  },
};
