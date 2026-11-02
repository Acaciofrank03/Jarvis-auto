/**
 * Serviço de comunicação com o Firebase Realtime Database.
 * Usado para trocar comandos e status com o app Android (disparador USSD).
 *
 * @author Jarvis Bot
 */
import { initializeApp, cert } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVICE_ACCOUNT_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "firebase-service-account.json"
);

const DATABASE_URL = "https://jarvis-bot258-default-rtdb.firebaseio.com";

let app = null;
let db = null;

/**
 * Inicializa a conexão com o Firebase.
 * Deve ser chamado uma única vez, no início do bot (src/index.js).
 */
export function initFirebase() {
  if (app) return app;

  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    throw new Error(
      `Credencial do Firebase não encontrada em: ${SERVICE_ACCOUNT_PATH}`
    );
  }

  const serviceAccount = JSON.parse(
    fs.readFileSync(SERVICE_ACCOUNT_PATH, "utf8")
  );

  app = initializeApp({
    credential: cert(serviceAccount),
    databaseURL: DATABASE_URL,
  });

  db = getDatabase(app);

  return app;
}

function getDb() {
  if (!db) {
    initFirebase();
  }
  return db;
}

/**
 * Envia um comando de venda/disparo para o app processar via USSD.
 *
 * @param {string} centralCode - Código da central (ex: "VD-744572")
 * @param {object} orderData - Dados do pedido (clientePhone, megasAmount, etc)
 * @returns {Promise<string>} ID do pedido criado
 */
export async function enviarComando(centralCode, orderData) {
  const database = getDb();

  const ref = database.ref(`device_pairings/${centralCode}/vendas_pendentes`).push();

  await ref.set({
    id: ref.key,
    ...orderData,
    status: "PENDENTE",
    timestamp: Date.now(),
  });

  return ref.key;
}

/**
 * Escuta a mudança de status de um pedido específico até ele ser concluído
 * (ou até o tempo limite passar).
 *
 * @param {string} centralCode
 * @param {string} orderId
 * @param {(data: object) => void} onUpdate - Chamado sempre que o status mudar
 * @param {number} timeoutMs - Tempo máximo de espera (padrão: 2 minutos)
 */
export function escutarStatusPedido(centralCode, orderId, onUpdate, timeoutMs = 120000) {
  const database = getDb();
  const ref = database.ref(`device_pairings/${centralCode}/vendas_pendentes/${orderId}`);

  const listener = ref.on("value", (snapshot) => {
    const data = snapshot.val();
    if (data) {
      onUpdate(data);
    }
  });

  const timeout = setTimeout(() => {
    ref.off("value", listener);
  }, timeoutMs);

  return () => {
    clearTimeout(timeout);
    ref.off("value", listener);
  };
}

/**
 * Busca os dados de uma licença principal (app_licenses) pela chave.
 *
 * @param {string} licenseKey
 * @returns {Promise<object|null>}
 */
export async function getLicense(licenseKey) {
  const database = getDb();
  const snapshot = await database.ref(`app_licenses/${licenseKey}`).get();
  return snapshot.exists() ? snapshot.val() : null;
}

/**
 * Busca os dados de uma licença Soprati pela chave.
 *
 * @param {string} sopratiKey
 * @returns {Promise<object|null>}
 */
export async function getSopratiLicense(sopratiKey) {
  const database = getDb();
  const snapshot = await database.ref(`soprati_licenses/${sopratiKey}`).get();
  return snapshot.exists() ? snapshot.val() : null;
}

/**
 * Ativa uma licença Soprati, associando-a a uma central.
 *
 * @param {string} sopratiKey
 * @param {string} centralCode
 * @param {number} durationDays
 */
export async function activateSopratiLicense(sopratiKey, centralCode, durationDays = 30) {
  const database = getDb();
  const now = Date.now();
  const expiresAt = now + durationDays * 24 * 60 * 60 * 1000;

  await database.ref(`soprati_licenses/${sopratiKey}`).set({
    centralCode,
    activatedAt: now,
    expiresAt,
    durationDays,
  });

  return { centralCode, activatedAt: now, expiresAt, durationDays };
}

/**
 * Verifica se uma licença Soprati está ativa (existe e não expirou)
 * para uma central específica.
 *
 * @param {string} centralCode
 * @returns {Promise<object|null>} Retorna os dados da licença se ativa, ou null
 */
export async function checkSopratiLicenseForCentral(centralCode) {
  const database = getDb();
  const snapshot = await database
    .ref("soprati_licenses")
    .orderByChild("centralCode")
    .equalTo(centralCode)
    .get();

  if (!snapshot.exists()) return null;

  const licenses = snapshot.val();
  const keys = Object.keys(licenses);

  for (const key of keys) {
    const license = licenses[key];
    if (license.expiresAt > Date.now()) {
      return { key, ...license };
    }
  }

  return null;
}

function randomChars(length) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem O, 0, I, 1
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/**
 * Gera uma nova chave de licença Soprati, ainda sem central vinculada.
 *
 * @param {number} durationDays
 * @returns {Promise<string>} A chave gerada
 */
