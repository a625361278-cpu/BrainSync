const TOKEN_KEY = "brainsync.miniapp.token";
const LEGACY_PLAYER_ID_KEY = "brainsync.miniapp.playerId";
const PLAYER_ID_PREFIX = "brainsync.miniapp.playerId.";

export function readToken(): string {
  return String(uni.getStorageSync(TOKEN_KEY) || "");
}

export function writeToken(token: string): void {
  uni.setStorageSync(TOKEN_KEY, token);
}

export function clearToken(): void {
  uni.removeStorageSync(TOKEN_KEY);
}

export function readPlayerId(roomCode: string): string {
  const normalized = roomCode.trim();
  if (!normalized) {
    return "";
  }
  return String(uni.getStorageSync(`${PLAYER_ID_PREFIX}${normalized}`) || "");
}

export function writePlayerId(roomCode: string, playerId: string): void {
  const normalized = roomCode.trim();
  const normalizedPlayerId = playerId.trim();
  if (!normalized || !normalizedPlayerId) {
    return;
  }
  uni.setStorageSync(`${PLAYER_ID_PREFIX}${normalized}`, normalizedPlayerId);
}

export function clearPlayerId(roomCode: string): void {
  const normalized = roomCode.trim();
  if (!normalized) {
    return;
  }
  uni.removeStorageSync(`${PLAYER_ID_PREFIX}${normalized}`);
}

export function clearLegacyPlayerId(): void {
  uni.removeStorageSync(LEGACY_PLAYER_ID_KEY);
}
