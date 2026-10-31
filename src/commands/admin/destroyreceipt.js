// src/commands/admin/destroyreceipt.js  (pasta admin: só administradores)
import { PREFIX } from "../../config.js";
import { InvalidParameterError, WarningError } from "../../errors/index.js";
import { getCentral } from "../../utils/centrals.js";
import {
  destruirComprovativo,
  extrairId,
  idValido,
} from "../../utils/comprovativos.js";

// Estados em que o dinheiro já entrou na carteira ou o pedido já saiu: destruir o ID não reverte isso.
const JA_PROCESSADOS = ["CARTEIRA", "EM_ANDAMENTO", "ENTREGUE", "CONSUMIDO"];

export default {
  name: "destroyreceipt",
  description: "Destrói o ID de um comprovativo: ele nunca mais será aceito.",
  commands: ["destroyreceipt"],
  usage:
    `${PREFIX}destroyreceipt ID1 ID2 ...\n` +
    `ou responda à mensagem do comprovativo com ${PREFIX}destroyreceipt`,

  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ fullArgs, remoteJid, isGroup, webMessage, sendReply }) => {
    if (!isGroup) throw new WarningError("Este comando só funciona em grupos!");

    const central = getCentral(remoteJid);
    if (!central) {
      throw new WarningError("Este grupo ainda não está vinculado a uma central.");
    }

    const ctx = webMessage?.message?.extendedTextMessage?.contextInfo;
    const citada = ctx?.quotedMessage;
    const textoCitado =
      citada?.conversation ||
      citada?.extendedTextMessage?.text ||
      citada?.imageMessage?.caption ||
      citada?.documentMessage?.caption ||
      "";

    const ids = [];
    const idCitado = textoCitado ? extrairId(textoCitado) : null;
    if (idCitado) ids.push(idCitado);

    const invalidos = [];
    for (const t of fullArgs.trim().split(/\s+/).filter(Boolean)) {
      const id = idValido(t);
      if (!id) invalidos.push(t);
      else if (!ids.includes(id)) ids.push(id);
    }

    if (!ids.length) {
      throw new InvalidParameterError(
        `${invalidos.length ? `ID inválido: ${invalidos.join(", ")}\n` : ""}` +
          `Use: ${PREFIX}destroyreceipt ID1 ID2 ...\n` +
          `ou responda à mensagem do comprovativo com ${PREFIX}destroyreceipt`,
      );
    }

    const por = webMessage?.key?.participant?.replace(/:[0-9]+/, "") || null;

    const linhas = [];
    for (const id of ids) {
      try {
        const { antes } = await destruirComprovativo(central.centralCode, { id, por });
        linhas.push(
          JA_PROCESSADOS.includes(antes)
            ? `⚠️ ${id} destruído, mas já estava "${antes}": saldo e pedido não foram revertidos.`
            : `🗑️ ${id} destruído.`,
        );
      } catch (e) {
        linhas.push(`❌ ${id}: ${e.message}`);
      }
    }
    if (invalidos.length) linhas.push(`⚠️ IDs inválidos ignorados: ${invalidos.join(", ")}`);

    await sendReply(linhas.join("\n"));
  },
};
