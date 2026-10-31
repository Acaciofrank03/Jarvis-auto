// src/index.js
import { connect } from "./connection.js";
import { initFirebase } from "./services/firebase.js";
import { load } from "./loader.js";
import { badMacHandler } from "./utils/badMacHandler.js";
import {
  bannerLog,
  errorLog,
  infoLog,
  installConsoleNoiseFilter,
  warningLog,
} from "./utils/logger.js";
import { iniciarWatchersDispositivos } from "./services/deviceWatcher.js";
import { iniciarSms } from "./utils/smsClientes.js";
import { ref, get } from "./utils/comprovativos.js";

async function startBot() {
  try {
    process.setMaxListeners(1500);

    bannerLog();
    infoLog("Iniciando meus componentes internos...");
    initFirebase();
    infoLog("Firebase conectado.");

    const stats = badMacHandler.getStats();
    if (stats.errorCount > 0) {
      warningLog(
        `BadMacHandler stats: ${stats.errorCount}/${stats.maxRetries} erros`,
      );
    }

    const socket = await connect();

    load(socket);
    iniciarWatchersDispositivos(socket);

    // Inicializa o ouvinte global de SMS buscando as centrais diretamente do Firebase
    const enviar = (jid, text, mentions = []) =>
      socket.sendMessage(jid, { text, mentions });

    try {
      const snapshot = await get(ref(null, "device_pairings"));
      const pairings = snapshot.val() || {};
      const centraisCodes = Object.keys(pairings);

      for (const centralCode of centraisCodes) {
        if (centralCode) {
          iniciarSms(centralCode, enviar);
          infoLog(`[SMS Listener] Ativado em background para a central: ${centralCode}`);
        }
      }
    } catch (err) {
      errorLog("Erro ao carregar centrais para o SMS listener:", err);
    }

    setInterval(() => {
      const currentStats = badMacHandler.getStats();
      if (currentStats.errorCount > 0) {
        warningLog(
          `BadMacHandler stats: ${currentStats.errorCount}/${currentStats.maxRetries} erros`,
        );
      }
    }, 300_000);
  } catch (error) {
    errorLog("Erro fatal ao iniciar o bot:", error);
  }
}

startBot();
