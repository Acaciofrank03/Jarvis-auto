/**
 * Nano: gatilhos e respostas rápidas por grupo.
 * Guardado em database/nano.json:
 * { [groupId]: { [gatilhoNormalizado]: { gatilho, resposta } } }
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const databasePath = path.resolve(__dirname, "..", "..", "database");
const ARQUIVO = path.join(databasePath, "nano.json");

// Minúsculas, sem acentos, sem pontuação, espaços únicos: "Como  PAGAR?" -> "como pagar"
export function normalizar(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

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

// Cria ou substitui um gatilho. Devolve { substituido } ou null se o gatilho for inválido.
export function setNano(groupId, gatilho, resposta) {
  const chave = normalizar(gatilho);
  if (!chave || !String(resposta || "").trim()) return null;

  const dados = ler();
  const grupo = (dados[groupId] ||= {});
  const substituido = Boolean(grupo[chave]);

  grupo[chave] = { gatilho: String(gatilho).trim(), resposta: String(resposta).trim() };
  gravar(dados);

  return { substituido };
}

// Resposta para a mensagem inteira, ou null se não houver gatilho igual.
export function getNanoResponse(groupId, mensagem) {
  const chave = normalizar(mensagem);
  if (!chave) return null;
  return ler()[groupId]?.[chave]?.resposta || null;
}

export function listNano(groupId) {
  return Object.values(ler()[groupId] || {});
}

export function removeNano(groupId, gatilho) {
  const chave = normalizar(gatilho);
  const dados = ler();
  if (!dados[groupId]?.[chave]) return false;

  delete dados[groupId][chave];
  if (!Object.keys(dados[groupId]).length) delete dados[groupId];

  gravar(dados);
  return true;
}
