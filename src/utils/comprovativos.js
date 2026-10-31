// src/utils/comprovativos.js
// Processo completo: comprovativo -> validação -> carteira -> pedido -> venda concluída.
import { getDatabase } from "firebase-admin/database";
import { PREFIX } from "../config.js";
import {
  initFirebase,
  enviarComando,
  escutarStatusPedido,
  resolveDeviceByNumber,
} from "../services/firebase.js";
import { registrarCompra, mensagemSucesso } from "./rankings.js";
import { getActiveDevices } from "./centrals.js";
import { getGestao } from "./gestao.js";
import { lerTabela, salvarProduto, removerProduto } from "./produtos.js";
import { lerContas, lerSuporte } from "./contas.js";
import { reservarSim, devolverSim } from "./limites.js";

// Re-exports: os comandos que já existem continuam a importar daqui.
export { lerTabela };
export const salvarItemTabela = salvarProduto;
export const removerItemTabela = removerProduto;
export {
  lerContas,
  salvarContas,
  formatarContas,
  operadoraDe,
  lerSuporte,
  salvarSuporte,
  formatarSuporte,
} from "./contas.js";
export { liberarComprovativo, destruirComprovativo, idValido } from "./recibos.js";
export { enviarSaldo } from "./saldo.js";

// Camada fina sobre o firebase-admin (a mesma conexão que o firebase.js já usa).
const db = null; // não usado, só mantém a assinatura ref(db, caminho)
export const ref = (_db, caminho) => getDatabase(initFirebase()).ref(caminho);
export const get = (r) => r.get();
export const set = (r, valor) => r.set(valor);
export const update = (r, valor) => r.update(valor);
export const remove = (r) => r.remove();
const runTransaction = (r, fn) => r.transaction(fn);
const limitToLast = (n) => ({ ultimos: n });
const query = (r, filtro) => r.limitToLast(filtro.ultimos);
const onChildAdded = (q, callback) => q.on("child_added", callback);

// ===== CONFIGURAÇÃO =====
export const CAMINHO_OFICIAIS = (c) => `device_pairings/${c}/comprovantes_oficiais`; // SMS "Recebeste" lidos pelo APK
const CAMPOS_TEXTO = ["raw_text", "rawText", "texto", "body"]; // campo com o texto do SMS
const STATUS_DISPONIVEL = "DISPONIVEL"; // comprovativo ainda não usado
export const STATUS_USADO = "USADO"; // AJUSTAR se o APK usar outro nome para "já usado"
const JANELA_MS = 10 * 60 * 1000; // espera máxima pelo SMS oficial
const NUMERO_MS = 10 * 60 * 1000; // um número enviado antes do comprovativo vale 10 min
const LIMITE_MB = 10 * 1024; // cada envio ao aparelho leva no máximo 10 GB
const TEMPO_APK_MS = 3 * 60 * 1000; // sem resposta do APK depois disto: avisa a gestão (ajuste ao tempo normal)
const ESCUTA_MS = 30 * 60 * 1000; // quanto tempo continuar a escutar o APK (permite sucesso tardio)
const FUSO = "Africa/Maputo";
const TIPOS_AUTOMATICOS = ["diario", "stock"]; // os únicos enviados ao aparelho
const BOT = "👻";
// ========================

const RX_NUM = /(?<!\d)(?:258)?(8[2-8]\d{7})(?!\d)/g;
const RX_DESTINO = /(?:para(?:\s+conta)?|\bto)\s+(?:258)?(8[2-8]\d{7})/i;
const RX_CONTEUDO = /(?:Conte[uú]do|Content)\s*:\s*(?:258)?(8[2-8]\d{7})(?!\d)/i;
const RX_RECEBIDO = /receb(?:este|eu)|received/i;
// Divisão por números, uma por linha: "846000001, 10gb"  (1 GB = 1024 MB)
const RX_DIVISAO = /(?<!\d)(?:258)?(8[2-8]\d{7})(?!\d)\s*[,;:=\-–]\s*(\d+(?:[.,]\d+)?)\s*(gb|g|mb)\b/gi;

// IDs (texto em maiúsculas): M-Pesa ("CONFIRMADO DJ39LSYN2KV" / "DIF6LKYL2NA CONFIRMED") e e-Mola ("PP261003.1047.P43149")
const RX_IDS = [
  /CONFIRMADO\s+((?=[A-Z0-9]*\d)[A-Z0-9]{8,})/g,
  /\b((?=[A-Z0-9]*\d)[A-Z0-9]{8,})\s+CONFIRMED\b/g,
  /\b(PP\d{6}\.\d{4}\.[A-Z]\d+)/g,
];
// Detalhes (valor e conta de destino) lidos do texto do cliente.
const RX_DETALHE = [
  /Confirmado\s+([A-Z0-9]+)\.\s+Transferiste\s+([\d.,]+)\s*MT.*?para\s+(\d{9,})/gis,
  /([A-Z0-9]+)\s+Confirmed\.\s+([\d.,]+)\s*MT\s+sent.*?to\s+(\d{9,})/gis,
  /ID\s+da\s+transac[aã]o\s+([A-Z0-9.]+)\.\s+Transferiste\s+([\d.,]+)\s*MT\s+para\s+conta\s+(\d{9,})/gis,
  /Transaction\s+ID\s+([A-Z0-9.]+)\.\s+You\s+transfer+ed\s+([\d.,]+)\s*MT\s+to\s+(\d{9,})/gis,
];

