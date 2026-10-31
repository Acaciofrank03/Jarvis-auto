import { getDatabase } from "firebase-admin/database";
import { initFirebase } from "./firebase.js";
import { watchNewDevices } from "./firebase.js";
import { getGrupoAlugueis } from "../utils/alugueis.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const centralsPath = path.resolve(__dirname, "..", "..", "database", "centrals.json");

const activeWatchers = new Map(); // centralCode -> stopFunction

function getAllCentralCodes() {
  if (!fs.existsSync(centralsPath)) return [];
  const data = JSON.parse(fs.readFileSync(centralsPath, "utf8"));
  return [...new Set(Object.values(data).map((c) => c.centralCode))];
}

/**
 * Inicia os watchers de novos dispositivos para todas as centrais.
 * Chamar uma vez no start do bot.
 */
export function iniciarWatchersDispositivos(socket) {
  const centrais = getAllCentralCodes();

  for (const code of centrais) {
    if (activeWatchers.has(code)) continue;

    const stop = watchNewDevices(code, async (deviceId, data) => {
      const grupo = getGrupoAlugueis();
      if (!grupo) return;

      const modelo = data.deviceModel || "Desconhecido";
      const role = data.deviceRole || "Desconhecido";
      const agora = new Date().toLocaleString("pt-PT", {
        timeZone: "Africa/Maputo",
      });

      try {
        await socket.sendMessage(grupo, {
          text:
            `🕷 🔔 ╭━━⪩ NOVO DISPOSITIVO ⪨━━\n` +
            `▢\n` +
            `▢ ✅ Aparelho conectado!\n` +
            `▢\n` +
            `▢ 🔑 Central: ${code}\n` +
            `▢ 📱 Modelo: ${modelo}\n` +
            `▢ 📋 Função: ${role}\n` +
            `▢ 🆔 Device ID: ${deviceId}\n` +
            `▢ 📅 Data: ${agora}\n` +
            `▢\n` +
            `╰━━─「📱」─━━`,
        });
      } catch (e) {
        console.error("[deviceWatcher] erro ao notificar:", e);
      }
    });

    activeWatchers.set(code, stop);
  }

  console.log(`[deviceWatcher] Monitorando ${activeWatchers.size} central(is)`);
}

/**
 * Adiciona watcher para uma central nova (chamar após vincular)
 */
export function adicionarWatcherCentral(centralCode, socket) {
  if (activeWatchers.has(centralCode)) return;

  const stop = watchNewDevices(centralCode, async (deviceId, data) => {
    const grupo = getGrupoAlugueis();
    if (!grupo) return;

    const modelo = data.deviceModel || "Desconhecido";
    const role = data.deviceRole || "Desconhecido";
    const agora = new Date().toLocaleString("pt-PT", {
      timeZone: "Africa/Maputo",
    });

    try {
      await socket.sendMessage(grupo, {
        text:
          `🕷 🔔 ╭━━⪩ NOVO DISPOSITIVO ⪨━━\n` +
          `▢\n` +
          `▢ ✅ Aparelho conectado!\n` +
          `▢\n` +
          `▢ 🔑 Central: ${centralCode}\n` +
          `▢ 📱 Modelo: ${modelo}\n` +
          `▢ 📋 Função: ${role}\n` +
          `▢ 🆔 Device ID: ${deviceId}\n` +
          `▢ 📅 Data: ${agora}\n` +
          `▢\n` +
          `╰━━─「📱」─━━`,
      });
    } catch (e) {
      console.error("[deviceWatcher] erro ao notificar:", e);
    }
  });

  activeWatchers.set(centralCode, stop);
}