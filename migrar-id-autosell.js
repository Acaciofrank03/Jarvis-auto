// migrar-id-autosell.js
// Programa de USO ÚNICO: copia os interruptores .id e .autosell que já existem
//   config_id/{grupo}       -> central_config/{VD}/id/{grupo}
//   config_autosell/{grupo} -> central_config/{VD}/autosell/{grupo}
// Descobre o VD de cada grupo em central_grupos. Não apaga nada dos locais antigos.
// Se o valor já existir no destino, é mantido.
//
// Como usar (na pasta do projeto, onde fica a pasta "src"):
//   node migrar-id-autosell.js
let getDb;
try {
  ({ getDb } = await import("./src/services/firebase.js"));
} catch (e) {
  console.error("Não consegui carregar ./src/services/firebase.js:", e.message);
  process.exit(1);
}

const db = getDb();
const lerNo = async (caminho) => (await db.ref(caminho).once("value")).val() || {};

// Mapa: chave do grupo (ex.: "1203...@g_us") -> VD
const grupos = await lerNo("central_grupos");
const vdDoGrupo = {};
for (const [vd, lista] of Object.entries(grupos)) {
  if (!/^VD-\d+$/.test(vd) || !lista || typeof lista !== "object") continue;
  for (const k of Object.keys(lista)) vdDoGrupo[k] = vd;
}

const PARES = [
  ["config_id", "id"],
  ["config_autosell", "autosell"],
];

let copiados = 0;
let ignorados = 0;
const semCentral = [];

for (const [origem, campo] of PARES) {
  const antigos = await lerNo(origem);
  for (const [grupo, valor] of Object.entries(antigos)) {
    if (typeof valor !== "boolean") continue;
    const vd = vdDoGrupo[grupo];
    if (!vd) {
      semCentral.push(`${origem}/${grupo}`);
      continue;
    }
    const destino = db.ref(`central_config/${vd}/${campo}/${grupo}`);
    if ((await destino.once("value")).exists()) {
      ignorados++;
      continue;
    }
    await destino.set(valor);
    copiados++;
  }
}

console.log(`Pronto. Copiados: ${copiados}. Já existiam (ignorados): ${ignorados}.`);
if (semCentral.length) {
  console.log("Sem central vinculada (não copiados):");
  semCentral.forEach((s) => console.log(" -", s));
}
process.exit(0); // o Firebase mantém a ligação aberta, então fechamos à mão
