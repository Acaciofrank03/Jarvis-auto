// src/commands/admin/jarvis.js
import { PREFIX, BOT_EMOJI } from "../../config.js";
import { WarningError } from "../../errors/index.js";
import { resolveDeviceByNumber, getDeviceList } from "../../services/firebase.js";
import { getActiveDevice, getCentral } from "../../utils/centrals.js";
import { listarGrupos } from "../../utils/grupos.js";
import {
  caixa,
  fmtEnvios,
  fmtMegas,
  fmtMT,
  getLimites,
} from "../../utils/limites.js";

const MAX_APARELHOS = 10;

export default {
  name: "jarvis",
  description: "Mostra a situação da central e dos dispositivos.",
  commands: ["jarvis"],
  usage: `${PREFIX}jarvis`,

  handle: async ({ remoteJid, isGroup, sendReply }) => {
    if (!isGroup) throw new WarningError("Este comando só funciona em grupos!");

    const central = getCentral(remoteJid);
    if (!central) {
      throw new WarningError("Este grupo ainda não está vinculado a uma central.");
    }

    const codigo = central.centralCode;
    const ativoNoGrupo = getActiveDevice(remoteJid);

    // Aparelho principal (isMaster)
    const todos = await getDeviceList(codigo);
    const principal = todos.find((d) => d.isMaster) || todos[0];
    const modeloPrincipal = principal?.deviceModel || "não definido";

    const blocos = [
      caixa(`${BOT_EMOJI} 👻`, "ESTADO DA CENTRAL", [
        `🏢 Central: ${codigo}`,
        `📟 Aparelho principal: ${modeloPrincipal}`,
      ]),
    ];

    // Grupos ligados à central (mostrados no 1º aparelho)
    const grupos = await listarGrupos(codigo);
    const linhasGrupos =
      grupos.length > 0
        ? ["Grupos ligados:", ...grupos.map((g, i) => `${i + 1}. ${g.nome}`)]
        : ["Grupos ligados:", "Nenhum grupo registado."];

    let encontrados = 0;

    for (let n = 1; n <= MAX_APARELHOS; n++) {
      let device = null;
      try {
        device = await resolveDeviceByNumber(codigo, n);
      } catch {
        break;
      }
      if (!device) break;
      encontrados += 1;

      const l = getLimites(codigo, n);

      const linhas = [
        `📱 Aparelho: ${device.deviceModel || "?"}`,
      ];

      for (const i of [0, 1]) {
        linhas.push(
          `🔹 SIM ${i + 1}: ${fmtEnvios(l.mlimite[i])} • ${fmtMegas(l.megas[i])}`,
        );
        linhas.push(`💰 Saldo SIM ${i + 1}: ${fmtMT(l.saldo[i])}`);
      }

      // Grupos só no primeiro aparelho (como no seu exemplo)
      if (n === 1) {
        linhas.push(...linhasGrupos);
      }

      blocos.push(caixa("⚡", `CELULAR ${n}`, linhas));
    }

    if (!encontrados) {
      blocos.push(
        caixa("📋", "DISPOSITIVOS", ["Nenhum dispositivo encontrado nesta central."]),
      );
    }

    blocos.push(
      caixa("⚙️", "GESTÃO RÁPIDA", [
        `${PREFIX}megas 2 50gb/900mb`,
        `${PREFIX}saldo 2 100/500`,
        `${PREFIX}mlimite 2 0/10,10/10`,
        `${PREFIX}slimite 2 100/500`,
        `${PREFIX}usarcell 2`,
      ]),
    );

    await sendReply(blocos.join("\n\n"));
  },
};