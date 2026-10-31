// src/commands/admin/issuereceipt.js  (pasta admin: só administradores)
import { PREFIX } from "../../config.js";
import { InvalidParameterError, WarningError } from "../../errors/index.js";
import { getCentral } from "../../utils/centrals.js";
import {
  extrairId,
  idValido,
  liberarComprovativo,
} from "../../utils/comprovativos.js";

export default {
  name: "issuereceipt",
  description: "Manda um comprovativo para o processamento (mesmo com as vendas pausadas).",
  commands: ["issuereceipt"],
  usage:
    `Responda à mensagem do comprovativo com ${PREFIX}issuereceipt\n` +
    `ou: ${PREFIX}issuereceipt ID1 ID2 ...`,

  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ fullArgs, remoteJid, isGroup, webMessage, socket, sendReply }) => {
    if (!isGroup) throw new WarningError("Este comando só funciona em grupos!");

    const central = getCentral(remoteJid);
    if (!central) {
      throw new WarningError("Este grupo ainda não está vinculado a uma central.");
    }

    // Mensagem respondida: dá o texto do comprovativo e o remetente (dono da carteira).
    const ctx = webMessage?.message?.extendedTextMessage?.contextInfo;
    const citada = ctx?.quotedMessage;
    const textoCitado =
      citada?.conversation ||
      citada?.extendedTextMessage?.text ||
      citada?.imageMessage?.caption ||
      citada?.documentMessage?.caption ||
      "";
    const jidCitado = ctx?.participant?.replace(/:[0-9]+/, "") || null;

    const alvos = [];
    const idCitado = textoCitado ? extrairId(textoCitado) : null;
    if (idCitado) alvos.push({ id: idCitado, jid: jidCitado, texto: textoCitado });

    const invalidos = [];
    for (const t of fullArgs.trim().split(/\s+/).filter(Boolean)) {
      const id = idValido(t);
      if (!id) invalidos.push(t);
      else if (!alvos.some((a) => a.id === id)) alvos.push({ id, jid: null, texto: "" });
    }

    if (!alvos.length) {
      throw new InvalidParameterError(
        `${invalidos.length ? `ID inválido: ${invalidos.join(", ")}\n` : ""}` +
          `Responda à mensagem do comprovativo com ${PREFIX}issuereceipt\n` +
          `ou use: ${PREFIX}issuereceipt ID1 ID2 ...`,
      );
    }

    // mesma assinatura usada em comprovativos.js: enviar(jid, texto, mencoes)
    const enviar = (j, texto, mencoes = []) =>
      socket.sendMessage(j, { text: texto, mentions: mencoes });

    const linhas = [];
    for (const a of alvos) {
      try {
        const r = await liberarComprovativo(central.centralCode, {
          id: a.id,
          jid: a.jid,
          remoteJid,
          texto: a.texto,
          enviar,
        });
        linhas.push(r.erro ? `⚠️ ${r.erro}` : `✅ ${a.id} enviado ao processamento.`);
      } catch (e) {
        linhas.push(`❌ ${a.id}: ${e.message}`);
      }
    }
    if (invalidos.length) linhas.push(`⚠️ IDs inválidos ignorados: ${invalidos.join(", ")}`);

    await sendReply(linhas.join("\n"));
  },
};
