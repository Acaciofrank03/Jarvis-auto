// src/utils/produtos.js
// Gestão independente da tabela de produtos (tabela de preços, usada pelo comando .addtabela).
// Guardado no Firebase em tabela_precos/{grupo}/{valor}, separado por GRUPO
// (cada grupo tem a sua tabela de preços).
// As leituras vêm de uma cópia em memória (rápidas); as gravações vão para o Firebase.
import { getDb } from "../services/firebase.js";

const RAIZ = "tabela_precos";

// O Firebase não aceita . # $ [ ] / nas chaves: o JID do grupo (1203...@g.us) é ajustado.
const chaveGrupo = (grupo) => String(grupo).replace(/[.#$\[\]\/]/g, "_");
const caminho = (grupo) => `${RAIZ}/${chaveGrupo(grupo)}`;

// Cópia em memória: { [grupo]: { [valor]: produto } }
let cache = {};

// Quando as chaves são números seguidos (1, 2, 3...), o Firebase devolve uma lista em vez de
// um objeto. Aqui voltamos sempre a objeto, sem os buracos.
function comoObjeto(v) {
  if (!v || typeof v !== "object") return {};
  if (!Array.isArray(v)) return v;
  return Object.fromEntries(v.map((x, i) => [i, x]).filter(([, x]) => x != null));
}

function reconstruir(todas) {
  cache = {};
  for (const [grupo, tabela] of Object.entries(comoObjeto(todas))) {
    cache[grupo] = comoObjeto(tabela);
  }
}

// Carrega ao arrancar e mantém-se atualizado se o Firebase mudar.
await new Promise((resolve, reject) => {
  let primeiro = true;
  getDb()
    .ref(RAIZ)
    .on(
      "value",
      (snap) => {
        reconstruir(snap.val());
        if (primeiro) {
          primeiro = false;
          resolve();
        }
      },
      reject,
    );
});

/**
 * Lê toda a tabela de um grupo.
 */
export async function lerTabela(grupo) {
  if (!grupo) return null;

  const tabela = cache[chaveGrupo(grupo)];
  return tabela && Object.keys(tabela).length ? structuredClone(tabela) : null;
}

/**
 * Procura um produto pelo valor exato em MT.
 */
export async function buscarProduto(grupo, valor) {
  if (!grupo || valor == null) return null;

  const produto = cache[chaveGrupo(grupo)]?.[valor];
  if (produto == null) return null;

  return {
    valor: Number(valor),
    ...structuredClone(produto),
  };
}

/**
 * Guarda ou atualiza um produto pelo seu valor.
 */
export async function salvarProduto(grupo, valor, produto) {
  if (!grupo) {
    throw new Error("Grupo não informado.");
  }

  if (valor == null || !produto) {
    throw new Error("Valor ou produto não informado.");
  }

  // Espera o Firebase confirmar. Se falhar, o erro chega a quem chamou, como antes.
  await getDb().ref(`${caminho(grupo)}/${valor}`).set(produto);

  (cache[chaveGrupo(grupo)] ||= {})[valor] = structuredClone(produto);
}

/**
 * Remove um produto específico.
 */
export async function removerProduto(grupo, valor) {
  if (!grupo) {
    throw new Error("Grupo não informado.");
  }

  await getDb().ref(`${caminho(grupo)}/${valor}`).remove();

  const tabela = cache[chaveGrupo(grupo)];
  if (tabela) {
    delete tabela[valor];
    if (!Object.keys(tabela).length) delete cache[chaveGrupo(grupo)];
  }
}

/**
 * Procura um produto pelo valor exato.
 */
export async function produtoPorValor(grupo, valor) {
  return buscarProduto(grupo, valor);
}

/**
 * Retorna os valores disponíveis na tabela do grupo,
 * ordenados do menor para o maior.
 */
export async function listarValores(grupo) {
  const tabela = await lerTabela(grupo);

  if (!tabela) return [];

  return Object.keys(tabela)
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
}
