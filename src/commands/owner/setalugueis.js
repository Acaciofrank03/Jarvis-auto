import { PREFIX } from "../../config.js";
import { WarningError } from "../../errors/index.js";
import { isBotOwner } from "../../middlewares/index.js";
import { setGrupoAlugueis, getGrupoAlugueis, removeGrupoAlugueis } from "../../utils/alugueis.js";
import { caixa } from "../../utils/limites.js";

export default {
  name: "setalugueis",
  description: "Define o grupo que recebe as notificações de aluguéis e dispositivos.",
  commands: ["setalugueis"],
  usage: `${PREFIX}setalugueis on | off`,

  handle: async ({ fullArgs, remoteJid, isGroup, userLid, socket, sendReply }) => {
    if (!isBotOwner({ userLid })) return;

    if (!isGroup) {
      throw new WarningError("Este comando só funciona em grupos!");
    }

    const partes = fullArgs.trim().toLowerCase().split(/\s+/).filter(Boolean);

    if (!partes.length) {
      const atual = getGrupoAlugueis();
      if (!atual) {
        return sendReply(
          caixa("🕷️", "GRUPO DE ALUGUÉIS", [
            "Nenhum grupo definido.",
            "",
            `Use ${PREFIX}setalugueis on para definir este grupo.`,
          ]),
        );
      }

      let nome = atual;
      try {
        nome = (await socket.groupMetadata(atual)).subject || atual;
      } catch {}

      return sendReply(
        caixa("🕷️", "GRUPO DE ALUGUÉIS", [
          `📋 Grupo atual: ${nome}`,
          `🆔 ID: ${atual}`,
        ]),
      );
    }

    if (partes[0] === "on") {
      setGrupoAlugueis(remoteJid);

      let nome = remoteJid;
      try {
        nome = (await socket.groupMetadata(remoteJid)).subject || remoteJid;
      } catch {}

      return sendReply(
        caixa("✅", "GRUPO DE ALUGUÉIS DEFINIDO", [
          `📋 Grupo: ${nome}`,
          `🆔 ID: ${remoteJid}`,
          "",
          "Agora este grupo receberá:",
          "• Notificações de novos vínculos",
          "• Notificações de novos dispositivos",
        ]),
      );
    }

    if (partes[0] === "off") {
      removeGrupoAlugueis();
      return sendReply(
        caixa("🕷️", "GRUPO DE ALUGUÉIS DESLIGADO", [
          "Notificações desativadas.",
        ]),
      );
    }

    throw new WarningError(`Use: ${PREFIX}setalugueis on | off`);
  },
};