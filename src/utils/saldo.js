// src/utils/saldo.js
// .k [dispositivo] [número] [valor] (administrador)
// Pede à APK para transferir saldo via *111#. O aparelho indicado tem de estar em modo "Disparador de Saldo".
// Não mexe em carteira: o saldo é atendido à mão pelo administrador.
// O SIM é escolhido pelo limites.js (saldo e limite de cada chip): começa pelo SIM 1 e troca para o SIM 2.
// Os campos enviados à APK são um palpite a validar nos testes (megasAmount e valorPago = valor).
import {
  enviarComando,
  escutarStatusPedido,
  resolveDeviceByNumber,
} from "../services/firebase.js";
import { avisarGestao, fmtMt } from "./comprovativos.js";
import { reservarSimSaldo, devolverSimSaldo } from "./limites.js";

const TEMPO_APK_MS = 3 * 60 * 1000; // sem resposta do APK depois disto: avisa a gestão
const ESCUTA_MS = 30 * 60 * 1000; // continua a escutar (permite sucesso tardio)

export async function enviarSaldo(central, { remoteJid, dispositivo, numero, valor, enviar }) {
  const device = await resolveDeviceByNumber(central, dispositivo);
  if (!device) return { erro: `Dispositivo ${dispositivo} não encontrado.` };

  const aparelho = `${dispositivo}${device.deviceModel ? ` (${device.deviceModel})` : ""}`;

  // O limites.js decide o chip (0 = SIM 1, 1 = SIM 2) e desconta o saldo do SIM.
  const reserva = reservarSimSaldo(central, dispositivo, valor);
  if (reserva.erro) {
    return { erro: `Sem saldo ou limite no dispositivo ${dispositivo}: ${reserva.erro}` };
  }
  const sim = reserva.sim;

  let orderId;
  try {
    orderId = await enviarComando(central, {
      targetDeviceId: device.deviceId,
      clientePhone: numero,
      megasAmount: valor,
      valorPago: valor,
      ussdMethod: "*111#",
      isManual: true,
      targetSimSlot: sim, // 0 = SIM 1, 1 = SIM 2 (o APK usa 0-based)
    });
  } catch (e) {
    devolverSimSaldo(central, dispositivo, sim, valor);
    await avisarGestao(central, enviar, remoteJid, [
      `📱 Número: ${numero}`,
      `💰 Valor: ${fmtMt(valor)}`,
      `📟 Aparelho: ${aparelho} — SIM ${sim + 1}`,
      `⚠️ Motivo: ${String(e.message)}`,
    ]);
    return { ok: false };
  }

  await enviar(
    remoteJid,
    [
      "💳 *Pedido de saldo recebido!*",
      "",
      `📱 Número: *${numero}*`,
      `💰 Valor: *${fmtMt(valor)}*`,
      "",
      "⏳ O seu pedido foi recebido com sucesso!",
      "Aguarde enquanto o sistema realiza a transferência.",
      "Será notificado assim que estiver concluído. 🙏",
    ].join("\n"),
  );

  let concluido = false;
  let falhaTratada = false;
  let semResposta = false;

  // Silêncio do APK: só avisa a gestão. Não devolve o saldo do SIM, porque o envio pode ter sido feito.
  const timer = setTimeout(async () => {
    if (concluido || falhaTratada || semResposta) return;
    semResposta = true;
    try {
      await avisarGestao(central, enviar, remoteJid, [
        `📱 Número: ${numero}`,
        `💰 Valor: ${fmtMt(valor)}`,
        `📟 Aparelho: ${aparelho} — SIM ${sim + 1}`,
        `⚠️ Motivo: sem resposta do APK há ${TEMPO_APK_MS / 60000} min`,
        "Confirme no aparelho. Se o APK concluir depois, o cliente é avisado sozinho.",
      ]);
    } catch (e) {
      console.error("[saldo] erro no aviso de silêncio:", e);
    }
  }, TEMPO_APK_MS);

  let parar = () => {};
  parar = escutarStatusPedido(
    central,
    orderId,
    async (st) => {
      if (concluido) return;
      try {
        if (st.status === "SUCESSO" || st.status === "CONCLUIDO") {
          concluido = true; // vale mesmo depois de silêncio ou falha
          clearTimeout(timer);
          const resposta = String(st.ussdResponseText || "").replace(/\s*\n\s*/g, " ").trim();
          await enviar(
            remoteJid,
            [
              "✅ *Saldo enviado com sucesso!*",
              "",
              `📱 Número: *${numero}*`,
              `💰 Valor: *${fmtMt(valor)}*`,
              ...(resposta ? [`📲 ${resposta}`] : []),
              "",
              "🎉 Obrigado pela preferência! 🙏",
            ].join("\n"),
          );
          parar();
        } else if (st.status === "FALHA" || st.status === "ERRO") {
          clearTimeout(timer);
          if (falhaTratada) return;
          falhaTratada = true;
          // Falha de verdade: o saldo volta ao SIM.
          devolverSimSaldo(central, dispositivo, sim, valor);
          await avisarGestao(central, enviar, remoteJid, [
            `📱 Número: ${numero}`,
            `💰 Valor: ${fmtMt(valor)}`,
            `📟 Aparelho: ${aparelho} — SIM ${sim + 1}`,
            `⚠️ Motivo: ${st.motivoErro || "desconhecido"}`,
            "↩️ O saldo voltou ao SIM no controlo de limites.",
          ]);
        }
      } catch (e) {
        console.error("[saldo] erro ao tratar o status do saldo:", e);
      }
    },
    ESCUTA_MS,
  );

  return { ok: true };
}