export const chave = (id) => String(id).replace(/[.#$\[\]\/]/g, "_");
const lerTexto = (r) => CAMPOS_TEXTO.map((c) => r?.[c]).find(Boolean) || "";
export const canalDoId = (id) => (String(id).startsWith("PP") ? "e-Mola" : "M-Pesa");
const tipoDoId = (id) => (canalDoId(id) === "e-Mola" ? "e" : "m");
const arred = (n) => Math.round(n * 100) / 100;
const semPrefixo = (n) => String(n).replace(/^258(?=\d{9}$)/, "");
const num = (s) => parseFloat(String(s).replace(/,(?=\d{3}(\D|$))/g, "").replace(",", "."));

// ---------- exigência do comprovativo oficial (.id on/off) ----------
const caminhoExigeOficial = (remoteJid) => `config_id/${chave(remoteJid)}`;

export async function exigeOficial(remoteJid) {
  try {
    const v = (await get(ref(null, caminhoExigeOficial(remoteJid)))).val();
    return v !== false;
  } catch (e) {
    console.error("[comprovativos] erro ao ler o modo .id, assumindo ligado:", e);
    return true;
  }
}

export async function definirExigeOficial(remoteJid, ligado) {
  await set(ref(null, caminhoExigeOficial(remoteJid)), !!ligado);
}

// ---------- formatação ----------
const milhar = (n) => String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const fmtMb = (n) => `${milhar(n)} MB`;
export const fmtMt = (n) => `${Number(n).toFixed(2)} MT`;
const fmtGb = (mb) =>
  mb == null
    ? "?"
    : mb % 1024 === 0
      ? `${mb / 1024} GB`
      : `${Number((mb / 1024).toFixed(2))} GB`;

function dataHora(ms) {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: FUSO,
      day: "numeric",
      month: "numeric",
      year: "2-digit",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );
  return {
    data: `${partes.day}/${partes.month}/${partes.year}`,
    hora: `${partes.hour}:${partes.minute} ${partes.dayPeriod}`,
  };
}

const TIPOS = {
  diario: "Diária",
  semanal: "Semanal",
  mensal: "Mensal",
  ilimitado: "Ilimitado",
  stock: "Stock",
  saldo: "Saldo",
};
const tipoLabel = (t) => TIPOS[t] || (t ? String(t) : "—");

function linhasIds(vs) {
  const ordem = [...vs].sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === "m" ? -1 : 1));
  const total = { m: 0, e: 0 };
  ordem.forEach((v) => total[v.tipo]++);
  const visto = { m: 0, e: 0 };
  return ordem.map((v) => {
    visto[v.tipo]++;
    const n = total[v.tipo] > 1 ? visto[v.tipo] : "";
    return `🔎 ID${v.tipo}${n}: *${v.id}*`;
  });
}

function linhasContas(vs) {
  const com = vs.filter((v) => v.account);
  if (!com.length) return [];
  if (vs.length === 1) return [`💳 Conta: *${com[0].account}*`];
  return vs.map((v, i) => (v.account ? `💳 Conta ${i + 1}: *${v.account}*` : null)).filter(Boolean);
}

const linhasNumeros = (ds) =>
  ds.length === 1
    ? [`📱 Número: *${ds[0].numero}*`]
    : ds.map((d) => `📱 Número: *${d.numero}*${d.mb ? ` — ${fmtGb(d.mb)}` : ""}`);

function linhaProduto(item) {
  if (item.megas) return `📊 Dados: *${fmtMb(item.megas)}*`;
  if (item.tipo === "saldo") return `💳 Saldo: *${item.nome}*`;
  if (item.tipo === "ilimitado") return `💎 Pacote: *${item.nome}*`;
  return `📦 Pacote: *${item.nome}*`;
}

const descricaoItem = (item) =>
  item.megas ? fmtMb(item.megas) : item.tipo === "saldo" ? `${item.nome} de saldo` : item.nome;

function msgAprovado({ info, item, valor, destinos, extras = [] }) {
  const vs = info?.vouchers || [];
  return [
    `${BOT} 🔔 *Pedido aprovado!*`,
    "",
    ...linhasIds(vs),
    ...linhasContas(vs),
    `📅 Data: *${dataHora(Date.now()).data}*`,
    `💰 Valor: *${fmtMt(valor)}*`,
    `📦 Tipo: *${tipoLabel(item.tipo)}*`,
    linhaProduto(item),
    ...linhasNumeros(destinos),
    ...extras,
    "",
    "⏳ O seu pedido foi recebido com sucesso!",
    "Aguarde enquanto o sistema realiza a transferência.",
    "Será notificado assim que estiver concluído. 🙏",
  ].join("\n");
}

const msgPedirNumero = (item, total) =>
  [
    "📱 *Aguardando o número!*",
    "",
    `💰 Valor: *${fmtMt(total)}*`,
    `📦 Pacote: *${descricaoItem(item)}*`,
    "",
    `📲 Envie apenas o número no qual pretende receber ${descricaoItem(item)}.`,
    "",
    "Vários números? Um por linha, com os GB:",
    "846000001, 10gb",
    "847000002, 20gb",
  ].join("\n");

const msgDivisaoInvalida = (linhas) =>
  ["⚠️ *Divisão inválida!*", "", ...linhas.filter((l) => l !== "")].join("\n");

// ---------- nome do grupo ----------
let socketAtual = null;
export function definirSocket(socket) {
  socketAtual = socket;
}

const nomesGrupos = new Map();
const NOME_MS = 60 * 60 * 1000;

async function nomeDoGrupo(jid) {
  const guardado = nomesGrupos.get(jid);
  if (guardado && Date.now() - guardado.em < NOME_MS) return guardado.nome;
  try {
    const nome = (await socketAtual?.groupMetadata(jid))?.subject;
    if (nome) {
      nomesGrupos.set(jid, { nome, em: Date.now() });
      return nome;
    }
  } catch {
    /* segue com o ID do grupo */
  }
  return jid;
}

export async function avisarGestao(central, enviar, remoteJid, linhas, mencoes = []) {
  console.warn("[comprovativos] aviso de vendas:", linhas.join(" | "));
  const grupo = getGestao(central);
  if (!grupo) return;
  try {
    const origem = await nomeDoGrupo(remoteJid);
    await enviar(
      grupo,
      ["⚠️ *Aviso de vendas*", "", `🏷️ Origem: ${origem}`, ...linhas].join("\n"),
      mencoes,
    );
  } catch (e) {
    console.error("[comprovativos] não consegui avisar o grupo de gestão:", e);
  }
}

export async function avisarDuplicado(central, id, remoteJid, enviar) {
  let reg = null;
  try {
    reg = (await get(ref(db, `comprovantes_usados/${central}/${chave(id)}`))).val();
  } catch {
    /* segue sem detalhes */
  }
  const mencoes = [];
  const linhas = ["⚠️ *Comprovativo duplicado!*", "", `🔎 ID: *${id}*`, "❌ Esta transação já foi processada!", ""];
  if (reg?.registadoPor) {
    linhas.push(`👤 Registado por: @${String(reg.registadoPor).split("@")[0]}`);
    mencoes.push(reg.registadoPor);
  }
  if (reg?.usadoEm) {
    const t = dataHora(reg.usadoEm);
    linhas.push(`🕐 Hora: *${t.hora}* de *${t.data}*`);
  }
  linhas.push("", "📞 Caso haja algum engano, entre em contacto com o administrador.");
  await enviar(remoteJid, linhas.join("\n"), mencoes);
}

