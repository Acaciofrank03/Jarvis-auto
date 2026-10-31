// src/commands/admin/nano.js  (pasta admin: só administradores)
import { PREFIX } from "../../config.js";
import { InvalidParameterError, WarningError } from "../../errors/index.js";
import { listNano, removeNano, setNano } from "../../utils/nano.js";

const ASPAS = `"“”`;
const RX_ASPAS = new RegExp(`^[${ASPAS}]([^${ASPAS}]+)[${ASPAS}]\\s+([\\s\\S]+)$`);
const RX_SEM_ASPAS = /^(\S+)\s+([\s\S]+)$/;
const tirarAspas = (s) => s.trim().replace(new RegExp(`^[${ASPAS}]|[${ASPAS}]$`, "g"), "").trim();

const resumo = (t) => {
  const linha = t.replace(/\s*\n\s*/g, " ");
  return linha.length > 60 ? `${linha.slice(0, 60)}…` : linha;
};

export default {
  name: "nano",
  description: "Gatilhos e respostas rápidas do grupo.",
  commands: ["nano"],
  usage:
    `${PREFIX}nano gatilho resposta\n` +
    `${PREFIX}nano "vários termos" resposta\n` +
    `${PREFIX}nano lista\n${PREFIX}nano remover gatilho`,

  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ fullArgs, remoteJid, isGroup, sendReply, sendSuccessReply }) => {
    if (!isGroup) throw new WarningError("Este comando só funciona em grupos!");

    const texto = fullArgs.trim();
    const uso =
      `Use: ${PREFIX}nano gatilho resposta\n` +
      `Ex: ${PREFIX}nano oi Olá! Em que posso ajudar?\n` +
      `Vários termos: ${PREFIX}nano "como pagar" resposta`;

    if (!texto) throw new InvalidParameterError(uso);

    // ---- lista ----
    if (/^lista$/i.test(texto)) {
      const itens = listNano(remoteJid);
      if (!itens.length) return sendReply("📋 Nenhum gatilho cadastrado neste grupo.");

      return sendReply(
        `📋 *GATILHOS DO GRUPO*\n────────────────\n` +
          itens.map((i, n) => `${n + 1}. ${i.gatilho} → ${resumo(i.resposta)}`).join("\n"),
      );
    }

    // ---- remover ----
    const rm = texto.match(/^remover\s+([\s\S]+)$/i);
    if (rm) {
      const gatilho = tirarAspas(rm[1]);
      if (!removeNano(remoteJid, gatilho)) {
        throw new WarningError(`O gatilho "${gatilho}" não existe neste grupo.`);
      }
      return sendSuccessReply(`Gatilho "${gatilho}" removido.`);
    }

    // ---- adicionar ou substituir ----
    const m = texto.match(RX_ASPAS) || texto.match(RX_SEM_ASPAS);
    if (!m) throw new InvalidParameterError(uso);

    const [, gatilho, resposta] = m;
    const r = setNano(remoteJid, gatilho, resposta);
    if (!r) {
      throw new InvalidParameterError(
        `O gatilho precisa ter letras ou números, e a resposta não pode ser vazia.\n${uso}`,
      );
    }

    await sendSuccessReply(
      r.substituido
        ? `Gatilho "${gatilho.trim()}" substituído.`
        : `Gatilho "${gatilho.trim()}" adicionado.`,
    );
  },
};
