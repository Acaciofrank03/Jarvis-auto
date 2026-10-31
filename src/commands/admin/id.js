// src/commands/admin/id.js  (pasta admin: só administradores)
// Pode ser usado de qualquer grupo da central (ex.: o de gestão): o nº vem do .grupos.
import { PREFIX } from "../../config.js";
import { InvalidParameterError, WarningError } from "../../errors/index.js";
import { getCentral } from "../../utils/centrals.js";
import { exigeOficial, definirExigeOficial } from "../../utils/comprovativos.js";
import { grupoPorIndice } from "../../utils/grupos.js";

const USO = `Use: ${PREFIX}id [nº do grupo] on | off\nEx: ${PREFIX}id 2 off\nVeja os números com ${PREFIX}grupos`;

export default {
  name: "id",
  description: "Liga ou desliga a exigência do comprovativo oficial (SMS do APK) num grupo da central.",
  commands: ["id"],
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
        (await exigeOficial(grupo.jid))
          ? `🟢 Comprovativo oficial *exigido* em ${nome}.`
          : `🔴 Comprovativo oficial *não exigido* em ${nome}.`,
      );
    }

    if (["off", "0"].includes(acao)) {
      await definirExigeOficial(grupo.jid, false);
      return sendReply(
        `🔴 Comprovativo oficial *não exigido* em ${nome}.\n` +
          "Sem o SMS oficial no APK, o bot usa o texto que o cliente enviou.\n" +
          "Se o SMS oficial existir, ele continua a ser usado.\n" +
          "Pedidos que já estavam em espera: o cliente deve reenviar a mensagem.",
      );
    }

    if (["on", "1"].includes(acao)) {
      await definirExigeOficial(grupo.jid, true);
      return sendReply(`🟢 Comprovativo oficial *exigido* em ${nome}.`);
    }

    throw new InvalidParameterError(USO);
  },
};
