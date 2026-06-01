import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { io, type Socket } from "socket.io-client";
import type { GameType, ChatMessage, Player, RoomSnapshot } from "../shared/types";
import "./styles.css";

interface AckPayload {
  ok: boolean;
  room?: RoomSnapshot;
  playerId?: string;
  error?: string;
}

const PLAYER_ID_KEY = "brainsync.playerId";

function App() {
  const socket = useMemo<Socket>(() => io(), []);
  const [room, setRoom] = useState<RoomSnapshot | undefined>();
  const [playerId, setPlayerId] = useState<string>(() => localStorage.getItem(PLAYER_ID_KEY) ?? "");
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    socket.on("roomSnapshot", (snapshot: RoomSnapshot) => setRoom(snapshot));
    return () => {
      socket.disconnect();
    };
  }, [socket]);

  function applyAck(payload: AckPayload) {
    if (!payload.ok) {
      setError(payload.error ?? "操作失败");
      return;
    }
    if (payload.playerId) {
      localStorage.setItem(PLAYER_ID_KEY, payload.playerId);
      setPlayerId(payload.playerId);
    }
    if (payload.room) {
      setRoom(payload.room);
      setRoomCode(payload.room.code);
    }
    setError("");
  }

  async function emitWithAck(event: string, payload: Record<string, unknown>) {
    setBusy(true);
    try {
      const ack = await socket.timeout(8000).emitWithAck(event, payload);
      applyAck(ack as AckPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "网络请求失败");
    } finally {
      setBusy(false);
    }
  }

  if (!room) {
    return (
      <Landing
        busy={busy}
        error={error}
        name={name}
        roomCode={roomCode}
        onNameChange={setName}
        onRoomCodeChange={setRoomCode}
        onCreate={() => emitWithAck("createRoom", { name })}
        onJoin={() => emitWithAck("joinRoom", { name, roomCode, playerId })}
      />
    );
  }

  return (
    <ChatRoom
      room={room}
      playerId={playerId}
      error={error}
      busy={busy}
      onStart={(gameType) => emitWithAck("startGame", { roomCode: room.code, gameType })}
      onSend={(text) => emitWithAck("sendMessage", { roomCode: room.code, playerId, text })}
      onBack={() => {
        setRoom(undefined);
        setError("");
      }}
    />
  );
}

function Landing(props: {
  busy: boolean;
  error: string;
  name: string;
  roomCode: string;
  onNameChange: (value: string) => void;
  onRoomCodeChange: (value: string) => void;
  onCreate: () => void;
  onJoin: () => void;
}) {
  return (
    <main className="landing">
      <section className="login-panel">
        <div className="brand-row">
          <img src="/avatars/bot.svg" alt="" className="brand-avatar" />
          <div>
            <h1>BrainSync 群聊小游戏</h1>
            <p>像微信群一样抢答：成语接龙、猜歌名。</p>
          </div>
        </div>

        <label>
          昵称
          <input value={props.name} onChange={(event) => props.onNameChange(event.target.value)} maxLength={12} />
        </label>

        <div className="action-grid">
          <button disabled={props.busy || !props.name.trim()} onClick={props.onCreate}>
            创建房间
          </button>
          <div className="join-row">
            <input
              value={props.roomCode}
              onChange={(event) => props.onRoomCodeChange(event.target.value.toUpperCase())}
              placeholder="房间号"
              maxLength={6}
            />
            <button disabled={props.busy || !props.name.trim() || !props.roomCode.trim()} onClick={props.onJoin}>
              加入
            </button>
          </div>
        </div>

        {props.error ? <p className="error">{props.error}</p> : null}
      </section>
    </main>
  );
}

