// Move o database/rankings.json (por central, sem grupo) para o Firebase. Não apaga nada.
//   node migrar-rankings.mjs                          -> simulação
//   node migrar-rankings.mjs --gravar                 -> guarda em rankings/{VD}/_antigo
//   node migrar-rankings.mjs --gravar --grupo ID@g.us -> o histórico passa a ser desse grupo
import fs from "node:fs";
import { getDb } from "./src/services/firebase.js";
import { fbKey } from "./src/utils/rankings.js";

const args = process.argv.slice(2);
const gravar = args.includes("--gravar");
const i = args.indexOf("--grupo");
const grupo = i >= 0 ? args[i + 1] : null;
if (i >= 0 && !/@g\.us$/.test(grupo || "")) {
  console.error("Use: --grupo 1203...@g.us");
  process.exit(1);
}

const velho = JSON.parse(fs.readFileSync("database/rankings.json", "utf8"));
const chaves = (m) => Object.fromEntries(Object.entries(m || {}).map(([j, r]) => [fbKey(j), r]));

const updates = {};
for (const [central, c] of Object.entries(velho)) {
  const dias = Object.fromEntries(Object.entries(c.dias || {}).map(([d, m]) => [d, chaves(m)]));
  const geral = chaves(c.geral);
  const destino = `rankings/${fbKey(central)}/${grupo ? fbKey(grupo) : "_antigo"}`;

  if (grupo) {
    // não sobrescreve um ranking que já tenha compras novas
    const ja = await getDb().ref(`${destino}/geral`).get();
    if (ja.exists()) {
      console.error(`${destino} já tem dados. Nada foi gravado.`);
      process.exit(1);
    }
  }
  updates[destino] = { dias, geral };
  console.log(`${central} -> ${destino}: ${Object.keys(dias).length} dias, ${Object.keys(geral).length} membros`);
}

if (!gravar) {
  console.log("\nSimulação: nada foi gravado. Acrescente --gravar para executar.");
  process.exit(0);
}
await getDb().ref().update(updates);
console.log("\nGravado.");
process.exit(0);
