import { PREFIX } from "../../config.js";
import { InvalidParameterError, WarningError } from "../../errors/index.js";
import {
  checkSopratiLicenseForCentral,
  enviarComando,
  escutarStatusPedido,
  resolveDeviceByNumber,
} from "../../services/firebase.js";
import { getCentral } from "../../utils/centrals.js";

// ===== CONFIGURAÇÃO (mexa só aqui) =====
const CLIENTE_PHONE = "Oferta Especial"; // aparece no app no lugar do número (o *109# não usa)
const MEGAS = 7168;
const NOME_OFERTA = "Oferta Especial"; // nome mostrado no grupo no lugar dos MB
const ESPERA_POR_PEDIDO_MS = 2 * 60 * 1000; // tempo máximo de espera por pedido na fila
// =======================================

const STATUS_FINAIS = ["SUCESSO", "CONCLUIDO", "FALHA", "ERRO"];

// Espera o APK terminar UM pedido e devolve os dados finais.
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

// Sucesso só conta quando a operadora confirma ("Activaste...").
// O APK marca SUCESSO mesmo quando a operadora recusa, por isso o texto é conferido.
function classificar(data) {
  const texto = limparTexto(data.ussdResponseText);

  if (data.status === "SUCESSO" || data.status === "CONCLUIDO") {
    return /activaste/i.test(texto)
      ? { ok: true }
      : { ok: false, motivo: texto || "sem confirmação da operadora" };
  }
  if (data.status === "TIMEOUT") {
    return { ok: false, motivo: "sem resposta do aparelho" };
  }
  return { ok: false, motivo: data.motivoErro || texto || "falha desconhecida" };
}

export default {
  name: "soprati",
  description: "Dispara recarga Soprati 7GB num aparelho disparador.",
  commands: ["soprati"],
  usage: `${PREFIX}soprati [nº aparelho] [repetições]x [SIM1/SIM2]`,

  handle: async ({ fullArgs, remoteJid, isGroup, sendReply }) => {
    if (!isGroup) {
      throw new WarningError("Este comando só funciona em grupos!");
    }

    const args = fullArgs.trim().split(/\s+/).filter(Boolean);

    if (args.length < 3) {
      throw new InvalidParameterError(
        `Use: ${PREFIX}soprati [nº aparelho] [repetições]x [SIM1/SIM2]\n` +
          `Ex: ${PREFIX}soprati 2 10x SIM2`,
      );
    }

    const central = getCentral(remoteJid);
    if (!central) {
      throw new WarningError(
        "Este grupo ainda não está vinculado a uma central. Use .ativarauto primeiro.",
      );
    }

    const license = await checkSopratiLicenseForCentral(central.centralCode);
    if (!license) {
      throw new WarningError(
        `🔒 *RECURSO SOPRATI (*109#) BLOQUEADO!*\n` +
          `────────────────────────\n` +
          `Esta Central não possui uma licença SoPraTi (*109#) ativa.\n\n` +
          `🔑 *Para ativar com sua chave de licença:*\n` +
          `👉 \`${PREFIX}ativarsoprati SOPRATI-XXXX-YYYY\`\n\n` +
          `📞 *Para adquirir ou renovar com o suporte:*\n` +
          `https://wa.me/258834254136`,
      );
    }

    const deviceNumber = parseInt(args[0], 10);
    if (!deviceNumber || deviceNumber <= 0) {
      throw new InvalidParameterError(
        `Número de aparelho inválido! Use ${PREFIX}aparelhos para ver a lista.`,
      );
    }

    const repMatch = args[1].match(/^(\d+)x?$/i);
    const vezes = repMatch ? parseInt(repMatch[1], 10) : 0;
    if (!vezes || vezes < 1) {
      throw new InvalidParameterError("Repetições inválidas! Use o formato: 10x");
    }

    const simMatch = args[2].match(/^SIM([12])$/i);
    if (!simMatch) {
      throw new InvalidParameterError("SIM inválido! Use SIM1 ou SIM2");
    }
    const sim = parseInt(simMatch[1], 10);

    const device = await resolveDeviceByNumber(central.centralCode, deviceNumber);
    if (!device) {
      throw new WarningError(
        `Dispositivo ${deviceNumber} não encontrado! Use ${PREFIX}aparelhos para ver a lista.`,
      );
    }

    // Cria todos os pedidos de uma vez, todos PENDENTE. O APK os processa em fila, um a um.
    const ids = [];
    let erroCriacao = null;
    console.log("[soprati] sim:", sim, "args:", args);
    for (let i = 0; i < vezes; i++) {
      try {
        ids.push(
          await enviarComando(central.centralCode, {
            targetDeviceId: device.deviceId,
            clientePhone: CLIENTE_PHONE,
            megasAmount: MEGAS,
            valorPago: 0,
            ussdMethod: "*109#",
            isManual: true,
            repeticoes: 1,
            targetSimSlot: sim - 1,
          }),
        );
        console.log("[soprati] pedido criado:", ids.at(-1), "sim:", sim);
      } catch (e) {
        erroCriacao = e.message || "erro desconhecido";
        break;
      }
    }

    if (!ids.length) {
      throw new WarningError(`❌ Não consegui criar os pedidos: ${erroCriacao}`);
    }

    // Mensagem 1: comando enviado.
    await sendReply(
      `📤 *Comando Soprati enviado ao disparador!*\n` +
        `🖥️ *Dispositivo:* ${deviceNumber} (${device.deviceModel})\n` +
        `🎁 *Oferta:* ${NOME_OFERTA}\n` +
        `🔄 *Repetições:* ${vezes}x\n` +
        `📶 *SIM:* ${sim}\n\n` +
        (erroCriacao
          ? `⚠️ Só ${ids.length} de ${vezes} pedidos foram criados (${erroCriacao}).\n\n`
          : "") +
        `⏳ Pedidos na fila do aparelho. Aguardando processamento...`,
    );

    // Mensagem 2: relatório final, quando o último pedido terminar.
    // Roda em segundo plano para não prender o bot enquanto a fila anda.
    const timeoutMs = ids.length * ESPERA_POR_PEDIDO_MS + 5 * 60 * 1000;

    (async () => {
      const resultados = await Promise.all(
        ids.map((id) => aguardarResultado(central.centralCode, id, timeoutMs)),
      );

      let sucessos = 0;
      const motivos = new Map();

      for (const data of resultados) {
        const r = classificar(data);
        if (r.ok) {
          sucessos++;
        } else {
          const m = r.motivo.length > 90 ? `${r.motivo.slice(0, 90)}…` : r.motivo;
          motivos.set(m, (motivos.get(m) || 0) + 1);
        }
      }

      const falhas = ids.length - sucessos;

      await sendReply(
        `📊 *RELATÓRIO FINAL SOPRATI*\n` +
          `────────────────────────\n` +
          `🖥️ *Dispositivo:* ${deviceNumber} | 📶 *SIM:* ${sim}\n` +
          `🎁 *${NOME_OFERTA}*\n\n` +
          `✅ *Sucesso:* ${sucessos}/${vezes}\n` +
          `❌ *Falhas:* ${falhas + (vezes - ids.length)}\n` +
          (motivos.size
            ? `\n⚠️ *Motivos:*\n${[...motivos]
                .map(([m, n]) => `• ${m}${n > 1 ? ` (${n}x)` : ""}`)
                .join("\n")}\n`
            : "") +
          (falhas === 0 && !erroCriacao ? `\n🎉 Todos os disparos concluídos!` : ""),
      );
    })().catch((e) => console.error("[soprati] erro no relatório final:", e));
  },
};
