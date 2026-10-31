// src/utils/rankings.js
// Ranking de compras POR GRUPO de cada central (MB, saldo e ilimitado), guardado no Firebase.
import { getDb } from "../services/firebase.js";

const FUSO = "Africa/Maputo";

// Estrutura no Firebase:
// rankings/{central}/{grupo}/dias/{AAAA-MM-DD}/{jid}: { mb, saldo, top, compras, em }
// rankings/{central}/{grupo}/geral/{jid}:               { mb, saldo, top, compras, em }
// rankings/{central}/_antigo: dados antigos sem grupo (vindos do rankings.json)

const hoje = () => new Date().toLocaleDateString("en-CA", { timeZone: FUSO }); // AAAA-MM-DD
const arred = (n) => Math.round(n * 100) / 100;

// O Firebase não aceita . # $ [ ] / nas chaves (ex.: 123@g.us -> 123@g_us).
export const fbKey = (s) => String(s).replace(/[.#$\[\]\/]/g, "_");

const refGrupo = (central, grupo) =>
  getDb().ref(`rankings/${fbKey(central)}/${fbKey(grupo)}`);

// Falha alto e claro se alguém chamar sem o grupo (assinatura antiga).
function exigirGrupo(grupo, fn) {
  if (!/@g[._]us$/.test(String(grupo))) {
    throw new Error(`${fn}: falta o id do grupo (…@g.us). O ranking é por grupo.`);
  }
}

// Mais primeiro; em empate, quem chegou àquele valor antes fica à frente.
// Só entra no ranking quem já comprou aquele produto.
const ordenar = (mapa, campo) =>
  Object.entries(mapa)
    .filter(([, r]) => (r[campo] || 0) > 0)
    .sort((a, b) => (b[1][campo] || 0) - (a[1][campo] || 0) || (a[1].em || 0) - (b[1].em || 0));

// Soma numa transação, para duas compras simultâneas nunca se perderem.
async function somar(ref, campo, qtd) {
  const res = await ref.transaction((atual) => {
    const r = { mb: 0, saldo: 0, top: 0, compras: 0, em: 0, ...(atual || {}) };
    r[campo] = arred(r[campo] + qtd);
    r.compras += 1;
    r.em = Date.now();
    return r;
  });
  return res.snapshot.val();
}

// Regista uma venda concluída e devolve as estatísticas para a mensagem.
// produto = { tipo: "mb" | "saldo" | "top", qtd, nome }
//   mb: qtd em MB | saldo: qtd em MT de saldo | top (ilimitado): conta 1 compra
export async function registrarCompra(central, grupo, jid, produto) {
  exigirGrupo(grupo, "registrarCompra");
  const p = typeof produto === "number" ? { tipo: "mb", qtd: produto } : produto;
  const campo = p.tipo === "saldo" ? "saldo" : p.tipo === "top" ? "top" : "mb";
  const qtd = campo === "top" ? 1 : Number(p.qtd) || 0;

  const raiz = refGrupo(central, grupo);
  const dia = hoje();
  const k = fbKey(jid);

  const [rDia, rGeral] = await Promise.all([
    somar(raiz.child(`dias/${dia}/${k}`), campo, qtd),
    somar(raiz.child(`geral/${k}`), campo, qtd),
  ]);

  const [snapDia, snapGeral] = await Promise.all([
    raiz.child(`dias/${dia}`).get(),
    raiz.child("geral").get(),
  ]);
  const rankDia = ordenar(snapDia.val() || {}, campo);
  const rankGeral = ordenar(snapGeral.val() || {}, campo);

  return {
    tipo: campo,
    nome: p.nome || null,
    compraDoDia: rDia.compras,
    actual: qtd,
    hoje: rDia[campo],
    acumulado: rGeral[campo],
    posDia: rankDia.findIndex(([x]) => x === k) + 1,
    totalDia: rankDia.length,
    posGeral: rankGeral.findIndex(([x]) => x === k) + 1,
    liderValor: rankGeral[0]?.[1]?.[campo] ?? 0,
  };
}

// Estatísticas de um membro NESTE grupo (para o .carteira): { hoje, geral }.
export async function lerEstatisticas(central, grupo, jid) {
  exigirGrupo(grupo, "lerEstatisticas");
  const raiz = refGrupo(central, grupo);
  const k = fbKey(jid);
  const [d, g] = await Promise.all([
    raiz.child(`dias/${hoje()}/${k}`).get(),
    raiz.child(`geral/${k}`).get(),
  ]);
  return { hoje: d.val(), geral: g.val() };
}

const milhar = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

function textoMotivacional(s) {
  const unidade = { mb: "MB", saldo: "MT", top: "compra(s)" }[s.tipo];
  const lider = `*${s.liderValor} ${unidade}*`;
  if (s.posGeral === 1) {
    return (
      `🥇 Você está em 1º lugar! Você é o líder com um total de ${lider} acumulado!\n` +
      "Mantenha sua posição que em breve receberá seu bónus! 🏆"
    );
  }
  if (s.posGeral === 2) {
    return `🥈 Você está em 2º lugar! Está quase lá! O líder tem ${lider} — continua a comprar para chegar ao topo! 💪`;
  }
  if (s.posGeral === 3) {
    return `🥉 Você está em 3º lugar! O líder tem ${lider} — cada compra aproxima você do pódio! 🔥`;
  }
  return `🚀 Você está em ${s.posGeral}º lugar. O líder tem ${lider} — continua a comprar para subir no ranking! 💪`;
}

function linhasProduto(s) {
  if (s.tipo === "saldo") {
    return [
      `💳 Actual: ${s.actual} MT de saldo`,
      `💳 Hoje: ${s.hoje} MT`,
      `💳 Acumulado: ${s.acumulado} MT`,
    ];
  }
  if (s.tipo === "top") {
    return [
      ...(s.nome ? [`💎 Pacote: ${s.nome}`] : []),
      `💎 Ilimitados hoje: ${s.hoje}`,
      `💎 Ilimitados acumulados: ${s.acumulado}`,
    ];
  }
  return [
    `📊 Actual: ${milhar(s.actual)} MB`,
    `📊 Hoje: ${s.hoje} MB`,
    `📊 Acumulado: ${s.acumulado} MB`,
  ];
}

// Mensagem de sucesso enviada no grupo. `jid` é quem fez a compra (vai mencionado).
export function mensagemSucesso(s, jid) {
  return (
    `✅ *Transação concluída com sucesso!*\n\n` +
    `Obrigado, @${jid.split("@")[0]}, você está fazendo a sua *${s.compraDoDia}ª compra* do dia!\n\n` +
    `${linhasProduto(s).join("\n")}\n` +
    `🏅 Posição Dia: ${s.posDia}º lugar (de ${s.totalDia})\n` +
    `🏆 Posição Geral: ${s.posGeral}º lugar\n\n` +
    `${textoMotivacional(s)}`
  );
}
