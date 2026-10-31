// src/utils/grupos.js
// Grupos de vendas de cada central, guardados por ordem de registo (o índice do .grupos).
import { chave, get, ref, remove, set } from "./comprovativos.js";
import { getGestao } from "./gestao.js";

const raiz = (central) => `central_grupos/${chave(central)}`;

async function nomeAtual(socket, jid) {
  try {
    return (await socket.groupMetadata(jid))?.subject || null;
  } catch {
    return null; // o bot já não está no grupo, ou o WhatsApp não respondeu
  }
}

// [{ jid, nome, criadoEm }] pela ordem em que foram registados.
export async function listarGrupos(central) {
  const todos = (await get(ref(null, raiz(central)))).val() || {};
  return Object.values(todos).sort((a, b) => (a.criadoEm || 0) - (b.criadoEm || 0));
}

// Grupo nº n (1, 2, 3...) da lista, ou null.
export async function grupoPorIndice(central, n) {
  return (await listarGrupos(central))[n - 1] || null;
}

// Grava o grupo, ou actualiza o nome se já existir. Pode ser chamado também pelo listener
// a cada mensagem de um grupo vinculado, para a lista se manter sozinha.
export async function registarGrupo(central, jid, socket) {
  const r = ref(null, `${raiz(central)}/${chave(jid)}`);
  const atual = (await get(r)).val();
  const nome = (await nomeAtual(socket, jid)) || atual?.nome || jid;
  await set(r, { jid, nome, criadoEm: atual?.criadoEm || Date.now() });
  return { novo: !atual, nome };
}

export async function removerGrupo(central, jid) {
  await remove(ref(null, `${raiz(central)}/${chave(jid)}`));
}

// Volta a ler o nome de cada grupo no WhatsApp. Devolve quantos mudaram.
export async function atualizarNomes(central, socket) {
  let mudaram = 0;
  for (const g of await listarGrupos(central)) {
    const nome = await nomeAtual(socket, g.jid);
    if (nome && nome !== g.nome) {
      await set(ref(null, `${raiz(central)}/${chave(g.jid)}`), { ...g, nome });
      mudaram++;
    }
  }
  return mudaram;
}

// Para o listener: regista o grupo de vendas automaticamente.
// A posição na lista nunca muda (fica gravada; só o nome é actualizado se o grupo for renomeado).
// Para não tocar no Firebase a cada mensagem, só volta a verificar de hora a hora por grupo.
// Ignora o grupo de gestão. Nunca lança erro: não pode atrapalhar o fluxo das mensagens.
const REFRESCO_MS = 60 * 60 * 1000;
const verificados = new Map(); // "central|jid" -> última verificação (ms)

export async function garantirGrupo(central, jid, socket) {
  const k = `${central}|${jid}`;
  const ultima = verificados.get(k);
  if (ultima && Date.now() - ultima < REFRESCO_MS) return;
  verificados.set(k, Date.now());
  try {
    if (getGestao(central) === jid) return;
    await registarGrupo(central, jid, socket);
  } catch (e) {
    verificados.delete(k); // tenta de novo na próxima mensagem
    console.error("[grupos] erro ao registar o grupo automaticamente:", e);
  }
}
