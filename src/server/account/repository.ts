import type { SongEntry } from "../../shared/types";

export interface AccountUserRecord {
  id: string;
  username: string;
  passwordHash: string;
  nickname: string;
  title: string;
  openid?: string | null;
  createdAt: number;
}

export interface PublicUser {
  id: string;
  username: string;
  nickname: string;
  title: string;
  createdAt: number;
}

export interface SessionRecord {
  token: string;
  userId: string;
  expiresAt: number;
  createdAt: number;
}

export interface StaminaRecord {
  userId: string;
  current: number;
  max: number;
  lastRecoveredAt: number;
  adRestoreCount: number;
}

export interface PveProgressRecord {
  userId: string;
  level: number;
  highestScore: number;
  stars: number;
  passed: boolean;
  updatedAt: number;
}

export type PveRunStatus = "playing" | "finished";

export interface PveRunQuestionRecord {
  questionId: string;
  song: SongEntry;
  timeLimitSeconds: number;
  startedAt?: number;
  answeredAt?: number;
  timedOutAt?: number;
  correct?: boolean;
  scoreDelta?: number;
  wrongCount?: number;
}

export interface PveRunSummaryRecord {
  totalScore: number;
  correctCount: number;
  fastestMs?: number;
  stars: number;
  passed: boolean;
}

export interface PveRunRecord {
  id: string;
  userId: string;
  level: number;
  status: PveRunStatus;
  questions: PveRunQuestionRecord[];
  currentIndex: number;
  totalScore: number;
  correctCount: number;
  combo: number;
  fastestMs?: number;
  startedAt: number;
  currentQuestionStartedAt: number;
  finishedAt?: number;
  summary?: PveRunSummaryRecord;
}

export interface AccountRepository {
  findUserByUsername(username: string): Promise<AccountUserRecord | undefined>;
  findUserById(userId: string): Promise<AccountUserRecord | undefined>;
  createUser(user: AccountUserRecord): Promise<void>;
  createSession(session: SessionRecord): Promise<void>;
  findSession(token: string): Promise<SessionRecord | undefined>;
  deleteSession(token: string): Promise<void>;
  getStamina(userId: string): Promise<StaminaRecord | undefined>;
  upsertStamina(stamina: StaminaRecord): Promise<void>;
  listProgress(userId: string): Promise<PveProgressRecord[]>;
  getProgress(userId: string, level: number): Promise<PveProgressRecord | undefined>;
  upsertProgress(progress: PveProgressRecord): Promise<void>;
  createRun(run: PveRunRecord): Promise<void>;
  getRun(runId: string): Promise<PveRunRecord | undefined>;
  updateRun(run: PveRunRecord): Promise<void>;
}

export function toPublicUser(user: AccountUserRecord): PublicUser {
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    title: user.title,
    createdAt: user.createdAt
  };
}
