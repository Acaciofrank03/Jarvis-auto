// src/commands/member/carteira.js
import { PREFIX } from "../../config.js";
import { InvalidParameterError, WarningError } from "../../errors/index.js";
import { getCentral } from "../../utils/centrals.js";
import {
  lerCarteira,
  ajustarCarteira,
  ehAdminGrupo,
  jidCitado,
} from "../../utils/carteira.js";
import { lerEstatisticas } from "../../utils/rankings.js";

const FUSO = "Africa/Maputo";
const mt = (n) => `${Number(n).toFixed(2).replace(/\.00$/, "")} MT`;
const quando = (ms) =>
  new Date(ms).toLocaleString("pt-PT", {
    timeZone: FUSO,
    hour12: false,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

function linhaMovimento(m) {
  if (m.tipo === "ENTRADA") return `➕ ${mt(m.valor)} — pagamento recebido`;
  if (m.tipo === "USO") return `➖ ${mt(m.valor)} — usado (${m.numero || "—"})`;
  if (m.tipo === "ESTORNO") return `↩️ ${mt(m.valor)} — devolvido`;
  if (m.tipo === "AJUSTE") {
    return m.valor >= 0
      ? `➕ ${mt(m.valor)} — adicionado pelo admin`
      : `➖ ${mt(-m.valor)} — retirado pelo admin`;
  }
  return `• ${mt(m.valor)} — ${m.tipo}`;
}

export default {
  name: "carteira",
  description: "Mostra o saldo da carteira. Admin: vê a de outro membro e ajusta o saldo.",
  commands: ["carteira"],
  usage:
    `${PREFIX}carteira\n` +
    `Admin (respondendo à mensagem do membro): ${PREFIX}carteira | ${PREFIX}carteira +50 | ${PREFIX}carteira -20`,

  handle: async ({ args, remoteJid, isGroup, webMessage, socket }) => {
    if (!isGroup) throw new WarningError("Este comando só funciona em grupos!");

    const central = getCentral(remoteJid);
    if (!central) {
      throw new WarningError("Este grupo ainda não está vinculado a uma central.");
    }
    const codigo = central.centralCode;

    const eu = webMessage?.key?.participant?.replace(/:[0-9]+/, "");
    if (!eu) throw new WarningError("Não consegui identificar você.");

    const responder = (texto, mencoes = []) =>
      socket.sendMessage(remoteJid, { text: texto, mentions: mencoes }, { quoted: webMessage });

    const citado = jidCitado(webMessage);
    const outro = citado && citado !== eu ? citado : null;
    const sinal = (args[0] || "").match(/^([+-])(\d+(?:[.,]\d+)?)$/);

    // Só o administrador do grupo mexe na carteira de outro membro ou ajusta saldo.
    if (outro || sinal) {
      if (!(await ehAdminGrupo(socket, remoteJid, eu))) {
        throw new WarningError("Só administradores podem ver ou alterar a carteira de outro membro.");
      }
    }

    // ---- ajuste: .carteira +50 / .carteira -20 (respondendo ao membro) ----
    if (sinal) {
      if (!citado) {
        throw new InvalidParameterError(
          `Responda à mensagem do membro com ${PREFIX}carteira +50 ou ${PREFIX}carteira -20`,
        );
      }
      const valor = Number(sinal[2].replace(",", "."));
      if (!valor) throw new InvalidParameterError("O valor tem de ser maior que zero.");
      const delta = sinal[1] === "-" ? -valor : valor;

      const r = await ajustarCarteira(codigo, { jid: citado, remoteJid, delta, por: eu });
      if (r.erro) throw new WarningError(`❌ ${r.erro}`);

      const quem = `@${citado.split("@")[0]}`;
      if (delta > 0) {
        return responder(
          `✅ ${quem}, foi adicionado à sua carteira: ${mt(valor)}\n` +
            `👛 Total: ${mt(r.total)}\n\n` +
            `Para usar, digite: ${PREFIX}usar valor número\n` +
            `💡 Exemplo: ${PREFIX}usar ${valor} 846000001`,
          [citado],
        );
      }
      return responder(
        `➖ ${quem}, foram retirados da sua carteira: ${mt(valor)}\n👛 Total: ${mt(r.total)}`,
        [citado],
      );
    }

    // ---- ver a carteira (a própria, ou a de outro membro se for admin) ----
    const alvo = outro || eu;
    const c = await lerCarteira(codigo, alvo);
    const saldo = Number(c?.total) || 0;
    const est = await lerEstatisticas(codigo, remoteJid, alvo);

    // Só aparece o que existe: nada de zeros ou campos vazios.
    const resumo = (e) => {
      if (!e?.compras) return [];
      const l = [];
      if (e.mb > 0) l.push(`📊 ${String(Math.round(e.mb)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")} MB`);
      if (e.saldo > 0) l.push(`💳 ${mt(e.saldo)} de saldo`);
      if (e.top > 0) l.push(`💎 ${e.top} ilimitado(s)`);
      return l;
    };
    const hoje = resumo(est.hoje);
    const geral = resumo(est.geral);

    const linhas = [`👛 *${outro ? `CARTEIRA DE @${alvo.split("@")[0]}` : "SUA CARTEIRA"}*`, "────────────────"];
    if (saldo > 0) linhas.push(`💰 Saldo: ${mt(saldo)}`);
    if (hoje.length) linhas.push("", `📅 *Hoje* — ${est.hoje.compras} compra(s)`, ...hoje);
    if (geral.length) linhas.push("", `🏆 *Acumulado* — ${est.geral.compras} compra(s)`, ...geral);

    const movs = (c?.movimentos || []).slice(-5).reverse();
    if (movs.length) {
      linhas.push("", "🧾 Últimos movimentos:");
      for (const m of movs) linhas.push(`${linhaMovimento(m)} (${quando(m.em)})`);
    }
    if (saldo > 0) linhas.push("", `Para usar, digite: ${PREFIX}usar valor número`);
    if (linhas.length === 2) linhas.push("Sem saldo e sem compras registadas.");

    return responder(linhas.join("\n"), outro ? [alvo] : []);
  },
};
