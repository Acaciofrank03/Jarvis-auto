import { WarningError } from "../../errors/index.js";
import { getCentral } from "../../utils/centrals.js";
import { lerContas, formatarContas } from "../../utils/contas.js";

export default {
  name: "payments",
  description: "Mostra as contas de pagamento cadastradas.",
  commands: ["payments"],
  usage: ".payments",

  handle: async ({ remoteJid, isGroup, sendReply }) => {
    if (!isGroup) throw new WarningError("Este comando só funciona em grupos!");

    const central = getCentral(remoteJid);
    if (!central) {
      throw new WarningError("Este grupo ainda não está vinculado a uma central.");
    }

    await sendReply(formatarContas(await lerContas(central.centralCode)));
  },
};
