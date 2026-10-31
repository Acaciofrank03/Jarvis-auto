// src/commands/admin/k.js  (pasta admin: só administradores)
import { PREFIX } from "../../config.js";
import { InvalidParameterError, WarningError } from "../../errors/index.js";
import { getCentral } from "../../utils/centrals.js";
import { enviarSaldo } from "../../utils/comprovativos.js";

const RX_NUMERO = /^(?:258)?(8[2-8]\d{7})$/;

export default {
  name: "k",
  description: "Envia saldo (*111#) pelo aparelho em modo Disparador de Saldo.",
  commands: ["k"],
  usage: `${PREFIX}k [dispositivo] [número] [valor]\nEx: ${PREFIX}k 3 846000001 50`,

  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ fullArgs, remoteJid, isGroup, sendReply, socket }) => {
    if (!isGroup) throw new WarningError("Este comando só funciona em grupos!");

    const central = getCentral(remoteJid);
    if (!central) {
      throw new WarningError("Este grupo ainda não está vinculado a uma central.");
    }

    const args = fullArgs.trim().split(/\s+/).filter(Boolean);
    const uso = `Use: ${PREFIX}k [dispositivo] [número] [valor]\nEx: ${PREFIX}k 3 846000001 50`;

    if (args.length < 3) throw new InvalidParameterError(uso);

    const dispositivo = parseInt(args[0], 10);
    const numero = args[1].match(RX_NUMERO)?.[1];
    const valor = Number(args[2].replace(",", "."));

    if (!dispositivo || dispositivo <= 0) {
      throw new InvalidParameterError(`Número de dispositivo inválido.\n${uso}`);
    }
    if (!numero) {
      throw new InvalidParameterError(`Número de destino inválido.\n${uso}`);
    }
    if (!Number.isFinite(valor) || valor <= 0) {
      throw new InvalidParameterError(`Valor inválido.\n${uso}`);
    }

    // mesma assinatura usada em comprovativos.js: enviar(jid, texto, mencoes)
    const enviar = (jid, texto, mencoes = []) =>
      socket.sendMessage(jid, { text: texto, mentions: mencoes });

    const r = await enviarSaldo(central.centralCode, {
      remoteJid,
      dispositivo,
      numero,
      valor,
      enviar,
    });

    if (r.erro) throw new WarningError(r.erro);
  },
};