export async function createSopratiLicense(durationDays = 30) {
  const database = getDb();
  const key = `SOPRATI-${randomChars(4)}-${randomChars(4)}`;

  await database.ref(`soprati_licenses/${key}`).set({
    durationDays,
    createdAt: Date.now(),
  });

  return key;
}
/**
 * Gera uma nova licença principal do app (PRO_APP), já ativa.
 *
 * @param {number} durationDays
 * @param {string} clientName
 * @returns {Promise<{key: string, expiresAt: number}>}
 */
export async function createAppLicense(durationDays = 30, clientName = "Cliente") {
  const database = getDb();
  const key = `JARVIS-${randomChars(4)}-${randomChars(4)}`;
  const now = Date.now();
  const expiresAt = now + durationDays * 24 * 60 * 60 * 1000;

  await database.ref(`app_licenses/${key}`).set({
    type: "PRO_APP",
    status: "ATIVO",
    expires_at: expiresAt,
    client_name: clientName,
  });

  return { key, expiresAt };
}

  const ROLE_LABELS = {
  TUDO_EM_UM: "Tudo-em-Um",
  RECEBER_PAGAMENTOS: "Receber Pagamentos (SMS)",
  DISPARADOR_SALDO: "Disparador de Saldo (*111#)",
  DISPARADOR_MEGAS: "Disparador de Megas (*162#)",
};

/**
 * Retorna a lista numerada de aparelhos de uma central (principal + pareados),
 * na mesma ordem sempre (principal primeiro, depois pareados por data de aprovação).
 *
 * @param {string} centralCode
 * @returns {Promise<Array<{numero: number, deviceId: string, deviceModel: string, role: string, isMaster: boolean}>>}
 */
export async function getDeviceList(centralCode) {
  const database = getDb();
  const infoSnap = await database.ref(`device_pairings/${centralCode}/info`).get();
  const pairedSnap = await database.ref(`device_pairings/${centralCode}/paired_devices`).get();

  const list = [];

  if (infoSnap.exists()) {
    const info = infoSnap.val();
    list.push({
      deviceId: info.masterDeviceId || "principal",
      deviceModel: info.masterDeviceModel || "Desconhecido",
      role: ROLE_LABELS[info.deviceRole] || "Principal",
      isMaster: true,
    });
  }

  if (pairedSnap.exists()) {
    const paired = pairedSnap.val();
    const workers = Object.entries(paired)
      .map(([deviceId, data]) => ({
        deviceId,
        deviceModel: data.deviceModel || "Desconhecido",
        role: ROLE_LABELS[data.deviceRole] || data.deviceRole || "Desconhecido",
        isMaster: false,
        approvedAt: data.approvedAt || 0,
      }))
      .sort((a, b) => a.approvedAt - b.approvedAt);

    list.push(...workers);
  }

  return list.map((item, index) => ({ numero: index + 1, ...item }));
}

/**
 * Resolve um número de aparelho (1, 2, 3...) para o deviceId real.
 *
 * @param {string} centralCode
 * @param {number} numero
 * @returns {Promise<{deviceId: string, deviceModel: string, role: string}|null>}
 */
export async function resolveDeviceByNumber(centralCode, numero) {
  const list = await getDeviceList(centralCode);
  return list.find((d) => d.numero === numero) || null;
}

/**
 * Escuta novos aparelhos pareados em uma central.
 * Chama onNewDevice sempre que um dispositivo novo for adicionado.
 *
 * @param {string} centralCode
 * @param {(deviceId: string, data: object) => void} onNewDevice
 * @returns {() => void} Função para parar o listener
 */
export function watchNewDevices(centralCode, onNewDevice) {
  const database = getDb();
  const ref = database.ref(`device_pairings/${centralCode}/paired_devices`);

  // Guarda os que já existiam para não notificar os antigos
  let conhecidos = new Set();

  // Primeiro carrega os atuais sem notificar
  ref.once("value", (snap) => {
    const val = snap.val() || {};
    conhecidos = new Set(Object.keys(val));
  });

  const listener = ref.on("child_added", (snap) => {
    const deviceId = snap.key;
    if (conhecidos.has(deviceId)) return; // já existia

    conhecidos.add(deviceId);
    onNewDevice(deviceId, snap.val());
  });

  return () => ref.off("child_added", listener);
}
/**
 * Renova uma central: o novo prazo SUBSTITUI o atual (não soma).
 * @param {string} centralCode
 * @param {"app"|"soprati"} tipo
 * @param {number} days
 */
