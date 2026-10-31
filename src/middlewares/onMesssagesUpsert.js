/**
 * Evento chamado quando uma mensagem
 * é enviada para o grupo do WhatsApp
 *
 * @author Dev Gui
 */
import { DEVELOPER_MODE, OWNER_LID } from "../config.js";
import { badMacHandler } from "../utils/badMacHandler.js";
import { checkIfMemberIsMuted, getPrefix } from "../utils/database.js";
import { dynamicCommand } from "../utils/dynamicCommand.js";
import {
  extractDataFromMessage,
  GROUP_PARTICIPANT_ADD,
  GROUP_PARTICIPANT_LEAVE,
  isAddOrLeave,
  isAtLeastMinutesInPast,
} from "../utils/index.js";
import { loadCommonFunctions } from "../utils/loadCommonFunctions.js";
import { errorLog, infoLog } from "../utils/logger.js";
import { customMiddleware } from "./customMiddleware.js";
import { messageHandler } from "./messageHandler.js";
import { recordMessageEnvelope } from "../utils/messageEnvelopeRegistry.js";
import { hasPaymentMessage } from "../utils/paymentMessage.js";
import { handleAfkReferences } from "./afkHandler.js";
import { onGroupParticipantsUpdate } from "./onGroupParticipantsUpdate.js";
import { ouvirComprovativos } from "./comprovativos-listener.js";
import { getCentral } from "../utils/centrals.js";

const semDispositivo = (id) => String(id || "").replace(/:[0-9]+@/, "@");

/**
 * Grupo sem central vinculada.
 * Só o dono do bot passa. Qualquer outro comando recebe a mensagem de permissão.
 */
async function responderSemCentral(socket, webMessage) {
  const remoteJid = webMessage.key.remoteJid;

  const { fullMessage, prefix, commandName } = extractDataFromMessage(webMessage);
  if (fullMessage === "#auto-command" || !commandName) return;
  if (prefix !== getPrefix(remoteJid)) return;

  await socket.sendMessage(remoteJid, {
    text:
      `╭━━⪩ *SEM PLANO ATIVO* ⪨━━\n` +
      `▢ ⚠️ Este grupo *não possui* um *plano ativo*!\n` +
      `▢ Para adquirir um plano, entre em *contacto*:\n` +
      `▢ 📞 +258 83 425 4136\n` +
      `▢ 👤 *Jovem*\n` +
      `╰━━─「⏳」─━━`,
  });
}

export async function onMessagesUpsert({ socket, messages, startProcess }) {
  if (!messages.length) return;

  for (const webMessage of messages) {
    if (DEVELOPER_MODE) {
      infoLog(
        `\n\n⪨========== [ MENSAGEM RECEBIDA ] ==========⪩ \n\n${JSON.stringify(
          messages,
          null,
          2,
        )}`,
      );
    }

    try {
      if (!webMessage?.key?.remoteJid?.endsWith("@g.us")) continue;

      const timestamp = webMessage.messageTimestamp;

      // Registra envelope de todas as mensagens de grupo
      recordMessageEnvelope(webMessage, hasPaymentMessage(webMessage));

      // ======================================================
      // BLOQUEIO ÚNICO — sem central vinculada = para tudo
      // ======================================================
      const central = getCentral(webMessage.key.remoteJid);
      const remetente = webMessage?.key?.participant?.replace(
        /:[0-9][0-9]|:[0-9]/g,
        "",
      );

      if (
        !central &&
        !webMessage.key.fromMe &&
        remetente !== OWNER_LID
      ) {
        if (!isAtLeastMinutesInPast(timestamp)) {
          await responderSemCentral(socket, webMessage);
        }
        continue;
      }
      // ======================================================

      if (webMessage?.message) {
        messageHandler(socket, webMessage);
      }

      if (isAtLeastMinutesInPast(timestamp)) continue;

      if (isAddOrLeave.includes(webMessage.messageStubType)) {
        let action = "";
        if (webMessage.messageStubType === GROUP_PARTICIPANT_ADD) {
          action = "add";
        } else if (webMessage.messageStubType === GROUP_PARTICIPANT_LEAVE) {
          action = "remove";
        }

        await customMiddleware({
          socket,
          webMessage,
          type: "participant",
          action,
          data: webMessage.messageStubParameters[0],
          commonFunctions: null,
        });

        await onGroupParticipantsUpdate({
          data: webMessage.messageStubParameters[0],
          remoteJid: webMessage.key.remoteJid,
          socket,
          action,
        });

        return;
      }

      if (
        checkIfMemberIsMuted(
          webMessage?.key?.remoteJid,
          webMessage?.key?.participant?.replace(/:[0-9][0-9]|:[0-9]/g, ""),
        )
      ) {
        try {
          const { id, remoteJid, participant } = webMessage.key;
          await socket.sendMessage(remoteJid, {
            delete: { remoteJid, fromMe: false, id, participant },
          });
        } catch (error) {
          errorLog(
            `Erro ao deletar mensagem de membro silenciado: ${error.message}`,
          );
        }
        return;
      }

      const commonFunctions = loadCommonFunctions({ socket, webMessage });
      if (!commonFunctions) continue;

      await customMiddleware({
        socket,
        webMessage,
        type: "message",
        commonFunctions,
      });

      await handleAfkReferences({ webMessage, commonFunctions });
      await ouvirComprovativos({ socket, webMessage });
      await dynamicCommand(commonFunctions, startProcess);
    } catch (error) {
      if (badMacHandler.handleError(error, "message-processing")) continue;
      if (badMacHandler.isSessionError(error)) {
        errorLog(`Erro de sessão: ${error.message}`);
        continue;
      }
      errorLog(`Erro ao processar mensagem: ${error.message}`);
      continue;
    }
  }
}