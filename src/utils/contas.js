// src/utils/contas.js
// Contas de pagamento (.addpayments / .payments / .rempayments)
// e membros de suporte (.support).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDatabase } from "firebase-admin/database";
import { initFirebase } from "../services/firebase.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONTAS_FILE = path.resolve(__dirname, "../../database/contas.json");

function lerArquivo() {
  if (!fs.existsSync(CONTAS_FILE)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(CONTAS_FILE, "utf8"));
  } catch (erro) {
    console.error("[CONTAS] Erro ao ler database/contas.json:", erro);
    return {};
  }
}

function salvarArquivo(dados) {
  fs.mkdirSync(path.dirname(CONTAS_FILE), { recursive: true });
  fs.writeFileSync(CONTAS_FILE, JSON.stringify(dados, null, 2), "utf8");
}

export async function lerContas(central) {
  const dados = lerArquivo();
  const contas = dados[central];

  return Array.isArray(contas) ? contas.filter(Boolean) : Object.values(contas || {});
}

export async function salvarContas(central, contas) {
  const dados = lerArquivo();

  dados[central] = Array.isArray(contas) ? contas.filter(Boolean) : [];

  salvarArquivo(dados);
}

export function formatarContas(contas) {
  if (!contas.length) {
    return "📋 Nenhuma conta de pagamento cadastrada.";
  }

  return (
    "📋 *CONTAS DE PAGAMENTO*\n────────────────\n" +
    contas
      .map(
        (c, i) =>
          `${i + 1}. ${c.numero}${c.rotulo ? ` (${c.rotulo})` : ""} — ${operadoraDe(c.numero)}`,
      )
      .join("\n")
  );
}

export function operadoraDe(numero) {
  const n = String(numero || "").replace(/\D/g, "");

  if (/^8[45]/.test(n)) return "M-Pesa";
  if (/^8[678]/.test(n)) return "e-Mola";

  return "Outra";
}

// ---------- suporte (.support) ----------
// Continua guardado no Firebase (suporte_membros/<central>), como antes.
const refSuporte = (central) => getDatabase(initFirebase()).ref(`suporte_membros/${central}`);

export async function lerSuporte(central) {
  const v = (await refSuporte(central).get()).val();
  return Array.isArray(v) ? v.filter(Boolean) : Object.values(v || {});
}

export async function salvarSuporte(central, lista) {
  await refSuporte(central).set(lista);
}

export function formatarSuporte(lista) {
  if (!lista.length) return "📋 Nenhum membro de suporte cadastrado.";
  return (
    "👥 *MEMBROS DE SUPORTE*\n────────────────\n" +
    lista.map((m, i) => `${i + 1}. ${m.numero} (${m.designacao})`).join("\n")
  );
}