export async function renovarCentral(centralCode, tipo, days) {
  const database = getDb();
  const novoPrazo = Date.now() + days * 24 * 60 * 60 * 1000;
  const updates = {};
  const alterados = [];

  if (tipo === "soprati") {
    const snap = await database.ref("soprati_licenses").get();
    for (const [key, l] of Object.entries(snap.val() || {})) {
      if (l.centralCode !== centralCode) continue;
      updates[`soprati_licenses/${key}/expiresAt`] = novoPrazo;
      updates[`soprati_licenses/${key}/durationDays`] = days;
      alterados.push(key);
    }
  } else {
    const aparelhos = new Set((await getDeviceList(centralCode)).map((d) => d.deviceId));
    const snap = await database.ref("app_licenses").get();
    for (const [key, l] of Object.entries(snap.val() || {})) {
      const ids = Object.keys(l.activatedDevices || {});
      const ligada = l.centralCode === centralCode || ids.some((id) => aparelhos.has(id));
      if (!ligada) continue;
      updates[`app_licenses/${key}/expiresAt`] = novoPrazo;
      updates[`app_licenses/${key}/expires_at`] = novoPrazo;
      updates[`app_licenses/${key}/status`] = "ATIVO";
      for (const id of ids) updates[`app_licenses/${key}/activatedDevices/${id}/expiresAt`] = novoPrazo;
      alterados.push(key);
    }
  }

  if (!alterados.length) return null;
  updates[`license_key/${centralCode}/${tipo}_license/expiresAt`] = novoPrazo;
  updates[`license_key/${centralCode}/${tipo}_license/status`] = "ATIVO";
  await database.ref().update(updates); // atómico
  return { novoPrazo, alterados };
}

/**
 * Lista os clientes (licenças do app) e as licenças Soprati, com a central de cada um.
 * Se a licença não tiver centralCode, tenta descobrir a central pelo aparelho ativado.
 */
export async function listarClientes() {
  const database = getDb();
  const [appSnap, sopSnap, mastersSnap] = await Promise.all([
    database.ref("app_licenses").get(),
    database.ref("soprati_licenses").get(),
    database.ref("device_masters").get(),
  ]);
  const masters = mastersSnap.val() || {};

  const app = Object.entries(appSnap.val() || {}).map(([key, l]) => {
    const ids = Object.keys(l.activatedDevices || {});
    const central = l.centralCode || ids.map((id) => masters[id]).find(Boolean) || null;
    return {
      key,
      nome: l.client_name || "Cliente",
      central,
      expiresAt: l.expiresAt || l.expires_at || 0,
      ativada: ids.length > 0,
    };
  });

  const soprati = Object.entries(sopSnap.val() || {}).map(([key, l]) => ({
    key,
    central: l.centralCode || null,
    expiresAt: l.expiresAt || 0,
  }));

  return { app, soprati };
}

/**
 * Muda o nome do cliente em todas as licenças do app ligadas a uma central.
 * @param {string} centralCode
 * @param {string} novoNome
 * @returns {Promise<{alteradas: string[]}|null>}
 */
export async function renomearCliente(centralCode, novoNome) {
  const database = getDb();
  const aparelhos = new Set((await getDeviceList(centralCode)).map((d) => d.deviceId));
  const snap = await database.ref("app_licenses").get();
  const updates = {};
  const alteradas = [];

  for (const [key, l] of Object.entries(snap.val() || {})) {
    const ids = Object.keys(l.activatedDevices || {});
    const ligada = l.centralCode === centralCode || ids.some((id) => aparelhos.has(id));
    if (!ligada) continue;
    updates[`app_licenses/${key}/client_name`] = novoNome;
    alteradas.push(key);
  }

  if (!alteradas.length) return null;
  updates[`license_key/${centralCode}/nome`] = novoNome;
  await database.ref().update(updates); // atómico
  return { alteradas };
}
export { getDb };

/**
 * Prazo da licença do app de uma central (o maior expiresAt entre as ligadas a ela).
 * @param {string} centralCode
 * @param {string[]} deviceIds - aparelhos da central (acha licenças sem centralCode)
 * @returns {Promise<number|null>} expiresAt em ms, ou null se não houver licença
 */
export async function getPrazoApp(centralCode, deviceIds = []) {
  const database = getDb();
  const snap = await database.ref("app_licenses").get();
  const ids = new Set(deviceIds);
  let prazo = null;
  for (const l of Object.values(snap.val() || {})) {
    const ativados = Object.keys(l.activatedDevices || {});
    const ligada = l.centralCode === centralCode || ativados.some((id) => ids.has(id));
    if (!ligada) continue;
    const e = Number(l.expiresAt ?? l.expires_at) || 0;
    if (e && (prazo === null || e > prazo)) prazo = e;
  }
  return prazo;
}

/**
 * Prazo da licença Soprati de uma central (mesmo vencida). null se nunca existiu.
 * @param {string} centralCode
 * @returns {Promise<number|null>}
 */
export async function getPrazoSoprati(centralCode) {
  const database = getDb();
  const snap = await database
    .ref("soprati_licenses")
    .orderByChild("centralCode")
    .equalTo(centralCode)
    .get();
  let prazo = null;
  for (const l of Object.values(snap.val() || {})) {
    const e = Number(l.expiresAt) || 0;
    if (e && (prazo === null || e > prazo)) prazo = e;
  }
  return prazo;
}
