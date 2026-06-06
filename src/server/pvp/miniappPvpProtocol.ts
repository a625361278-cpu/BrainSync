import type { AuthService } from "../account/authService";
import type { GameRoom } from "../game/room";
import type { GameType, RoomSnapshot } from "../../shared/types";

export interface MiniappPvpProtocolOptions {
  auth: AuthService;
  rooms: Map<string, GameRoom>;
  createRoomCode: () => string;
  createRoom: (code: string) => GameRoom;
  send: (clientId: string, message: MiniappPvpServerMessage) => void;
  broadcast: (roomCode: string, snapshot: RoomSnapshot) => void;
  bindClientToRoom?: (clientId: string, roomCode: string) => void;
  unbindClientFromRoom?: (clientId: string, roomCode: string) => void;
  scheduleRoundTimers?: (roomCode: string) => void;
  clearRoomTimersIfEmpty?: (roomCode: string, snapshot: RoomSnapshot) => void;
}

export interface MiniappPvpClientMessage {
  type: "createRoom" | "joinRoom" | "startGame" | "sendMessage" | "leaveRoom";
  requestId?: string;
  payload?: Record<string, unknown>;
}

export type MiniappPvpServerMessage =
  | { type: "ack"; requestId?: string; ok: true; payload?: Record<string, unknown> }
  | { type: "ack"; requestId?: string; ok: false; error: string }
  | { type: "roomSnapshot"; payload: RoomSnapshot };

interface ClientState {
  roomCode?: string;
  playerId?: string;
}

export interface MiniappPvpProtocol {
  handle(clientId: string, message: MiniappPvpClientMessage): Promise<void>;
  disconnect(clientId: string): void;
}

export function createMiniappPvpProtocol(options: MiniappPvpProtocolOptions): MiniappPvpProtocol {
  const clientStates = new Map<string, ClientState>();

  async function handle(clientId: string, message: MiniappPvpClientMessage): Promise<void> {
    try {
      const payload = message.payload ?? {};
      if (message.type === "createRoom") {
        const user = await requireUser(payload.token);
        const code = createUniqueRoomCode(options.createRoomCode, options.rooms);
        const room = options.createRoom(code);
        options.rooms.set(code, room);
        const player = room.join(user.nickname, undefined, user.avatarUrl, user.id);
        clientStates.set(clientId, { roomCode: code, playerId: player.id });
        options.bindClientToRoom?.(clientId, code);
        const snapshot = room.snapshot();
        options.broadcast(code, snapshot);
        ack(clientId, message.requestId, { room: snapshot, playerId: player.id });
        return;
      }
      if (message.type === "joinRoom") {
        const user = await requireUser(payload.token);
        const roomCode = requireString(payload.roomCode, "房间号不能为空");
        const room = requireRoom(roomCode);
        const player = room.join(user.nickname, optionalString(payload.playerId), user.avatarUrl, user.id);
        clientStates.set(clientId, { roomCode, playerId: player.id });
        options.bindClientToRoom?.(clientId, roomCode);
        const snapshot = room.snapshot();
        options.broadcast(roomCode, snapshot);
        ack(clientId, message.requestId, { room: snapshot, playerId: player.id });
        return;
      }
      if (message.type === "startGame") {
        const roomCode = requireString(payload.roomCode, "房间号不能为空");
        const room = requireRoom(roomCode);
        room.start(requireGameType(payload.gameType), requireString(payload.playerId, "玩家ID不能为空"));
        options.scheduleRoundTimers?.(roomCode);
        const snapshot = room.snapshot();
        options.broadcast(roomCode, snapshot);
        ack(clientId, message.requestId, { room: snapshot });
        return;
      }
      if (message.type === "sendMessage") {
        const roomCode = requireString(payload.roomCode, "房间号不能为空");
        const room = requireRoom(roomCode);
        const result = room.submitMessage(requireString(payload.playerId, "玩家ID不能为空"), requireString(payload.text, "消息不能为空"));
        if (result.hit) {
          options.scheduleRoundTimers?.(roomCode);
        }
        const snapshot = room.snapshot();
        options.broadcast(roomCode, snapshot);
        ack(clientId, message.requestId, { room: snapshot });
        return;
      }
      if (message.type === "leaveRoom") {
        const roomCode = requireString(payload.roomCode, "房间号不能为空");
        const playerId = requireString(payload.playerId, "玩家ID不能为空");
        const state = clientStates.get(clientId);
        if (state?.roomCode !== roomCode || state.playerId !== playerId) {
          throw new Error("离开房间状态异常：当前连接不在该房间");
        }
        const room = requireRoom(roomCode);
        room.leave(playerId);
        const snapshot = room.snapshot();
        options.clearRoomTimersIfEmpty?.(roomCode, snapshot);
        options.broadcast(roomCode, snapshot);
        options.unbindClientFromRoom?.(clientId, roomCode);
        clientStates.delete(clientId);
        ack(clientId, message.requestId);
        return;
      }
      throw new Error(`未知PVP消息类型：${(message as { type?: string }).type ?? ""}`);
    } catch (error) {
      options.send(clientId, {
        type: "ack",
        requestId: message.requestId,
        ok: false,
        error: error instanceof Error ? error.message : "未知错误"
      });
    }
  }

  function disconnect(clientId: string): void {
    const state = clientStates.get(clientId);
    clientStates.delete(clientId);
    if (!state?.roomCode || !state.playerId) {
      return;
    }
    const room = options.rooms.get(state.roomCode);
    if (!room) {
      return;
    }
    room.leave(state.playerId);
    const snapshot = room.snapshot();
    options.clearRoomTimersIfEmpty?.(state.roomCode, snapshot);
    options.broadcast(state.roomCode, snapshot);
    options.unbindClientFromRoom?.(clientId, state.roomCode);
  }

  function ack(clientId: string, requestId?: string, payload?: Record<string, unknown>): void {
    options.send(clientId, { type: "ack", requestId, ok: true, payload });
  }

  function requireRoom(roomCode: string): GameRoom {
    const normalized = roomCode.trim();
    const room = options.rooms.get(normalized);
    if (!room) {
      throw new Error(`房间不存在：${normalized}`);
    }
    return room;
  }

  async function requireUser(token: unknown) {
    const cleanToken = requireString(token, "未登录");
    return options.auth.requireUserByToken(cleanToken);
  }

  return { handle, disconnect };
}

function createUniqueRoomCode(createRoomCode: () => string, rooms: Map<string, GameRoom>): string {
  for (let i = 0; i < 20; i += 1) {
    const code = createRoomCode().trim();
    if (code && !rooms.has(code)) {
      return code;
    }
  }
  throw new Error("房间号生成失败");
}

function requireString(value: unknown, errorMessage: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    throw new Error(errorMessage);
  }
  return text;
}

function optionalString(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

function requireGameType(value: unknown): GameType {
  if (value === "idiom" || value === "song" || value === "silhouette" || value === "movie") {
    return value;
  }
  throw new Error(`游戏类型异常：${String(value)}`);
}