function mencionarSuporte(lista) {
  if (!lista.length) return { texto: "Administradores", jids: [] };
  return {
    texto: lista.map((m) => `@${m.numero} (${m.designacao})`).join(" "),
    jids: lista.map((m) => `${m.numero}@s.whatsapp.net`),
  };
}

// ---------- leitura de mensagens ----------
export function extrairIds(texto) {
  const t = String(texto || "").toUpperCase();
  const ids = [];
  for (const rx of RX_IDS) {
    for (const m of t.matchAll(rx)) if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

export const extrairId = (texto) => extrairIds(texto)[0] || null;

export function extrairComprovativos(texto) {
  const t = String(texto || "");
  const lista = extrairIds(t).map((id) => ({ id, tipo: tipoDoId(id), amount: null, account: null }));
  for (const rx of RX_DETALHE) {
    for (const m of t.matchAll(rx)) {
      const id = m[1].toUpperCase().replace(/\.$/, "");
      let v = lista.find((x) => x.id === id);
      if (!v) {
        v = { id, tipo: tipoDoId(id), amount: null, account: null };
        lista.push(v);
      }
      v.amount = num(m[2]);
      v.account = semPrefixo(m[3]);
    }
  }
  return lista;
}

export function extrairDivisao(texto) {
  const lista = [];
  for (const m of String(texto || "").matchAll(RX_DIVISAO)) {
    const q = Number(m[2].replace(",", "."));
    const mb = /^mb$/i.test(m[3]) ? q : q * 1024;
    lista.push({ numero: m[1], mb: Math.round(mb) });
  }
  return lista;
}

const extrairDestino = (t) => t.match(RX_DESTINO)?.[1] || null;
const extrairConteudo = (t) => t.match(RX_CONTEUDO)?.[1] || null;

function extrairNumeros(texto, excluir) {
  const divisao = extrairDivisao(texto);
  if (divisao.length) return divisao;
  const n = [...texto.matchAll(RX_NUM)].map((m) => m[1]).find((x) => !excluir.includes(x));
  return n ? [{ numero: n, mb: null }] : null;
}

export function extrairValor(textoSms) {
  const t = String(textoSms || "");
  const m =
    t.match(/(?:receb(?:este|eu)|received)\s+(\d[\d,]*(?:\.\d+)?)\s*MT/i) ||
    t.match(/(?<![A-Za-z0-9.,])(\d[\d,]*(?:\.\d+)?)\s*MT\b/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export async function buscarRecibo(central, id) {
  const base = CAMINHO_OFICIAIS(central);
  const alvo = id.toUpperCase();

  const direto = await get(ref(db, `${base}/${chave(id)}`));
  let candidatos;
  if (direto.exists()) {
    candidatos = [[direto.key, direto.val()]];
  } else {
    const snap = await get(query(ref(db, base), limitToLast(300)));
    candidatos = Object.entries(snap.val() || {});
  }

  const achado = candidatos.find(([, r]) => {
    const texto = lerTexto(r);
    const ids = [r.tx_id, r.safe_key, r.txId]
      .filter(Boolean)
      .map((x) => String(x).toUpperCase());
    return (
      RX_RECEBIDO.test(texto) &&
      (ids.includes(alvo) || ids.includes(chave(alvo)) || texto.toUpperCase().includes(alvo))
    );
  });

  if (!achado) return null;
  const [chaveOficial, r] = achado;
  return {
    chaveOficial,
    texto: lerTexto(r),
    status: r.status || null,
    amount: r.amount_mt ?? null,
  };
}

const numerosAvulsos = new Map();
const chaveNum = (remoteJid, jid) => `${remoteJid}|${jid}`;

function guardarNumero(remoteJid, jid, destinos) {
  numerosAvulsos.set(chaveNum(remoteJid, jid), { destinos, em: Date.now() });
}

function levarNumero(remoteJid, jid) {
  const k = chaveNum(remoteJid, jid);
  const v = numerosAvulsos.get(k);
  numerosAvulsos.delete(k);
  return v && Date.now() - v.em <= NUMERO_MS ? v.destinos : null;
}

// ---------- carteira ----------
const carteiraRef = (central, jid) => ref(db, `carteiras/${central}/${chave(jid)}`);

async function creditarCarteira(central, jid, remoteJid, valor, ids) {
  let antes = 0;
  const tr = await runTransaction(carteiraRef(central, jid), (a) => {
    antes = Number(a?.total) || 0;
    const c = a ? { ...a } : { remetente: jid, remoteJid, total: 0, criadoEm: Date.now() };
    c.total = arred((Number(c.total) || 0) + valor);
    c.movimentos = [...(c.movimentos || []), { tipo: "ENTRADA", valor, ids, em: Date.now() }];
    c.atualizadoEm = Date.now();
    return c;
  });
  return { antes, saldo: Number(tr.snapshot.val()?.total) || 0 };
}

async function devolverCarteira(central, jid, remoteJid, valor) {
  await runTransaction(carteiraRef(central, jid), (a) => {
    const c = a ? { ...a } : { remetente: jid, remoteJid, total: 0, criadoEm: Date.now() };
    c.total = arred((Number(c.total) || 0) + valor);
    c.movimentos = [...(c.movimentos || []), { tipo: "ESTORNO", valor, em: Date.now() }];
    c.atualizadoEm = Date.now();
    return c;
  });
}

async function marcarIds(central, ids, patch) {
  for (const id of ids) {
    await update(ref(db, `comprovantes_usados/${central}/${chave(id)}`), patch);
  }
}

// ---------- venda concluída ----------
export async function concluirVenda(central, { jid, remoteJid, produto, enviar }) {
  let stats = null;
  try {
    stats = await registrarCompra(central, remoteJid, jid, produto);
  } catch (e) {
    console.error("[comprovativos] erro ao registrar ranking:", e);
  }
  const texto = stats
    ? mensagemSucesso(stats, jid)
    : "✅ *Transação concluída com sucesso!*\n\nObrigado pela preferência! 🙏";
  await enviar(remoteJid, texto, [jid]);
  return stats;
}

export function produtoDaTabela(item) {
  if (!item) return null;
  if (item.tipo === "saldo") {
    const qtd = parseFloat(String(item.nome).replace(/[^\d.,]/g, "").replace(",", "."));
    return Number.isFinite(qtd) ? { tipo: "saldo", qtd } : null;
  }
  if (item.tipo === "ilimitado") return { tipo: "top", nome: item.nome };
  if (item.megas) return { tipo: "mb", qtd: Number(item.megas) };
  return null;
}

// ---------- disparo automático (.autosell) ----------
const caminhoAutosell = (remoteJid) => `config_autosell/${chave(remoteJid)}`;

export async function autosellLigado(remoteJid) {
  try {
    const v = (await get(ref(null, caminhoAutosell(remoteJid)))).val();
    return v !== false;
  } catch (e) {
    console.error("[comprovativos] erro ao ler o .autosell, assumindo ligado:", e);
    return true;
  }
}

export async function definirAutosell(remoteJid, ligado) {
  await set(ref(null, caminhoAutosell(remoteJid)), !!ligado);
}

// ---------- pedidos aprovados ----------
const caminhoPedido = (central, msgId) => `pedidos_aprovados/${central}/${chave(msgId)}`;

async function moverPedido(central, msgId, de, para, extra = {}) {
  if (!msgId) return null;
  const pRef = ref(db, caminhoPedido(central, msgId));
  let mudou = false;
  const tr = await runTransaction(pRef, (a) => {
    mudou = false;
    if (a === null) return null;
    if (!de.includes(a.status)) return undefined;
    mudou = true;
    return { ...a, ...extra, status: para, atualizadoEm: Date.now() };
  });
  return tr.committed && mudou ? tr.snapshot.val() : null;
}

export async function concluirPorReacao(central, { remoteJid, msgId, enviar, por }) {
  const atual = (await get(ref(db, caminhoPedido(central, msgId)))).val();
  if (!atual || atual.remoteJid !== remoteJid) return { ok: false };

  const ped = await moverPedido(central, msgId, ["AGUARDANDO"], "CONCLUIDO_MANUAL", {
    concluidoPor: por || null,
  });
  if (!ped) return { ok: false };

  await marcarIds(central, ped.ids || [], { status: "ENTREGUE" });
  if (ped.produto) {
    await concluirVenda(central, { jid: ped.jid, remoteJid, produto: ped.produto, enviar });
  } else {
    await enviar(remoteJid, "✅ *Transação concluída com sucesso!*\n\nObrigado pela preferência! 🙏", [ped.jid]);
  }
  return { ok: true };
}

const semAcento = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const RX_ERRO_OPERADORA = /transferencia de megas nao permitida/;
const erroOperadora = (st) => RX_ERRO_OPERADORA.test(semAcento(JSON.stringify(st)));
const textoErro = (st) => String(st?.motivoErro || st?.ussdResponseText || JSON.stringify(st));

// ---------- pedido ----------
function resolverDestinos(lista, item) {
  const megas = Number(item.megas) || 0;
  if (lista.length === 1 && lista[0].mb == null) {
    return { destinos: [{ numero: lista[0].numero, mb: megas || null }] };
  }
  const exemplo = ["", "Um por linha, com os GB:", "846000001, 10gb", "847000002, 20gb"];
  if (!megas) {
    return { erro: true, linhas: ["Este pacote não permite divisão por números.", ...exemplo] };
  }
  if (lista.some((d) => d.mb == null)) {
    return { erro: true, linhas: ["Informe os GB de cada número.", ...exemplo] };
  }
  const soma = lista.reduce((t, d) => t + d.mb, 0);
  if (soma !== megas) {
    const dif = megas - soma;
    return {
      erro: true,
      linhas: [
        `📦 Pacote: ${fmtGb(megas)}`,
        `📊 Pedido: ${fmtGb(soma)}`,
        "",
        dif > 0
          ? `Faltam ${fmtGb(dif)} para completar o pacote.`
          : `Excede o pacote em ${fmtGb(-dif)}.`,
        "Envie os números novamente, com os GB corretos.",
      ],
    };
  }
  return { destinos: lista };
}

function partir(destinos) {
  const saida = [];
  for (const d of destinos) {
    let resto = d.mb;
    while (resto > LIMITE_MB) {
      saida.push({ numero: d.numero, mb: LIMITE_MB });
      resto -= LIMITE_MB;
    }
    saida.push({ numero: d.numero, mb: resto });
  }
  return saida;
}

async function criarPedido(central, o) {
  const { remoteJid, jid, item, valor, destinos, enviar, info = null, extras = [], mencoes = [] } = o;
  const ids = (info?.vouchers || []).map((v) => v.id);
  const produto = produtoDaTabela(item);
  const aprovado = () =>
    enviar(remoteJid, msgAprovado({ info, item, valor, destinos, extras }), mencoes);

  const registar = async (enviada, status) => {
    const msgId = enviada?.key?.id;
    if (!msgId) {
      console.warn("[comprovativos] sem o id da mensagem do pedido: a reação ✅ não funciona neste pedido");
      return null;
    }
    await set(ref(db, caminhoPedido(central, msgId)), {
      jid,
      remoteJid,
      valor,
      ids,
      produto: produto || null,
      status,
      criadoEm: Date.now(),
    });
    return msgId;
  };

  const manual = async (titulo, detalhes = []) => {
    let sup = { texto: "Administradores", jids: [] };
    try {
      sup = mencionarSuporte(await lerSuporte(central));
    } catch (e) {
      console.error("[comprovativos] erro ao ler o suporte:", e);
    }
    await marcarIds(central, ids, { status: "MANUAL", pacote: item.nome });
    await registar(await aprovado(), "AGUARDANDO");
    await avisarGestao(
      central,
      enviar,
      remoteJid,
      [
        `📋 ${titulo}`,
        `💰 Valor: ${fmtMt(valor)}`,
        `📦 Tipo: ${tipoLabel(item.tipo)} — ${descricaoItem(item)}`,
        ...destinos.map((d) => `📱 Número: ${d.numero}${d.mb ? ` — ${fmtGb(d.mb)}` : ""}`),
        ...detalhes,
        `👤 ${sup.texto}`,
        `Depois de atender, reaja com ✅ ao "Pedido aprovado" (ou use ${PREFIX}record).`,
      ],
      sup.jids,
    );
  };

  if (!TIPOS_AUTOMATICOS.includes(item.tipo)) return manual("Pedido manual para atender");
  if (!(await autosellLigado(remoteJid))) {
    return manual(`Disparo automático desligado (${PREFIX}autosell off)`);
  }

  const megasPacote = Number(item.megas) || 0;
  const isSms = info?.sms === true;

  const falhaGeral = async (motivo) => {
    if (!isSms) {
      await devolverCarteira(central, jid, remoteJid, valor);
    }
    await avisarGestao(central, enviar, remoteJid, [
      ...(ids.length ? [`🔎 ID: ${ids.join(", ")}`] : []),
      `💰 Valor: ${fmtMt(valor)}`,
      `⚠️ Motivo: ${motivo}`,
      ...(isSms ? [] : [`↩️ ${fmtMt(valor)} voltaram para a carteira do cliente`]),
    ]);
  };
  if (!megasPacote) return falhaGeral("pacote automático sem MB definido na tabela");

  const numerosAparelho = getActiveDevices(remoteJid);
  if (!numerosAparelho.length) return falhaGeral("grupo sem aparelho definido (use .usarcell)");

  const blocos = partir(destinos);
  let restoValor = valor;
  const lista = blocos.map((d, i) => {
    const ultimo = i === blocos.length - 1;
    const v = ultimo ? restoValor : arred(valor * (d.mb / megasPacote));
    restoValor = arred(restoValor - v);
    return { ...d, valor: v };
  });

  let numeroAparelho = null;
  let device = null;
  let reservas = [];
  let algumExiste = false;
  const motivos = [];
  for (const num of numerosAparelho) {
    let dev;
    try {
      dev = await resolveDeviceByNumber(central, num);
    } catch (e) {
      motivos.push(`Dispositivo ${num}: ${String(e.message)}`);
      continue;
    }
    if (!dev) {
      motivos.push(`Dispositivo ${num}: não encontrado`);
      continue;
    }
    algumExiste = true;

    const tentativa = [];
    let erro = null;
    for (const d of lista) {
      const r = reservarSim(central, num, d.mb);
      if (r.erro) {
        erro = r.erro;
        break;
      }
      tentativa.push({ ...r, d });
    }
    if (erro) {
      for (const x of tentativa) devolverSim(central, num, x.sim, x.d.mb);
      motivos.push(`Dispositivo ${num}: ${erro}`);
      continue;
    }

    numeroAparelho = num;
    device = dev;
    reservas = tentativa;
    break;
  }

  if (!numeroAparelho) {
    if (!algumExiste) return falhaGeral(motivos.join("; "));
    return manual("Sem megas ou limites para o disparo automático", [
      ...motivos.map((m) => `⚠️ ${m}`),
      `Defina com ${PREFIX}megas e ${PREFIX}mlimite.`,
    ]);
  }

  for (const r of reservas) {
    if (!r.trocou) continue;
    await avisarGestao(central, enviar, remoteJid, [
      `🔁 Troca de chip no dispositivo ${numeroAparelho}: SIM ${r.trocou.de + 1} → SIM ${r.trocou.para + 1}`,
      `Motivo: ${r.trocou.motivo}`,
    ]);
  }

  let msgId = null;
  let mbOk = 0;
  const feitos = new Set();

  const pedirAdmin = async (d, motivo) => {
    await moverPedido(central, msgId, ["EM_ANDAMENTO"], "AGUARDANDO");
    await avisarGestao(central, enviar, remoteJid, [
      ...(ids.length ? [`🔎 ID: ${ids.join(", ")}`] : []),
      `📱 Número: ${d.numero}`,
      `📊 Dados: ${fmtMb(d.mb)}`,
      `⚠️ Motivo: ${motivo}`,
      `Faça manualmente e reaja com ✅ ao "Pedido aprovado".`,
      "Se o APK concluir depois, o pedido conclui sozinho.",
    ]);
  };

  const sucesso = async (orderId, d) => {
    if (feitos.has(orderId)) return;
    feitos.add(orderId);
    mbOk += d.mb;
    if (feitos.size < lista.length) return;
    if (msgId) {
      const ped = await moverPedido(central, msgId, ["EM_ANDAMENTO", "AGUARDANDO"], "CONCLUIDO");
      if (!ped) return;
    }
    await marcarIds(central, ids, { status: "ENTREGUE" });
    await concluirVenda(central, { jid, remoteJid, produto: { tipo: "mb", qtd: mbOk }, enviar });
  };

  const enviados = [];
  const falhasEnvio = [];
  for (const { d, sim } of reservas) {
    try {
      const orderId = await enviarComando(central, {
        targetDeviceId: device.deviceId,
        clientePhone: d.numero,
        megasAmount: d.mb,
        valorPago: d.valor,
        ussdMethod: "*162#",
        isManual: true,
        targetSimSlot: sim,
      });
      enviados.push({ orderId, d, sim });
    } catch (e) {
      devolverSim(central, numeroAparelho, sim, d.mb);
      falhasEnvio.push({ d, motivo: String(e.message) });
    }
  }

  await marcarIds(central, ids, {
    status: enviados.length ? "EM_ANDAMENTO" : "MANUAL",
    pacote: item.nome,
    pedidoId: enviados.map((x) => x.orderId).join(","),
  });
  msgId = await registar(await aprovado(), enviados.length ? "EM_ANDAMENTO" : "AGUARDANDO");

  for (const f of falhasEnvio) await pedirAdmin(f.d, f.motivo);

  for (const { orderId, d, sim } of enviados) {
    let falhou = false;
    const timer = setTimeout(async () => {
      if (feitos.has(orderId) || falhou) return;
      falhou = true;
      try {
        await pedirAdmin(d, `sem resposta do APK há ${TEMPO_APK_MS / 60000} min`);
      } catch (e) {
        console.error("[comprovativos] erro no timeout:", e);
      }
    }, TEMPO_APK_MS);

    let parar = () => {};
    parar = escutarStatusPedido(central, orderId, async (st) => {
      try {
        if (st.status === "SUCESSO" || st.status === "CONCLUIDO") {
          clearTimeout(timer);
          await sucesso(orderId, d);
          parar();
        } else if (st.status === "FALHA" || st.status === "ERRO") {
          clearTimeout(timer);
          if (feitos.has(orderId)) return;
          if (erroOperadora(st)) {
            await avisarGestao(central, enviar, remoteJid, [
              `📱 Número: ${d.numero}`,
              `📊 Dados: ${fmtMb(d.mb)}`,
              "⚠️ Erro da operadora (considerado enviado):",
              textoErro(st),
            ]);
            await sucesso(orderId, d);
            parar();
          } else if (!falhou) {
            falhou = true;
            devolverSim(central, numeroAparelho, sim, d.mb);
            await pedirAdmin(d, st.motivoErro || "desconhecido");
          }
        }
      } catch (e) {
        console.error("[comprovativos] erro ao tratar o status do pedido:", e);
      }
    }, ESCUTA_MS);
  }
}

// ---------- .usar ----------
export async function usarCarteira(
  central,
  { jid, remoteJid, valor, destinos = null, numero = null, enviar, porAdmin = false, auto = false, info = null },
) {
  const tabela = (await lerTabela(remoteJid)) || {};
  const cRef = carteiraRef(central, jid);

  // SE FOR DISPARO AUTOMÁTICO DE SMS, IGNORA A VALIDAÇÃO E O DÉBITO DA CARTEIRA
  const isSmsAuto = auto && info?.sms === true;

  if (!isSmsAuto) {
    const saldo = Number((await get(cRef)).val()?.total) || 0;
    if (saldo <= 0) {
      return { erro: porAdmin ? "O membro não tem fundos na carteira." : "Você não tem fundos na carteira." };
    }
  }

  const item = tabela[String(valor)];
  if (!item) {
    const saldoAtual = isSmsAuto ? valor : Number((await get(cRef)).val()?.total) || 0;
    const validos = Object.keys(tabela)
      .map(Number)
      .filter((v) => v <= saldoAtual)
      .sort((a, b) => b - a)
      .slice(0, 5);
    return {
      erro:
        `O valor ${valor} MT não existe na tabela.` +
        (validos.length
          ? ` Valores que a carteira cobre: ${validos.join(", ")} MT.`
          : ` A carteira ainda não cobre nenhum pacote.`),
    };
  }

  if (!isSmsAuto) {
    const saldo = Number((await get(cRef)).val()?.total) || 0;
    if (saldo < valor) {
      return { erro: `Saldo insuficiente. Carteira: ${saldo} MT, pedido: ${valor} MT.` };
    }
  }

  const lista = destinos || (numero ? [{ numero, mb: null }] : null);
  if (!lista) return { erro: `Informe o número. Ex: ${PREFIX}usar ${valor} 846000001` };

  const r = resolverDestinos(lista, item);
  if (r.erro) return { erro: r.linhas.filter(Boolean).join("\n"), divisao: true, linhas: r.linhas };

  let debitou = true;
  let restante = 0;

  if (!isSmsAuto) {
    debitou = false;
    const tr = await runTransaction(cRef, (a) => {
      debitou = false;
      if (a === null) return null;
      if ((Number(a.total) || 0) < valor) return undefined;
      debitou = true;
      const c = { ...a };
      c.total = arred(c.total - valor);
      c.movimentos = [
        ...(c.movimentos || []),
        {
          tipo: "USO",
          valor,
          numero: r.destinos.map((d) => d.numero).join(","),
          por: porAdmin ? "ADMIN" : "MEMBRO",
          em: Date.now(),
        },
      ];
      c.atualizadoEm = Date.now();
      return c.total <= 0 ? null : c;
    });
    if (!tr.committed || !debitou) {
      return { erro: "Saldo insuficiente. Ele pode ter sido usado agora há pouco." };
    }
    restante = Number(tr.snapshot.val()?.total) || 0;
  }

  const dono = `@${jid.split("@")[0]}`;
  const extras = auto
    ? []
    : porAdmin
      ? [`👛 Debitado da carteira de ${dono} (restante: ${restante} MT)`]
      : [`👛 Saldo restante na carteira: ${restante} MT`];

  await criarPedido(central, {
    remoteJid,
    jid,
    item,
    valor,
    destinos: r.destinos,
    enviar,
    info,
    extras,
    mencoes: porAdmin ? [jid] : [],
  });

  return { ok: true };
}

export async function enviarMb(central, { jid, remoteJid, mb, numero, enviar }) {
  const tabela = (await lerTabela(remoteJid)) || {};
  const achado = Object.entries(tabela)
    .filter(([, i]) => Number(i.megas) === mb)
    .sort((a, b) => Number(a[0]) - Number(b[0]))[0];

  if (!achado) {
    const proximos = Object.values(tabela)
      .map((i) => Number(i.megas))
      .filter(Boolean)
      .sort((a, b) => Math.abs(a - mb) - Math.abs(b - mb))
      .slice(0, 6)
      .sort((a, b) => a - b);
    return {
      erro:
        `${mb} MB não existe na tabela.` +
        (proximos.length ? ` Valores mais próximos: ${proximos.join(", ")} MB.` : ""),
    };
  }

  return usarCarteira(central, {
    jid,
    remoteJid,
    valor: Number(achado[0]),
    numero,
    enviar,
    porAdmin: true,
  });
}

const caminhoAguardando = (central, remoteJid, jid) =>
  `aguardando_numero/${central}/${chave(`${remoteJid}_${jid}`)}`;

const normalizar = (p) => ({
  ...p,
  ids: p.ids || (p.id ? [{ id: p.id, tipo: tipoDoId(p.id), amount: null, account: null }] : []),
});
const chavePend = (p) => chave(p.ids[0].id);
const pendRoot = (central) => `comprovantes_pendentes/${central}`;

async function listarPendentes(central) {
  const todos = (await get(ref(db, pendRoot(central)))).val() || {};
  return Object.values(todos).map(normalizar).filter((p) => p.ids.length);
}

const emCurso = new Set();

async function tentar(central, p, enviar, primeira) {
  p = normalizar(p);
  const k = `${central}|${chavePend(p)}`;
  if (emCurso.has(k)) return;
  emCurso.add(k);
  try {
    await tentarInterno(central, p, enviar, primeira);
  } finally {
    emCurso.delete(k);
  }
}

async function tentarInterno(central, p, enviar, primeira) {
  const pendRef = ref(db, `${pendRoot(central)}/${chavePend(p)}`);
  if (!(await get(pendRef)).exists()) return;
  const exige = await exigeOficial(p.remoteJid);

  const recibos = [];
  const faltam = [];
  for (const v of p.ids) {
    let recibo = await buscarRecibo(central, v.id);
    if (!recibo && !exige && v.amount) {
      recibo = { chaveOficial: null, texto: "", status: null, amount: v.amount };
    }
    if (recibo) recibos.push({ v, recibo });
    else faltam.push(v);
  }

  if (faltam.length) {
    if (primeira && !p.avisadoEspera) {
      await update(pendRef, { avisadoEspera: true });
      await avisarGestao(central, enviar, p.remoteJid, [
        ...linhasIds(faltam),
        "⏳ Em espera: aguardando o SMS oficial no aparelho (expira em 10 min)",
      ]);
    }
    return;
  }

  await remove(pendRef);
  await finalizar(central, p, recibos, enviar);
}

async function finalizar(central, p, recibos, enviar) {
  const jid = p.remetente || p.remoteJid;
  const idsTxt = p.ids.map((v) => v.id);

  const valores = [];
  for (const { v, recibo } of recibos) {
    if (recibo.chaveOficial) {
      const trava = await runTransaction(
        ref(db, `${CAMINHO_OFICIAIS(central)}/${recibo.chaveOficial}/status`),
        (atual) => (atual === null || atual === STATUS_DISPONIVEL ? STATUS_USADO : undefined),
      );
      if (!trava.committed) {
        await avisarDuplicado(central, v.id, p.remoteJid, enviar);
        return;
      }
    }
    const valor = extrairValor(recibo.texto) ?? (Number(recibo.amount) || null);
    const reserva = await runTransaction(
      ref(db, `comprovantes_usados/${central}/${chave(v.id)}`),
      (atual) =>
        atual === null || (p.liberado && atual.status === "PAUSADO")
          ? {
              id: v.id,
              canal: canalDoId(v.id),
              valor,
              registadoPor: jid,
              origem: "GRUPO",
              semOficial: !recibo.chaveOficial,
              usadoEm: Date.now(),
              status: "RESERVADO",
            }
          : undefined,
    );
    if (!reserva.committed) {
      await avisarDuplicado(central, v.id, p.remoteJid, enviar);
      return;
    }
    valores.push(valor);
  }

  if (valores.some((x) => !x)) {
    await marcarIds(central, idsTxt, { status: "MANUAL", motivo: "valor ilegível" });
    await avisarGestao(central, enviar, p.remoteJid, [
      ...linhasIds(p.ids),
      "⚠️ Motivo: valor ilegível no SMS",
    ]);
    return;
  }

  const total = arred(valores.reduce((s, x) => s + x, 0));
  const tabela = (await lerTabela(p.remoteJid)) || {};
  const precos = Object.keys(tabela).map(Number).sort((a, b) => a - b);

  if (!precos.length) {
    await marcarIds(central, idsTxt, { status: "MANUAL", motivo: "tabela vazia" });
    await avisarGestao(central, enviar, p.remoteJid, [
      ...linhasIds(p.ids),
      `💰 Valor: ${fmtMt(total)}`,
      "⚠️ Motivo: tabela de preços vazia",
    ]);
    return;
  }

  const vouchers = p.ids.map((v, i) => ({
    ...v,
    account: v.account || extrairDestino(recibos[i].recibo.texto) || null,
  }));
  const info = { vouchers };
  const conteudo = recibos.map((r) => extrairConteudo(r.recibo.texto)).find(Boolean);

  let saldo;
  let antes;
  try {
    ({ antes, saldo } = await creditarCarteira(central, jid, p.remoteJid, total, idsTxt));
  } catch (e) {
    await marcarIds(central, idsTxt, { status: "MANUAL", motivo: String(e.message) });
    await avisarGestao(central, enviar, p.remoteJid, [
      ...linhasIds(p.ids),
      `💰 Valor: ${fmtMt(total)}`,
      `⚠️ Motivo: erro ao guardar na carteira (${String(e.message)})`,
    ]);
    return;
  }
  await marcarIds(central, idsTxt, { status: "CARTEIRA" });

  const item = tabela[String(total)];

  if (!item) {
    const abaixo = [...precos].reverse().find((v) => v <= saldo);
    const linhas = [
      "💰 *Pagamento parcial recebido!*",
      "",
      ...linhasIds(p.ids),
      `💰 Valor: *${fmtMt(total)}*`,
      `👛 Carteira: *${fmtMt(saldo)}*`,
      "",
      "O valor não consta na nossa tabela de preços e foi adicionado à sua carteira.",
    ];
    if (abaixo) {
      linhas.push(
        `Verifique a tabela (${PREFIX}tabela) e complete o pagamento, ou use uma parte do valor:`,
        `💡 ${PREFIX}usar ${abaixo} 846000001`,
      );
    } else {
      linhas.push(`Verifique a tabela (${PREFIX}tabela) e complete o pagamento.`);
    }
    await enviar(p.remoteJid, linhas.join("\n"));
    return;
  }

  if (antes > 0) {
    levarNumero(p.remoteJid, jid);
    await enviar(
      p.remoteJid,
      [
        "👛 *Pagamento adicionado à carteira!*",
        "",
        ...linhasIds(p.ids),
        `💰 Valor: *${fmtMt(total)}*`,
        `👛 Carteira: *${fmtMt(saldo)}*`,
        "",
        "Como a sua carteira já tinha saldo, o valor foi adicionado a ela.",
        "Escolha o pacote com:",
        `💡 ${PREFIX}usar ${total} 846000001`,
      ].join("\n"),
    );
    return;
  }

  const destinos = p.destinos || levarNumero(p.remoteJid, jid) || (conteudo ? [{ numero: conteudo, mb: null }] : null);
  const aguardar = async (linhasErro = null) => {
    await set(ref(db, caminhoAguardando(central, p.remoteJid, jid)), {
      jid,
      remoteJid: p.remoteJid,
      valor: total,
      info,
      criadoEm: Date.now(),
    });
    await enviar(
      p.remoteJid,
      linhasErro ? msgDivisaoInvalida(linhasErro) : msgPedirNumero(item, total),
    );
  };

  if (!destinos) return aguardar();

  const r = await usarCarteira(central, {
    jid,
    remoteJid: p.remoteJid,
    valor: total,
    destinos,
    enviar,
    auto: true,
    info,
  });
  if (r.divisao) return aguardar(r.linhas);
  if (r.erro) {
    await avisarGestao(central, enviar, p.remoteJid, [
      ...linhasIds(p.ids),
      `💰 Valor: ${fmtMt(total)}`,
      `⚠️ Motivo: ${r.erro}`,
      "O valor ficou na carteira do cliente.",
    ]);
  }
}

export async function tratarMensagem({ central, texto, jid, remoteJid, enviar }) {
  const contas = (await lerContas(central)).map((c) => String(c.numero));
  const vouchers = extrairComprovativos(texto);
  const excluir = [...contas, ...vouchers.map((v) => v.account).filter(Boolean)];
  const destinos = extrairNumeros(texto, excluir);

  if (!vouchers.length) {
    if (!destinos) return false;
    if (!extrairDivisao(texto).length && texto.trim().length > 40) return false;

    const awRef = ref(db, caminhoAguardando(central, remoteJid, jid));
    const aw = (await get(awRef)).val();
    if (aw) {
      const r = await usarCarteira(central, {
        jid,
        remoteJid,
        valor: aw.valor,
        destinos,
        enviar,
        auto: true,
        info: aw.info,
      });
      if (r.divisao) {
        await enviar(remoteJid, msgDivisaoInvalida(r.linhas));
        return true;
      }
      await remove(awRef);
      if (r.erro) {
        await avisarGestao(central, enviar, remoteJid, [
          `💰 Valor: ${fmtMt(aw.valor)}`,
          `⚠️ Motivo: ${r.erro}`,
        ]);
      }
      return true;
    }

    const p = (await listarPendentes(central)).find((x) => x.remetente === jid && x.remoteJid === remoteJid);
    if (p) {
      await update(ref(db, `${pendRoot(central)}/${chavePend(p)}`), { destinos });
      await tentar(central, { ...p, destinos }, enviar, false);
      return true;
    }

    guardarNumero(remoteJid, jid, destinos);
    return false;
  }

  if (!contas.length) {
    let novos = 0;
    for (const v of vouchers) {
      const reserva = await runTransaction(
        ref(db, `comprovantes_usados/${central}/${chave(v.id)}`),
        (atual) =>
          atual === null
            ? {
                id: v.id,
                canal: canalDoId(v.id),
                registadoPor: jid,
                origem: "GRUPO",
                usadoEm: Date.now(),
                status: "MANUAL",
                motivo: "sem conta cadastrada",
              }
            : undefined,
      );
      if (reserva.committed) novos++;
      else await avisarDuplicado(central, v.id, remoteJid, enviar);
    }
    if (novos) {
      await avisarGestao(central, enviar, remoteJid, [
        ...linhasIds(vouchers),
        ...(destinos ? destinos.map((d) => `📱 Número: ${d.numero}`) : []),
        "⚠️ Motivo: nenhuma conta de pagamento cadastrada (use .addpayments)",
      ]);
    }
    return true;
  }

  const fora = vouchers.find((v) => v.account && !contas.includes(v.account));
  if (fora) {
    await enviar(
      remoteJid,
      [
        "🚫 *Comprovativo inválido!*",
        "",
        `🔎 ID: *${fora.id}*`,
        "❌ Este comprovativo não foi enviado para uma das nossas contas de pagamento.",
        "",
        "📞 Verifique o número de destino e tente novamente.",
      ].join("\n"),
    );
    return true;
  }

  for (const v of vouchers) {
    if ((await get(ref(db, `comprovantes_usados/${central}/${chave(v.id)}`))).exists()) {
      await avisarDuplicado(central, v.id, remoteJid, enviar);
      return true;
    }
  }

  const destinosFinal = destinos || levarNumero(remoteJid, jid);

  const existente = (await listarPendentes(central)).find((p) =>
    p.ids.some((x) => vouchers.some((v) => v.id === x.id)),
  );
  if (existente) {
    const p = {
      ...existente,
      destinos: destinosFinal || existente.destinos || null,
      texto: existente.texto || texto,
    };
    if (destinosFinal) await update(ref(db, `${pendRoot(central)}/${chavePend(p)}`), { destinos: destinosFinal });
    await tentar(central, p, enviar, true);
    return true;
  }

  const p = {
    ids: vouchers,
    destinos: destinosFinal || null,
    remetente: jid,
    remoteJid,
    texto,
    criadoEm: Date.now(),
  };
  await set(ref(db, `${pendRoot(central)}/${chavePend(p)}`), p);
  await tentar(central, p, enviar, true);
  return true;
}

export function iniciarComprovativos(central, enviar) {
  onChildAdded(query(ref(db, CAMINHO_OFICIAIS(central)), limitToLast(50)), async (snap) => {
    try {
      const r = snap.val() || {};
      const texto = lerTexto(r);
      if (!RX_RECEBIDO.test(texto)) return;
      if (r.status && r.status !== STATUS_DISPONIVEL) return;
      const id =
        extrairId(texto) ||
        (r.tx_id && r.tx_id !== "RECEBESTE" ? String(r.tx_id).toUpperCase() : null);
      if (!id) return;

      const p = (await listarPendentes(central)).find((x) => x.ids.some((v) => v.id === id));
      if (!p) return;

      await tentar(central, p, enviar, false);
    } catch (e) {
      console.error("[comprovativos] erro no comprovativo novo:", e);
    }
  });

  setInterval(async () => {
    try {
      for (const p of await listarPendentes(central)) {
        if (Date.now() - p.criadoEm <= JANELA_MS) continue;
        await remove(ref(db, `${pendRoot(central)}/${chavePend(p)}`));
        await enviar(
          p.remoteJid,
          [
            "⌛ *Comprovativo expirado!*",
            "",
            ...linhasIds(p.ids),
            "",
            "Expirou sem confirmação do pagamento.",
            "Envie novamente ou fale com o suporte.",
          ].join("\n"),
        );
      }

      const aguardando = (await get(ref(db, `aguardando_numero/${central}`))).val() || {};
      for (const [k, aw] of Object.entries(aguardando)) {
        if (Date.now() - aw.criadoEm <= NUMERO_MS) continue;
        await remove(ref(db, `aguardando_numero/${central}/${k}`));
        await enviar(
          aw.remoteJid,
          [
            "⌛ *Tempo para enviar o número esgotado!*",
            "",
            `👛 O valor de *${fmtMt(aw.valor)}* ficou na sua carteira.`,
            `Para usar, digite: ${PREFIX}usar ${aw.valor} número`,
          ].join("\n"),
          [aw.jid],
        );
      }

      for (const [k, v] of numerosAvulsos) {
        if (Date.now() - v.em > NUMERO_MS) numerosAvulsos.delete(k);
      }
    } catch (e) {
      console.error("[comprovativos] erro ao expirar:", e);
    }
  }, 60 * 1000);
}
