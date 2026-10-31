// src/commands/admin/autosell.js  (pasta admin: só administradores)
// Pode ser usado de qualquer grupo da central (ex.: o de gestão): o nº vem do .grupos.
import { PREFIX } from "../../config.js";
import { InvalidParameterError, WarningError } from "../../errors/index.js";
import { getCentral } from "../../utils/centrals.js";
import { autosellLigado, definirAutosell } from "../../utils/comprovativos.js";
import { grupoPorIndice } from "../../utils/grupos.js";

const USO = `Use: ${PREFIX}autosell [nº do grupo] on | off\nEx: ${PREFIX}autosell 2 off\nVeja os números com ${PREFIX}grupos`;

export default {
  name: "autosell",
  description: "Liga ou desliga o disparo automático ao aparelho de um grupo da central.",
  commands: ["autosell"],
  usage: USO,

  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ fullArgs, remoteJid, isGroup, sendReply }) => {
    if (!isGroup) throw new WarningError("Este comando só funciona em grupos!");

    const central = getCentral(remoteJid);
    if (!central) {
      throw new WarningError("Este grupo ainda não está vinculado a uma central.");
    }

    // Lê do fullArgs (como o .usarcell): o "args" do bot pode vir separado por / | , e não por espaços.
    const args = fullArgs.trim().split(/\s+/).filter(Boolean);

    const n = parseInt(args[0], 10);
    if (!n) throw new InvalidParameterError(USO);

    const grupo = await grupoPorIndice(central.centralCode, n);
    if (!grupo) {
      throw new WarningError(`Grupo ${n} não existe. Use ${PREFIX}grupos para ver a lista.`);
    }

    const acao = (args[1] || "").toLowerCase();
    const nome = `*${grupo.nome}*`;

    if (!acao) {
      return sendReply(
        (await autosellLigado(grupo.jid))
          ? `🟢 Disparo automático *ligado* em ${nome}.`
          : `🔴 Disparo automático *desligado* em ${nome}.`,
      );
    }

    if (["off", "0"].includes(acao)) {
      await definirAutosell(grupo.jid, false);
      return sendReply(
        `🔴 Disparo automático *desligado* em ${nome}.\n` +
          "Os pedidos são criados e aprovados, mas nada é enviado ao aparelho.\n" +
          'Para concluir cada pedido, reaja com ✅ à mensagem "Pedido aprovado" nesse grupo.',
      );
    }

    if (["on", "1"].includes(acao)) {
      await definirAutosell(grupo.jid, true);
      return sendReply(`🟢 Disparo automático *ligado* em ${nome}.`);
    }

    throw new InvalidParameterError(USO);
  },
};
