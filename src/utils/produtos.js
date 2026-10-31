// src/utils/produtos.js
// Gestão independente da tabela de produtos.
// Os dados continuam armazenados no Firebase Realtime Database,
// agora separados por GRUPO (cada grupo tem a sua tabela de preços).
//  Tabela de preços (usada pelo comando .addtabela)

import { getDatabase } from "firebase-admin/database";
import { initFirebase } from "../services/firebase.js";

function database() {
  return getDatabase(initFirebase());
}

// O Firebase não aceita . # $ [ ] / nas chaves: o JID do grupo (1203...@g.us) é ajustado.
const chaveGrupo = (grupo) => String(grupo).replace(/[.#$\[\]\/]/g, "_");
const caminho = (grupo) => `tabela_precos/${chaveGrupo(grupo)}`;

/**
 * Lê toda a tabela de um grupo.
 */
export async function lerTabela(grupo) {
  if (!grupo) return null;

  const snapshot = await database().ref(caminho(grupo)).get();

  return snapshot.val();
}

/**
 * Procura um produto pelo valor exato em MT.
 */
export async function buscarProduto(grupo, valor) {
  if (!grupo || valor == null) return null;

  const snapshot = await database().ref(`${caminho(grupo)}/${valor}`).get();

  if (!snapshot.exists()) return null;

  return {
    valor: Number(valor),
    ...snapshot.val(),
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

  await database().ref(`${caminho(grupo)}/${valor}`).set(produto);
}

/**
 * Remove um produto específico.
 */
export async function removerProduto(grupo, valor) {
  if (!grupo) {
    throw new Error("Grupo não informado.");
  }

  await database().ref(`${caminho(grupo)}/${valor}`).remove();
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
