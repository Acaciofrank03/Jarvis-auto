// src/commands/owner/management.js  (só o dono do BOT: confere OWNER_LID dentro do comando)
import { PREFIX } from "../../config.js";
import { InvalidParameterError, WarningError } from "../../errors/index.js";
import { isBotOwner } from "../../middlewares/index.js";
import { getCentral } from "../../utils/centrals.js";
import { getGestao, removeGestao, setGestao } from "../../utils/gestao.js";
import { caixa } from "../../utils/limites.js";

export default {
  name: "management",
  description: "Define o grupo que recebe as falhas e avisos técnicos da central.",
  commands: ["management"],
  usage: `${PREFIX}management group on | off`,

  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ fullArgs, remoteJid, isGroup, userLid, socket, sendReply }) => {
    // O tipo "owner" também deixa passar o dono do grupo; aqui só o dono do bot.
    if (!isBotOwner({ userLid })) return;

    if (!isGroup) throw new WarningError("Este comando só funciona em grupos!");

    const central = getCentral(remoteJid);
    if (!central) {
      throw new WarningError(
        "Este grupo ainda não está vinculado a uma central. Use .ativarauto primeiro.",
      );
    }
    const codigo = central.centralCode;

    const partes = fullArgs.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const uso = `Use: ${PREFIX}management group on | off`;

    // ---- sem argumentos: mostra o atual ----
    if (!partes.length) {
      const atual = getGestao(codigo);
      if (!atual) {
        return sendReply(
          caixa("🛠️", "GESTÃO DA CENTRAL", [
            `🏢 Central: ${codigo}`,
            "📋 Grupo de gestão: não definido",
            "",
            "Sem grupo de gestão, as falhas não são enviadas a ninguém.",
            `Defina com ${PREFIX}management group on`,
          ]),
        );
      }

      let nome = "Grupo desconhecido";
      try {
        nome = (await socket.groupMetadata(atual)).subject || "Grupo desconhecido";
      } catch {
        /* mantém o fallback */
      }

      return sendReply(
        caixa("🛠️", "GESTÃO DA CENTRAL", [
          `🏢 Central: ${codigo}`,
          `📋 Grupo de gestão: ${nome}`,
        ]),
      );
    }

    if (partes[0] !== "group" || !["on", "off"].includes(partes[1])) {
      throw new InvalidParameterError(uso);
    }

    // ---- on: este grupo passa a ser o de gestão ----
    if (partes[1] === "on") {
      setGestao(codigo, remoteJid);

      let nome = "Grupo atual";
      try {
        nome = (await socket.groupMetadata(remoteJid)).subject || "Grupo atual";
      } catch {
        /* mantém o fallback */
      }

      return sendReply(
        caixa("✅", "GRUPO DE GESTÃO DEFINIDO", [
          `🏢 Central: ${codigo}`,
          `📋 Grupo: ${nome}`,
          "",
          "Todas as falhas e avisos técnicos desta central",
          "passam a chegar aqui. Os outros grupos ficam limpos.",
        ]),
      );
    }

    // ---- off: desfaz ----
    const havia = removeGestao(codigo);
    await sendReply(
      caixa("🛠️", "GESTÃO DESLIGADA", [
        `🏢 Central: ${codigo}`,
        havia
          ? "Grupo de gestão removido. As falhas deixam de ser enviadas a ninguém."
          : "Esta central não tinha grupo de gestão definido.",
      ]),
    );
  },
};