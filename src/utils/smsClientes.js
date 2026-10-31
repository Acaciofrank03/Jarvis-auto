// src/utils/smsClientes.js
import {
  CAMINHO_OFICIAIS,
  avisarGestao,
  chave,
  extrairIds,
  extrairValor,
  fmtMt,
  get,
  lerTabela,
  ref,
  remove,
  set,
  update,
  usarCarteira,
} from "./comprovativos.js";

const STATUS_DISPONIVEL = "DISPONIVEL";
const STATUS_USADO = "USADO";
const CAMPOS_TEXTO = ["raw_text", "rawText", "texto", "body"];
const RX_RECEBIDO = /receb(?:este|eu)|received/i;
const RX_PAGADOR = /(?:receb(?:este|eu)|received)\s+[\d.,]+\s*MT\s+(?:de|from)\s+(?:258)?(8[2-8]\d{7})(?!\d)/i;

const lerTexto = (r) => CAMPOS_TEXTO.map((c) => r?.[c]).find(Boolean) || "";
const nove = (x) => String(x || "").replace(/\D/g, "").replace(/^258(?=\d{9}$)/, "");
const valido = (n) => /^8[2-8]\d{7}$/.test(n);

export const censurar = (n) => {
  const s = nove(n);
  if (s.length === 9) {
    return s.slice(0, 3) + "***" + s.slice(-3);
  }
  return "***";
};

const caminhoNumero = (central, n) => "sms_clientes/" + central + "/" + n;

export async function numerosDoGrupo(central, grupo) {
  const todos = (await get(ref(null, "sms_clientes/" + central))).val() || {};
  return Object.entries(todos)
    .filter(([, v]) => v?.grupo === grupo)
    .sort((a, b) => (a[1].em || 0) - (b[1].em || 0) || a[0].localeCompare(b[0]))
    .map(([n]) => n);
}

export async function adicionarNumeros(central, grupo, tokens, por) {
  const resultados = [];
  const vistos = new Set();
  let i = 0;
  for (const token of tokens) {
    const numero = nove(token);
    if (!valido(numero)) {
      resultados.push({ token, estado: "invalido" });
      continue;
    }
    if (vistos.has(numero)) continue;
    vistos.add(numero);

    const atual = (await get(ref(null, caminhoNumero(central, numero)))).val();
    if (atual?.grupo === grupo) {
      resultados.push({ token, numero, estado: "ja" });
    } else if (atual?.grupo) {
      resultados.push({ token, numero, estado: "outro", grupo: atual.grupo });
    } else {
      await set(ref(null, caminhoNumero(central, numero)), { grupo, por: por || null, em: Date.now() + i++ });
      resultados.push({ token, numero, estado: "ok" });
    }
  }
  return resultados;
}

export async function removerNumeros(central, grupo, tokens) {
  const lista = await numerosDoGrupo(central, grupo);
  const resultados = [];
  const feitos = new Set();

  for (const token of tokens) {
    let numero;
    if (/^\d{1,4}$/.test(token)) {
      numero = lista[Number(token) - 1];
      if (!numero) {
        resultados.push({ token, estado: "nao_existe" });
        continue;
      }
    } else {
      numero = nove(token);
      if (!valido(numero)) {
        resultados.push({ token, estado: "invalido" });
        continue;
      }
      if (!lista.includes(numero)) {
        const atual = (await get(ref(null, caminhoNumero(central, numero)))).val();
        resultados.push({ token, numero, estado: atual?.grupo ? "outro" : "nao_existe" });
        continue;
      }
    }
    if (feitos.has(numero)) continue;
    feitos.add(numero);
    await remove(ref(null, caminhoNumero(central, numero)));
    resultados.push({ token, numero, estado: "removido" });
  }
  return resultados;
}

export function censurarEnvio(enviar, { central, grupo, jid, receptor }) {
  const pagador = String(jid).split("@")[0];
  const cens = censurar(receptor || pagador);

  return async (destino, texto, mencoes = []) => {
    if (destino !== grupo) return enviar(destino, texto, mencoes);

    let t = String(texto).split("@" + pagador).join(cens);

    if (receptor) t = t.split(receptor).join(cens);

    // Altera apenas o cabeçalho quando for pedido vindo de SMS
    if (t.includes("Pedido aprovado!")) {
      t = t.replace(
        /👻 🔔 \*Pedido aprovado!\*/,
        "📩 🔔 *Pedido SMS aprovado!*"
      );
    }

    const res = await enviar(destino, t, (mencoes || []).filter((m) => m !== jid));

    const msgId = res?.key?.id;
    if (msgId && t.includes("Pedido SMS aprovado!")) {
      await set(ref(null, "sms_pedidos/" + central + "/" + chave(msgId)), {
        jid,
        grupo,
        receptor: receptor || null,
        em: Date.now(),
      });
    }

    return res;
  };
}

