// src/utils/centralConfig.js
// Configurações de cada central, guardadas no Firebase em central_config/{VD}/{campo}.
// As leituras são síncronas (cópia em memória); as gravações vão para o Firebase.
// Quem quiser ter certeza de que gravou pode usar "await" nas funções de escrita:
// elas devolvem true (gravou) ou false (falhou).
import { getDb } from "../services/firebase.js";

const RAIZ = "central_config";
const TEMPO_MAXIMO_MS = 15000; // se o Firebase não responder neste tempo, o bot avisa
const fbKey = (s) => String(s).replace(/[.#$\[\]\/]/g, "_");
let cache = {}; // { [central]: { [campo]: valor } }

// Carrega ao arrancar e mantém-se atualizado se o Firebase mudar.
await new Promise((resolve, reject) => {
  let primeiro = true;
  const timer = setTimeout(() => {
    reject(new Error("[centralConfig] O Firebase não respondeu em 15 segundos."));
  }, TEMPO_MAXIMO_MS);

  getDb()
    .ref(RAIZ)
    .on(
      "value",
      (snap) => {
        cache = snap.val() || {};
        if (primeiro) {
          primeiro = false;
          clearTimeout(timer);
          resolve();
        }
      },
      (erro) => {
        // Este aviso aparece também se o erro acontecer depois do arranque.
        console.error("[centralConfig] erro ao ler do Firebase:", erro);
        if (primeiro) {
          primeiro = false;
          clearTimeout(timer);
          reject(erro);
        }
      },
    );
});

// Devolve true se gravou e false se falhou (nunca derruba o bot).
const persistir = (updates) =>
  getDb()
    .ref()
    .update(updates)
    .then(() => true)
    .catch((e) => {
      console.error("[centralConfig] erro ao gravar no Firebase:", e);
      return false;
    });

const caminho = (central, campo) => `${RAIZ}/${fbKey(central)}/${fbKey(campo)}`;
const limpar = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v))); // sem undefined

export function getConfig(central, campo) {
  const v = cache[central]?.[campo];
  return v === undefined ? null : structuredClone(v);
}

export function setConfig(central, campo, valor) {
  const limpo = limpar(valor);
  (cache[central] ||= {})[campo] = limpo;
  return persistir({ [caminho(central, campo)]: limpo });
}

// Grava só um pedaço dentro de um campo, sem mexer no resto.
// Exemplo: setConfigPath("VD-1", ["limites", "d1", "megas"], [500, 200])
// só altera os megas do aparelho 1, e não regrava os outros aparelhos.
export function setConfigPath(central, partes, valor) {
  const [campo, ...resto] = partes;
  if (!resto.length) return setConfig(central, campo, valor);

  const limpo = limpar(valor);
  let no = (cache[central] ||= {});
  let chave = campo;
  for (const p of resto) {
    if (typeof no[chave] !== "object" || no[chave] === null) no[chave] = {};
    no = no[chave];
    chave = p;
  }
  no[chave] = limpo;

  const destino = [RAIZ, fbKey(central), ...partes.map(fbKey)].join("/");
  return persistir({ [destino]: limpo });
}

// Devolve true se existia algo para remover.
export function removeConfig(central, campo) {
  if (cache[central]?.[campo] === undefined) return false;
  delete cache[central][campo];
  persistir({ [caminho(central, campo)]: null });
  return true;
}

// Códigos de todas as centrais que têm alguma configuração.
export const listarCentraisComConfig = () => Object.keys(cache);
