const TOKEN_KEY = "brainsync.miniapp.token";
const PLAYER_ID_KEY = "brainsync.miniapp.playerId";

export function readToken(): string {
  return String(uni.getStorageSync(TOKEN_KEY) || "");
}

export function writeToken(token: string): void {
  uni.setStorageSync(TOKEN_KEY, token);
}

export function clearToken(): void {
  uni.removeStorageSync(TOKEN_KEY);
}

export function readPlayerId(): string {
  return String(uni.getStorageSync(PLAYER_ID_KEY) || "");
}

export function writePlayerId(playerId: string): void {
  uni.setStorageSync(PLAYER_ID_KEY, playerId);
}
