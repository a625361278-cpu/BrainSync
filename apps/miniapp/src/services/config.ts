export const API_BASE_URL = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL || "https://like2022.online");
export const WS_URL = import.meta.env.VITE_WS_URL || "wss://like2022.online/pvp-ws";
export const REWARD_AD_UNIT_ID = import.meta.env.VITE_REWARD_AD_UNIT_ID || "";

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}
