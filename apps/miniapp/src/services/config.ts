export const API_BASE_URL = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL || "https://example.com");
export const WS_URL = import.meta.env.VITE_WS_URL || "wss://example.com/pvp-ws";
export const REWARD_AD_UNIT_ID = import.meta.env.VITE_REWARD_AD_UNIT_ID || "";

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}
