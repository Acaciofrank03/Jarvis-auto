// src/utils/recibos.js
// Comandos de administrador sobre comprovativos:
//   .issuereceipt  -> liberarComprovativo: move o comprovativo para "usados"
//   .destroyreceipt -> destruirComprovativo: apaga o comprovativo do Firebase
import {
  ref,
  get,
  set,
  update,
  remove,
  CAMINHO_OFICIAIS,
  STATUS_USADO,
  chave,
  canalDoId,
  extrairValor,
  buscarRecibo,
} from "./comprovativos.js";

const RX_ID_SOLTO = [/^(?=[A-Z0-9]*\d)[A-Z0-9]{8,}$/, /^PP\d{6}\.\d{4}\.[A-Z]\d+$/];

// Aceita um ID escrito à mão (DJ41LTC4WKX, PP260525.1447.m29909) e devolve-o em maiúsculas, ou null.
export function idValido(token) {
  const t = String(token || "").trim().toUpperCase();
  return RX_ID_SOLTO.some((rx) => rx.test(t)) ? t : null;
}

// .issuereceipt: move o comprovativo para "usados".
// - marca o registo do APK como USADO (se o SMS existir lá)
// - tira o ID da fila de espera
// - grava o ID em comprovantes_usados
// Não entrega nenhum pacote e não mexe em carteira.
// Devolve { ok, noApk } (noApk = false quando o SMS não foi achado no APK).
export async function liberarComprovativo(central, { id, jid = null, remoteJid }) {
  id = id.toUpperCase();
  const recibo = await buscarRecibo(central, id);

  if (recibo) {
    await update(ref(null, `${CAMINHO_OFICIAIS(central)}/${recibo.chaveOficial}`), {
      status: STATUS_USADO,
    });
  }

  await remove(ref(null, `comprovantes_pendentes/${central}/${chave(id)}`));
  await set(ref(null, `comprovantes_usados/${central}/${chave(id)}`), {
    id,
    canal: canalDoId(id),
    valor: recibo ? (extrairValor(recibo.texto) ?? recibo.amount ?? null) : null,
    registadoPor: jid,
    remoteJid: remoteJid || null,
    origem: "ADMIN",
    usadoEm: Date.now(),
    status: "USADO",
  });

  return { ok: true, noApk: !!recibo };
}

// .destroyreceipt: faz o comprovativo desaparecer do Firebase.
// Apaga do APK (oficial), da fila de espera e dos usados.
// Devolve { antes, noApk } (antes = status que tinha em "usados").
export async function destruirComprovativo(central, { id }) {
  id = id.toUpperCase();
  const uRef = ref(null, `comprovantes_usados/${central}/${chave(id)}`);
  const antes = (await get(uRef)).val();
  const recibo = await buscarRecibo(central, id);

  if (recibo) {
    await remove(ref(null, `${CAMINHO_OFICIAIS(central)}/${recibo.chaveOficial}`));
  }
  await remove(ref(null, `comprovantes_pendentes/${central}/${chave(id)}`));
  await remove(uRef);

  return { antes: antes?.status || null, noApk: !!recibo };
}
