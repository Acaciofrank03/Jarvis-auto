// src/commands/admin/enviar.js  (pasta admin: só administradores)
import { PREFIX } from "../../config.js";
import { InvalidParameterError, WarningError } from "../../errors/index.js";
import { getCentral } from "../../utils/centrals.js";
import { enviarMb } from "../../utils/comprovativos.js";

export default {
  name: "enviar",
  description: "Entrega MB a um número, debitando da carteira do membro.",
  commands: ["enviar"],
  usage: `${PREFIX}enviar [mb] [número]  (respondendo à mensagem do membro)`,

  handle: async ({ fullArgs, remoteJid, isGroup, webMessage, socket }) => {
    if (!isGroup) throw new WarningError("Este comando só funciona em grupos!");

    const central = getCentral(remoteJid);
    if (!central) {
      throw new WarningError("Este grupo ainda não está vinculado a uma central.");
    }

    const [a, b] = fullArgs.trim().split(/\s+/);
    const mb = parseInt((a || "").replace(/mb$/i, ""), 10);
    const m = (b || "").replace(/\D/g, "").match(/^(?:258)?(8[2-8]\d{7})$/);

    if (!mb || mb <= 0 || !m) {
      throw new InvalidParameterError(
        `Use: ${PREFIX}enviar [mb] [número], respondendo à mensagem do membro.\n` +
          `Ex: ${PREFIX}enviar 850 842898459`,
      );
    }

    // O membro é quem escreveu a mensagem respondida.
    const alvo = webMessage?.message?.extendedTextMessage?.contextInfo?.participant?.replace(
      /:[0-9]+/,
      "",
    );
    if (!alvo) {
      throw new WarningError(
        `Responda à mensagem do membro com ${PREFIX}enviar [mb] [número].`,
      );
    }

    const enviar = (j, text, mentions = []) =>
      socket.sendMessage(j, { text, mentions });

    const r = await enviarMb(central.centralCode, {
      jid: alvo,
      remoteJid,
      mb,
      numero: m[1],
      enviar,
    });

    if (r.erro) throw new WarningError(`❌ ${r.erro}`);
  },
};
