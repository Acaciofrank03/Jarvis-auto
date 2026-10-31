import { PREFIX } from "../../config.js";
import { InvalidParameterError, WarningError } from "../../errors/index.js";
import { activateSopratiLicense, getSopratiLicense } from "../../services/firebase.js";
import { getCentral } from "../../utils/centrals.js";

export default {
  name: "ativarsoprati",
  description: "Ativa a licença Soprati (*109#) para a central deste grupo.",
  commands: ["ativarsoprati"],
  usage: `${PREFIX}ativarsoprati SOPRATI-XXXX-YYYY`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ args, remoteJid, isGroup, sendReply }) => {
    if (!isGroup) {
      throw new WarningError("Este comando só funciona em grupos!");
    }

    if (!args.length) {
      throw new InvalidParameterError(
        `Use: ${PREFIX}ativarsoprati SOPRATI-XXXX-YYYY`,
      );
    }

    const central = getCentral(remoteJid);

    if (!central) {
      throw new WarningError(
        "Este grupo ainda não está vinculado a uma central. Use .ativarauto primeiro.",
      );
    }

    const key = args[0].trim().toUpperCase();
    const existing = await getSopratiLicense(key);

    if (!existing) {
      throw new WarningError(
        `Chave *${key}* não encontrada ou inválida.\n\n` +
          `📞 Para adquirir ou renovar com o suporte:\nhttps://wa.me/258834254136`,
      );
    }

    if (existing.expiresAt > Date.now()) {
      throw new WarningError(
        `Esta chave já está ativa e expira em ${new Date(existing.expiresAt).toLocaleString("pt-PT", { timeZone: "Africa/Maputo" })}.`,
      );
    }

    const durationDays = existing.durationDays || 30;
    const result = await activateSopratiLicense(key, central.centralCode, durationDays);

    const expira = new Date(result.expiresAt).toLocaleString("pt-PT", {
      timeZone: "Africa/Maputo",
    });

    await sendReply(
      `🚀 *LICENÇA SOPRATI (*109#) ATIVADA COM SUCESSO!*\n` +
        `────────────────────────\n` +
        `🏢 *Central:* \`${central.centralCode}\`\n` +
        `👥 *Grupo:* Grupo Atual\n` +
        `🔑 *Chave Utilizada:* \`${key}\`\n` +
        `⏱️ *Duração:* ${durationDays} dias\n` +
        `📅 *Expira em:* ${expira}\n\n` +
        `📲 *Recursos Liberados:*\n` +
        `• Disparo de pacotes SoPraTi próprios via *109#\n` +
        `• Seleção direta de SIM e repetições automáticas\n\n` +
        `⚡ Use \`${PREFIX}soprati [celular] [vezes] [SIM]\` para disparar!`,
    );
  },
};
