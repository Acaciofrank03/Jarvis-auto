/**
 * Megas, saldo e limites por dispositivo e por SIM, definidos à mão pelos administradores.
 * Guardado no Firebase em central_config/{central}/limites/d{dispositivo}:
 * { d1: {
 *     megas:   [mbSIM1, mbSIM2],
 *     saldo:   [mtSIM1, mtSIM2],
 *     mlimite: [{ feitos, limite }, { feitos, limite }],
 *     slimite: [mtSIM1, mtSIM2]
 * } }
 * Índice 0 = SIM 1, índice 1 = SIM 2. null = ainda não definido.
 * As leituras são síncronas (cópia em memória, em centralConfig.js).
 *
 * Reinício diário: todos os dias às 0h (hora de Moçambique) os "feitos" de
 * cada SIM voltam a 0. Os megas e o saldo NÃO são mexidos.
 */
import {
  getConfig,
  setConfig,
  setConfigPath,
  listarCentraisComConfig,
} from "./centralConfig.js";

const CAMPO = "limites";
const CAMPO_DIA = "limitesDia"; // guarda a data do último reinício (ex.: "2026-11-01")
const FUSO = "Africa/Maputo"; // meia-noite de Moçambique
// Chaves "d1", "d2"...: o Firebase transforma chaves só com números em listas.
const chaveDisp = (dispositivo) => `d${dispositivo}`;

const vazio = () => ({
  megas: [null, null],
  saldo: [null, null],
  mlimite: [
    { feitos: 0, limite: null },
    { feitos: 0, limite: null },
  ],
  slimite: [null, null],
});

// O Firebase não guarda null: um SIM sem valor chega em falta ou numa lista curta.
const par = (v) => [v?.[0] ?? null, v?.[1] ?? null];
const envios = (v) =>
  [0, 1].map((i) => ({ feitos: Number(v?.[i]?.feitos) || 0, limite: v?.[i]?.limite ?? null }));

const normalizar = (salvo) => ({
  megas: par(salvo?.megas),
  saldo: par(salvo?.saldo),
  mlimite: envios(salvo?.mlimite),
  slimite: par(salvo?.slimite),
});

const lerTudo = (central) => getConfig(central, CAMPO) || {};

export function getLimites(central, dispositivo) {
  const salvo = lerTudo(central)[chaveDisp(dispositivo)];
  return salvo ? normalizar(salvo) : vazio();
}

// Limites de todos os dispositivos de uma central: { [dispositivo]: { megas, saldo, ... } }
export function listarLimites(central) {
  return Object.fromEntries(
    Object.entries(lerTudo(central))
      .filter(([k]) => /^d\d+$/.test(k))
      .map(([k, v]) => [k.slice(1), normalizar(v)]),
  );
}

// Grava só o campo alterado (ex.: limites/d1/megas), sem regravar os outros aparelhos.
// Devolve os dados do aparelho já atualizados.
function guardar(central, dispositivo, campo, valor) {
  setConfigPath(central, [CAMPO, chaveDisp(dispositivo), campo], valor);
  return getLimites(central, dispositivo);
}

export const setMegas = (central, disp, v) => guardar(central, disp, "megas", v);
export const setSaldo = (central, disp, v) => guardar(central, disp, "saldo", v);
export const setMLimite = (central, disp, v) => guardar(central, disp, "mlimite", v);
export const setSLimite = (central, disp, v) => guardar(central, disp, "slimite", v);

// ---------- reinício diário dos envios (meia-noite) ----------
// Data de hoje no fuso de Moçambique, no formato "2026-11-01".
const hoje = () => new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(new Date());

// Põe os "feitos" de todos os SIMs de todos os aparelhos da central a 0.
export function reiniciarEnvios(central) {
  for (const [disp, l] of Object.entries(listarLimites(central))) {
    setMLimite(
      central,
      disp,
      l.mlimite.map((x) => ({ ...x, feitos: 0 })),
    );
  }
  setConfig(central, CAMPO_DIA, hoje());
  console.log(`[limites] envios reiniciados na central ${central}`);
}

