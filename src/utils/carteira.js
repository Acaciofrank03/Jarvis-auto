// src/utils/carteira.js
// Tudo o que as regras da carteira precisam: ler, ajustar, saber se é admin e quem foi respondido.
import { ref, get, chave } from "./comprovativos.js";

const arred = (n) => Math.round(n * 100) / 100;
const limpar = (j) => String(j || "").replace(/:[0-9]+/, "");

// Lê a carteira de um membro. Devolve o registo ou null se não existir.
export async function lerCarteira(central, jid) {
  return (await get(ref(null, `carteiras/${central}/${chave(jid)}`))).val();
}

// Soma (delta > 0) ou retira (delta < 0) saldo da carteira de um membro.
// Fica registado como movimento "AJUSTE". O saldo nunca fica abaixo de zero.
// Devolve { ok: true, total } ou { erro }.
export async function ajustarCarteira(central, { jid, remoteJid, delta, por }) {
  const cRef = ref(null, `carteiras/${central}/${chave(jid)}`);
  let aplicou = false;

  const tr = await cRef.transaction((a) => {
    aplicou = false;
    // A 1ª chamada do Firebase vem sem o valor guardado (null). Para retirar saldo, devolver
    // null faz o servidor enviar o valor real e repetir (undefined cancelaria por engano).
    if (a === null && delta < 0) return null;
    const c = a
      ? { ...a }
      : { remetente: jid, remoteJid, total: 0, itens: [], criadoEm: Date.now() };
    const novo = arred((Number(c.total) || 0) + delta);
    if (novo < 0) return undefined; // cancela, nada é gravado
    aplicou = true;
    if (novo === 0) return null; // carteira vazia: apaga o registo
    c.total = novo;
    c.movimentos = [
      ...(c.movimentos || []),
      { tipo: "AJUSTE", valor: delta, por: por || null, em: Date.now() },
    ];
    c.atualizadoEm = Date.now();
    return c;
  });

  if (!tr.committed || !aplicou) {
    return { erro: "O membro não tem saldo suficiente para retirar esse valor." };
  }
  return { ok: true, total: Number(tr.snapshot.val()?.total) || 0 };
}

// Diz se `jid` é administrador do grupo no WhatsApp.
export async function ehAdminGrupo(socket, remoteJid, jid) {
  const alvo = limpar(jid);
  if (!alvo) return false;

  const meta = await socket.groupMetadata(remoteJid);
  return (meta?.participants || []).some(
    (p) =>
      (p.admin === "admin" || p.admin === "superadmin") &&
      [p.id, p.jid, p.lid, p.phoneNumber].map(limpar).includes(alvo),
  );
}

// Devolve o JID de quem escreveu a mensagem respondida (ou null se não for uma resposta).
export function jidCitado(webMessage) {
  const ctx = webMessage?.message?.extendedTextMessage?.contextInfo;
  const jid = ctx?.quotedMessage ? ctx?.participant : null;
  return jid ? limpar(jid) : null;
}
