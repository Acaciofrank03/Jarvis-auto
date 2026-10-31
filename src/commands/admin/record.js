// src/commands/admin/record.js  (pasta admin: só administradores)
// Regista uma venda à mão (ranking, .carteira e mensagem de conclusão).
// Não debita carteira e não envia nada ao aparelho.
import { PREFIX } from "../../config.js";
import { InvalidParameterError, WarningError } from "../../errors/index.js";
import { getCentral } from "../../utils/centrals.js";
import { lerTabela } from "../../utils/produtos.js";
import {
  ref,
  chave,
  canalDoId,
  extrairComprovativos,
  avisarDuplicado,
  concluirVenda,
  produtoDaTabela,
} from "../../utils/comprovativos.js";
import { jidCitado } from "../../utils/carteira.js";

// 100mb, 1.5gb, 100s (saldo), top100 (ilimitado)
function lerProdutos(texto) {
  const produtos = [];
  for (const bruto of texto.toLowerCase().replace(/\s+/g, "").split("+")) {
    let m;
    if ((m = bruto.match(/^(\d+(?:[.,]\d+)?)(mb|gb)$/))) {
      const q = Number(m[1].replace(",", "."));
      produtos.push({ tipo: "mb", qtd: Math.round(m[2] === "gb" ? q * 1024 : q) });
    } else if ((m = bruto.match(/^(\d+(?:[.,]\d+)?)s$/))) {
      produtos.push({ tipo: "saldo", qtd: Number(m[1].replace(",", ".")) });
    } else if ((m = bruto.match(/^top(\d+)$/))) {
      produtos.push({ tipo: "top", nome: `TOP ${m[1]}` });
    } else {
      return null;
    }
  }
  return produtos;
}

const textoDe = (webMessage) => {
  const q = webMessage?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  return (
    q?.conversation ||
    q?.extendedTextMessage?.text ||
    q?.imageMessage?.caption ||
    q?.documentMessage?.caption ||
    ""
  );
};

export default {
  name: "record",
  description: "Regista uma venda manualmente (responda à mensagem do membro).",
  commands: ["record"],
  usage:
    `${PREFIX}record 100mb | 100gb | 100s | top100  (podem juntar com +: 100gb+100s)\n` +
    `Respondendo a um comprovativo, sem valores: ${PREFIX}record`,

  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ fullArgs, remoteJid, isGroup, webMessage, socket }) => {
    if (!isGroup) throw new WarningError("Este comando só funciona em grupos!");

    const central = getCentral(remoteJid);
    if (!central) {
      throw new WarningError("Este grupo ainda não está vinculado a uma central.");
    }
    const codigo = central.centralCode;

    const membro = jidCitado(webMessage);
    if (!membro) {
      throw new InvalidParameterError(
        `Responda à mensagem do membro com ${PREFIX}record 100gb (ou 100s, top100, 100gb+100s).`,
      );
    }

    const enviar = (j, text, mentions = []) => socket.sendMessage(j, { text, mentions });
    const arg = fullArgs.trim();
    let produtos;

    if (arg) {
      produtos = lerProdutos(arg);
      if (!produtos?.length) {
        throw new InvalidParameterError(
          `Não entendi "${arg}". Use ${PREFIX}record 100mb | 100gb | 100s | top100 (ou juntos com +).`,
        );
      }
    } else {
      // Sem valores: usa o comprovativo respondido e o produto da tabela com o mesmo valor.
      const vouchers = extrairComprovativos(textoDe(webMessage));
      if (!vouchers.length) {
        throw new InvalidParameterError(`Não achei comprovativo nem valores. Use ${PREFIX}record 100gb.`);
      }
      if (vouchers.some((v) => !v.amount)) {
        throw new WarningError("Não consegui ler o valor do comprovativo. Use o valor à mão: .record 100gb.");
      }
      const total = Math.round(vouchers.reduce((s, v) => s + v.amount, 0) * 100) / 100;
      const item = ((await lerTabela(remoteJid)) || {})[String(total)];
      if (!item) throw new WarningError(`O valor ${total} MT não consta na tabela.`);
      const produto = produtoDaTabela(item);
      if (!produto) throw new WarningError("Este produto da tabela não tem quantidade para registar.");

      // Marca os IDs como usados; se algum já estiver usado, é duplicado.
      for (const v of vouchers) {
        const reserva = await ref(null, `comprovantes_usados/${codigo}/${chave(v.id)}`).transaction((atual) =>
          atual === null
            ? {
                id: v.id,
                canal: canalDoId(v.id),
                valor: v.amount,
                registadoPor: membro,
                origem: "RECORD",
                usadoEm: Date.now(),
                status: "REGISTADO",
              }
            : undefined,
        );
        if (!reserva.committed) {
          await avisarDuplicado(codigo, v.id, remoteJid, enviar);
          return;
        }
      }
      produtos = [produto];
    }

    // Uma mensagem de conclusão por produto.
    for (const produto of produtos) {
      await concluirVenda(codigo, { jid: membro, remoteJid, produto, enviar });
    }
  },
};
