/**
 * Grupo de gestão de cada central: recebe todas as falhas e avisos técnicos.
 * Guardado em database/gestao.json: { [central]: groupId }
 * Sem grupo de gestão definido, os avisos técnicos não vão a lugar nenhum.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const databasePath = path.resolve(__dirname, "..", "..", "database");
const ARQUIVO = path.join(databasePath, "gestao.json");

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

export const getGestao = (central) => ler()[central] || null;

export function setGestao(central, groupId) {
  const dados = ler();
  dados[central] = groupId;
  gravar(dados);
}

// Devolve true se havia um grupo de gestão para remover.
export function removeGestao(central) {
  const dados = ler();
  if (!dados[central]) return false;
  delete dados[central];
  gravar(dados);
  return true;
}
