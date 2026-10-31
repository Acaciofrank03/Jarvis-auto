// src/commands/<pasta>/tabela.js  (comando para todos os membros)
import { PREFIX } from "../../config.js";
import { WarningError } from "../../errors/index.js";
import { getCentral } from "../../utils/centrals.js";
import { lerTabela } from "../../utils/produtos.js";

const ROTULOS = {
  diario: "📥 Diários",
  stock: "📦 Stock",
  semanal: "📆 Semanais",
  mensal: "📅 Mensais",
  ilimitado: "💎 Ilimitados",
  saldo: "💳 Saldo",
};

export default {
  name: "tabela",
  description: "Mostra a tabela de preços deste grupo.",
  commands: ["tabela", "produtos", "precos", "preços"],
  usage: `${PREFIX}tabela`,

  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ remoteJid, isGroup, sendReply }) => {
    if (!isGroup) throw new WarningError("Este comando só funciona em grupos!");

    const central = getCentral(remoteJid);
    if (!central) {
      throw new WarningError("Este grupo ainda não está vinculado a uma central.");
    }

    const tabela = await lerTabela(remoteJid);
    if (!tabela || !Object.keys(tabela).length) {
      return sendReply("📋 A tabela de preços está vazia.");
    }

    const grupos = {};
    for (const [valor, item] of Object.entries(tabela)) {
      (grupos[item.tipo] ||= []).push([valor, item]);
    }

    const partes = Object.keys(ROTULOS)
      .filter((t) => grupos[t])
      .map(
        (t) =>
          `*${ROTULOS[t]}*\n` +
          grupos[t]
            .sort((a, b) => Number(a[0]) - Number(b[0]))
            .map(([valor, item]) => `• ${valor} MT → ${item.tipo === "saldo" ? `${item.nome} de saldo` : item.nome}`)
            .join("\n"),
      );

    return sendReply(`📋 *TABELA DE PREÇOS*\n────────────────\n${partes.join("\n\n")}`);
  },
};
