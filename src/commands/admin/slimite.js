// src/commands/admin/slimite.js  (pasta admin: só administradores)
import { PREFIX } from "../../config.js";
import { InvalidParameterError, WarningError } from "../../errors/index.js";
import { resolveDeviceByNumber } from "../../services/firebase.js";
import { getCentral } from "../../utils/centrals.js";
import {
  caixa,
  fmtMT,
  lerDispositivo,
  parseMT,
  setSLimite,
} from "../../utils/limites.js";

export default {
  name: "slimite",
  description: "Define o limite de saldo (MT) de cada SIM de um dispositivo.",
  commands: ["slimite"],
  usage: `${PREFIX}slimite [dispositivo] [SIM1]/[SIM2]\nEx: ${PREFIX}slimite 2 100/500`,

  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ fullArgs, remoteJid, isGroup, sendReply }) => {
    if (!isGroup) throw new WarningError("Este comando só funciona em grupos!");

    const central = getCentral(remoteJid);
    if (!central) {
      throw new WarningError("Este grupo ainda não está vinculado a uma central.");
    }

    const uso = `Use: ${PREFIX}slimite [dispositivo] [SIM1]/[SIM2]\nEx: ${PREFIX}slimite 2 100/500`;

    const a = lerDispositivo(fullArgs);
    if (!a) throw new InvalidParameterError(uso);

    const valores = parseMT(a.resto);
    if (!valores) throw new InvalidParameterError(`Valores inválidos.\n${uso}`);

    const device = await resolveDeviceByNumber(central.centralCode, a.disp);
    if (!device) {
      throw new WarningError(
        `Dispositivo ${a.disp} não encontrado! Use ${PREFIX}aparelhos para ver a lista.`,
      );
    }

    setSLimite(central.centralCode, a.disp, valores);

    await sendReply(
      caixa("✅", "LIMITE DE SALDO DEFINIDO", [
        `📱 Dispositivo ${a.disp}: ${device.deviceModel || "?"}`,
        "",
        `🔹 SIM 1: ${fmtMT(valores[0])}`,
        `🔹 SIM 2: ${fmtMT(valores[1])}`,
      ]),
    );
  },
};
