import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Request, type Response } from "express";
import { Server } from "socket.io";
import { WebSocket, WebSocketServer } from "ws";
import { createGameRoom, type GameRoom } from "./game/room";
import { loadGameData } from "./data/loadData";
import { createAuthService, type AuthService } from "./account/authService";
import { exchangeWechatLoginCode } from "./account/wechatLogin";
import { createMysqlAccountRepository, readMysqlConfig } from "./account/mysqlRepository";
import { DEFAULT_PVE_LEVELS } from "./pve/levels";
import { createPveService, type PveService } from "./pve/pveService";
import { createAdRewardService, type AdRewardService } from "./ad/adRewardService";
import { resolveSongPreviewUrl } from "./audio/audioProxy";
import { createMiniappPvpProtocol, type MiniappPvpClientMessage, type MiniappPvpServerMessage } from "./pvp/miniappPvpProtocol";
import type { GameType, RoomSnapshot } from "../shared/types";

interface ClientJoinPayload {
  roomCode: string;
  token?: string;
  playerId?: string;
}

interface ClientCreatePayload {
  token?: string;
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

interface ClientLeavePayload {
  roomCode: string;
  playerId: string;
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
const HINT_REMAINING_SECONDS = Number(process.env.PVP_HINT_REMAINING_SECONDS ?? 15);
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
const miniappClients = new Map<string, WebSocket>();
const miniappRoomClients = new Map<string, Set<string>>();
let miniappClientSeq = 0;
interface RoomTimers {
  hint?: NodeJS.Timeout;
  timeout?: NodeJS.Timeout;
}

const timers = new Map<string, RoomTimers>();
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
  "/api/auth/wechat-login",
  asyncRoute(async (req, res) => {
    const { auth } = requireAccountContext();
    const openid = await exchangeWechatLoginCode({
      code: String(req.body?.code ?? ""),
      appId: process.env.WECHAT_APP_ID,
      appSecret: process.env.WECHAT_APP_SECRET
    });
    const result = await auth.loginWithWechat({
      openid,
      nickname: typeof req.body?.nickname === "string" ? req.body.nickname : undefined
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
  "/api/pve/question/start",
  asyncRoute(async (req, res) => {
    const { pve } = requireAccountContext();
    const user = await requireHttpUser(req);
    res.json({
      ok: true,
      result: await pve.startQuestion(user.id, {
        runId: String(req.body?.runId ?? ""),
        questionId: String(req.body?.questionId ?? "")
      })
    });
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
  "/api/pve/timeout",
  asyncRoute(async (req, res) => {
    const { pve } = requireAccountContext();
    const user = await requireHttpUser(req);
    res.json({
      ok: true,
      result: await pve.timeoutQuestion(user.id, {
        runId: String(req.body?.runId ?? ""),
        questionId: String(req.body?.questionId ?? "")
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

app.get(
  "/api/audio/preview/:songId",
  asyncRoute(async (req, res) => {
    const previewUrl = resolveSongPreviewUrl(String(req.params.songId ?? ""), data.songs);
    const upstream = await fetch(previewUrl);
    if (!upstream.ok) {
      throw new Error(`歌曲试听源请求失败：HTTP ${upstream.status}`);
    }
    const contentType = upstream.headers.get("content-type") ?? "audio/mp4";
    const arrayBuffer = await upstream.arrayBuffer();
    res.setHeader("content-type", contentType);
    res.setHeader("cache-control", "public, max-age=3600");
    res.send(Buffer.from(arrayBuffer));
  })
);

app.post(
  "/api/ad/reward/start",
  asyncRoute(async (req, res) => {
    const { adRewards } = requireAccountContext();
    const user = await requireHttpUser(req);
    const rewardType = String(req.body?.rewardType ?? "");
    res.json({ ok: true, reward: await adRewards.start(user.id, rewardType as never) });
  })
);

app.post(
  "/api/ad/reward/callback",
  asyncRoute(async (req, res) => {
    requireAdCallbackSecret(req);
    const { adRewards } = requireAccountContext();
    const event = await adRewards.verifyCallback({
      eventId: String(req.body?.eventId ?? ""),
      rewardType: String(req.body?.rewardType ?? "") as never,
      platformTraceId: String(req.body?.platformTraceId ?? "")
    });
    res.json({ ok: true, eventId: event.id, status: event.status });
  })
);

app.post(
  "/api/ad/reward/claim",
  asyncRoute(async (req, res) => {
    const { adRewards } = requireAccountContext();
    const user = await requireHttpUser(req);
    res.json({ ok: true, reward: await adRewards.claim(user.id, String(req.body?.eventId ?? "")) });
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
    handleAck(ack, async () => {
      const user = await requireSocketUser(payload.token);
      const code = createUniqueRoomCode();
      const room = createGameRoom({
        code,
        idioms: data.idioms,
        songs: data.songs,
        characters: data.characters,
        movies: data.movies,
        roundSeconds: ROUND_SECONDS
      });
      rooms.set(code, room);
      const player = room.join(user.nickname);
      socket.join(socketRoom(code));
      socket.data.roomCode = code;
      socket.data.playerId = player.id;
      const snapshot = room.snapshot();
      emitRoom(code, snapshot);
      return { ok: true, room: snapshot, playerId: player.id };
    });
  });

  socket.on("joinRoom", (payload: ClientJoinPayload, ack?: (payload: AckPayload) => void) => {
    handleAck(ack, async () => {
      const user = await requireSocketUser(payload.token);
      const room = requireRoom(payload.roomCode);
      const player = room.join(user.nickname, payload.playerId);
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
      scheduleRoundTimers(payload.roomCode);
      const snapshot = room.snapshot();
      emitRoom(payload.roomCode, snapshot);
      return { ok: true, room: snapshot };
    });
  });

  socket.on("sendMessage", (payload: ClientMessagePayload, ack?: (payload: AckPayload) => void) => {
    handleAck(ack, () => {
      const room = requireRoom(payload.roomCode);
      const result = room.submitMessage(payload.playerId, payload.text);
      if (result.hit) {
        scheduleRoundTimers(payload.roomCode);
      }
      const snapshot = room.snapshot();
      emitRoom(payload.roomCode, snapshot);
      return { ok: true, room: snapshot };
    });
  });

  socket.on("leaveRoom", (payload: ClientLeavePayload, ack?: (payload: AckPayload) => void) => {
    handleAck(ack, () => {
      const socketRoomCode = socket.data.roomCode as string | undefined;
      const socketPlayerId = socket.data.playerId as string | undefined;
      if (socketRoomCode !== payload.roomCode || socketPlayerId !== payload.playerId) {
        throw new Error("离开房间状态异常：当前连接不在该房间");
      }
      const room = requireRoom(payload.roomCode);
      room.leave(payload.playerId);
      socket.leave(socketRoom(payload.roomCode));
      socket.data.roomCode = undefined;
      socket.data.playerId = undefined;
      clearRoomTimersIfEmpty(payload.roomCode, room.snapshot());
      emitRoom(payload.roomCode, room.snapshot());
      return { ok: true };
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
    const snapshot = room.snapshot();
    clearRoomTimersIfEmpty(roomCode, snapshot);
    emitRoom(roomCode, snapshot);
  });
});

const miniappProtocol = accountContext.ready
  ? createMiniappPvpProtocol({
      auth: accountContext.auth,
      rooms,
      createRoomCode: createUniqueRoomCode,
      createRoom: (code) =>
        createGameRoom({
          code,
          idioms: data.idioms,
          songs: data.songs,
          characters: data.characters,
          movies: data.movies,
          roundSeconds: ROUND_SECONDS
        }),
      send: sendMiniappMessage,
      broadcast: emitRoom,
      bindClientToRoom,
      unbindClientFromRoom,
      scheduleRoundTimers,
      clearRoomTimersIfEmpty
    })
  : undefined;
const miniappUnavailableMessage = accountContext.ready ? undefined : accountContext.error.message;
const miniappWss = new WebSocketServer({ noServer: true });
httpServer.on("upgrade", (req, socket, head) => {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  if (pathname !== "/pvp-ws") {
    return;
  }
  miniappWss.handleUpgrade(req, socket, head, (ws) => {
    miniappWss.emit("connection", ws, req);
  });
});

miniappWss.on("connection", (ws) => {
  const clientId = `miniapp_${++miniappClientSeq}`;
  miniappClients.set(clientId, ws);
  ws.on("message", (raw) => {
    if (!miniappProtocol) {
      sendMiniappMessage(clientId, { type: "ack", ok: false, error: miniappUnavailableMessage ?? "小程序PVP服务不可用" });
      return;
    }
    try {
      const message = JSON.parse(raw.toString()) as MiniappPvpClientMessage;
      void miniappProtocol.handle(clientId, message);
    } catch (error) {
      sendMiniappMessage(clientId, { type: "ack", ok: false, error: error instanceof Error ? error.message : "未知错误" });
    }
  });
  ws.on("close", () => {
    miniappClients.delete(clientId);
    miniappProtocol?.disconnect(clientId);
    removeClientFromAllMiniappRooms(clientId);
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`BrainSync party games listening on http://localhost:${PORT}`);
});

async function handleAck(ack: ((payload: AckPayload) => void) | undefined, action: () => AckPayload | Promise<AckPayload>): Promise<void> {
  try {
    ack?.(await action());
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    ack?.({ ok: false, error: message });
  }
}

function requireRoom(code: string): GameRoom {
  const normalized = code.trim();
  const room = rooms.get(normalized);
  if (!room) {
    throw new Error(`房间不存在：${normalized}`);
  }
  return room;
}

function createUniqueRoomCode(): string {
  for (let i = 0; i < 20; i += 1) {
    const code = Math.floor(Math.random() * 1_000_000)
      .toString()
      .padStart(6, "0");
    if (!rooms.has(code)) {
      return code;
    }
  }
  throw new Error("房间号生成失败");
}

function socketRoom(code: string): string {
  return `room:${code.trim()}`;
}

function emitRoom(code: string, snapshot: RoomSnapshot): void {
  io.to(socketRoom(code)).emit("roomSnapshot", snapshot);
  emitMiniappRoom(code, snapshot);
}

function emitMiniappRoom(code: string, snapshot: RoomSnapshot): void {
  const clientIds = miniappRoomClients.get(code.trim());
  if (!clientIds) {
    return;
  }
  for (const clientId of clientIds) {
    sendMiniappMessage(clientId, { type: "roomSnapshot", payload: snapshot });
  }
}

function sendMiniappMessage(clientId: string, message: MiniappPvpServerMessage): void {
  const client = miniappClients.get(clientId);
  if (!client || client.readyState !== WebSocket.OPEN) {
    return;
  }
  client.send(JSON.stringify(message));
}

function bindClientToRoom(clientId: string, roomCode: string): void {
  const normalized = roomCode.trim();
  const existing = miniappRoomClients.get(normalized) ?? new Set<string>();
  existing.add(clientId);
  miniappRoomClients.set(normalized, existing);
}

function unbindClientFromRoom(clientId: string, roomCode: string): void {
  const normalized = roomCode.trim();
  const existing = miniappRoomClients.get(normalized);
  if (!existing) {
    return;
  }
  existing.delete(clientId);
  if (existing.size === 0) {
    miniappRoomClients.delete(normalized);
  }
}

function removeClientFromAllMiniappRooms(clientId: string): void {
  for (const roomCode of [...miniappRoomClients.keys()]) {
    unbindClientFromRoom(clientId, roomCode);
  }
}

function scheduleRoundTimers(code: string): void {
  const room = requireRoom(code);
  const snapshot = room.snapshot();
  clearRoundTimers(code);
  if (snapshot.status !== "playing" || !snapshot.currentQuestion) {
    return;
  }

  const questionId = snapshot.currentQuestion.questionId;
  const hintDelay = Math.max(0, ROUND_SECONDS - HINT_REMAINING_SECONDS) * 1000;
  const roomTimers: RoomTimers = {};
  roomTimers.hint = setTimeout(() => {
    const liveRoom = rooms.get(code);
    if (!liveRoom) {
      return;
    }
    const messages = liveRoom.hintRound(questionId);
    if (messages.length > 0) {
      emitRoom(code, liveRoom.snapshot());
    }
  }, hintDelay);

  roomTimers.timeout = setTimeout(() => {
    const liveRoom = rooms.get(code);
    if (!liveRoom) {
      return;
    }
    const messages = liveRoom.timeoutRound(questionId);
    if (messages.length === 0) {
      return;
    }
    const after = liveRoom.snapshot();
    emitRoom(code, after);
    if (after.status === "playing") {
      scheduleRoundTimers(code);
    } else {
      clearRoundTimers(code);
    }
  }, ROUND_SECONDS * 1000);
  timers.set(code, roomTimers);
}

function clearRoundTimers(code: string): void {
  const existing = timers.get(code);
  if (!existing) {
    return;
  }
  if (existing.hint) {
    clearTimeout(existing.hint);
  }
  if (existing.timeout) {
    clearTimeout(existing.timeout);
  }
  timers.delete(code);
}

function clearRoomTimersIfEmpty(code: string, snapshot: RoomSnapshot): void {
  if (snapshot.players.every((player) => !player.connected)) {
    clearRoundTimers(code);
  }
}

interface AccountContextReady {
  ready: true;
  auth: AuthService;
  pve: PveService;
  adRewards: AdRewardService;
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
      error: new Error("MySQL未配置，账号、PVE和PVP开房功能不可用")
    };
  }
  try {
    const repo = await createMysqlAccountRepository(config);
    return {
      ready: true,
      auth: createAuthService({ repo }),
      pve: createPveService({ repo, songs: data.songs, levels: DEFAULT_PVE_LEVELS }),
      adRewards: createAdRewardService({ repo })
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

async function requireSocketUser(token: string | undefined) {
  const { auth } = requireAccountContext();
  if (!token?.trim()) {
    throw new Error("未登录");
  }
  return auth.requireUserByToken(token);
}

function readBearerToken(req: Request): string | undefined {
  const authorization = req.header("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim();
}

function requireAdCallbackSecret(req: Request): void {
  const expected = process.env.UNI_AD_CALLBACK_SECRET;
  if (!expected) {
    throw new ServiceUnavailableError("广告回调密钥未配置：UNI_AD_CALLBACK_SECRET");
  }
  const actual = req.header("x-ad-callback-secret") ?? "";
  if (actual !== expected) {
    throw new HttpError(401, "广告回调签名异常");
  }
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
