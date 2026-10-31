// src/commands/admin/consultar.js  (pasta admin: só administradores)
// .consultar [dispositivo] [SIM1/SIM2]
// Pede ao APK para executar *100# no SIM indicado, lê o saldo e os megas da resposta
// e atualiza os valores do limites.js (os mesmos do .saldo e .megas).
import { PREFIX } from "../../config.js";
import { InvalidParameterError, WarningError } from "../../errors/index.js";
import {
  enviarComando,
  escutarStatusPedido,
  resolveDeviceByNumber,
} from "../../services/firebase.js";
import { getCentral } from "../../utils/centrals.js";
import { fmtMegas, getLimites, setMegas, setSaldo } from "../../utils/limites.js";

// ===== CONFIGURAÇÃO (mexa só aqui) =====
const USSD = "*100#";
const ESPERA_MS = 3 * 60 * 1000; // tempo máximo de espera pela resposta do aparelho
// =======================================

const STATUS_FINAIS = ["SUCESSO", "CONCLUIDO", "FALHA", "ERRO"];

// Espera o APK terminar o pedido e devolve os dados finais (ou { status: "TIMEOUT" }).
function aguardarResultado(centralCode, orderId, timeoutMs) {
  return new Promise((resolve) => {
    let fim = false;
    let parar = null;

    const finalizar = (resultado) => {
      if (fim) return;
      fim = true;
      clearTimeout(timer);
      setTimeout(() => parar?.(), 0); // libera o listener do Firebase
      resolve(resultado);
    };

    const timer = setTimeout(() => finalizar({ status: "TIMEOUT" }), timeoutMs);

    parar = escutarStatusPedido(
      centralCode,
      orderId,
      (data) => {
        if (data && STATUS_FINAIS.includes(data.status)) finalizar(data);
      },
      timeoutMs,
    );
  });
}

const limparTexto = (texto) =>
  String(texto || "")
    .replace(/\s*\n\s*/g, " ")
    .replace(/\s*OK\s*$/i, "")
    .trim();

const numero = (s) => parseFloat(String(s).replace(/,(?=\d{3}(\D|$))/g, "").replace(",", "."));

// Lê saldo (MT) e internet (MB) do texto do *100#.
// AJUSTAR as expressões se a resposta da operadora tiver outro formato.
function lerConsulta(textoBruto) {
  const texto = limparTexto(textoBruto);

  const s = texto.match(/saldo\D{0,20}(\d[\d.,]*)/i);
  let saldo = s ? numero(s[1]) : null;
  if (!Number.isFinite(saldo)) saldo = null;

  const i = texto.match(/(?:internet|dados|megas|b[oó]nus)\D{0,20}(\d[\d.,]*)\s*(gb|mb)/i);
  let megas = null;
  if (i) {
    const q = numero(i[1]);
    if (Number.isFinite(q)) megas = Math.round(/^g/i.test(i[2]) ? q * 1024 : q);
  }

  return { texto, saldo, megas };
}

const fmtMt = (n) => `${Number(n).toFixed(2)} MT`;

// "29/09/2026 02:44:53" (hora de Maputo)
const horario = () =>
  new Date()
    .toLocaleString("pt-BR", { timeZone: "Africa/Maputo", hour12: false })
    .replace(",", "");

