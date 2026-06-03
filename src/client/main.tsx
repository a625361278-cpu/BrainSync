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
  summary?: PveSummary;
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
type PvpIntent = "idiom" | "song" | undefined;
type ChallengePhase = "levels" | "countdown" | "playing" | "feedback";

const PLAYER_ID_KEY = "brainsync.playerId";
const AUTH_TOKEN_KEY = "brainsync.authToken";

export function App() {
  const socket = useMemo<Socket>(() => io(), []);
  const [view, setView] = useState<View>("home");
  const [room, setRoom] = useState<RoomSnapshot | undefined>();
  const [activeRoomCode, setActiveRoomCodeState] = useState<string | undefined>();
  const activeRoomCodeRef = useRef<string | undefined>(undefined);
  const [playerId, setPlayerId] = useState<string>(() => localStorage.getItem(PLAYER_ID_KEY) ?? "");
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string>(() => localStorage.getItem(AUTH_TOKEN_KEY) ?? "");
  const [user, setUser] = useState<PublicUser | undefined>();
  const [profile, setProfile] = useState<PveProfile | undefined>();
  const [levels, setLevels] = useState<PveLevel[]>([]);
  const [showAuthModal, setShowAuthModal] = useState(() => !localStorage.getItem(AUTH_TOKEN_KEY));
  const [pvpIntent, setPvpIntent] = useState<PvpIntent>();

  useEffect(() => {
    socket.on("roomSnapshot", (snapshot: RoomSnapshot) => {
      if (activeRoomCodeRef.current === snapshot.code) {
        setRoom(snapshot);
      }
    });
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
      setShowAuthModal(true);
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
      setShowAuthModal(false);
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
      setShowAuthModal(false);
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
      setActiveRoomCode(payload.room.code);
      setRoom(payload.room);
      setRoomCode(payload.room.code);
    }
    setError("");
  }

  function setActiveRoomCode(code: string | undefined) {
    activeRoomCodeRef.current = code;
    setActiveRoomCodeState(code);
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

  async function leaveRoom(roomCodeToLeave: string, playerIdToLeave: string) {
    setActiveRoomCode(undefined);
    setRoom(undefined);
    setError("");
    setView("home");
    setPvpIntent(undefined);
    setBusy(true);
    try {
      const ack = (await socket.timeout(8000).emitWithAck("leaveRoom", {
        roomCode: roomCodeToLeave,
        playerId: playerIdToLeave
      })) as AckPayload;
      if (!ack.ok) {
        setError(ack.error ?? "离开房间失败");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "离开房间失败");
    } finally {
      setBusy(false);
    }
  }

  if (room && activeRoomCode === room.code) {
    return (
      <ChatRoom
        room={room}
        playerId={playerId}
        error={error}
        busy={busy}
        onStart={(gameType) => emitWithAck("startGame", { roomCode: room.code, gameType, playerId })}
        onSend={(text) => emitWithAck("sendMessage", { roomCode: room.code, playerId, text })}
        onBack={() => {
          void leaveRoom(room.code, playerId);
        }}
      />
    );
  }

  if (view === "pvp") {
    if (!user) {
      return (
        <Home
          user={user}
          profile={profile}
          busy={busy}
          error={error || "请先登录后再开房对战"}
          onLogin={login}
          onRegister={register}
          onLogout={logout}
          showAuthModal={true}
          onCloseAuth={() => setView("home")}
          onOpenAuth={() => setShowAuthModal(true)}
          onOpenPve={() => setShowAuthModal(true)}
          onOpenPvp={() => setShowAuthModal(true)}
        />
      );
    }
    return (
      <Landing
        busy={busy}
        error={error}
        nickname={user.nickname}
        roomCode={roomCode}
        onRoomCodeChange={setRoomCode}
        onCreate={() => emitWithAck("createRoom", { token })}
        onJoin={() => emitWithAck("joinRoom", { token, roomCode, playerId })}
        intent={pvpIntent}
        onHome={() => {
          setView("home");
          setError("");
          setPvpIntent(undefined);
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
      showAuthModal={showAuthModal}
      onCloseAuth={() => setShowAuthModal(false)}
      onOpenAuth={() => setShowAuthModal(true)}
      onOpenPve={() => {
        if (!user) {
          setShowAuthModal(true);
          return;
        }
        setView("pve");
      }}
      onOpenPvp={(intent) => {
        if (!user) {
          setShowAuthModal(true);
          return;
        }
        setPvpIntent(intent);
        setView("pvp");
      }}
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
  showAuthModal: boolean;
  onCloseAuth: () => void;
  onOpenAuth: () => void;
  onOpenPve: () => void;
  onOpenPvp: (intent?: Exclude<PvpIntent, undefined>) => void;
}) {
  return (
    <main className="home-shell">
      <section className="mini-home-page">
        <div className="home-statusbar">
          <span>16:02</span>
          <span>5G 68%</span>
        </div>
        <header className="home-topbar">
          <div className="home-player">
            <img src="/home-assets/avatar-dog.svg" alt="" />
            <div>
              <strong>{props.user?.nickname ?? "欢迎来到 BrainSync"}</strong>
              <span>{props.user ? props.user.title : "未登录"}</span>
            </div>
          </div>
          <div className="home-actions">
            <button type="button" className="round-action" aria-label="好友">
              <span>👥</span>
              <small>好友</small>
            </button>
            <button type="button" className="round-action has-dot" aria-label="消息">
              <span>💬</span>
              <small>消息</small>
            </button>
            <button type="button" className="capsule-action" aria-label="更多">
              •••
            </button>
          </div>
        </header>

        <section className="home-title-stage">
          <img className="floating-note note-left" src="/home-assets/note.svg" alt="" />
          <img className="floating-note note-right" src="/home-assets/note.svg" alt="" />
          <img className="home-logo" src="/home-assets/logo.svg" alt="BrainSync 欢乐房间" />
          <div className="bot-speech">嗨！欢迎来到BrainSync，一起猜歌接龙，快乐翻倍！</div>
          <img className="hero-microphone" src="/home-assets/microphone.svg" alt="" />
          <img className="hero-robot" src="/home-assets/robot.svg" alt="" />
        </section>

        <section className="home-main-modes">
          <article className="big-mode guess-mode">
            <span className="mode-ribbon">主打玩法</span>
            <strong>猜歌挑战</strong>
            <small>听歌猜歌名，赢星星！</small>
            <div className="stamina-badge">
              ⚡ {props.profile ? `体力 ${props.profile.stamina.current}/${props.profile.stamina.max}` : "登录查看体力"}
            </div>
            <div className="star-track" aria-hidden="true">★★★★</div>
            <img className="mode-art record-art" src="/home-assets/record.svg" alt="" />
            <button type="button" onClick={props.onOpenPve}>开始挑战</button>
          </article>

          <article className="big-mode room-mode">
            <strong>开房间对战</strong>
            <small>邀请好友，实时对战</small>
            <div className="chat-vs">
              <span>•••</span>
              <b>VS</b>
              <span>•••</span>
            </div>
            <button type="button" onClick={() => props.onOpenPvp()}>快速开始</button>
          </article>
        </section>

        <section className="home-sub-modes">
          <SmallMode title="成语接龙" desc="妙趣接龙，才思无限" art="/home-assets/scroll.svg" tone="purple" onClick={() => props.onOpenPvp("idiom")} />
          <SmallMode title="猜歌名" desc="经典金曲，等你来猜" art="/home-assets/headphones.svg" tone="yellow" onClick={() => props.onOpenPvp("song")} />
          <SmallMode title="每日挑战" desc="每日更新，赢取星星" art="/home-assets/calendar.svg" tone="blue" onClick={() => alert("每日挑战功能开发中")} />
          <SmallMode title="好友排行" desc="好友比拼，谁更厉害" art="/home-assets/trophy.svg" tone="pink" onClick={() => alert("好友排行功能开发中")} />
        </section>

        <section className="online-strip">
          <span className="online-dot"></span>
          <strong>32</strong>
          <span>位好友在线</span>
          <div className="friend-stack">
            <img src="/home-assets/friend-1.svg" alt="" />
            <img src="/home-assets/friend-2.svg" alt="" />
            <img src="/home-assets/avatar-dog.svg" alt="" />
            <img src="/home-assets/friend-3.svg" alt="" />
          </div>
          <button type="button">邀请好友</button>
        </section>

        <section className="system-strip">
          <span>💬</span>
          <p>系统消息：欢迎来到 BrainSync 欢乐房间！🎉</p>
          <b>›</b>
        </section>
      </section>
      {props.showAuthModal ? (
        <AuthModal
          busy={props.busy}
          error={props.error}
          onLogin={props.onLogin}
          onRegister={props.onRegister}
          onClose={props.onCloseAuth}
        />
      ) : null}
      {props.error ? <p className="home-error">{props.error}</p> : null}
    </main>
  );
}

function SmallMode(props: { title: string; desc: string; art: string; tone: string; onClick: () => void }) {
  return (
    <button type="button" className={`small-mode ${props.tone}`} onClick={props.onClick}>
      <div>
        <strong>{props.title}</strong>
        <span>{props.desc}</span>
      </div>
      <img src={props.art} alt="" />
    </button>
  );
}

function AuthModal(props: {
  busy: boolean;
  error: string;
  onLogin: (payload: { username: string; password: string }) => Promise<void>;
  onRegister: (payload: { username: string; password: string; nickname: string }) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <div className="home-auth-modal" role="dialog" aria-modal="true" aria-label="登录 BrainSync">
      <section className="auth-modal-card">
        <button type="button" className="modal-close" aria-label="关闭登录弹窗" onClick={props.onClose}>
          ×
        </button>
        <img src="/home-assets/avatar-dog.svg" alt="" />
        <h2>欢迎来到 BrainSync</h2>
        <p>登录后保存体力、星级和闯关进度；开房对战也会使用你的账号昵称。</p>
        <AuthBox busy={props.busy} onLogin={props.onLogin} onRegister={props.onRegister} />
        {props.error ? <span className="form-error">{props.error}</span> : null}
      </section>
    </div>
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
  nickname: string;
  roomCode: string;
  intent: PvpIntent;
  onRoomCodeChange: (value: string) => void;
  onCreate: () => void;
  onJoin: () => void;
  onHome: () => void;
}) {
  return (
    <main className="landing">
      <section className="login-panel pvp-entry-panel">
        <button className="ghost-button back-home" onClick={props.onHome}>
          返回大厅
        </button>
        <div className="brand-row">
          <img src="/avatars/bot.svg" alt="" className="brand-avatar" />
          <div>
            <h1>开房间对战</h1>
            <p>
              {props.intent === "idiom"
                ? "准备开一局成语接龙。"
                : props.intent === "song"
                  ? "准备开一局猜歌名。"
                  : "像微信群一样抢答：成语接龙、猜歌名。"}
            </p>
          </div>
        </div>

        <div className="pvp-player-chip">当前玩家：{props.nickname}</div>

        <div className="pvp-choice-grid">
          <button className="pvp-create-card" disabled={props.busy} onClick={props.onCreate}>
            <strong>创建房间</strong>
            <span>生成 6 位数字房间号，邀请好友加入</span>
          </button>
          <div className="pvp-join-card">
            <strong>加入房间</strong>
            <input
              value={props.roomCode}
              onChange={(event) => props.onRoomCodeChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="6位数字房间号"
              inputMode="numeric"
              maxLength={6}
            />
            <button disabled={props.busy || props.roomCode.length !== 6} onClick={props.onJoin}>
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
  const [phase, setPhase] = useState<ChallengePhase>("levels");
  const [countdown, setCountdown] = useState(3);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [currentScore, setCurrentScore] = useState(0);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<PveAnswerResult | undefined>();
  const [summary, setSummary] = useState<PveSummary | undefined>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const timeoutBusyRef = useRef(false);

  useEffect(() => {
    pauseOtherAudio(null);
  }, [currentQuestion?.questionId]);

  useEffect(() => {
    if (phase !== "countdown" || !run || !currentQuestion) {
      return;
    }
    if (countdown <= 0) {
      void markQuestionStarted(run, currentQuestion);
      return;
    }
    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [phase, countdown, run, currentQuestion]);

  useEffect(() => {
    if (phase !== "playing" || !run || !currentQuestion) {
      return;
    }
    if (secondsLeft <= 0) {
      void timeoutCurrentQuestion(run, currentQuestion);
      return;
    }
    const timer = window.setTimeout(() => setSecondsLeft((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [phase, secondsLeft, run, currentQuestion]);

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
    setCurrentScore(0);
    try {
      const response = await apiRequest<{ run: PveRun }>("/api/pve/start", {
        method: "POST",
        token: props.token,
        body: { level }
      });
      setRun(response.run);
      beginQuestion(response.run.currentQuestion);
      if (props.profile) {
        props.onProfileChange({ ...props.profile, stamina: response.run.stamina });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "开始挑战失败");
    } finally {
      setBusy(false);
    }
  }

  function beginQuestion(question: PveQuestion) {
    pauseOtherAudio(null);
    timeoutBusyRef.current = false;
    setCurrentQuestion(question);
    setAnswer("");
    setResult(undefined);
    setSecondsLeft(question.timeLimitSeconds);
    setCountdown(3);
    setPhase("countdown");
  }

  async function markQuestionStarted(activeRun: PveRun, question: PveQuestion) {
    if (phase !== "countdown") {
      return;
    }
    setPhase("playing");
    setError("");
    try {
      const response = await apiRequest<{ result: { timeLimitSeconds: number } }>("/api/pve/question/start", {
        method: "POST",
        token: props.token,
        body: { runId: activeRun.runId, questionId: question.questionId }
      });
      setSecondsLeft(response.result.timeLimitSeconds);
      window.setTimeout(() => {
        const audio = document.querySelector<HTMLAudioElement>(".pve-audio audio");
        const playResult = audio?.play();
        playResult?.catch(() => setError("浏览器阻止自动播放，请手动点击播放"));
      }, 80);
    } catch (err) {
      setPhase("feedback");
      setError(err instanceof Error ? err.message : "题目开始失败");
    }
  }

  async function submitAnswer() {
    if (!run || !currentQuestion || !answer.trim() || phase !== "playing") {
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
      setCurrentScore(response.result.totalScore);
      setAnswer("");
      setPhase("feedback");
      if (response.result.finished) {
        const finish = await apiRequest<{ summary: PveSummary }>("/api/pve/finish", {
          method: "POST",
          token: props.token,
          body: { runId: run.runId }
        });
        setSummary(finish.summary);
        setRun(undefined);
        setCurrentQuestion(undefined);
        setPhase("levels");
        await props.onRefreshProfile();
      } else if (response.result.correct && response.result.nextQuestion) {
        window.setTimeout(() => beginQuestion(response.result.nextQuestion!), 1200);
      } else {
        setPhase("playing");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交答案失败");
    } finally {
      setBusy(false);
    }
  }

  async function timeoutCurrentQuestion(activeRun: PveRun, question: PveQuestion) {
    if (timeoutBusyRef.current) {
      return;
    }
    timeoutBusyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await apiRequest<{ result: PveAnswerResult }>("/api/pve/timeout", {
        method: "POST",
        token: props.token,
        body: { runId: activeRun.runId, questionId: question.questionId }
      });
      setResult(response.result);
      setCurrentScore(response.result.totalScore);
      setAnswer("");
      setPhase("feedback");
      if (response.result.finished) {
        setSummary(response.result.summary);
        setRun(undefined);
        setCurrentQuestion(undefined);
        setPhase("levels");
        await props.onRefreshProfile();
      } else if (response.result.nextQuestion) {
        window.setTimeout(() => beginQuestion(response.result.nextQuestion!), 1500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "超时结算失败");
      setPhase("playing");
      timeoutBusyRef.current = false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="pve-shell pve-phone-shell">
      <section className="pve-phone-page">
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
            {summary ? <PveSummaryPanel summary={summary} /> : null}
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
          </section>
        ) : (
          <section className="challenge-card">
            <div className="challenge-top">
              <span>
                第 {currentQuestion.index}/{currentQuestion.total} 首
              </span>
              <strong>{phase === "countdown" ? "准备听歌" : `${run.level} 关挑战中`}</strong>
              <small>
                {phase === "playing" ? `剩余 ${secondsLeft} 秒` : "倒计时结束后自动播放，限时 30 秒"}
              </small>
            </div>
            <div className="score-strip">
              <span>当前得分</span>
              <strong>{currentScore}</strong>
            </div>
            {phase === "countdown" ? <div className="countdown-overlay">{countdown || "GO"}</div> : null}
            <div className="time-bar">
              <span style={{ width: `${Math.max(0, (secondsLeft / currentQuestion.timeLimitSeconds) * 100)}%` }} />
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
                placeholder={phase === "playing" ? "输入歌名" : "等待倒计时..."}
                disabled={phase !== "playing"}
              />
              <button disabled={busy || phase !== "playing" || !answer.trim()} onClick={submitAnswer}>
                抢答
              </button>
            </div>
            {result ? (
              <div className={`answer-result ${result.correct ? "correct" : "wrong"}`}>
                {result.correct
                  ? `答对 +${result.scoreDelta}，总分 ${result.totalScore}`
                  : result.answer
                    ? `本题超时，正确答案是《${result.answer}》`
                    : "答案不对，继续听继续猜"}
              </div>
            ) : null}
          </section>
        )}
        {error ? <div className="toast">{error}</div> : null}
      </section>
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

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(<App />);
}