export async function enviarDoPedido(central, msgId, enviar) {
  const reg = (await get(ref(null, "sms_pedidos/" + central + "/" + chave(msgId)))).val();
  if (!reg) return enviar;
  return censurarEnvio(enviar, { central, grupo: reg.grupo, jid: reg.jid, receptor: reg.receptor });
}

// ---------- pendências SMS ----------
export async function listarPendentesSms(central, grupo) {
  const pedidosSms = (await get(ref(null, "sms_pedidos/" + central))).val() || {};
  const lista = [];

  for (const [msgId, reg] of Object.entries(pedidosSms)) {
    if (reg.grupo !== grupo) continue;

    const ped = (await get(ref(null, "pedidos_aprovados/" + central + "/" + chave(msgId)))).val();
    if (!ped) continue;
    if (!["AGUARDANDO", "EM_ANDAMENTO"].includes(ped.status)) continue;

    lista.push({
      msgId,
      jid: ped.jid,
      valor: ped.valor,
      status: ped.status,
      ids: ped.ids || [],
      criadoEm: ped.criadoEm || reg.em || 0,
      receptor: reg.receptor || null,
    });
  }

  lista.sort((a, b) => a.criadoEm - b.criadoEm);
  return lista;
}

export async function limparPendentesSms(central, grupo, msgIdAlvo = null) {
  const pedidosSms = (await get(ref(null, "sms_pedidos/" + central))).val() || {};
  const removidos = [];

  for (const [msgId, reg] of Object.entries(pedidosSms)) {
    if (reg.grupo !== grupo) continue;
    if (msgIdAlvo && msgId !== msgIdAlvo) continue;

    const pedRef = ref(null, "pedidos_aprovados/" + central + "/" + chave(msgId));
    const ped = (await get(pedRef)).val();

    if (ped && ["AGUARDANDO", "EM_ANDAMENTO"].includes(ped.status)) {
      await update(pedRef, {
        status: "CANCELADO",
        atualizadoEm: Date.now(),
        canceladoPor: "SMS_LIMPAR",
      });
      removidos.push({ msgId, valor: ped.valor, statusAnterior: ped.status });
    }

    await remove(ref(null, "sms_pedidos/" + central + "/" + chave(msgId)));
  }

  return removidos;
}

const tipoDoId = (id) => (String(id).startsWith("PP") ? "e" : "m");