export default {
  name: "consultar",
  description: "Consulta o saldo e os megas de um SIM via *100# e sincroniza o sistema.",
  commands: ["consultar"],
  usage: `${PREFIX}consultar [dispositivo] [SIM1/SIM2]\nEx: ${PREFIX}consultar 2 SIM2`,

  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ fullArgs, remoteJid, isGroup, sendReply }) => {
    if (!isGroup) throw new WarningError("Este comando só funciona em grupos!");

    const uso = `Use: ${PREFIX}consultar [dispositivo] [SIM1/SIM2]\nEx: ${PREFIX}consultar 2 SIM2`;
    const args = fullArgs.trim().split(/\s+/).filter(Boolean);
    if (args.length < 2) throw new InvalidParameterError(uso);

    const central = getCentral(remoteJid);
    if (!central) {
      throw new WarningError(
        "Este grupo ainda não está vinculado a uma central. Use .ativarauto primeiro.",
      );
    }

    const disp = parseInt(args[0], 10);
    if (!disp || disp <= 0) {
      throw new InvalidParameterError(
        `Número de aparelho inválido! Use ${PREFIX}aparelhos para ver a lista.`,
      );
    }

    const simMatch = args[1].match(/^(?:SIM)?([12])$/i);
    if (!simMatch) throw new InvalidParameterError("SIM inválido! Use SIM1 ou SIM2");
    const sim = parseInt(simMatch[1], 10);

    const device = await resolveDeviceByNumber(central.centralCode, disp);
    if (!device) {
      throw new WarningError(
        `Dispositivo ${disp} não encontrado! Use ${PREFIX}aparelhos para ver a lista.`,
      );
    }

    const nomeAparelho = `Celular ${disp} (${device.deviceModel || "?"})`;

    let orderId;
    try {
      orderId = await enviarComando(central.centralCode, {
        targetDeviceId: device.deviceId,
        clientePhone: "Consulta",
        megasAmount: 0,
        valorPago: 0,
        ussdMethod: USSD,
        isManual: true,
        targetSimSlot: sim - 1, // o APK usa 0-based: 0 = SIM 1, 1 = SIM 2
      });
    } catch (e) {
      throw new WarningError(`❌ Não consegui enviar a consulta: ${e.message || "erro desconhecido"}`);
    }

    await sendReply(
      `🔄 *CONSULTA USSD (${USSD}) ENVIADA!*\n` +
        `────────────────────────\n` +
        `📱 *Aparelho:* ${nomeAparelho}\n` +
        `💳 *Chip:* SIM ${sim}\n` +
        `🏢 *Central:* \`${central.centralCode}\`\n\n` +
        `⚡ O Celular ${disp} está executando ${USSD} no SIM ${sim} agora.\n` +
        `O saldo e os megas capturados serão atualizados no sistema automaticamente.`,
    );

    // Resultado em segundo plano, para não prender o bot enquanto o aparelho responde.
    (async () => {
      const data = await aguardarResultado(central.centralCode, orderId, ESPERA_MS);

      if (data.status !== "SUCESSO" && data.status !== "CONCLUIDO") {
        const motivo =
          data.status === "TIMEOUT"
            ? "sem resposta do aparelho"
            : data.motivoErro || limparTexto(data.ussdResponseText) || "falha desconhecida";
        await sendReply(
          `⚠️ *CONSULTA USSD (${USSD}) FALHOU*\n` +
            `────────────────────────\n` +
            `📱 *Aparelho:* ${nomeAparelho}\n` +
            `💳 *Chip:* SIM ${sim}\n` +
            `⚠️ *Motivo:* ${motivo}`,
        );
        return;
      }

      const { texto, saldo, megas } = lerConsulta(data.ussdResponseText);

      // Sincroniza com o limites.js (mesmos valores do .saldo e .megas).
      const l = getLimites(central.centralCode, disp);
      if (megas != null) {
        const m = [...l.megas];
        m[sim - 1] = megas;
        setMegas(central.centralCode, disp, m);
      }
      if (saldo != null) {
        const s = [...l.saldo];
        s[sim - 1] = saldo;
        setSaldo(central.centralCode, disp, s);
      }

      const linhas = [
        `📋 *RESULTADO DA CONSULTA USSD (${USSD})*`,
        `────────────────────────`,
        `📱 *Aparelho:* ${nomeAparelho}`,
        `💳 *Chip:* SIM ${sim} (${device.role || "?"})`,
        ...(megas != null ? [`🌐 *Internet Revelada:* ${fmtMegas(megas)}`] : []),
        ...(saldo != null ? [`💰 *Saldo Revelado:* ${fmtMt(saldo)}`] : []),
        `📄 *Resposta USSD:* ${texto || "sem texto"}`,
        `⏰ *Horário:* ${horario()}`,
        `────────────────────────`,
      ];

      if (megas == null && saldo == null) {
        linhas.push(
          `⚠️ Não consegui ler o saldo nem os megas desta resposta.`,
          `Nada foi alterado no sistema.`,
        );
      } else {
        if (megas != null) linhas.push(`✅ *Megas sincronizados:* *${fmtMegas(megas)}* no SIM ${sim}`);
        if (saldo != null) linhas.push(`✅ *Saldo sincronizado:* *${fmtMt(saldo)}* no SIM ${sim}`);
        linhas.push(`⚡ _Valores atualizados automaticamente no ${PREFIX}saldo e ${PREFIX}megas._`);
      }

      await sendReply(linhas.join("\n"));
    })().catch((e) => console.error("[consultar] erro no resultado:", e));
  },
};
