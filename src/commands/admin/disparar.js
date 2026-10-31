import { PREFIX } from "../../config.js";
import { InvalidParameterError, WarningError } from "../../errors/index.js";
import {
  enviarComando,
  escutarStatusPedido,
  resolveDeviceByNumber,
} from "../../services/firebase.js";
import { getActiveDevice, getCentral } from "../../utils/centrals.js";
import { onlyNumbers } from "../../utils/index.js";

const LIMITE_POR_ORDEM_MB = 10240;

export default {
  name: "disparar",
  description: "Dispara a compra de megas para um número de cliente.",
  commands: ["disparar"],
  usage: `${PREFIX}disparar [quantidade]mb/gb [número]`,

  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ fullArgs, remoteJid, isGroup, sendReply }) => {
    if (!isGroup) {
      throw new WarningError("Este comando só funciona em grupos!");
    }

    const args = fullArgs.trim().split(/\s+/).filter(Boolean);

    if (args.length < 2) {
      throw new InvalidParameterError(
        `Use: ${PREFIX}disparar [quantidade]mb/gb [número]\nEx: ${PREFIX}disparar 2gb 843443776`,
      );
    }

    const central = getCentral(remoteJid);

    if (!central) {
      throw new WarningError(
        "Este grupo ainda não está vinculado a uma central. Use .ativarauto primeiro.",
      );
    }

    const deviceNumber = getActiveDevice(remoteJid);

    if (!deviceNumber) {
      throw new WarningError(
        `Nenhum aparelho definido para este grupo! Use ${PREFIX}usarcell [nº dispositivo] primeiro.`,
      );
    }

    const device = await resolveDeviceByNumber(
      central.centralCode,
      deviceNumber,
    );

    if (!device) {
      throw new WarningError(
        `Dispositivo ${deviceNumber} não encontrado! Use ${PREFIX}aparelhos para ver a lista.`,
      );
    }

    const quantMatch = args[0].match(/^(\d+(?:\.\d+)?)(mb|gb)$/i);

    if (!quantMatch) {
      throw new InvalidParameterError(
        "Quantidade inválida! Use o formato: 500mb ou 2gb",
      );
    }

    const value = parseFloat(quantMatch[1]);
    const unit = quantMatch[2].toLowerCase();

    const megasAmount =
      unit === "gb"
        ? Math.round(value * 1024)
        : Math.round(value);

    if (megasAmount <= 0) {
      throw new InvalidParameterError("A quantidade deve ser maior que zero.");
    }

    const phone = onlyNumbers(args[1]);

    if (!phone || phone.length < 9) {
      throw new InvalidParameterError("Número de celular inválido!");
    }

    // Divide a quantidade total em ordens de no máximo 10 GB.
    const partes = [];

    let restante = megasAmount;

    while (restante > 0) {
      const parte = Math.min(restante, LIMITE_POR_ORDEM_MB);
      partes.push(parte);
      restante -= parte;
    }

    // Cria TODAS as ordens no Firebase.
    // O APK já mantém vendas_pendentes em fila e processa uma por uma.
    const orderIds = [];

    for (const parte of partes) {
      const orderId = await enviarComando(central.centralCode, {
        targetDeviceId: device.deviceId,
        clientePhone: phone,
        megasAmount: parte,
        valorPago: 0,
        ussdMethod: "*162#",
        isManual: true,
      });

      orderIds.push(orderId);
    }

    const displayAmount =
      unit === "gb" ? `${value}GB` : `${value}MB`;

    let mensagem =
      `🚀 *ORDEM DE DISPARO ENVIADA COM SUCESSO!*\n` +
      `────────────────────────\n` +
      `📞 *Destinatário:* \`${phone}\`\n` +
      `💾 *Quantidade:* ${displayAmount} (${megasAmount} MB)\n` +
      `📦 *Divisão:* ${partes.length}x envio${partes.length > 1 ? "s" : ""} de até 10GB\n` +
      `⚡ *Método USSD:* *162#\n` +
      `────────────────────────\n` +
      `📲 *Status:* Ordens enviadas para processamento nos aparelhos da Central.`;

    await sendReply(mensagem);

    // Acompanha cada ordem individualmente.
    // O APK continua responsável pela fila e pelo processamento sequencial.
    orderIds.forEach((orderId, index) => {
      const parte = partes[index];

      escutarStatusPedido(
        central.centralCode,
        orderId,
        async (data) => {
          if (data.status === "CONCLUIDO" || data.status === "SUCESSO") {
            await sendReply(
              `✅ *Ordem ${index + 1}/${partes.length} concluída!*\n\n` +
                `📱 *Número:* ${phone}\n` +
                `📊 *Megas:* ${parte} MB (${(parte / 1024).toFixed(2)} GB)\n` +
                `🖥️ *Dispositivo:* ${deviceNumber}\n\n` +
                `_Transferência processada automaticamente pelo sistema_`,
            );
          } else if (data.status === "ERRO") {
            await sendReply(
              `❌ *Erro na ordem ${index + 1}/${partes.length}.*\n` +
                `📱 *Número:* ${phone}\n` +
                `📊 *Quantidade:* ${parte} MB`,
            );
          }
        },
      );
    });
  },
};
