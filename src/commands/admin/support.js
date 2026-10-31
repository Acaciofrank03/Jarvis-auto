import { PREFIX } from "../../config.js";
import { InvalidParameterError, WarningError } from "../../errors/index.js";
import { getCentral } from "../../utils/centrals.js";
import {
  lerSuporte,
  salvarSuporte,
  formatarSuporte,
} from "../../utils/comprovativos.js";

export default {
  name: "support",
  description: "Define o assistente que o bot menciona.",
  commands: ["support"],
  usage:
    `${PREFIX}support 841234567-assistente\n` +
    `${PREFIX}support remover`,

  handle: async ({ fullArgs, remoteJid, isGroup, sendReply }) => {
    if (!isGroup) throw new WarningError("Este comando só funciona em grupos!");

    const central = getCentral(remoteJid);
    if (!central) {
      throw new WarningError("Este grupo ainda não está vinculado a uma central.");
    }

    const texto = fullArgs.trim();

    // Sem argumentos: mostra o assistente atual.
    if (!texto) {
      return sendReply(
        `${formatarSuporte(await lerSuporte(central.centralCode))}\n\n` +
          `Use: ${PREFIX}support 841234567-assistente`,
      );
    }

    if (texto.toLowerCase() === "remover") {
      await salvarSuporte(central.centralCode, []);
      return sendReply("🗑️ Assistente removido. O bot voltará a mencionar *Administradores*.");
    }

    // .support 841234567-assistente  (substitui o anterior)
    const m = texto.match(/^\+?(?:258)?\s*(8[2-8]\d{7})\s*-\s*(.+)$/);
    if (!m) {
      throw new InvalidParameterError(
        `Use: ${PREFIX}support numero-designação\nEx: ${PREFIX}support 841234567-assistente`,
      );
    }

    const assistente = { numero: `258${m[1]}`, designacao: m[2].trim() };
    await salvarSuporte(central.centralCode, [assistente]);

    await sendReply(
      `✅ *Assistente definido:*\n• ${assistente.numero} (${assistente.designacao})\n\n` +
        `O bot vai mencioná-lo nos avisos de pagamento e falhas.`,
    );
  },
};
