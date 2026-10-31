// src/commands/admin/addtabela.js  (pasta admin: só administradores)
import { PREFIX } from "../../config.js";
import { InvalidParameterError, WarningError } from "../../errors/index.js";
import { getCentral } from "../../utils/centrals.js";
import {
  lerTabela,
  salvarProduto,
  removerProduto,
} from "../../utils/produtos.js";

const TIPOS = ["diario", "stock", "semanal", "mensal", "saldo"];
const AUTOMATICOS = ["diario", "stock"]; // iguais a TIPOS_AUTOMATICOS do comprovativos.js

const ROTULOS = {
  diario: "📥 Diários (Automático)",
  stock: "📦 Stock (Automático)",
  semanal: "📆 Semanais (Manual)",
  mensal: "📅 Mensais (Manual)",
  ilimitado: "💎 Ilimitados (Manual)",
  saldo: "💳 Saldo (Manual)",
};

const formatarMegas = (m) =>
  m >= 1024 ? `${+(m / 1024).toFixed(2)} GB` : `${m} MB`;

// Converte letras estilizadas (𝗗𝗜Á𝗥𝗜𝗔𝗦) em texto simples (DIARIAS).
const normalizar = (s) =>
  s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase();

const RX_PRECO = /^\W*(\d+)\s*MT\s*[-–—]\s*(.+?)\s*$/i;
const RX_MEGAS = /^(\d+(?:[.,]\d+)?)\s*(MB|GB)$/i;
// Saldo, forma 1: "📱☎️ *50*  45 𝗠𝗧" (quantidade e depois o preço). A forma 2 ("45 MT - 50") já é lida acima.
const RX_SALDO = /^[^\dA-Z]*(\d+)[^\dA-Z]+(\d+(?:[.,]\d+)?)\s*MT\s*$/;

function detectarSecao(linha) {
  const t = normalizar(linha);
  if (t.includes("DIARI")) return "diario";
  if (t.includes("STOCK")) return "stock";
  if (t.includes("SALDO")) return "saldo";
  if (t.includes("SEMANA")) return "semanal";
  if (t.includes("MENSA")) return "mensal";
  if (t.includes("ILIMITAD") || t.includes("TUDO TOP")) return "ilimitado";
  return null;
}

// Lê uma tabela colada: títulos de seção definem o tipo, linhas "20 MT - 850 MB" definem os itens.
function parseTabela(texto) {
  const itens = {};
  const duplicados = [];
  const ignoradas = [];
  let tipo = null;

  for (const bruta of texto.split(/\r?\n/)) {
    const linha = bruta.trim();
    if (!linha || /^[_\-=\s]+$/.test(linha)) continue;

    if (tipo === "saldo") {
      const s = normalizar(linha).match(RX_SALDO);
      if (s) {
        const valorSaldo = Number(s[2].replace(",", "."));
        if (itens[valorSaldo]) duplicados.push(valorSaldo);
        itens[valorSaldo] = { megas: null, tipo: "saldo", nome: s[1] };
        continue;
      }
    }

    const m = linha.match(RX_PRECO);
    if (!m) {
      const secao = detectarSecao(linha);
      if (secao) tipo = secao; // senão é título ou lixo, ignora
      continue;
    }

    if (!tipo) {
      ignoradas.push(linha);
      continue;
    }

    const valor = Number(m[1]);
    const resto = m[2].trim();
    const mm = resto.match(RX_MEGAS);
    const megas = mm
      ? Math.round(
          Number(mm[1].replace(",", ".")) * (mm[2].toUpperCase() === "GB" ? 1024 : 1),
        )
      : null;

    if (itens[valor]) duplicados.push(valor);
    itens[valor] = { megas, tipo, nome: resto };
  }

  return { itens, duplicados, ignoradas };
}