// Compara a data guardada com a de hoje. Se mudou o dia, reinicia.
// Como compara datas (e não só "é meia-noite?"), funciona mesmo se o bot
// estiver desligado à meia-noite: reinicia assim que ligar.
export function verificarReinicioDiario() {
  const dia = hoje();
  for (const central of listarCentraisComConfig()) {
    const ultimo = getConfig(central, CAMPO_DIA);
    if (ultimo === dia) continue;
    if (ultimo == null) {
      setConfig(central, CAMPO_DIA, dia); // primeira vez: só marca a data, não zera nada
    } else {
      reiniciarEnvios(central);
    }
  }
}

// Verifica já ao ligar e depois a cada 1 minuto.
export function iniciarReinicioDiario() {
  verificarReinicioDiario();
  setInterval(verificarReinicioDiario, 60 * 1000);
}

// ---------- escolha do SIM em cada envio ----------
// Começa pelo SIM 1; quando ele não serve, troca para o SIM 2.
// Cada envio reservado desconta os megas e soma 1 aos envios feitos.
const ultimoSim = new Map(); // "central|dispositivo" -> 0 | 1

// Devolve o motivo de um SIM não servir, ou null se serve.
function motivoSim(l, i, mb) {
  const m = l.megas[i];
  if (m == null) return "megas não definidos";
  if (m < mb) return `megas insuficientes (${m} MB)`;
  const ml = l.mlimite[i];
  if (ml?.limite != null && ml.feitos >= ml.limite) {
    return `limite de envios atingido (${ml.feitos}/${ml.limite})`;
  }
  return null;
}

// Reserva um envio de `mb` megas. Devolve { sim, trocou } (sim: 0 = SIM 1, 1 = SIM 2)
// ou { erro } com o motivo de cada SIM. `trocou` = { de, para, motivo } quando o chip mudou.
export function reservarSim(central, dispositivo, mb) {
  const l = getLimites(central, dispositivo);
  const motivos = [];

  for (const i of [0, 1]) {
    const motivo = motivoSim(l, i, mb);
    if (motivo) {
      motivos.push(`SIM ${i + 1}: ${motivo}`);
      continue;
    }

    const megas = [...l.megas];
    megas[i] = Math.round(megas[i] - mb);
    setMegas(central, dispositivo, megas);

    const mlimite = l.mlimite.map((x) => ({ ...x }));
    mlimite[i].feitos = (mlimite[i].feitos || 0) + 1;
    setMLimite(central, dispositivo, mlimite);

    const k = `${central}|${dispositivo}`;
    const antes = ultimoSim.get(k);
    ultimoSim.set(k, i);
    const mudou = antes === undefined ? i === 1 : antes !== i;
    const trocou = mudou
      ? {
          de: i === 1 ? 0 : 1,
          para: i,
          motivo: motivos[0] || "SIM 1 disponível novamente",
        }
      : null;
    return { sim: i, trocou };
  }

  return { erro: motivos.join(" | ") };
}

// Desfaz uma reserva (o envio falhou de verdade).
export function devolverSim(central, dispositivo, sim, mb) {
  const l = getLimites(central, dispositivo);
  const megas = [...l.megas];
  if (megas[sim] != null) megas[sim] = Math.round(megas[sim] + mb);
  setMegas(central, dispositivo, megas);

  const mlimite = l.mlimite.map((x) => ({ ...x }));
  mlimite[sim].feitos = Math.max(0, (mlimite[sim].feitos || 0) - 1);
  setMLimite(central, dispositivo, mlimite);
}

// ---------- escolha do SIM para saldo (*111#) ----------
// Devolve o motivo de um SIM não servir para enviar `mt` de saldo, ou null se serve.
function motivoSimSaldo(l, i, mt) {
  const s = l.saldo[i];
  if (s == null) return "saldo não definido";
  if (s < mt) return `saldo insuficiente (${s} MT)`;
  const lim = l.slimite[i];
  if (lim != null && mt > lim) return `acima do limite por envio (${lim} MT)`;
  return null;
}

