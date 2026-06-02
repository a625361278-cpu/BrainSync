import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { io, type Socket } from "socket.io-client";
import type { GameType, ChatMessage, RoomSnapshot } from "../shared/types";
import "./styles.css";

interface AckPayload {
  ok: boolean;
  room?: RoomSnapshot;
  playerId?: string;
  error?: string;
}

interface PublicUser {
  id: string;
  username: string;
  nickname: string;
  title: string;
  createdAt: number;
}

interface Stamina {
  current: number;
  max: number;
  lastRecoveredAt: number;
  adRestoreCount: number;
}

interface PveProgress {
  level: number;
  highestScore: number;
  stars: number;
  passed: boolean;
}

interface PveProfile {
  stamina: Stamina;
  highestUnlockedLevel: number;
  progress: PveProgress[];
}

interface PveLevel {
  level: number;
  name: string;
  songCount: number;
  timeLimitSeconds: number;
  passScore: number;
  starScores: [number, number, number];
  audioFilter: "phone" | "muffled" | "short";
  difficultyRange: [number, number];
}

interface PveQuestion {
  questionId: string;
  songId: string;
  index: number;
  total: number;
  audioUrl: string;
  sourceUrl: string;
  timeLimitSeconds: number;
  audioFilter: PveLevel["audioFilter"];
}

interface PveRun {
  runId: string;
  level: number;
  questions: PveQuestion[];
  currentQuestion: PveQuestion;
  stamina: Stamina;
}

interface PveAnswerResult {
  correct: boolean;
  answer: string;
  scoreDelta: number;
  totalScore: number;
  correctCount: number;
  nextQuestion?: PveQuestion;
  finished: boolean;
}

interface PveSummary {
  runId: string;
  level: number;
  totalScore: number;
  correctCount: number;
  fastestMs?: number;
  stars: number;
  passed: boolean;
}

type View = "home" | "pvp" | "pve";

const PLAYER_ID_KEY = "brainsync.playerId";
const AUTH_TOKEN_KEY = "brainsync.authToken";

function App() {
  const socket = useMemo<Socket>(() => io(), []);
  const [view, setView] = useState<View>("home");
  const [room, setRoom] = useState<RoomSnapshot | undefined>();
  const [playerId, setPlayerId] = useState<string>(() => localStorage.getItem(PLAYER_ID_KEY) ?? "");
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string>(() => localStorage.getItem(AUTH_TOKEN_KEY) ?? "");
  const [user, setUser] = useState<PublicUser | undefined>();
  const [profile, setProfile] = useState<PveProfile | undefined>();
  const [levels, setLevels] = useState<PveLevel[]>([]);

  useEffect(() => {
    socket.on("roomSnapshot", (snapshot: RoomSnapshot) => setRoom(snapshot));
    return () => {
      socket.disconnect();
    };
  }, [socket]);

  useEffect(() => {
    void loadLevels();
  }, []);

  useEffect(() => {
    if (!token) {
      setUser(undefined);
      setProfile(undefined);
      return;
    }
    void refreshMe(token);
  }, [token]);

  async function loadLevels() {
    const result = await apiRequest<{ levels: PveLevel[] }>("/api/pve/levels");
    setLevels(result.levels);
  }

  async function refreshMe(authToken = token) {
    try {
      const me = await apiRequest<{ user: PublicUser }>("/api/me", { token: authToken });
      const pveProfile = await apiRequest<{ profile: PveProfile }>("/api/pve/profile", { token: authToken });
      setUser(me.user);
      setProfile(pveProfile.profile);
      setError("");
    } catch (err) {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      setToken("");
      setUser(undefined);
      setProfile(undefined);
      setError(err instanceof Error ? err.message : "登录状态失效");
    }
  }

  async function login(payload: { username: string; password: string }) {
    setBusy(true);
    try {
      const result = await apiRequest<{ token: string; user: PublicUser }>("/api/auth/login", {
        method: "POST",
        body: payload
      });
      localStorage.setItem(AUTH_TOKEN_KEY, result.token);
      setToken(result.token);
      setUser(result.user);
      await refreshMe(result.token);
    } finally {
      setBusy(false);
    }
  }

  async function register(payload: { username: string; password: string; nickname: string }) {
    setBusy(true);
    try {
      const result = await apiRequest<{ token: string; user: PublicUser }>("/api/auth/register", {
        method: "POST",
        body: payload
      });
      localStorage.setItem(AUTH_TOKEN_KEY, result.token);
      setToken(result.token);
      setUser(result.user);
      await refreshMe(result.token);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    const oldToken = token;
    localStorage.removeItem(AUTH_TOKEN_KEY);
    setToken("");
    setUser(undefined);
    setProfile(undefined);
    if (oldToken) {
      await apiRequest("/api/auth/logout", { method: "POST", token: oldToken }).catch(() => undefined);
    }
  }

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

  if (room) {
    return (
      <ChatRoom
        room={room}
        playerId={playerId}
        error={error}
        busy={busy}
        onStart={(gameType) => emitWithAck("startGame", { roomCode: room.code, gameType, playerId })}
        onSend={(text) => emitWithAck("sendMessage", { roomCode: room.code, playerId, text })}
        onBack={() => {
          setRoom(undefined);
          setError("");
          setView("home");
        }}
      />
    );
  }

  if (view === "pvp") {
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
        onHome={() => {
          setView("home");
          setError("");
        }}
      />
    );
  }

  if (view === "pve") {
    return (
      <PveChallenge
        user={user}
        token={token}
        busy={busy}
        levels={levels}
        profile={profile}
        onLogin={login}
        onRegister={register}
        onBack={() => setView("home")}
        onProfileChange={setProfile}
        onRefreshProfile={() => refreshMe()}
      />
    );
  }

  return (
    <Home
      user={user}
      profile={profile}
      busy={busy}
      error={error}
      onLogin={login}
      onRegister={register}
      onLogout={logout}
      onOpenPve={() => setView("pve")}
      onOpenPvp={() => setView("pvp")}
    />
  );
}