export default {
  name: "addtabela",
  description: "Gerencia a tabela de preços (valor em MT → pacote).",
  commands: ["addtabela"],
  usage:
    `${PREFIX}addtabela *MOZ NET*  (e a tabela colada nas linhas abaixo)\n` +
    `${PREFIX}addtabela [valorMT] [megas] [diario/stock/semanal/mensal/saldo]\n` +
    `${PREFIX}addtabela remover [valorMT]\n${PREFIX}addtabela limpar`,

  handle: async ({ fullArgs, remoteJid, isGroup, sendReply }) => {
    if (!isGroup) throw new WarningError("Este comando só funciona em grupos!");

    const central = getCentral(remoteJid);
    if (!central) {
      throw new WarningError("Este grupo ainda não está vinculado a uma central.");
    }

    const codigo = central.centralCode;
    const args = fullArgs.trim().split(/\s+/).filter(Boolean);
    const acao = (args[0] || "").toLowerCase();

    // ---- tabela colada (várias linhas "20 MT - 850 MB") ----
    if (/\d+\s*MT\s*[-–—]\s*\S/i.test(fullArgs)) {
      const { itens, duplicados, ignoradas } = parseTabela(fullArgs);
      const valores = Object.keys(itens);

      if (!valores.length) {
        throw new InvalidParameterError(
          "Não encontrei itens. Os títulos (DIÁRIAS, STOCK, SEMANAIS, MENSAIS, ILIMITADO, SALDO) devem vir antes dos preços.",
        );
      }

      for (const v of valores) await salvarProduto(remoteJid, v, itens[v]);

      const contagem = {};
      for (const i of Object.values(itens)) contagem[i.tipo] = (contagem[i.tipo] || 0) + 1;

      return sendReply(
        `✅ *Tabela atualizada* (${valores.length} itens)\n────────────────\n` +
          Object.entries(contagem).map(([t, n]) => `${ROTULOS[t]}: ${n}`).join("\n") +
          (duplicados.length ? `\n\n⚠️ Valores repetidos (ficou o último): ${duplicados.join(", ")} MT` : "") +
          (ignoradas.length ? `\n\n⚠️ Sem título antes, ignoradas:\n${ignoradas.map((l) => `• ${l}`).join("\n")}` : ""),
      );
    }

    if (acao === "remover") {
      const valor = Number(args[1]);
      if (!valor) throw new InvalidParameterError(`Use: ${PREFIX}addtabela remover 20`);
      await removerProduto(remoteJid, valor);
      return sendReply(`🗑️ Valor ${valor} MT removido da tabela.`);
    }

    if (acao === "limpar") {
      const tabela = (await lerTabela(remoteJid)) || {};
      const chaves = Object.keys(tabela);
      for (const v of chaves) await removerProduto(remoteJid, v);
      return sendReply(`🗑️ Tabela limpa (${chaves.length} itens removidos).`);
    }

    // ---- um item: .addtabela 20 1024 diario [nome opcional] ----
    const valor = Number(args[0]);
    const megas = parseInt(args[1], 10);
    const tipo = (args[2] || "").toLowerCase();

    if (!valor || !megas || !TIPOS.includes(tipo)) {
      throw new InvalidParameterError(
        `Use: ${PREFIX}addtabela [valorMT] [megas] [diario/stock/semanal/mensal/saldo]\n` +
          `Ex: ${PREFIX}addtabela 20 1024 diario\n\n` +
          `Ou cole a tabela inteira:\n${PREFIX}addtabela *MOZ NET*\n(e a tabela nas linhas abaixo)`,
      );
    }

    const nome = args.slice(3).join(" ") || `${formatarMegas(megas)}`;
    await salvarProduto(remoteJid, valor, { megas, tipo, nome });

    await sendReply(
      `✅ *Tabela atualizada*\n💰 ${valor} MT → 📦 ${nome} (${tipo})\n` +
        (AUTOMATICOS.includes(tipo)
          ? "⚡ Processamento automático."
          : "👤 Atendimento pelo suporte (não automático)."),
    );
  },
};
