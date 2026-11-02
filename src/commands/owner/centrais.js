import { PREFIX } from "../../config.js";
import { WarningError } from "../../errors/index.js";
import { isBotOwner } from "../../middlewares/index.js";
import { getDeviceList, getPrazoApp, getPrazoSoprati } from "../../services/firebase.js";
import { getTodasCentrais } from "../../utils/centrals.js";

const DIA = 24 * 60 * 60 * 1000;

// "30 dia(s)" enquanto vale; "vencida"/"vencido" depois. null se não houver prazo.
function prazoTexto(expiresAt, vencido = "vencida") {
  if (!expiresAt) return null;
  const dias = Math.ceil((expiresAt - Date.now()) / DIA);
  return dias > 0 ? `${dias} dia(s)` : vencido;
}

export default {
  name: "centrais",
  description: "Lista as centrais com as licenças, os grupos e os aparelhos de cada uma.",
  commands: ["centrais"],
  usage: `${PREFIX}centrais`,

  handle: async ({ userLid, socket, sendReply }) => {
    if (!isBotOwner({ userLid })) return;

    const entries = Object.entries(getTodasCentrais());
    if (!entries.length) {
      throw new WarningError("Nenhuma central vinculada ainda.");
    }

    // Agrupa os grupos por central
    const porCentral = {};
    for (const [groupId, data] of entries) {
      (porCentral[data.centralCode] ||= []).push({ groupId, nome: data.nome });
    }

    let texto = `🕷 🔔 ╭━━⪩ CENTRAIS ⪨━━\n▢\n`;

    for (const [code, grupos] of Object.entries(porCentral).sort(([a], [b]) => a.localeCompare(b))) {
      let devices = [];
      try {
        devices = await getDeviceList(code);
      } catch {}

      const [soprati, app] = await Promise.all([
        getPrazoSoprati(code).catch(() => null),
        getPrazoApp(code, devices.map((d) => d.deviceId)).catch(() => null),
      ]);

      const nomes = await Promise.all(
        grupos.map(async (g) => {
          try {
            return (await socket.groupMetadata(g.groupId)).subject || g.nome || g.groupId;
          } catch {
            return g.nome || g.groupId;
          }
        }),
      );

      texto += `✅ Central ${code}\n`;
      if (soprati) texto += `🔷 Soprati: ${prazoTexto(soprati, "vencido")}\n`;
      texto += `📅 AppLicença: ${prazoTexto(app) || "sem licença"}\n`;
      texto += `Grupos:\n`;
      nomes.forEach((nome, i) => {
        texto += `${i + 1} ${nome}\n`;
      });
      texto += `📱 Dispositivos:\n`;
      if (!devices.length) texto += `Nenhum\n`;
      for (const d of devices) {
        texto += `${d.numero} ${d.deviceModel}${d.isMaster ? " ⭐" : ""}\n`;
      }
      texto += `▢\n`;
    }

    texto += `╰━━─「🔑」─━━`;
    await sendReply(texto);
  },
};