function Home(props: {
  user?: PublicUser;
  profile?: PveProfile;
  busy: boolean;
  error: string;
  onLogin: (payload: { username: string; password: string }) => Promise<void>;
  onRegister: (payload: { username: string; password: string; nickname: string }) => Promise<void>;
  onLogout: () => Promise<void>;
  onOpenPve: () => void;
  onOpenPvp: () => void;
}) {
  return (
    <main className="home-shell">
      <section className="home-hero">
        <div className="hero-copy">
          <span className="pill">BrainSync</span>
          <h1>猜歌开局，好友接招</h1>
          <p>一个像微信小游戏大厅的实时猜歌房间：自己闯关，也可以拉朋友开房抢答。</p>
        </div>
        <div className="profile-card">
          {props.user ? (
            <>
              <div className="profile-main">
                <img src="/avatars/player-2.svg" alt="" />
                <div>
                  <strong>{props.user.nickname}</strong>
                  <span>{props.user.title}</span>
                </div>
              </div>
              <div className="stamina-line">
                <span>体力</span>
                <strong>
                  {props.profile?.stamina.current ?? "-"} / {props.profile?.stamina.max ?? "-"}
                </strong>
              </div>
              <button className="light-button" onClick={props.onLogout}>
                退出登录
              </button>
            </>
          ) : (
            <AuthBox busy={props.busy} onLogin={props.onLogin} onRegister={props.onRegister} />
          )}
        </div>
      </section>

      <section className="mode-grid">
        <button className="mode-card primary-mode" onClick={props.onOpenPve}>
          <span>主玩法</span>
          <strong>猜歌挑战</strong>
          <small>5 首一关，越快答对分越高</small>
        </button>
        <button className="mode-card battle-mode" onClick={props.onOpenPvp}>
          <span>实时对战</span>
          <strong>开房间对战</strong>
          <small>成语接龙 / 猜歌名，像群聊一样抢答</small>
        </button>
        <button className="mode-card" onClick={props.onOpenPvp}>
          <span>小游戏</span>
          <strong>成语接龙</strong>
          <small>同音接龙，房主开局</small>
        </button>
        <button className="mode-card disabled-card" disabled>
          <span>预留</span>
          <strong>每日挑战</strong>
          <small>后续加入广告恢复体力</small>
        </button>
        <button className="mode-card disabled-card" disabled>
          <span>预留</span>
          <strong>排行榜</strong>
          <small>好友星级和闯关进度</small>
        </button>
      </section>
      {props.error ? <p className="home-error">{props.error}</p> : null}
    </main>
  );
}

