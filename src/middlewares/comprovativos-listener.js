// src/middlewares/comprovativos-listener.js
// Faz o bot "escutar" as mensagens normais do grupo (que não são comandos).
import { PREFIX } from "../config.js";
import { getCentral } from "../utils/centrals.js";
import {
  tratarMensagem,
  iniciarComprovativos,
  definirSocket,
} from "../utils/comprovativos.js";

const iniciadas = new Set(); // centrais com o escutador já ligado

function extrairTexto(webMessage) {
  const m = webMessage?.message || {};
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    ""
  );
}

// Chame para TODA mensagem recebida: await ouvirComprovativos({ socket, webMessage });
// Devolve true se a mensagem foi tratada como comprovativo ou número.
export async function ouvirComprovativos({ socket, webMessage }) {
  try {
    // Entrega o socket atual ao comprovativos.js (usado para buscar o nome do grupo nos avisos).
    definirSocket(socket);

    const key = webMessage?.key;
    if (!key || key.fromMe) return false; // ignora as mensagens do próprio bot

    const remoteJid = key.remoteJid;
    if (!remoteJid?.endsWith("@g.us")) return false; // só grupos

    const texto = extrairTexto(webMessage).trim();
    if (!texto || texto.startsWith(PREFIX)) return false; // comandos seguem o fluxo normal

    const central = getCentral(remoteJid);
    if (!central) return false;

    const enviar = (jid, text, mentions = []) =>
      socket.sendMessage(jid, { text, mentions });

    // Liga os comprovativos do Firebase uma vez por central.
    if (!iniciadas.has(central.centralCode)) {
      iniciadas.add(central.centralCode);
      iniciarComprovativos(central.centralCode, enviar);
    }

    return await tratarMensagem({
      central: central.centralCode,
      texto,
      jid: key.participant?.replace(/:[0-9]+/, ""),
      remoteJid,
      enviar,
    });
  } catch (e) {
    console.error("[comprovativos-listener] erro:", e);
    return false;
  }
}
