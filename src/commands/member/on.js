// src/commands/member/on.js  (pasta de comandos de membros)
// .on  -> qualquer membro vê os megas e o saldo disponíveis para venda.
// Megas: dos aparelhos definidos para o grupo (.usarcell), só dos SIMs que ainda podem enviar.
// Saldo: de todos os SIMs da central com saldo definido (.saldo).
import { PREFIX } from "../../config.js";
import { WarningError } from "../../errors/index.js";
import { getCentral, getActiveDevices } from "../../utils/centrals.js";
import { fmtMegas, listarLimites } from "../../utils/limites.js";

const fmtMt = (n) => `${Number(n).toFixed(2)} MT`;

// "29/09/2026 02:44" (hora de Maputo)
const horario = () =>
  new Date()
    .toLocaleString("pt-BR", {
      timeZone: "Africa/Maputo",
      hour12: false,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(",", "");

export default {
  name: "on",
  description: "Mostra os megas e o saldo disponíveis para venda.",
  commands: ["on"],
  usage: `${PREFIX}on`,

  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ remoteJid, isGroup, sendReply }) => {
    if (!isGroup) throw new WarningError("Este comando só funciona em grupos!");

    const central = getCentral(remoteJid);
    if (!central) {
      throw new WarningError("Este grupo ainda não está vinculado a uma central.");
    }

    const todos = listarLimites(central.centralCode);
    const ativos = getActiveDevices(remoteJid).map(String);

    let megas = 0;
    let saldo = 0;

    for (const [disp, l] of Object.entries(todos)) {
      for (const i of [0, 1]) {
        // megas: só dos aparelhos do grupo e de SIMs que não atingiram o limite de envios
        if (ativos.includes(String(disp))) {
          const m = Number(l.megas?.[i]) || 0;
          const ml = l.mlimite?.[i];
          const esgotado = ml?.limite != null && (ml.feitos || 0) >= ml.limite;
          if (m > 0 && !esgotado) megas += m;
        }
        // saldo: de todos os SIMs da central
        const s = Number(l.saldo?.[i]) || 0;
        if (s > 0) saldo += s;
      }
    }

    await sendReply(
      [
        `${megas > 0 || saldo > 0 ? "🟢" : "🔴"} *DISPONIBILIDADE*`,
        `────────────────────────`,
        `🌐 *Megas:* ${megas > 0 ? fmtMegas(megas) : "🔴 Esgotado"}`,
        `💰 *Saldo:* ${saldo > 0 ? fmtMt(saldo) : "🔴 Esgotado"}`,
        `────────────────────────`,
        `⏰ Atualizado: ${horario()}`,
      ].join("\n"),
    );
  },
};
