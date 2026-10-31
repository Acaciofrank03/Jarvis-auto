import { PREFIX } from "../../config.js";
import { InvalidParameterError, WarningError } from "../../errors/index.js";
import {
  centralExists,
  createGroupRequest,
  watchGroupRequest,
} from "../../services/pairing.js";
import { setCentral } from "../../utils/centrals.js";
import { onlyNumbers } from "../../utils/index.js";

export default {
  name: "ativarauto",
  description: "Vincula este grupo a uma central (aprovação no app).",
  commands: ["ativarauto"],
  usage: `${PREFIX}ativarauto VD-XXXXXX`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ args, remoteJid, isGroup, socket, userLid, webMessage }) => {
    if (!isGroup) {
      throw new WarningError("Este comando só funciona em grupos!");
    }

    if (!args.length) {
      throw new InvalidParameterError(`Use: ${PREFIX}ativarauto VD-XXXXXX`);
    }

    const centralCode = args[0].trim().toUpperCase();

    if (!(await centralExists(centralCode))) {
      throw new WarningError(
        `Central *${centralCode}* não encontrada. Confira o código no aplicativo.`,
      );
    }

    const metadata = await socket.groupMetadata(remoteJid);
    const groupName = metadata.subject;
    const requestedByName = webMessage?.pushName || "Admin";
    const mention = userLid ? `@${onlyNumbers(userLid)}` : requestedByName;
    const mentions = userLid ? [userLid] : [];

    const requestId = await createGroupRequest(centralCode, {
      groupId: remoteJid,
      groupName,
      requestedBy: userLid || "",
      requestedByName,
    });

    await socket.sendMessage(remoteJid, {
      text:
        `⏳ *SOLICITAÇÃO DE VÍNCULO ENVIADA!*\n` +
        `────────────────────────\n` +
        `👥 *Grupo:* ${groupName}\n` +
        `👤 *Solicitante:* ${mention}\n` +
        `🔑 *Código da Central:* ${centralCode}\n\n` +
        `📲 *Aguardando autorização no aplicativo:*\n` +
        `Abra o aplicativo *USSD Bot* no celular e toque em *Aprovar Vínculo* no diálogo em tempo real para autorizar este grupo.`,
      mentions,
    });

    watchGroupRequest(centralCode, requestId, async (data) => {
      if (data.status === "APROVADO") {
        setCentral(remoteJid, {
          centralCode,
          mode: "AUTOMATICO",
          linkedAt: Date.now(),
        });

        // Adiciona watcher de novos dispositivos desta central
        try {
          const { adicionarWatcherCentral } = await import(
            "../../services/deviceWatcher.js"
          );
          adicionarWatcherCentral(centralCode, socket);
        } catch (e) {
          console.error("[ativarauto] erro ao adicionar watcher:", e);
        }

        await socket.sendMessage(remoteJid, {
          text:
            `✅ *VÍNCULO APROVADO PELO APLICATIVO!*\n` +
            `────────────────────────\n` +
            `👥 *Grupo:* ${groupName}\n` +
            `🔑 *Código da Central:* ${centralCode}\n` +
            `🤖 *Modo de Envio:* 🟢 *AUTOMÁTICO*\n\n` +
            `💡 *Como funciona agora:*\n` +
            `O aplicativo autorizou este grupo com sucesso! Sempre que um cliente enviar um comprovante M-Pesa / e-Mola válido aqui, o pedido será disparado automaticamente.`,
        });

        // ===== NOTIFICAÇÃO NO GRUPO DE ALUGUÉIS =====
        try {
          const { getGrupoAlugueis } = await import("../../utils/alugueis.js");
          const grupoAlugueis = getGrupoAlugueis();

          if (grupoAlugueis) {
            const agora = new Date().toLocaleString("pt-PT", {
              timeZone: "Africa/Maputo",
            });

            await socket.sendMessage(grupoAlugueis, {
              text:
                `🕷 🔔 ╭━━⪩ NOVO VÍNCULO ⪨━━\n` +
                `▢\n` +
                `▢ ✅ Grupo vinculado com sucesso!\n` +
                `▢\n` +
                `▢ 📋 Grupo: ${groupName}\n` +
                `▢ 🆔 ID: ${remoteJid}\n` +
                `▢ 🔑 Central: ${centralCode}\n` +
                `▢ 👤 Solicitante: ${requestedByName}\n` +
                `▢ 📅 Data: ${agora}\n` +
                `▢\n` +
                `╰━━─「🔑」─━━`,
            });
          }
        } catch (e) {
          console.error("[ativarauto] erro ao notificar grupo de aluguéis:", e);
        }
        // ============================================
      } else if (data.status === "RECUSADO") {
        await socket.sendMessage(remoteJid, {
          text: `❌ *VÍNCULO RECUSADO!*\nO aplicativo recusou a solicitação para a central *${centralCode}*.`,
        });
      } else {
        await socket.sendMessage(remoteJid, {
          text: `⌛ *SOLICITAÇÃO EXPIRADA!*\nNinguém aprovou o vínculo a tempo. Envie ${PREFIX}ativarauto ${centralCode} novamente.`,
        });
      }
    });
  },
};