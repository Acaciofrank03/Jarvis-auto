// src/commands/admin/mlimite.js  (pasta admin: só administradores)
import { PREFIX } from "../../config.js";
import { InvalidParameterError, WarningError } from "../../errors/index.js";
import { resolveDeviceByNumber } from "../../services/firebase.js";
import { getCentral } from "../../utils/centrals.js";
import {
  caixa,
  fmtEnvios,
  lerDispositivo,
  parseMLimite,
  setMLimite,
} from "../../utils/limites.js";

export default {
  name: "mlimite",
  description: "Define envios feitos/limite de megas em cada SIM de um dispositivo.",
  commands: ["mlimite"],
  usage: `${PREFIX}mlimite [dispositivo] [feitos/limite],[feitos/limite]\nEx: ${PREFIX}mlimite 2 0/10,10/10`,

  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ fullArgs, remoteJid, isGroup, sendReply }) => {
    if (!isGroup) throw new WarningError("Este comando só funciona em grupos!");

    const central = getCentral(remoteJid);
    if (!central) {
      throw new WarningError("Este grupo ainda não está vinculado a uma central.");
    }

    const uso = `Use: ${PREFIX}mlimite [dispositivo] [feitos/limite],[feitos/limite]\nEx: ${PREFIX}mlimite 2 0/10,10/10`;

    const a = lerDispositivo(fullArgs);
    if (!a) throw new InvalidParameterError(uso);

    const valores = parseMLimite(a.resto);
    if (!valores) throw new InvalidParameterError(`Valores inválidos.\n${uso}`);

    const device = await resolveDeviceByNumber(central.centralCode, a.disp);
    if (!device) {
      throw new WarningError(
        `Dispositivo ${a.disp} não encontrado! Use ${PREFIX}aparelhos para ver a lista.`,
      );
    }

    setMLimite(central.centralCode, a.disp, valores);

    await sendReply(
      caixa("✅", "LIMITE DE ENVIOS DEFINIDO", [
        `📱 Dispositivo ${a.disp}: ${device.deviceModel || "?"}`,
        "",
        `🔹 SIM 1: ${fmtEnvios(valores[0])}`,
        `🔹 SIM 2: ${fmtEnvios(valores[1])}`,
      ]),
    );
  },
};
