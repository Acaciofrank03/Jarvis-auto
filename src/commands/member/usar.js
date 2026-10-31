// src/commands/member/usar.js
import { PREFIX } from "../../config.js";
import { InvalidParameterError, WarningError } from "../../errors/index.js";
import { getCentral } from "../../utils/centrals.js";
import { usarCarteira, extrairDivisao } from "../../utils/comprovativos.js";
import { ehAdminGrupo, jidCitado } from "../../utils/carteira.js";

export default {
  name: "usar",
  description: "Usa o valor da sua carteira num pacote da tabela.",
  commands: ["usar"],
  usage:
    `${PREFIX}usar [valor] [número]\n` +
    `${PREFIX}usar [valor] e, nas linhas abaixo, "número, 10gb"\n` +
    `Admin (respondendo à mensagem do membro): o mesmo formato`,

  handle: async ({ fullArgs, remoteJid, isGroup, webMessage, socket }) => {
    if (!isGroup) throw new WarningError("Este comando só funciona em grupos!");

    const central = getCentral(remoteJid);
    if (!central) {
      throw new WarningError("Este grupo ainda não está vinculado a uma central.");
    }

    // Caso 1: .usar valor número
    // Caso 2: .usar valor  +  linhas "número, 10gb"
    const [primeira = "", ...resto] = fullArgs.trim().split(/\r?\n/);
    const partes = primeira.trim().split(/\s+/);
    const valor = Number((partes[0] || "").replace(",", "."));

    let destinos = null;
    const divisao = extrairDivisao(resto.join("\n"));
    if (divisao.length) {
      destinos = divisao;
    } else {
      const m = (partes[1] || "").replace(/\D/g, "").match(/^(?:258)?(8[2-8]\d{7})$/);
      if (m) destinos = [{ numero: m[1], mb: null }];
    }

    if (!valor || valor <= 0 || !destinos) {
      throw new InvalidParameterError(
        `Use: ${PREFIX}usar [valor] [número]\nEx: ${PREFIX}usar 25 842898459\n\n` +
          `Ou dividindo por números:\n${PREFIX}usar 90\n846000001, 10gb\n847000002, 20gb`,
      );
    }

    const eu = webMessage?.key?.participant?.replace(/:[0-9]+/, "");
    if (!eu) throw new WarningError("Não consegui identificar você.");

    // Respondendo à mensagem de outro membro: só administrador, e o valor sai da carteira dele.
    const citado = jidCitado(webMessage);
    const outro = citado && citado !== eu ? citado : null;
    let jid = eu;
    let porAdmin = false;
    if (outro) {
      if (!(await ehAdminGrupo(socket, remoteJid, eu))) {
        throw new WarningError("Só administradores podem usar a carteira de outro membro.");
      }
      jid = outro;
      porAdmin = true;
    }

    const enviar = (j, text, mentions = []) => socket.sendMessage(j, { text, mentions });

    const r = await usarCarteira(central.centralCode, {
      jid,
      remoteJid,
      valor,
      destinos,
      enviar,
      porAdmin,
    });

    if (r.erro) throw new WarningError(`❌ ${r.erro}`);
  },
};
