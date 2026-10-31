import { PREFIX } from "../../config.js";
import { InvalidParameterError } from "../../errors/index.js";
import { renovarCentral } from "../../services/firebase.js";

export default {
  name: "renovar",
  description: "Renova uma central: o novo prazo substitui o atual.",
  commands: ["renovar"],
  usage: `${PREFIX}renovar [VD-xxxxxx] [app|soprati] [dias]`,
  handle: async ({ fullArgs, sendReply }) => {
    const [vd, tipo, d] = fullArgs.trim().split(/\s+/);
    const days = parseInt(d, 10);
    const t = (tipo || "").toLowerCase();
    if (!/^VD-\d+$/i.test(vd || "") || !["app", "soprati"].includes(t) || !days || days <= 0) {
      throw new InvalidParameterError(`Use: ${PREFIX}renovar VD-499527 app 30`);
    }
    const r = await renovarCentral(vd.toUpperCase(), t, days);
    if (!r) throw new InvalidParameterError("Nenhuma licença encontrada para essa central.");
    const expira = new Date(r.novoPrazo).toLocaleString("pt-PT", { timeZone: "Africa/Maputo" });
    await sendReply(
      `✅ *Central renovada*\n` +
        `Central: ${vd.toUpperCase()} (${t})\n` +
        `Novo prazo: ${days} dias\n` +
        `Expira em: ${expira}`,
    );
  },
};
