import { WS_URL } from "./config";
import type { GameType, RoomSnapshot } from "./types";

export interface AckPayload {
  ok: boolean;
  room?: RoomSnapshot;
  playerId?: string;
  error?: string;
}

type SnapshotHandler = (snapshot: RoomSnapshot) => void;

export class PvpSocket {
  private socket?: UniApp.SocketTask;
  private seq = 0;
  private readonly pending = new Map<string, (ack: AckPayload) => void>();
  private snapshotHandler?: SnapshotHandler;

  connect(onSnapshot: SnapshotHandler): Promise<void> {
    this.snapshotHandler = onSnapshot;
    return new Promise((resolve, reject) => {
      const socket = uni.connectSocket({ url: WS_URL, success: () => undefined, fail: reject });
      this.socket = socket;
      socket.onOpen(() => resolve());
      socket.onMessage((event) => this.handleMessage(String(event.data)));
      socket.onError((error) => reject(error));
    });
  }

  close(): void {
    this.socket?.close({});
    this.socket = undefined;
    this.pending.clear();
  }

  createRoom(token: string): Promise<AckPayload> {
    return this.send("createRoom", { token });
  }

  joinRoom(token: string, roomCode: string, playerId?: string): Promise<AckPayload> {
    return this.send("joinRoom", { token, roomCode, playerId });
  }

  startGame(roomCode: string, playerId: string, gameType: GameType): Promise<AckPayload> {
    return this.send("startGame", { roomCode, playerId, gameType });
  }

  sendChat(roomCode: string, playerId: string, text: string): Promise<AckPayload> {
    return this.send("sendMessage", { roomCode, playerId, text });
  }

  leaveRoom(roomCode: string, playerId: string): Promise<AckPayload> {
    return this.send("leaveRoom", { roomCode, playerId });
  }

  private send(type: string, payload: Record<string, unknown>): Promise<AckPayload> {
    const requestId = `r_${++this.seq}`;
    const socket = this.socket;
    if (!socket) {
      throw new Error("PVP连接尚未建立");
    }
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, resolve);
      socket.send({
        data: JSON.stringify({ type, requestId, payload }),
        fail: (error) => {
          this.pending.delete(requestId);
          reject(error);
        }
      });
    });
  }

  private handleMessage(raw: string): void {
    const message = JSON.parse(raw) as { type: string; requestId?: string; ok?: boolean; error?: string; payload?: unknown };
    if (message.type === "roomSnapshot") {
      this.snapshotHandler?.((message.payload as { payload?: RoomSnapshot }).payload ?? (message.payload as RoomSnapshot));
      return;
    }
    if (message.type === "ack" && message.requestId) {
      const resolve = this.pending.get(message.requestId);
      this.pending.delete(message.requestId);
      resolve?.({
        ok: Boolean(message.ok),
        error: message.error,
        room: (message.payload as { room?: RoomSnapshot } | undefined)?.room,
        playerId: (message.payload as { playerId?: string } | undefined)?.playerId
      });
    }
  }
}
