import { existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server } from "socket.io";
import { createGameRoom, type GameRoom } from "./game/room";
import { loadGameData } from "./data/loadData";
import type { GameType, RoomSnapshot } from "../shared/types";

interface ClientJoinPayload {
  roomCode: string;
  name: string;
  playerId?: string;
}

interface ClientCreatePayload {
  name: string;
}

interface ClientStartPayload {
  roomCode: string;
  gameType: GameType;
}

interface ClientMessagePayload {
  roomCode: string;
  playerId: string;
  text: string;
}

interface AckPayload {
  ok: boolean;
  room?: RoomSnapshot;
  playerId?: string;
  error?: string;
}

const PORT = Number(process.env.PORT ?? 3000);
const ROUND_SECONDS = Number(process.env.ROUND_SECONDS ?? 30);
const data = loadGameData();
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: true,
    credentials: false
  }
});

const rooms = new Map<string, GameRoom>();
const timers = new Map<string, NodeJS.Timeout>();

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const distPath = [
  path.resolve(process.cwd(), "dist"),
  path.resolve(serverDir, "../dist"),
  path.resolve(serverDir, "../../dist")
].find((candidate) => existsSync(candidate));
if (distPath) {
  app.use(express.static(distPath));
  app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
}

io.on("connection", (socket) => {
  socket.on("createRoom", (payload: ClientCreatePayload, ack?: (payload: AckPayload) => void) => {
    handleAck(ack, () => {
      const code = createUniqueRoomCode();
      const room = createGameRoom({ code, idioms: data.idioms, songs: data.songs, roundSeconds: ROUND_SECONDS });
      rooms.set(code, room);
      const player = room.join(payload.name);
      socket.join(socketRoom(code));
      socket.data.roomCode = code;
      socket.data.playerId = player.id;
      const snapshot = room.snapshot();
      emitRoom(code, snapshot);
      return { ok: true, room: snapshot, playerId: player.id };
    });
  });

  socket.on("joinRoom", (payload: ClientJoinPayload, ack?: (payload: AckPayload) => void) => {
    handleAck(ack, () => {
      const room = requireRoom(payload.roomCode);
      const player = room.join(payload.name, payload.playerId);
      socket.join(socketRoom(payload.roomCode));
      socket.data.roomCode = payload.roomCode;
      socket.data.playerId = player.id;
      const snapshot = room.snapshot();
      emitRoom(payload.roomCode, snapshot);
      return { ok: true, room: snapshot, playerId: player.id };
    });
  });

  socket.on("startGame", (payload: ClientStartPayload, ack?: (payload: AckPayload) => void) => {
    handleAck(ack, () => {
      const room = requireRoom(payload.roomCode);
      room.start(payload.gameType);
      scheduleRoundTimeout(payload.roomCode);
      const snapshot = room.snapshot();
      emitRoom(payload.roomCode, snapshot);
      return { ok: true, room: snapshot };
    });
  });

  socket.on("sendMessage", (payload: ClientMessagePayload, ack?: (payload: AckPayload) => void) => {
    handleAck(ack, () => {
      const room = requireRoom(payload.roomCode);
      room.submitMessage(payload.playerId, payload.text);
      scheduleRoundTimeout(payload.roomCode);
      const snapshot = room.snapshot();
      emitRoom(payload.roomCode, snapshot);
      return { ok: true, room: snapshot };
    });
  });

  socket.on("disconnect", () => {
    const roomCode = socket.data.roomCode as string | undefined;
    const playerId = socket.data.playerId as string | undefined;
    if (!roomCode || !playerId) {
      return;
    }
    const room = rooms.get(roomCode);
    if (!room) {
      return;
    }
    room.leave(playerId);
    emitRoom(roomCode, room.snapshot());
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`BrainSync party games listening on http://localhost:${PORT}`);
});

function handleAck(ack: ((payload: AckPayload) => void) | undefined, action: () => AckPayload): void {
  try {
    ack?.(action());
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    ack?.({ ok: false, error: message });
  }
}

function requireRoom(code: string): GameRoom {
  const normalized = code.trim().toUpperCase();
  const room = rooms.get(normalized);
  if (!room) {
    throw new Error(`房间不存在：${normalized}`);
  }
  return room;
}

function createUniqueRoomCode(): string {
  for (let i = 0; i < 20; i += 1) {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    if (!rooms.has(code)) {
      return code;
    }
  }
  throw new Error("房间号生成失败");
}

function socketRoom(code: string): string {
  return `room:${code.trim().toUpperCase()}`;
}

function emitRoom(code: string, snapshot: RoomSnapshot): void {
  io.to(socketRoom(code)).emit("roomSnapshot", snapshot);
}

function scheduleRoundTimeout(code: string): void {
  const room = requireRoom(code);
  const snapshot = room.snapshot();
  const existing = timers.get(code);
  if (existing) {
    clearTimeout(existing);
    timers.delete(code);
  }
  if (snapshot.status !== "playing" || !snapshot.currentQuestion) {
    return;
  }

  const timer = setTimeout(() => {
    const liveRoom = rooms.get(code);
    if (!liveRoom) {
      return;
    }
    const before = liveRoom.snapshot().currentQuestion;
    if (!before) {
      return;
    }
    liveRoom.timeoutRound();
    const after = liveRoom.snapshot();
    emitRoom(code, after);
    if (after.status === "playing") {
      scheduleRoundTimeout(code);
    }
  }, ROUND_SECONDS * 1000);
  timers.set(code, timer);
}