function ChatRoom(props: {
  room: RoomSnapshot;
  playerId: string;
  busy: boolean;
  error: string;
  onStart: (gameType: GameType) => void;
  onSend: (text: string) => void;
  onBack: () => void;
}) {
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const me = props.room.players.find((player) => player.id === props.playerId);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [props.room.messages.length]);

  function send() {
    const clean = text.trim();
    if (!clean) {
      return;
    }
    props.onSend(clean);
    setText("");
  }

  return (
    <main className="wechat-shell">
      <header className="room-header">
        <button className="ghost-button" onClick={props.onBack}>
          返回
        </button>
        <div className="room-title">
          <strong>房间 {props.room.code}</strong>
          <span>{formatRoomSubTitle(props.room)}</span>
        </div>
        <span className="online-count">{props.room.players.filter((player) => player.connected).length} 人</span>
      </header>

      <div className="game-toolbar">
        <button disabled={props.busy || props.room.status === "playing"} onClick={() => props.onStart("idiom")}>
          成语接龙
        </button>
        <button disabled={props.busy || props.room.status === "playing"} onClick={() => props.onStart("song")}>
          猜歌名
        </button>
        <span>{me ? `我：${me.name}` : "未识别玩家"}</span>
      </div>

      <section ref={scrollRef} className="message-list">
        {props.room.messages.map((message) => (
          <MessageBubble key={message.id} message={message} isMine={message.playerId === props.playerId} />
        ))}
        {props.room.status === "finished" && props.room.settlement ? <Settlement rows={props.room.settlement} /> : null}
      </section>

      {props.error ? <div className="toast">{props.error}</div> : null}

      <footer className="input-bar">
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              send();
            }
          }}
          placeholder={props.room.status === "playing" ? "输入答案或聊天..." : "输入聊天内容..."}
        />
        <button disabled={props.busy || !text.trim()} onClick={send}>
          发送
        </button>
      </footer>
    </main>
  );
}

function MessageBubble({ message, isMine }: { message: ChatMessage; isMine: boolean }) {
  const showName = !isMine && message.sender === "player";
  const rowClass = message.sender === "system" ? "message-row system-row" : `message-row ${isMine ? "mine" : "other"}`;

  return (
    <article className={rowClass}>
      {!isMine ? <img className="avatar" src={message.avatar ?? "/avatars/bot.svg"} alt="" /> : null}
      <div className="bubble-stack">
        {showName ? <span className="sender-name">{message.playerName}</span> : null}
        <div className={`bubble ${message.kind === "audio" ? "audio-bubble" : ""}`}>
          {message.kind === "audio" && message.audioUrl ? <AudioPreview text={message.text} url={message.audioUrl} /> : message.text}
        </div>
      </div>
      {isMine ? <img className="avatar" src={message.avatar ?? "/avatars/player-1.svg"} alt="" /> : null}
    </article>
  );
}

function AudioPreview({ text, url }: { text: string; url: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const wiredRef = useRef(false);

  function handlePlay() {
    const audio = audioRef.current;
    pauseOtherAudio(audio);
    if (!audio || wiredRef.current) {
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContextClass();
    const source = context.createMediaElementSource(audio);
    const highpass = context.createBiquadFilter();
    const lowpass = context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 320;
    lowpass.type = "lowpass";
    lowpass.frequency.value = 2600;
    source.connect(highpass).connect(lowpass).connect(context.destination);
    wiredRef.current = true;
  }

  return (
    <div className="audio-message">
      <span>{text}</span>
      <audio ref={audioRef} controls crossOrigin="anonymous" src={url} onPlay={handlePlay} />
    </div>
  );
}

function pauseOtherAudio(current: HTMLAudioElement | null): void {
  const audioElements = document.querySelectorAll<HTMLAudioElement>("audio");
  for (const audio of audioElements) {
    if (audio !== current && !audio.paused) {
      audio.pause();
    }
  }
}

function Settlement({ rows }: { rows: { playerId: string; name: string; score: number }[] }) {
  return (
    <section className="settlement-panel">
      <h2>本局结算</h2>
      {rows.map((row, index) => (
        <div key={row.playerId} className="settlement-row">
          <span>{index + 1}. {row.name}</span>
          <strong>{row.score} 题</strong>
        </div>
      ))}
    </section>
  );
}

function formatRoomSubTitle(room: RoomSnapshot): string {
  if (room.status === "waiting") {
    return "等待开始";
  }
  if (room.status === "finished") {
    return "已结束";
  }
  const question = room.currentQuestion;
  if (!question) {
    return "游戏中";
  }
  const gameName = question.gameType === "song" ? "猜歌名" : "成语接龙";
  return `${gameName} ${question.round}/${question.totalRounds}`;
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

createRoot(document.getElementById("root")!).render(<App />);
