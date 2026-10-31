import { PREFIX } from "../../config.js";
import { InvalidParameterError } from "../../errors/index.js";
import { createSopratiLicense } from "../../services/firebase.js";

export default {
  name: "gerarsoprati",
  description: "Gera uma nova chave de licença Soprati (*109#).",
  commands: ["gerarsoprati"],
  usage: `${PREFIX}gerarsoprati [dias]`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ args, sendReply }) => {
    const days = args[0] ? parseInt(args[0], 10) : 30;

    if (!days || days <= 0) {
      throw new InvalidParameterError(`Use: ${PREFIX}gerarsoprati [dias]`);
    }

    const key = await createSopratiLicense(days);

    await sendReply(
      `🔑 *Nova chave Soprati gerada!*\n` +
        `────────────────────────\n` +
        `Chave: \`${key}\`\n` +
        `Duração: ${days} dias (começa a contar quando for ativada)\n\n` +
        `Envie esta chave ao cliente. Ele deve usar:\n` +
        `${PREFIX}ativarsoprati ${key}`,
    );
  },
};
