import { initFirebase, getLicense } from "./src/services/firebase.js";

console.log("Testando conexão com Firebase...");

try {
  initFirebase();
  console.log("✅ Conectado com sucesso!");

  const license = await getLicense("JARVIS-8K2F-9QTX");

  if (license) {
    console.log("✅ Licença encontrada:", license);
  } else {
    console.log("⚠️ Licença não encontrada (mas a conexão funcionou).");
  }

  process.exit(0);
} catch (error) {
  console.error("❌ Erro:", error.message);
  process.exit(1);
}
