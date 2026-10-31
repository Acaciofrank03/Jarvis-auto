// src/middlewares/onReaction.js
// Reação ✅ de um administrador no "Pedido aprovado" = registo manual da venda concluída.
import { getCentral } from "../utils/centrals.js";
import { ehAdminGrupo } from "../utils/carteira.js";
import { concluirPorReacao } from "../utils/comprovativos.js";
import { enviarDoPedido } from "../utils/smsClientes.js";

export async function onReaction({ socket, reacoes }) {
  for (const r of reacoes || []) {
    try {
      const emoji = String(r?.reaction?.text || "").replace(/\uFE0F/g, "");
      if (emoji !== "✅") continue;

      const remoteJid = r.key?.remoteJid;
      if (!remoteJid?.endsWith("@g.us")) continue;

      // quem reagiu (se foi a própria conta do bot, usa o JID dela)
      const quem = (r.reaction?.key?.fromMe ? socket.user?.id : r.reaction?.key?.participant) || "";
      const jid = quem.replace(/:[0-9]+/, "");
      if (!jid) continue;

      const central = getCentral(remoteJid);
      if (!central) continue;

      // só administradores do grupo
      if (!(await ehAdminGrupo(socket, remoteJid, jid))) continue;

      const enviar = (j, text, mentions = []) => socket.sendMessage(j, { text, mentions });
      // pedidos vindos de SMS concluem com o número censurado
      const enviarFinal = await enviarDoPedido(central.centralCode, r.key.id, enviar);
      await concluirPorReacao(central.centralCode, {
        remoteJid,
        msgId: r.key.id,
        enviar: enviarFinal,
        por: jid,
      });
    } catch (e) {
      console.error("[onReaction] erro:", e);
    }
  }
}
