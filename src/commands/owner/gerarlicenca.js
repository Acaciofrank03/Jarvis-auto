import { PREFIX } from "../../config.js";
import { InvalidParameterError } from "../../errors/index.js";
import { createAppLicense } from "../../services/firebase.js";

export default {
  name: "gerarlicenca",
  description: "Gera uma nova licença principal do app (PRO_APP).",
  commands: ["gerarlicenca", "gerarlicença"],
  usage: `${PREFIX}gerarlicenca [dias] [nome do cliente]`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ fullArgs, sendReply }) => {
    const args = fullArgs.trim().split(/\s+/).filter(Boolean);

    if (!args.length) {
      throw new InvalidParameterError(
        `Use: ${PREFIX}gerarlicenca [dias] [nome do cliente]`,
      );
    }

    const days = parseInt(args[0], 10);

    if (!days || days <= 0) {
      throw new InvalidParameterError(
        `Use: ${PREFIX}gerarlicenca [dias] [nome do cliente]`,
      );
    }

    const clientName = args.slice(1).join(" ").trim() || "Cliente";

    const { key, expiresAt } = await createAppLicense(days, clientName);

    const expira = new Date(expiresAt).toLocaleString("pt-PT", {
      timeZone: "Africa/Maputo",
    });

    await sendReply(
      `🔑 *Nova licença gerada!*\n` +
        `────────────────────────\n` +
        `Chave: \`${key}\`\n` +
        `Cliente: ${clientName}\n` +
        `Validade: ${days} dias\n` +
        `Expira em: ${expira}\n\n` +
        `Envie esta chave ao cliente para ativar no aplicativo.`,
    );
  },
};
