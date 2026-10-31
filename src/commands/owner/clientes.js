import { PREFIX } from "../../config.js";
import { listarClientes } from "../../services/firebase.js";

const fmt = (ms) =>
  new Date(ms).toLocaleDateString("pt-PT", { timeZone: "Africa/Maputo" });
const estado = (ms) => (ms > Date.now() ? `✅ até ${fmt(ms)}` : `❌ expirou ${fmt(ms)}`);

export default {
  name: "clientes",
  description: "Lista os clientes e a central de cada um.",
  commands: ["clientes"],
  usage: `${PREFIX}clientes`,
  handle: async ({ sendReply }) => {
    const { app, soprati } = await listarClientes();

    if (!app.length && !soprati.length) {
      await sendReply("Nenhum cliente registado.");
      return;
    }

    const lista = [...app].sort(
      (a, b) =>
        (a.central || "~").localeCompare(b.central || "~") ||
        a.nome.localeCompare(b.nome),
    );

    let txt = `👥 *Clientes* (${lista.length})\n────────────────────────\n`;
    lista.forEach((c, i) => {
      txt +=
        `${i + 1}. *${c.nome}*\n` +
        `   Central: ${c.central || "—"}\n` +
        `   App: ${c.ativada ? estado(c.expiresAt) : "⏳ aguardando ativação"}\n`;
    });

    if (soprati.length) {
      txt += `\n🔷 *Soprati*\n`;
      [...soprati]
        .sort((a, b) => (a.central || "~").localeCompare(b.central || "~"))
        .forEach((s) => {
          txt += `• ${s.central || "—"}: ${s.expiresAt ? estado(s.expiresAt) : "⏳ aguardando ativação"}\n`;
        });
    }

    await sendReply(txt.trim());
  },
};
