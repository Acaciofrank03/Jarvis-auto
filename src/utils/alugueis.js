import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filePath = path.resolve(__dirname, "..", "..", "database", "alugueis.json");

function read() {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify({ grupo: null }, null, 2));
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function write(data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

export function setGrupoAlugueis(groupId) {
  const data = read();
  data.grupo = groupId;
  write(data);
}

export function getGrupoAlugueis() {
  return read().grupo || null;
}

export function removeGrupoAlugueis() {
  const data = read();
  data.grupo = null;
  write(data);
}