function AuthBox(props: {
  busy: boolean;
  onLogin: (payload: { username: string; password: string }) => Promise<void>;
  onRegister: (payload: { username: string; password: string; nickname: string }) => Promise<void>;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    try {
      if (mode === "login") {
        await props.onLogin({ username, password });
      } else {
        await props.onRegister({ username, password, nickname });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "账号操作失败");
    }
  }

  return (
    <div className="auth-box">
      <div className="auth-tabs">
        <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
          登录
        </button>
        <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>
          注册
        </button>
      </div>
      <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="账号" />
      {mode === "register" ? (
        <input value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="昵称" maxLength={16} />
      ) : null}
      <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="密码" type="password" />
      <button disabled={props.busy || !username.trim() || !password.trim()} onClick={submit}>
        {mode === "login" ? "登录" : "创建账号"}
      </button>
      {error ? <span className="form-error">{error}</span> : null}
    </div>
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
  onHome: () => void;
}) {
  return (
    <main className="landing">
      <section className="login-panel">
        <button className="ghost-button back-home" onClick={props.onHome}>
          返回大厅
        </button>
        <div className="brand-row">
          <img src="/avatars/bot.svg" alt="" className="brand-avatar" />
          <div>
            <h1>开房间对战</h1>
            <p>像微信群一样抢答：成语接龙、猜歌名。游客也可以玩。</p>
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

function PveChallenge(props: {
  user?: PublicUser;
  token: string;
  busy: boolean;
  levels: PveLevel[];
  profile?: PveProfile;
  onLogin: (payload: { username: string; password: string }) => Promise<void>;
  onRegister: (payload: { username: string; password: string; nickname: string }) => Promise<void>;
  onBack: () => void;
  onProfileChange: (profile: PveProfile) => void;
  onRefreshProfile: () => Promise<void>;
}) {
  const [run, setRun] = useState<PveRun | undefined>();
  const [currentQuestion, setCurrentQuestion] = useState<PveQuestion | undefined>();
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<PveAnswerResult | undefined>();
  const [summary, setSummary] = useState<PveSummary | undefined>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    pauseOtherAudio(null);
  }, [currentQuestion?.questionId]);

  if (!props.user) {
    return (
      <main className="pve-shell">
        <header className="pve-header">
          <button className="ghost-button" onClick={props.onBack}>
            返回大厅
          </button>
          <strong>猜歌挑战</strong>
        </header>
        <section className="pve-login-panel">
          <h1>登录后开始闯关</h1>
          <p>PVE 会消耗体力并保存关卡星级；PVP 开房间不需要登录。</p>
          <AuthBox busy={props.busy} onLogin={props.onLogin} onRegister={props.onRegister} />
        </section>
      </main>
    );
  }

  async function startLevel(level: number) {
    setBusy(true);
    setError("");
    setSummary(undefined);
    setResult(undefined);
    try {
      const response = await apiRequest<{ run: PveRun }>("/api/pve/start", {
        method: "POST",
        token: props.token,
        body: { level }
      });
      setRun(response.run);
      setCurrentQuestion(response.run.currentQuestion);
      if (props.profile) {
        props.onProfileChange({ ...props.profile, stamina: response.run.stamina });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "开始挑战失败");
    } finally {
      setBusy(false);
    }
  }

  async function submitAnswer() {
    if (!run || !currentQuestion || !answer.trim()) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await apiRequest<{ result: PveAnswerResult }>("/api/pve/answer", {
        method: "POST",
        token: props.token,
        body: { runId: run.runId, questionId: currentQuestion.questionId, answer }
      });
      setResult(response.result);
      setAnswer("");
      if (response.result.nextQuestion) {
        setCurrentQuestion(response.result.nextQuestion);
      }
      if (response.result.finished) {
        const finish = await apiRequest<{ summary: PveSummary }>("/api/pve/finish", {
          method: "POST",
          token: props.token,
          body: { runId: run.runId }
        });
        setSummary(finish.summary);
        setRun(undefined);
        setCurrentQuestion(undefined);
        await props.onRefreshProfile();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交答案失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="pve-shell">
      <header className="pve-header">
        <button className="ghost-button" onClick={props.onBack}>
          返回大厅
        </button>
        <strong>猜歌挑战</strong>
        <span>
          体力 {props.profile?.stamina.current ?? "-"} / {props.profile?.stamina.max ?? "-"}
        </span>
      </header>

      {!run || !currentQuestion ? (
        <section className="level-list">
          {props.levels.map((level) => {
            const progress = props.profile?.progress.find((row) => row.level === level.level);
            const locked = level.level > (props.profile?.highestUnlockedLevel ?? 1);
            return (
              <article key={level.level} className={`level-card ${locked ? "locked" : ""}`}>
                <div>
                  <span>第 {level.level} 关</span>
                  <strong>{level.name}</strong>
                  <small>
                    {level.songCount} 首 / {level.timeLimitSeconds} 秒 / 过关 {level.passScore} 分
                  </small>
                </div>
                <div className="level-meta">
                  <span>{renderStars(progress?.stars ?? 0)}</span>
                  <small>最高 {progress?.highestScore ?? 0}</small>
                  <button disabled={busy || locked || (props.profile?.stamina.current ?? 0) <= 0} onClick={() => startLevel(level.level)}>
                    {locked ? "未解锁" : "开始"}
                  </button>
                </div>
              </article>
            );
          })}
          {summary ? <PveSummaryPanel summary={summary} /> : null}
        </section>
      ) : (
        <section className="challenge-card">
          <div className="challenge-top">
            <span>
              第 {currentQuestion.index}/{currentQuestion.total} 首
            </span>
            <strong>{run.level} 关挑战中</strong>
            <small>限时 {currentQuestion.timeLimitSeconds} 秒，答错不换歌但会扣本题分</small>
          </div>
          <FilteredAudio question={currentQuestion} />
          <div className="answer-row">
            <input
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void submitAnswer();
                }
              }}
              placeholder="输入歌名"
            />
            <button disabled={busy || !answer.trim()} onClick={submitAnswer}>
              抢答
            </button>
          </div>
          {result ? (
            <div className={`answer-result ${result.correct ? "correct" : "wrong"}`}>
              {result.correct ? `答对 +${result.scoreDelta}，总分 ${result.totalScore}` : "答案不对，继续听继续猜"}
            </div>
          ) : null}
        </section>
      )}
      {error ? <div className="toast">{error}</div> : null}
    </main>
  );
}

