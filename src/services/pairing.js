import { getDatabase } from "firebase-admin/database";
import { initFirebase } from "./firebase.js";

function db() {
  return getDatabase(initFirebase());
}

export async function centralExists(centralCode) {
  const snap = await db().ref(`device_pairings/${centralCode}/info`).get();
  return snap.exists();
}

export async function createGroupRequest(centralCode, data) {
  const ref = db().ref(`device_pairings/${centralCode}/group_requests`).push();
  const requestId = ref.key;

  await ref.set({
    ...data,
    requestId,
    status: "PENDENTE",
    timestamp: Date.now(),
  });

  return requestId;
}

export function watchGroupRequest(centralCode, requestId, onChange, timeoutMs = 600000) {
  const ref = db().ref(
    `device_pairings/${centralCode}/group_requests/${requestId}`,
  );

  let stop = () => {};

  const listener = ref.on("value", (snap) => {
    const data = snap.val();
    if (!data || data.status === "PENDENTE") return;
    stop();
    onChange(data);
  });

  const timer = setTimeout(() => {
    stop();
    onChange({ status: "EXPIRADO" });
  }, timeoutMs);

  stop = () => {
    clearTimeout(timer);
    ref.off("value", listener);
  };

  return stop;
}
