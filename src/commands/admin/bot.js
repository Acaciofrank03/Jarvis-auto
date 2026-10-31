// src/commands/admin/bot.js
import { PREFIX } from "../../config.js";
import { WarningError } from "../../errors/index.js";
import { getCentral } from "../../utils/centrals.js";
import { autosellLigado } from "../../utils/comprovativos.js";
import { getGestao } from "../../utils/gestao.js";
import { caixa } from "../../utils/limites.js";

export default {
  name: "bot",
  description: "Mostra a situação do bot neste grupo.",
  commands: ["bot"],
  usage: `${PREFIX}bot`,

  handle: async ({ remoteJid, isGroup, socket, sendReply }) => {
    if (!isGroup) throw new WarningError("Este comando só funciona em grupos!");

    const central = getCentral(remoteJid);

    let gestao = "não definido";
    const gestaoId = central ? getGestao(central.centralCode) : null;
    if (gestaoId) {
      gestao = gestaoId;
      try {
        gestao = (await socket.groupMetadata(gestaoId)).subject || gestaoId;
      } catch {
        /* segue com o ID */
      }
    }

    const linhas = [
      `🏢 Central: ${central ? central.centralCode : "não vinculada"}`,
      `🛠️ Gestão: ${gestao}`,
      "",
      `⚙️ Modo auto: ${(await autosellLigado(remoteJid)) ? "ON" : "OFF"}`,
    ];

    await sendReply(caixa("🤖", "J.A.R.V.I.S BOT: ON", linhas, "🤖"));
  },
};
