import { initFirebase } from "./src/services/firebase.js";
import { getDatabase } from "firebase-admin/database";

initFirebase();
const db = getDatabase();

const centralCode = "VD-966417";

const info = await db.ref(`device_pairings/${centralCode}/info`).get();
console.log("INFO:", JSON.stringify(info.val(), null, 2));

const vendas = await db.ref(`device_pairings/${centralCode}/vendas_pendentes`).get();
console.log("VENDAS:", JSON.stringify(vendas.val(), null, 2));

process.exit(0);
