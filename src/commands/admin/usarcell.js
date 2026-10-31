// src/commands/admin/usarcell.js
// Pode ser usado de qualquer grupo da central (ex.: o de gestão):
// o nº do grupo vem do .grupos e os nºs dos dispositivos vêm do .aparelhos.
// Vários dispositivos: .usarcell 2 1,2  (o disparo tenta por esta ordem).
import { PREFIX } from "../../config.js";
import { InvalidParameterError, WarningError } from "../../errors/index.js";
import { resolveDeviceByNumber } from "../../services/firebase.js";
import { getCentral, setActiveDevice } from "../../utils/centrals.js";
import { grupoPorIndice } from "../../utils/grupos.js";

const USO =
  `Use: ${PREFIX}usarcell [nº grupo] [nº dispositivo]\n` +
  `Vários: ${PREFIX}usarcell [nº grupo] 1,2 (tenta pela ordem indicada)\n` +
  `Ex: ${PREFIX}usarcell 2 1,2\n` +
  `Grupos: ${PREFIX}grupos | Dispositivos: ${PREFIX}aparelhos`;

export default {
  name: "usarcell",
  description: "Define qual(is) aparelho(s) um grupo da central usa por padrão.",
  commands: ["usarcell"],
  usage: USO,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ fullArgs, remoteJid, isGroup, sendReply }) => {
    if (!isGroup) {
      throw new WarningError("Este comando só funciona em grupos!");
    }

    const central = getCentral(remoteJid);
    if (!central) {
      throw new WarningError(
        "Este grupo ainda não está vinculado a uma central. Use .ativarauto primeiro.",
      );
    }

    const args = fullArgs.trim().split(/\s+/).filter(Boolean);
    const nGrupo = parseInt(args[0], 10);
    // "1,2", "1, 2" ou "1 2": tudo o que vem depois do nº do grupo.
    const nums = [
      ...new Set(
        args
          .slice(1)
          .join(",")
          .split(/[,\s]+/)
          .filter(Boolean)
          .map((x) => parseInt(x, 10)),
      ),
    ];

    if (!nGrupo || nGrupo <= 0 || !nums.length || nums.some((n) => !n || n <= 0)) {
      throw new InvalidParameterError(USO);
    }

    const grupo = await grupoPorIndice(central.centralCode, nGrupo);
    if (!grupo) {
      throw new WarningError(`Grupo ${nGrupo} não existe. Use ${PREFIX}grupos para ver a lista.`);
    }

    const devices = [];
    for (const n of nums) {
      const device = await resolveDeviceByNumber(central.centralCode, n);
      if (!device) {
        throw new WarningError(
          `Dispositivo ${n} não encontrado! Use ${PREFIX}aparelhos para ver a lista.`,
        );
      }
      devices.push({ n, device });
    }

    if (!setActiveDevice(grupo.jid, nums)) {
      throw new WarningError(
        `O grupo *${grupo.nome}* não está vinculado a uma central. Use .ativarauto nele primeiro.`,
      );
    }

    const linhas = devices.map(
      (d, i) => `${nums.length > 1 ? `${i + 1}º ` : ""}Dispositivo ${d.n} (${d.device.deviceModel || "?"})`,
    );
    await sendReply(
      `✅ *Aparelho${nums.length > 1 ? "s" : ""} definido${nums.length > 1 ? "s" : ""}!*\n` +
        `O grupo *${grupo.nome}* agora usa:\n${linhas.map((l) => `• ${l}`).join("\n")}` +
        (nums.length > 1
          ? "\n\nO disparo tenta o 1º; se não tiver megas ou limite, passa ao seguinte."
          : ""),
    );
  },
};
