// src/utils/centrals.js
// Vínculo grupo -> central (e aparelhos ativos), guardado no Firebase em
// central_grupos/{VD}/{grupo}. As leituras continuam síncronas (cópia em memória),
// por isso quem chama não muda; as gravações vão para o Firebase em segundo plano.
import { getDb } from "../services/firebase.js";

const RAIZ = "central_grupos";
const fbKey = (s) => String(s).replace(/[.#$\[\]\/]/g, "_");
const cache = new Map(); // groupId (…@g.us) -> dados do grupo

function reconstruir(todas) {
  cache.clear();
  for (const [vd, grupos] of Object.entries(todas || {})) {
    if (!/^VD-\d+$/.test(vd) || !grupos || typeof grupos !== "object") continue;
    for (const [k, rec] of Object.entries(grupos)) {
      if (!rec || typeof rec !== "object") continue;
      const groupId = rec.jid || k.replace(/@g_us$/, "@g.us");
      cache.set(groupId, { ...rec, centralCode: rec.centralCode || vd });
    }
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
if (!cache.size) {
  console.warn("[centrals] Nenhum grupo em central_grupos.");
}

const persistir = (updates) =>
  getDb()
    .ref()
    .update(updates)
    .catch((e) => console.error("[centrals] erro ao gravar no Firebase:", e));

const caminho = (vd, groupId) => `${RAIZ}/${fbKey(vd)}/${fbKey(groupId)}`;

export function setCentral(groupId, data) {
  if (!data?.centralCode) throw new Error("setCentral: falta o centralCode");
  const velho = cache.get(groupId);
  const novo = JSON.parse(
    JSON.stringify({
      nome: velho?.nome,
      criadoEm: velho?.criadoEm ?? Date.now(),
      ...data,
      jid: groupId,
    }),
  );
  cache.set(groupId, novo);

  const updates = {};
  if (velho?.centralCode && velho.centralCode !== novo.centralCode) {
    updates[caminho(velho.centralCode, groupId)] = null; // grupo mudou de central
  }
  updates[caminho(novo.centralCode, groupId)] = novo;
  persistir(updates);
}

export function getCentral(groupId) {
  const c = cache.get(groupId);
  return c ? structuredClone(c) : null;
}

// Aceita um número (1) ou vários ([1, 2]) por ordem de preferência.
// Um só número continua a ser gravado como número, para não quebrar o que já existe.
export function setActiveDevice(groupId, deviceNumbers) {
  const c = cache.get(groupId);
  if (!c) return false;
  const lista = [].concat(deviceNumbers).map(Number).filter((n) => n > 0);
  if (!lista.length) return false;
  c.activeDeviceNumber = lista.length === 1 ? lista[0] : lista;
  persistir({ [`${caminho(c.centralCode, groupId)}/activeDeviceNumber`]: c.activeDeviceNumber });
  return true;
}

// Todos os aparelhos do grupo, por ordem de preferência. [] se não houver.
export function getActiveDevices(groupId) {
  const v = cache.get(groupId)?.activeDeviceNumber;
  if (!v) return [];
  return [].concat(v).map(Number).filter((n) => n > 0);
}

// Compatibilidade: devolve só o primeiro (usado por quem ainda espera um aparelho).
export function getActiveDevice(groupId) {
  return getActiveDevices(groupId)[0] || null;
}

// Todos os grupos vinculados, no formato antigo do centrals.json: { [groupId]: dados }.
export function getTodasCentrais() {
  return Object.fromEntries([...cache].map(([g, d]) => [g, structuredClone(d)]));
}

// Códigos das centrais, sem repetir.
export function listarCentrais() {
  return [...new Set([...cache.values()].map((d) => d.centralCode))];
}
