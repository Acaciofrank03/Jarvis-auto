import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filePath = path.resolve(__dirname, "..", "..", "database", "centrals.json");

function read() {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "{}");
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function write(data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

export function setCentral(groupId, data) {
  const centrals = read();
  centrals[groupId] = data;
  write(centrals);
}

export function getCentral(groupId) {
  return read()[groupId] || null;
}

// Aceita um número (1) ou vários ([1, 2]) por ordem de preferência.
// Um só número continua a ser gravado como número, para não quebrar o que já existe.
export function setActiveDevice(groupId, deviceNumbers) {
  const centrals = read();
  if (!centrals[groupId]) return false;
  const lista = [].concat(deviceNumbers).map(Number).filter((n) => n > 0);
  if (!lista.length) return false;
  centrals[groupId].activeDeviceNumber = lista.length === 1 ? lista[0] : lista;
  write(centrals);
  return true;
}

// Todos os aparelhos do grupo, por ordem de preferência. [] se não houver.
export function getActiveDevices(groupId) {
  const v = read()[groupId]?.activeDeviceNumber;
  if (!v) return [];
  return [].concat(v).map(Number).filter((n) => n > 0);
}

// Compatibilidade: devolve só o primeiro (usado por quem ainda espera um aparelho).
export function getActiveDevice(groupId) {
  return getActiveDevices(groupId)[0] || null;
}
