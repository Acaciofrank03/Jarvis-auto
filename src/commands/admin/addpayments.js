// src/commands/admin/addpayments.js  (pasta admin: só administradores)
import { PREFIX } from "../../config.js";
import { InvalidParameterError, WarningError } from "../../errors/index.js";
import { getCentral } from "../../utils/centrals.js";
import {
  lerContas,
  salvarContas,
  operadoraDe,
} from "../../utils/contas.js";

export default {
  name: "addpayments",
  description: "Cadastra contas de pagamento (M-Pesa / e-Mola).",
  commands: ["addpayments"],
  usage: `${PREFIX}addpayments 871234567-work, 841234567-work`,

  handle: async ({ fullArgs, remoteJid, isGroup, sendReply }) => {
    if (!isGroup) throw new WarningError("Este comando só funciona em grupos!");

    const central = getCentral(remoteJid);
    if (!central) {
      throw new WarningError("Este grupo ainda não está vinculado a uma central.");
    }

    const contas = await lerContas(central.centralCode);

    if (!fullArgs.trim()) {
      throw new InvalidParameterError(
        `Use: ${PREFIX}addpayments 871234567-work, 841234567-work\n` +
          `Para ver a lista: ${PREFIX}payments`,
      );
    }

    const adicionadas = [];
    const ignoradas = [];

    for (const parte of fullArgs.split(",")) {
      const m = parte.trim().match(/^(?:258)?(8[2-8]\d{7})(?:\s*-\s*(.+))?$/);
      if (!m) {
        ignoradas.push(`${parte.trim()} (formato inválido)`);
        continue;
      }
      const [, numero, rotulo] = m;
      if (contas.some((c) => c.numero === numero)) {
        ignoradas.push(`${numero} (já cadastrado)`);
        continue;
      }
      contas.push({ numero, rotulo: (rotulo || "").trim() });
      adicionadas.push(`${numero}${rotulo ? ` (${rotulo.trim()})` : ""} — ${operadoraDe(numero)}`);
    }

    if (!adicionadas.length && !ignoradas.length) {
      throw new InvalidParameterError(`Use: ${PREFIX}addpayments 871234567-work, 841234567-work`);
    }

    if (adicionadas.length) await salvarContas(central.centralCode, contas);

    await sendReply(
      (adicionadas.length ? `✅ *Adicionadas:*\n${adicionadas.map((a) => `• ${a}`).join("\n")}\n\n` : "") +
        (ignoradas.length ? `⚠️ *Ignoradas:*\n${ignoradas.map((a) => `• ${a}`).join("\n")}\n\n` : "") +
        `📊 Total de contas: ${contas.length} (veja em ${PREFIX}payments)`,
    );
  },
};