function FilteredAudio({ question }: { question: PveQuestion }) {
  return (
    <div className={`pve-audio ${question.audioFilter}`}>
      <AudioPreview text="语音 15''" url={question.audioUrl} />
    </div>
  );
}

function PveSummaryPanel({ summary }: { summary: PveSummary }) {
  return (
    <section className="pve-summary">
      <h2>{summary.passed ? "闯关成功" : "再试一次"}</h2>
      <div className="summary-score">{summary.totalScore}</div>
      <p>
        答对 {summary.correctCount} 首 / 星级 {renderStars(summary.stars)} / 最快{" "}
        {summary.fastestMs === undefined ? "-" : `${(summary.fastestMs / 1000).toFixed(1)} 秒`}
      </p>
    </section>
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
  const isHost = props.room.hostId === props.playerId;
  const startDisabled = props.busy || props.room.status === "playing" || !isHost;

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
        <button disabled={startDisabled} title={isHost ? "开始成语接龙" : "只有房主可以开始"} onClick={() => props.onStart("idiom")}>
          成语接龙
        </button>
        <button disabled={startDisabled} title={isHost ? "开始猜歌名" : "只有房主可以开始"} onClick={() => props.onStart("song")}>
          猜歌名
        </button>
        <span>{me ? `我：${me.name}${isHost ? "（房主）" : ""}` : "未识别玩家"}</span>
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
          <span>
            {index + 1}. {row.name}
          </span>
          <strong>{row.score} 题</strong>
        </div>
      ))}
    </section>
  );
}

async function apiRequest<T = unknown>(
  url: string,
  options: { method?: string; token?: string; body?: unknown } = {}
): Promise<T> {
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const payload = (await response.json()) as { ok?: boolean; error?: string } & T;
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error ?? `请求失败：${response.status}`);
  }
  return payload;
}

function renderStars(stars: number): string {
  return "★".repeat(stars) + "☆".repeat(Math.max(0, 3 - stars));
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
