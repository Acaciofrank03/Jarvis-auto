/**
 * Grupo de gestão de cada central: recebe todas as falhas e avisos técnicos.
 * Guardado no Firebase em central_config/{central}/gestao (o id do grupo, texto).
 * Sem grupo de gestão definido, os avisos técnicos não vão a lugar nenhum.
 * As leituras são síncronas (cópia em memória, em centralConfig.js).
 */
import { getConfig, setConfig, removeConfig } from "./centralConfig.js";

const CAMPO = "gestao";

export const getGestao = (central) => getConfig(central, CAMPO) || null;

export function setGestao(central, groupId) {
  setConfig(central, CAMPO, groupId);
}

// Devolve true se havia um grupo de gestão para remover.
export function removeGestao(central) {
  return removeConfig(central, CAMPO);
}