async function processarSms(central, snap, enviar) {
  const r = snap.val() || {};
  console.log("[SMS DEBUG] Novo item detetado na central " + central + ":", JSON.stringify(r));

  const texto = lerTexto(r);
  console.log("[SMS DEBUG] Texto extraído:", texto);

  if (!RX_RECEBIDO.test(texto)) return;
  if (r.status && r.status !== STATUS_DISPONIVEL) return;

  // Extrair pagador (só para informação)
  const pagador = texto.match(RX_PAGADOR)?.[1] || null;
  console.log("[SMS DEBUG] Pagador detetado:", pagador);

  // ===== NOVA LÓGICA: procurar receptor 84/85 registado =====
  const matchConteudo = texto.match(/(?:Conte[uú]do|Content)\s*:\s*(?:258)?(8[45]\d{7})/i);
  const matchesGeral = texto.match(/(?<!\d)(?:258)?(8[45]\d{7})(?!\d)/g) || [];

  const candidatos = [];
  if (matchConteudo?.[1]) candidatos.push(matchConteudo[1]);
  for (const n of matchesGeral) {
    const limpo = n.replace(/^258/, "");
    if (!candidatos.includes(limpo)) candidatos.push(limpo);
  }

  console.log("[SMS DEBUG] Candidatos 84/85 encontrados:", candidatos);

  let receptor = null;
  let reg = null;

  for (const num of candidatos) {
    const tent = (await get(ref(null, caminhoNumero(central, num)))).val();
    if (tent?.grupo) {
      receptor = num;
      reg = tent;
      break;
    }
  }

  console.log("[SMS DEBUG] Receptor registado encontrado:", receptor, reg);
  if (!receptor || !reg?.grupo) return;

  const grupo = reg.grupo;

  // ===== resto do processamento =====
  const id =
    extrairIds(texto)[0] ||
    (r.tx_id && r.tx_id !== "RECEBESTE" ? String(r.tx_id).toUpperCase() : null);
  if (!id) return;

  const pendentes = (await get(ref(null, "comprovantes_pendentes/" + central))).val() || {};
  if (Object.values(pendentes).some((p) => p.id === id || (p.ids || []).some((v) => v.id === id))) return;

  // TRAVA (versão segura)
  const caminhoStatus = CAMINHO_OFICIAIS(central) + "/" + snap.key + "/status";
  const trava = await ref(null, caminhoStatus).transaction((a) =>
    a === null || a === STATUS_DISPONIVEL ? STATUS_USADO : undefined,
  );
  if (!trava.committed) return;

  const jid = pagador ? "258" + pagador + "@sms" : "258" + receptor + "@sms";
  const valor = extrairValor(texto) ?? (Number(r.amount_mt) || null);
  console.log("[SMS DEBUG] Valor extraído:", valor);

  // RESERVA (versão segura)
  const caminhoReserva = "comprovantes_usados/" + central + "/" + chave(id);
  const reserva = await ref(null, caminhoReserva).transaction((a) =>
    a === null
      ? { id, valor, registadoPor: jid, origem: "SMS", usadoEm: Date.now(), status: "RESERVADO" }
      : undefined,
  );
  if (!reserva.committed) return;

  const marcar = (patch) => update(ref(null, caminhoReserva), patch);

  const enviarG = censurarEnvio(enviar, { central, grupo, jid, receptor });
  const cliente = censurar(pagador || receptor);

  const linhasGestao = (extra) => [
    "📩 SMS de " + (pagador || "desconhecido"),
    "🔎 ID: " + id,
    "💰 Valor: " + (valor != null ? fmtMt(valor) : "ilegível"),
    "📱 Número a receber: " + receptor,
    ...extra,
  ];

  if (!valor) {
    await marcar({ status: "MANUAL", motivo: "valor ilegível" });
    await avisarGestao(central, enviar, grupo, linhasGestao(["⚠️ Motivo: valor ilegível no SMS"]));
    return;
  }

  const tabela = (await lerTabela(grupo)) || {};
  const item = tabela[String(valor)];

  if (!item) {
    await marcar({ status: "MANUAL", motivo: "valor fora da tabela" });
    await enviar(
      grupo,
      [
        "📩 *Pagamento por SMS recebido!*",
        "",
        "🔎 ID: *" + id + "*",
        "📱 Cliente: *" + cliente + "*",
        "💰 Valor: *" + fmtMt(valor) + "*",
        "",
        "O valor não consta na tabela de preços.",
      ].join("\n"),
    );
    await avisarGestao(central, enviar, grupo, linhasGestao(["⚠️ Valor fora da tabela de preços."]));
    return;
  }

  // DISPARO IMEDIATO
  await marcar({ status: "PEDIDO" });
  console.log("[SMS DEBUG] A disparar pedido automático direto para o grupo " + grupo + "...");

  const res = await usarCarteira(central, {
    jid,
    remoteJid: grupo,
    valor,
    destinos: [{ numero: receptor, mb: null }],
    enviar: enviarG,
    auto: true,
    info: { vouchers: [{ id, tipo: tipoDoId(id), amount: valor, account: null }], sms: true },
  });

  if (res.erro) {
    console.error("[SMS DEBUG] Erro no retorno do usarCarteira:", res.erro);
    await avisarGestao(central, enviar, grupo, linhasGestao(["⚠️ Erro no disparo: " + res.erro]));
  } else {
    console.log("[SMS DEBUG] Pedido disparado com sucesso direto!");
  }
}

export function iniciarSms(central, enviar) {
  ref(null, CAMINHO_OFICIAIS(central))
    .limitToLast(50)
    .on("child_added", async (snap) => {
      try {
        await processarSms(central, snap, enviar);
      } catch (e) {
        console.error("[sms] erro ao processar o SMS:", e);
      }
    });
}