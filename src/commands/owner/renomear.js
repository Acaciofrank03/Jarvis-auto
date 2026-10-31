import { PREFIX } from "../../config.js";
import { InvalidParameterError } from "../../errors/index.js";
import { renomearCliente } from "../../services/firebase.js";

export default {
  name: "renomear",
  description: "Muda o nome do cliente de uma central.",
  commands: ["renomear"],
  usage: `${PREFIX}renomear [VD-xxxxxx] [novo nome]`,
  handle: async ({ fullArgs, sendReply }) => {
    const [vd, ...resto] = fullArgs.trim().split(/\s+/).filter(Boolean);
    const nome = resto.join(" ").trim().slice(0, 40);

    if (!/^VD-\d+$/i.test(vd || "") || !nome) {
      throw new InvalidParameterError(`Use: ${PREFIX}renomear VD-499527 PAULO BALÃO`);
    }

    const central = vd.toUpperCase();
    const r = await renomearCliente(central, nome);
    if (!r) {
      throw new InvalidParameterError("Nenhuma licença encontrada para essa central.");
    }

    await sendReply(
      `✏️ *Cliente renomeado*\n` +
        `Central: ${central}\n` +
        `Nome: ${nome}\n` +
        `Licenças alteradas: ${r.alteradas.length}`,
    );
  },
};
