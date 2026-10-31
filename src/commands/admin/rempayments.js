import { PREFIX } from "../../config.js";
import { InvalidParameterError, WarningError } from "../../errors/index.js";
import { getCentral } from "../../utils/centrals.js";
import { lerContas, salvarContas } from "../../utils/contas.js";

export default {
  name: "rempayments",
  description: "Remove contas de pagamento pelo índice.",
  commands: ["rempayments"],
  usage: `${PREFIX}rempayments [índice]  (ex.: ${PREFIX}rempayments 2  ou  2, 3)`,

  handle: async ({ fullArgs, remoteJid, isGroup, sendReply }) => {
    if (!isGroup) throw new WarningError("Este comando só funciona em grupos!");

    const central = getCentral(remoteJid);
    if (!central) {
      throw new WarningError("Este grupo ainda não está vinculado a uma central.");
    }

    const contas = await lerContas(central.centralCode);

    if (!fullArgs.trim()) {
      throw new InvalidParameterError(
        `Use: ${PREFIX}rempayments [índice]\nVeja os índices em ${PREFIX}payments`,
      );
    }

    const indices = [
      ...new Set(
        fullArgs
          .split(/[,\s]+/)
          .filter(Boolean)
          .map((x) => parseInt(x, 10)),
      ),
    ];

    if (indices.some((i) => !i || i < 1 || i > contas.length)) {
      throw new InvalidParameterError(
        `Índice inválido! Veja os índices em ${PREFIX}payments`,
      );
    }

    const removidas = [];
    for (const i of indices.sort((a, b) => b - a)) {
      removidas.push(contas.splice(i - 1, 1)[0]);
    }

    await salvarContas(central.centralCode, contas);

    await sendReply(
      `🗑️ *Removidas:*\n${removidas.map((c) => `• ${c.numero}${c.rotulo ? ` (${c.rotulo})` : ""}`).join("\n")}\n\n` +
        `📊 Total de contas: ${contas.length} (veja em ${PREFIX}payments)`,
    );
  },
};
