// src/commands/admin/grupos.js  (pasta admin: só administradores)
import { PREFIX } from "../../config.js";
import { InvalidParameterError, WarningError } from "../../errors/index.js";
import { getCentral } from "../../utils/centrals.js";
import { autosellLigado } from "../../utils/comprovativos.js";
import { getGestao } from "../../utils/gestao.js";
import {
  atualizarNomes,
  grupoPorIndice,
  listarGrupos,
  registarGrupo,
  removerGrupo,
} from "../../utils/grupos.js";
import { caixa } from "../../utils/limites.js";

const USO =
  `Use: ${PREFIX}grupos\n` +
  `${PREFIX}grupos add (dentro do grupo de vendas)\n` +
  `${PREFIX}grupos atualizar\n` +
  `${PREFIX}grupos remover [nº]`;

export default {
  name: "grupos",
  description: "Lista e gere os grupos de vendas da central.",
  commands: ["grupos"],
  usage: USO,

  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ fullArgs, remoteJid, isGroup, socket, sendReply }) => {
    if (!isGroup) throw new WarningError("Este comando só funciona em grupos!");

    const central = getCentral(remoteJid);
    if (!central) {
      throw new WarningError("Este grupo ainda não está vinculado a uma central.");
    }
    const codigo = central.centralCode;
    // Lê do fullArgs (como o .usarcell): o "args" do bot pode vir separado por / | , e não por espaços.
    const args = fullArgs.trim().split(/\s+/).filter(Boolean);

    const acao = (args[0] || "").toLowerCase();

    const mostrar = async (titulo = "GRUPOS DA CENTRAL") => {
      const lista = await listarGrupos(codigo);
      if (!lista.length) {
        return sendReply(
          `Nenhum grupo registado.\nEntre no grupo de vendas e use ${PREFIX}grupos add`,
        );
      }
      const linhas = [];
      for (const [i, g] of lista.entries()) {
        const estado = (await autosellLigado(g.jid)) ? "🟢" : "🔴";
        linhas.push(`${i + 1}. ${g.nome} ${estado}`);
      }
      return sendReply(
        caixa("📋", titulo, [
          ...linhas,
          "",
          `Autosell: ${PREFIX}autosell [nº] on | off`,
        ]),
      );
    };

    if (!acao) return mostrar();

    if (acao === "add") {
      if (getGestao(codigo) === remoteJid) {
        throw new WarningError("Este é o grupo de gestão. Registe só grupos de vendas.");
      }
      const { novo, nome } = await registarGrupo(codigo, remoteJid, socket);
      return sendReply(
        novo ? `✅ Grupo *${nome}* registado na central.` : `🔄 Grupo *${nome}* actualizado.`,
      );
    }

    if (["atualizar", "actualizar"].includes(acao)) {
      const n = await atualizarNomes(codigo, socket);
      return mostrar(n ? `ACTUALIZADO (${n} nome(s))` : "GRUPOS DA CENTRAL");
    }

    if (["remover", "rm"].includes(acao)) {
      const n = parseInt(args[1], 10);
      if (!n) throw new InvalidParameterError(`Use: ${PREFIX}grupos remover [nº]`);
      const g = await grupoPorIndice(codigo, n);
      if (!g) throw new WarningError(`Grupo ${n} não existe. Use ${PREFIX}grupos para ver a lista.`);
      await removerGrupo(codigo, g.jid);
      return sendReply(`🗑️ Grupo *${g.nome}* removido da lista.`);
    }

    throw new InvalidParameterError(USO);
  },
};
