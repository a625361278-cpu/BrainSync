import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Request, type Response } from "express";
import { Server } from "socket.io";
import { createGameRoom, type GameRoom } from "./game/room";
import { loadGameData } from "./data/loadData";
import { createAuthService, type AuthService } from "./account/authService";
import { createMysqlAccountRepository, readMysqlConfig } from "./account/mysqlRepository";
import { DEFAULT_PVE_LEVELS } from "./pve/levels";
import { createPveService, type PveService } from "./pve/pveService";
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
  playerId: string;
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

loadDotEnv();

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
const accountContext = await initializeAccountContext();

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, rooms: rooms.size, account: accountContext.ready ? "ready" : "unavailable" });
});

app.post(
  "/api/auth/register",
  asyncRoute(async (req, res) => {
    const { auth } = requireAccountContext();
    const result = await auth.register({
      username: String(req.body?.username ?? ""),
      password: String(req.body?.password ?? ""),
      nickname: String(req.body?.nickname ?? "")
    });
    res.json({ ok: true, ...result });
  })
);

app.post(
  "/api/auth/login",
  asyncRoute(async (req, res) => {
    const { auth } = requireAccountContext();
    const result = await auth.login({
      username: String(req.body?.username ?? ""),
      password: String(req.body?.password ?? "")
    });
    res.json({ ok: true, ...result });
  })
);

app.post(
  "/api/auth/logout",
  asyncRoute(async (req, res) => {
    const { auth } = requireAccountContext();
    const token = readBearerToken(req);
    if (token) {
      await auth.logout(token);
    }
    res.json({ ok: true });
  })
);

app.get(
  "/api/me",
  asyncRoute(async (req, res) => {
    const user = await requireHttpUser(req);
    res.json({ ok: true, user });
  })
);

app.get("/api/pve/levels", (_req, res) => {
  res.json({ ok: true, levels: DEFAULT_PVE_LEVELS });
});

app.get(
  "/api/pve/profile",
  asyncRoute(async (req, res) => {
    const { pve } = requireAccountContext();
    const user = await requireHttpUser(req);
    res.json({ ok: true, profile: await pve.profile(user.id) });
  })
);

app.post(
  "/api/pve/start",
  asyncRoute(async (req, res) => {
    const { pve } = requireAccountContext();
    const user = await requireHttpUser(req);
    res.json({ ok: true, run: await pve.start(user.id, Number(req.body?.level)) });
  })
);

app.post(
  "/api/pve/answer",
  asyncRoute(async (req, res) => {
    const { pve } = requireAccountContext();
    const user = await requireHttpUser(req);
    res.json({
      ok: true,
      result: await pve.answer(user.id, {
        runId: String(req.body?.runId ?? ""),
        questionId: String(req.body?.questionId ?? ""),
        answer: String(req.body?.answer ?? "")
      })
    });
  })
);

app.post(
  "/api/pve/finish",
  asyncRoute(async (req, res) => {
    const { pve } = requireAccountContext();
    const user = await requireHttpUser(req);
    res.json({ ok: true, summary: await pve.finish(user.id, String(req.body?.runId ?? "")) });
  })
);

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
      room.start(payload.gameType, payload.playerId);
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

interface AccountContextReady {
  ready: true;
  auth: AuthService;
  pve: PveService;
}

interface AccountContextUnavailable {
  ready: false;
  error: Error;
}

type AccountContext = AccountContextReady | AccountContextUnavailable;

class ServiceUnavailableError extends Error {
  readonly statusCode = 503;
}

async function initializeAccountContext(): Promise<AccountContext> {
  const config = readMysqlConfig(process.env);
  if (!config) {
    return {
      ready: false,
      error: new Error("MySQL未配置，账号和PVE功能不可用；PVP房间仍可继续使用")
    };
  }
  try {
    const repo = await createMysqlAccountRepository(config);
    return {
      ready: true,
      auth: createAuthService({ repo }),
      pve: createPveService({ repo, songs: data.songs, levels: DEFAULT_PVE_LEVELS })
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知MySQL初始化错误";
    console.error(`账号/PVE MySQL初始化失败：${message}`);
    return {
      ready: false,
      error: new Error(`MySQL初始化失败：${message}`)
    };
  }
}

function requireAccountContext(): AccountContextReady {
  if (!accountContext.ready) {
    throw new ServiceUnavailableError(accountContext.error.message);
  }
  return accountContext;
}

async function requireHttpUser(req: Request) {
  const { auth } = requireAccountContext();
  const token = readBearerToken(req);
  if (!token) {
    throw new HttpError(401, "未登录");
  }
  return auth.requireUserByToken(token);
}

function readBearerToken(req: Request): string | undefined {
  const authorization = req.header("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim();
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    handler(req, res).catch((error: unknown) => {
      const statusCode =
        error instanceof HttpError || error instanceof ServiceUnavailableError ? error.statusCode : inferStatusCode(error);
      const message = error instanceof Error ? error.message : "未知错误";
      res.status(statusCode).json({ ok: false, error: message });
    });
  };
}

function inferStatusCode(error: unknown): number {
  if (!(error instanceof Error)) {
    return 500;
  }
  if (["未登录", "登录状态不存在", "登录已过期"].some((message) => error.message.includes(message))) {
    return 401;
  }
  return 400;
}

function loadDotEnv(): void {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) {
    return;
  }
  const content = readFileSync(envPath, "utf8");
  for (const [index, rawLine] of content.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      throw new Error(`.env 配置格式错误：第 ${index + 1} 行`);
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = stripEnvQuotes(line.slice(separatorIndex + 1).trim());
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
      throw new Error(`.env 配置键名不合法：第 ${index + 1} 行`);
    }
    process.env[key] ??= value;
  }
}

function stripEnvQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