// Reserva um envio de `mt` de saldo. Devolve { sim } (0 = SIM 1, 1 = SIM 2) ou { erro }.
// Desconta o saldo do SIM escolhido.
export function reservarSimSaldo(central, dispositivo, mt) {
  const l = getLimites(central, dispositivo);
  const motivos = [];

  for (const i of [0, 1]) {
    const motivo = motivoSimSaldo(l, i, mt);
    if (motivo) {
      motivos.push(`SIM ${i + 1}: ${motivo}`);
      continue;
    }
    const saldo = [...l.saldo];
    saldo[i] = Math.round((saldo[i] - mt) * 100) / 100;
    setSaldo(central, dispositivo, saldo);
    return { sim: i };
  }

  return { erro: motivos.join(" | ") };
}

// Desfaz a reserva de saldo (o envio falhou de verdade).
export function devolverSimSaldo(central, dispositivo, sim, mt) {
  const l = getLimites(central, dispositivo);
  const saldo = [...l.saldo];
  if (saldo[sim] != null) saldo[sim] = Math.round((saldo[sim] + mt) * 100) / 100;
  setSaldo(central, dispositivo, saldo);
}

// ---------- leitura dos argumentos ----------
// "2 50gb/900mb" -> { disp: 2, resto: "50gb/900mb" }
export function lerDispositivo(fullArgs) {
  const partes = String(fullArgs || "").trim().split(/\s+/).filter(Boolean);
  if (partes.length < 2 || !/^\d+$/.test(partes[0]) || Number(partes[0]) < 1) return null;
  return { disp: Number(partes[0]), resto: partes.slice(1).join(" ") };
}

const RX_MEGAS = /^(\d+(?:\.\d+)?)(gb|g|mb|m)$/i;
const RX_MT = /^(\d+(?:\.\d+)?)(?:mt)?$/i;
const RX_PAR = /^(\d+)\/(\d+)$/;

// "50gb/900mb" ou "50gb,900mb" -> [51200, 900]  (1 GB = 1024 MB; decimais só com ponto)
export function parseMegas(resto) {
  const partes = resto.split(/[\/,;\s]+/).filter(Boolean);
  if (partes.length !== 2) return null;

  const saida = [];
  for (const p of partes) {
    if (p === "0") {
      saida.push(0);
      continue;
    }
    const m = p.match(RX_MEGAS);
    if (!m) return null;
    const q = Number(m[1]);
    saida.push(Math.round(/^g/i.test(m[2]) ? q * 1024 : q));
  }
  return saida;
}

// "100/500" ou "100mt/500mt" -> [100, 500]
export function parseMT(resto) {
  const partes = resto.split(/[\/,;\s]+/).filter(Boolean);
  if (partes.length !== 2) return null;

  const saida = [];
  for (const p of partes) {
    const m = p.match(RX_MT);
    if (!m) return null;
    saida.push(Number(m[1]));
  }
  return saida;
}

// "0/10,10/10" -> [{ feitos: 0, limite: 10 }, { feitos: 10, limite: 10 }]
export function parseMLimite(resto) {
  const partes = resto.split(/[,;\s]+/).filter(Boolean);
  if (partes.length !== 2) return null;

  const saida = [];
  for (const p of partes) {
    const m = p.match(RX_PAR);
    if (!m) return null;
    const feitos = Number(m[1]);
    const limite = Number(m[2]);
    if (feitos > limite) return null;
    saida.push({ feitos, limite });
  }
  return saida;
}

// ---------- formatação ----------
export const fmtMegas = (mb) =>
  mb == null
    ? "não definido"
    : mb >= 1024
      ? `${+(mb / 1024).toFixed(2)} GB (${mb} MB)`
      : `${mb} MB`;

export const fmtMT = (n) => (n == null ? "não definido" : `${+Number(n).toFixed(2)} MT`);

export const fmtEnvios = (m) =>
  m?.limite == null ? "envios não definidos" : `${m.feitos}/${m.limite} envios`;

// caixa("⚡", "TITULO", ["linha", "", "outra"], "🛒")
export function caixa(icone, titulo, linhas, selo = "🛒") {
  return (
    `${icone} ╭━━⪩ ${titulo} ⪨━━\n▢\n` +
    linhas.map((l) => (l === "" ? "▢" : `▢ ${l}`)).join("\n") +
    `\n▢\n╰━━─「${selo}」─━━`
  );
}

// Liga o reinício diário assim que o ficheiro é carregado (não precisa chamar em mais nenhum lado).
iniciarReinicioDiario();
