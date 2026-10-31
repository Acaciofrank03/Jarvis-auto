import { PREFIX } from "../../config.js";
import { WarningError } from "../../errors/index.js";
import { isBotOwner } from "../../middlewares/index.js";
import { getDeviceList, checkSopratiLicenseForCentral } from "../../services/firebase.js";
import { getCentral } from "../../utils/centrals.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const centralsPath = path.resolve(__dirname, "..", "..", "..", "database", "centrals.json");

export default {
  name: "centrais",
  description: "Lista todas as centrais e grupos vinculados.",
  commands: ["centrais"],
  usage: `${PREFIX}centrais`,

  handle: async ({ userLid, socket, sendReply }) => {
    if (!isBotOwner({ userLid })) return;

    if (!fs.existsSync(centralsPath)) {
      throw new WarningError("Nenhuma central vinculada ainda.");
    }

    const centrals = JSON.parse(fs.readFileSync(centralsPath, "utf8"));
    const entries = Object.entries(centrals);

    if (!entries.length) {
      throw new WarningError("Nenhuma central vinculada ainda.");
    }

    // Agrupa por centralCode
    const porCentral = {};
    for (const [groupId, data] of entries) {
      const code = data.centralCode;
      if (!porCentral[code]) porCentral[code] = [];
      porCentral[code].push({ groupId, ...data });
    }

    let texto = `🕷 🔔 ╭━━⪩ CENTRAIS VINCULADAS ⪨━━\n▢\n`;

    let contador = 1;

    for (const [code, grupos] of Object.entries(porCentral)) {
      // Licença Soprati (se existir)
      let linhaLicenca = "📅 Licença: gerenciada no aplicativo";
      try {
        const lic = await checkSopratiLicenseForCentral(code);
        if (lic) {
          const dias = Math.ceil((lic.expiresAt - Date.now()) / (1000 * 60 * 60 * 24));
          const venc = new Date(lic.expiresAt).toLocaleDateString("pt-PT", {
            timeZone: "Africa/Maputo",
          });
          linhaLicenca =
            dias > 0
              ? `📅 Vencimento: ${venc} • ${dias} dia(s)`
              : `📅 Licença vencida em ${venc}`;
        }
      } catch {}

      // Dispositivos
      let dispositivos = "Nenhum dispositivo";
      try {
        const devices = await getDeviceList(code);
        if (devices.length) {
          dispositivos = devices
            .map((d) => `Dispositivo ${d.numero}: \( {d.deviceModel} \){d.isMaster ? " ⭐" : ""}`)
            .join("\n▢     ");
        }
      } catch {}

      for (const g of grupos) {
        let nome = g.groupId;
        try {
          nome = (await socket.groupMetadata(g.groupId)).subject || g.groupId;
        } catch {}

        texto +=
          `▢\n` +
          `▢ ✅ Central ${contador}: ${code}\n` +
          `▢ 📋 Grupo: ${nome}\n` +
          `▢ 🆔 ID: ${g.groupId}\n` +
          `▢ ${linhaLicenca}\n` +
          `▢ 📱 Dispositivos:\n▢     ${dispositivos}\n` +
          `▢\n`;
        contador++;
      }
    }

    texto += `╰━━─「🔑」─━━`;

    await sendReply(texto);
  },
};