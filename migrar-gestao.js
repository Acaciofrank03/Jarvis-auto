// migrar-gestao.js
// Programa de USO ÚNICO: copia o database/gestao.json para o Firebase (central_config/{central}/gestao).
// Não apaga nada. Se uma central já tiver grupo de gestão no Firebase, ele é mantido.
//
// Como usar (na pasta do projeto, onde fica a pasta "database" e a pasta "src"):
//   node migrar-gestao.js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const ARQUIVO = path.join(aqui, "database", "gestao.json");

// Mesma regra do centralConfig.js: o Firebase não aceita . # $ [ ] / nas chaves.
const fbKey = (s) => String(s).replace(/[.#$\[\]\/]/g, "_");

if (!fs.existsSync(ARQUIVO)) {
  console.log(`Não encontrei ${ARQUIVO}. Se nunca definiu grupo de gestão, não há nada a copiar.`);
  process.exit(0);
}

let dados;
try {
  dados = JSON.parse(fs.readFileSync(ARQUIVO, "utf8"));
} catch (e) {
  console.error("O gestao.json não é um JSON válido:", e.message);
  process.exit(1);
}

let getDb;
try {
  ({ getDb } = await import("./src/services/firebase.js"));
} catch (e) {
  console.error("Não consegui carregar ./src/services/firebase.js:", e.message);
  process.exit(1);
}

const db = getDb();
let novos = 0;
let ignorados = 0;

for (const [central, groupId] of Object.entries(dados)) {
  if (!groupId) continue;
  const r = db.ref(`central_config/${fbKey(central)}/gestao`);
  if ((await r.once("value")).exists()) {
    ignorados++;
    continue;
  }
  await r.set(String(groupId));
  novos++;
}

console.log(`Pronto. Centrais copiadas: ${novos}. Já existiam no Firebase (ignoradas): ${ignorados}.`);
process.exit(0); // o Firebase mantém a ligação aberta, então fechamos à mão
