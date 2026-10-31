// src/commands/admin/sms.js  (pasta admin: só administradores)
// Números dos clientes por SMS. Cada número fica ligado a UM grupo da central.
import { PREFIX } from "../../config.js";
import { InvalidParameterError, WarningError } from "../../errors/index.js";
import { getCentral } from "../../utils/centrals.js";
import {
  adicionarNumeros,
  numerosDoGrupo,
  removerNumeros,
  listarPendentesSms,
  limparPendentesSms,
  censurar,
} from "../../utils/smsClientes.js";

export default {
  name: "sms",
  description: "Regista os números de clientes por SMS neste grupo.",
  commands: ["sms"],
  usage:
    `${PREFIX}sms add 850375662 842111222 ...\n` +
    `${PREFIX}sms rem 850375662 2 3 ...  (número ou posição da lista)\n` +
    `${PREFIX}sms lista\n` +
    `${PREFIX}sms pendentes\n` +
    `${PREFIX}sms limpar\n` +
    `${PREFIX}sms limpar <msgId>`,

  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ fullArgs, remoteJid, isGroup, socket, sendReply, webMessage }) => {
    if (!isGroup) throw new WarningError("Este comando só funciona em grupos!");

    const central = getCentral(remoteJid);
    if (!central) {
      throw new WarningError("Este grupo ainda não está vinculado a uma central.");
    }
    const codigo = central.centralCode;

    // vários números, separados por espaço, vírgula ou linha
    const partes = fullArgs.trim().split(/[\s,;]+/).filter(Boolean);
    const acao = (partes.shift() || "lista").toLowerCase();

    // ---------- LISTA DE NÚMEROS ----------
    if (acao === "lista") {
      const lista = await numerosDoGrupo(codigo, remoteJid);
      if (!lista.length) return sendReply("📋 Nenhum número registado neste grupo.");
      return sendReply(
        "📩 *CLIENTES SMS DESTE GRUPO*\n────────────────\n" +
          lista.map((n, i) => `${i + 1}. ${n}`).join("\n"),
      );
    }

    // ---------- PENDENTES ----------
    if (acao === "pendentes") {
      const lista = await listarPendentesSms(codigo, remoteJid);
      if (!lista.length) {
        return sendReply("✅ Não existem pedidos SMS pendentes neste grupo.");
      }

      const agora = Date.now();
      const linhas = lista.map((p, i) => {
        const min = Math.round((agora - p.criadoEm) / 60000);
        const cliente = censurar(String(p.jid).replace("@sms", "").replace(/^258/, ""));
        const ids = (p.ids || []).join(", ") || "—";
        return (
          `*\( {i + 1}.* \` \){p.msgId}\`\n` +
          `   👤 ${cliente} | 💰 ${p.valor} MT\n` +
          `   📊 ${p.status} | ⏱️ ${min} min\n` +
          `   🔎 ${ids}`
        );
      });

      return sendReply(
        `📩 *PEDIDOS SMS PENDENTES* (${lista.length})\n────────────────\n` +
          linhas.join("\n\n") +
          `\n\nPara limpar: ${PREFIX}sms limpar\nou ${PREFIX}sms limpar <msgId>`
      );
    }

    // ---------- LIMPAR ----------
    if (acao === "limpar") {
      const msgIdAlvo = partes[0] || null;
      const removidos = await limparPendentesSms(codigo, remoteJid, msgIdAlvo);

      if (!removidos.length) {
        return sendReply(
          msgIdAlvo
            ? `ℹ️ Nenhum pedido pendente encontrado com o ID \`${msgIdAlvo}\`.`
            : "✅ Não havia pedidos SMS pendentes para limpar.",
        );
      }

      const resumo = removidos
        .map((r) => `• \`\( {r.msgId}\` ( \){r.valor} MT) — era ${r.statusAnterior}`)
        .join("\n");

      return sendReply(
        `🗑️ *Pedidos SMS limpos:* \( {removidos.length}\n\n \){resumo}`
      );
    }

    // ---------- ADD / REM ----------
    if (acao !== "add" && acao !== "rem") {
      throw new InvalidParameterError(
        `Use:\n` +
          `${PREFIX}sms add 850375662 842111222\n` +
          `${PREFIX}sms rem 850375662 2\n` +
          `${PREFIX}sms lista\n` +
          `${PREFIX}sms pendentes\n` +
          `${PREFIX}sms limpar\n` +
          `${PREFIX}sms limpar <msgId>`,
      );
    }

    if (!partes.length) {
      throw new InvalidParameterError(
        acao === "add"
          ? `Informe os números. Ex: ${PREFIX}sms add 850375662 842111222`
          : `Informe o número ou a posição. Ex: ${PREFIX}sms rem 850375662 2`,
      );
    }

    const nomeGrupo = async (jid) => {
      try {
        return (await socket.groupMetadata(jid))?.subject || jid;
      } catch {
        return jid;
      }
    };

    if (acao === "add") {
      const por = webMessage?.key?.participant?.replace(/:[0-9]+/, "");
      const r = await adicionarNumeros(codigo, remoteJid, partes, por);
      const de = (estado) => r.filter((x) => x.estado === estado);
      const linhas = [];
      if (de("ok").length) linhas.push(`✅ Registados (${de("ok").length}): ${de("ok").map((x) => x.numero).join(", ")}`);
      if (de("ja").length) linhas.push(`ℹ️ Já estavam neste grupo: ${de("ja").map((x) => x.numero).join(", ")}`);
      for (const x of de("outro")) {
        linhas.push(`⚠️ ${x.numero} já está registado noutro grupo: ${await nomeGrupo(x.grupo)}`);
      }
      if (de("invalido").length) linhas.push(`❌ Inválidos: ${de("invalido").map((x) => x.token).join(", ")}`);
      return sendReply(linhas.join("\n"));
    }

    // rem
    const r = await removerNumeros(codigo, remoteJid, partes);
    const de = (estado) => r.filter((x) => x.estado === estado);
    const linhas = [];
    if (de("removido").length) linhas.push(`🗑️ Removidos (${de("removido").length}): ${de("removido").map((x) => x.numero).join(", ")}`);
    if (de("nao_existe").length) linhas.push(`ℹ️ Não encontrados: ${de("nao_existe").map((x) => x.token).join(", ")}`);
    if (de("outro").length) linhas.push(`⚠️ Registados noutro grupo (não removidos): ${de("outro").map((x) => x.numero).join(", ")}`);
    if (de("invalido").length) linhas.push(`❌ Inválidos: ${de("invalido").map((x) => x.token).join(", ")}`);
    return sendReply(linhas.join("\n"));
  },
};