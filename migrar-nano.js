// migrar-nano.js
// Programa de USO ÚNICO: copia os gatilhos do database/nano.json para o Firebase (nano/{grupo}/{gatilho}).
// Não apaga nada. Se um gatilho já existir no Firebase, ele é mantido e o do ficheiro é ignorado.
//
// Como usar (na pasta do projeto, onde fica a pasta "database" e a pasta "src"):
//   node migrar-nano.js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const ARQUIVO = path.join(aqui, "database", "nano.json");

// Mesma regra do nano.js: o Firebase não aceita . # $ [ ] / nas chaves.
const fbKey = (s) => String(s).replace(/[.#$\[\]\/]/g, "_");

if (!fs.existsSync(ARQUIVO)) {
  console.error(`Não encontrei ${ARQUIVO}. Rode este programa na pasta do projeto.`);
  process.exit(1);
}

let dados;
try {
  dados = JSON.parse(fs.readFileSync(ARQUIVO, "utf8"));
} catch (e) {
  console.error("O nano.json não é um JSON válido:", e.message);
  process.exit(1);
}

let getDb;
try {
  ({ getDb } = await import("./src/services/firebase.js"));
} catch (e) {
  console.error("Não consegui carregar ./src/services/firebase.js:", e.message);
  process.exit(1);
}

const ref = getDb().ref("nano");
const existente = (await ref.once("value")).val() || {};

const updates = {};
let novos = 0;
let ignorados = 0;

for (const [grupo, gatilhos] of Object.entries(dados)) {
  const g = fbKey(grupo);
  for (const [chave, registro] of Object.entries(gatilhos || {})) {
    const k = fbKey(chave);
    if (existente[g]?.[k]) {
      ignorados++;
      continue;
    }
    updates[`${g}/${k}`] = registro;
    novos++;
  }
}

if (novos) await ref.update(updates);

console.log(`Pronto. Gatilhos copiados: ${novos}. Já existiam no Firebase (ignorados): ${ignorados}.`);
process.exit(0); // o Firebase mantém a ligação aberta, então fechamos à mão
