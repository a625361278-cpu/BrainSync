export type GameType = "idiom" | "song" | "silhouette" | "movie";
export type RoomStatus = "waiting" | "playing" | "finished";
export type MessageSender = "bot" | "player" | "system";
export type MessageKind = "chat" | "round" | "audio" | "image" | "hint" | "result" | "system";

export interface PublicUser {
  id: string;
  username: string;
  nickname: string;
  title: string;
  createdAt: number;
}

export interface Stamina {
  current: number;
  max: number;
  lastRecoveredAt: number;
  adRestoreCount: number;
}

export interface PveProgress {
  level: number;
  highestScore: number;
  stars: number;
  passed: boolean;
}

export interface PveProfile {
  stamina: Stamina;
  highestUnlockedLevel: number;
  progress: PveProgress[];
}

export interface PveLevel {
  level: number;
  name: string;
  songCount: number;
  timeLimitSeconds: number;
  passScore: number;
  starScores: [number, number, number];
  audioFilter: "phone" | "muffled" | "short";
  difficultyRange: [number, number];
}

export interface PveQuestion {
  questionId: string;
  songId: string;
  index: number;
  total: number;
  audioUrl: string;
  sourceUrl: string;
  timeLimitSeconds: number;
  audioFilter: PveLevel["audioFilter"];
}

export interface PveRun {
  runId: string;
  level: number;
  questions: PveQuestion[];
  currentQuestion: PveQuestion;
  stamina: Stamina;
}

export interface PveAnswerResult {
  correct: boolean;
  answer: string;
  scoreDelta: number;
  totalScore: number;
  correctCount: number;
  nextQuestion?: PveQuestion;
  finished: boolean;
  summary?: PveSummary;
}

export interface PveSummary {
  runId: string;
  level: number;
  totalScore: number;
  correctCount: number;
  fastestMs?: number;
  stars: number;
  passed: boolean;
}

export interface Player {
  id: string;
  name: string;
  avatar: string;
  score: number;
  connected: boolean;
}

export interface ChatMessage {
  id: string;
  sender: MessageSender;
  kind: MessageKind;
  text: string;
  atPlayerId?: string;
  playerId?: string;
  playerName?: string;
  avatar?: string;
  audioUrl?: string;
  imageUrl?: string;
  imageAlt?: string;
  createdAt: number;
}

export interface PublicQuestion {
  questionId: string;
  gameType: GameType;
  round: number;
  totalRounds: number;
  prompt: string;
  audioUrl?: string;
  imageUrl?: string;
  sourceUrl?: string;
  endsWithPinyin?: string;
}

export interface RoomSnapshot {
  code: string;
  status: RoomStatus;
  hostId: string;
  gameType?: GameType;
  currentQuestion?: PublicQuestion;
  players: Player[];
  messages: ChatMessage[];
  settlement?: Array<{ playerId: string; name: string; score: number }>;
}
