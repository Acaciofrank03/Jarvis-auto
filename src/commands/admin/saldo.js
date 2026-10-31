// src/commands/admin/saldo.js  (pasta admin: só administradores)
import { PREFIX } from "../../config.js";
import { InvalidParameterError, WarningError } from "../../errors/index.js";
import { resolveDeviceByNumber } from "../../services/firebase.js";
import { getCentral } from "../../utils/centrals.js";
import {
  caixa,
  fmtMT,
  lerDispositivo,
  parseMT,
  setSaldo,
} from "../../utils/limites.js";

export default {
  name: "saldo",
  description: "Define o saldo (MT) disponível em cada SIM de um dispositivo.",
  commands: ["saldo"],
  usage: `${PREFIX}saldo [dispositivo] [SIM1]/[SIM2]\nEx: ${PREFIX}saldo 2 100/500`,

  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ fullArgs, remoteJid, isGroup, sendReply }) => {
    if (!isGroup) throw new WarningError("Este comando só funciona em grupos!");

    const central = getCentral(remoteJid);
    if (!central) {
      throw new WarningError("Este grupo ainda não está vinculado a uma central.");
    }

    const uso = `Use: ${PREFIX}saldo [dispositivo] [SIM1]/[SIM2]\nEx: ${PREFIX}saldo 2 100/500`;

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

    setSaldo(central.centralCode, a.disp, valores);

    await sendReply(
      caixa("✅", "SALDO DEFINIDO", [
        `📱 Dispositivo ${a.disp}: ${device.deviceModel || "?"}`,
        "",
        `🔹 SIM 1: ${fmtMT(valores[0])}`,
        `🔹 SIM 2: ${fmtMT(valores[1])}`,
      ]),
    );
  },
};
