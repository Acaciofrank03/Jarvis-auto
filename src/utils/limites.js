/**
 * Megas, saldo e limites por dispositivo e por SIM, definidos à mão pelos administradores.
 * Guardado em database/limites.json:
 * { [central]: { [dispositivo]: {
 *     megas:   [mbSIM1, mbSIM2],
 *     saldo:   [mtSIM1, mtSIM2],
 *     mlimite: [{ feitos, limite }, { feitos, limite }],
 *     slimite: [mtSIM1, mtSIM2]
 * } } }
 * Índice 0 = SIM 1, índice 1 = SIM 2. null = ainda não definido.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const databasePath = path.resolve(__dirname, "..", "..", "database");
const ARQUIVO = path.join(databasePath, "limites.json");

const vazio = () => ({
  megas: [null, null],
  saldo: [null, null],
  mlimite: [
    { feitos: 0, limite: null },
    { feitos: 0, limite: null },
  ],
  slimite: [null, null],
});

function ler() {
  try {
    return JSON.parse(fs.readFileSync(ARQUIVO, "utf8"));
  } catch {
    return {};
  }
}

// Escreve num arquivo temporário e renomeia, para nunca deixar o JSON pela metade.
function gravar(dados) {
  fs.mkdirSync(databasePath, { recursive: true });
  const tmp = `${ARQUIVO}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(dados, null, 2), "utf8");
  fs.renameSync(tmp, ARQUIVO);
}

export function getLimites(central, dispositivo) {
  const salvo = ler()[central]?.[dispositivo];
  return salvo ? { ...vazio(), ...salvo } : vazio();
}

// Limites de todos os dispositivos de uma central: { [dispositivo]: { megas, saldo, ... } }
export function listarLimites(central) {
  return ler()[central] || {};
}

function guardar(central, dispositivo, campo, valor) {
  const dados = ler();
  const c = (dados[central] ||= {});
  const dev = (c[dispositivo] = { ...vazio(), ...(c[dispositivo] || {}) });
  dev[campo] = valor;
  gravar(dados);
  return dev;
}

export const setMegas = (central, disp, v) => guardar(central, disp, "megas", v);
export const setSaldo = (central, disp, v) => guardar(central, disp, "saldo", v);
export const setMLimite = (central, disp, v) => guardar(central, disp, "mlimite", v);
export const setSLimite = (central, disp, v) => guardar(central, disp, "slimite", v);

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
