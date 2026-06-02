import { randomBytes } from "node:crypto";
import type {
  AccountRepository,
  PveProgressRecord,
  PveRunQuestionRecord,
  PveRunRecord,
  PveRunSummaryRecord,
  StaminaRecord
} from "../account/repository";
import type { PveLevelConfig } from "./levels";
import type { SongEntry } from "../../shared/types";

const DEFAULT_MAX_STAMINA = 5;
const DEFAULT_STAMINA_RECOVERY_MS = 30 * 60 * 1000;

export interface CreatePveServiceOptions {
  repo: AccountRepository;
  songs: SongEntry[];
  levels: PveLevelConfig[];
  now?: () => number;
  random?: () => number;
  randomId?: () => string;
  maxStamina?: number;
  staminaRecoveryMs?: number;
}

export interface PublicPveQuestion {
  questionId: string;
  songId: string;
  index: number;
  total: number;
  audioUrl: string;
  sourceUrl: string;
  timeLimitSeconds: number;
  audioFilter: PveLevelConfig["audioFilter"];
}

export interface PveProfile {
  stamina: StaminaRecord;
  highestUnlockedLevel: number;
  progress: PveProgressRecord[];
}

export interface PveStartResult {
  runId: string;
  level: number;
  questions: PublicPveQuestion[];
  currentQuestion: PublicPveQuestion;
  stamina: StaminaRecord;
}

export interface PveAnswerPayload {
  runId: string;
  questionId: string;
  answer: string;
}

export interface PveAnswerResult {
  correct: boolean;
  answer: string;
  scoreDelta: number;
  totalScore: number;
  correctCount: number;
  nextQuestion?: PublicPveQuestion;
  finished: boolean;
}

export interface PveFinishResult extends PveRunSummaryRecord {
  level: number;
  runId: string;
}

export interface PveService {
  profile(userId: string): Promise<PveProfile>;
  levels(): PveLevelConfig[];
  start(userId: string, level: number): Promise<PveStartResult>;
  answer(userId: string, payload: PveAnswerPayload): Promise<PveAnswerResult>;
  finish(userId: string, runId: string): Promise<PveFinishResult>;
}

export function createPveService(options: CreatePveServiceOptions): PveService {
  validateOptions(options);
  return new DefaultPveService(options);
}

class DefaultPveService implements PveService {
  private readonly repo: AccountRepository;
  private readonly songPool: SongEntry[];
  private readonly levelConfigs: PveLevelConfig[];
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly randomId: () => string;
  private readonly maxStamina: number;
  private readonly staminaRecoveryMs: number;

  constructor(options: CreatePveServiceOptions) {
    this.repo = options.repo;
    this.songPool = [...options.songs];
    this.levelConfigs = [...options.levels].sort((a, b) => a.level - b.level);
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.randomId = options.randomId ?? (() => randomBytes(12).toString("hex"));
    this.maxStamina = options.maxStamina ?? DEFAULT_MAX_STAMINA;
    this.staminaRecoveryMs = options.staminaRecoveryMs ?? DEFAULT_STAMINA_RECOVERY_MS;
  }

  async profile(userId: string): Promise<PveProfile> {
    const stamina = await this.getRecoveredStamina(userId);
    const progress = (await this.repo.listProgress(userId)).sort((a, b) => a.level - b.level);
    return {
      stamina,
      progress,
      highestUnlockedLevel: resolveHighestUnlockedLevel(progress)
    };
  }

  levels(): PveLevelConfig[] {
    return this.levelConfigs.map((level) => ({ ...level, starScores: [...level.starScores] as [number, number, number] }));
  }

  async start(userId: string, level: number): Promise<PveStartResult> {
    const config = this.requireLevel(level);
    await this.requireLevelUnlocked(userId, level);
    const stamina = await this.getRecoveredStamina(userId);
    if (stamina.current <= 0) {
      throw new Error("体力不足");
    }
    const questions = this.pickQuestions(config);
    const now = this.now();
    const run: PveRunRecord = {
      id: `run_${this.randomId()}`,
      userId,
      level,
      status: "playing",
      questions,
      currentIndex: 0,
      totalScore: 0,
      correctCount: 0,
      combo: 0,
      startedAt: now,
      currentQuestionStartedAt: now
    };
    stamina.current -= 1;
    await this.repo.upsertStamina(stamina);
    await this.repo.createRun(run);
    const publicQuestions = questions.map((question, index) => toPublicQuestion(question, index, config));
    return {
      runId: run.id,
      level,
      questions: publicQuestions,
      currentQuestion: publicQuestions[0],
      stamina
    };
  }

  async answer(userId: string, payload: PveAnswerPayload): Promise<PveAnswerResult> {
    const run = await this.requireRunForUser(payload.runId, userId);
    if (run.status !== "playing") {
      throw new Error("挑战已结束");
    }
    const question = run.questions[run.currentIndex];
    if (!question) {
      throw new Error("PVE挑战状态异常：当前题目缺失");
    }
    if (question.questionId !== payload.questionId) {
      throw new Error("题目顺序异常，请刷新挑战状态");
    }
    const config = this.requireLevel(run.level);
    const elapsedMs = Math.max(0, this.now() - run.currentQuestionStartedAt);
    const correct = isSongAnswer(payload.answer, question.song);
    const answerTitle = question.song.title;
    let scoreDelta = 0;
    if (correct) {
      run.combo += 1;
      scoreDelta = Math.max(0, scoreQuestion(elapsedMs, config.timeLimitSeconds, run.combo) - (question.wrongCount ?? 0) * 100);
      run.totalScore += scoreDelta;
      run.correctCount += 1;
      run.fastestMs = run.fastestMs === undefined ? elapsedMs : Math.min(run.fastestMs, elapsedMs);
      question.answeredAt = this.now();
      question.correct = true;
      question.scoreDelta = scoreDelta;
      run.currentIndex += 1;
      run.currentQuestionStartedAt = this.now();
    } else {
      run.combo = 0;
      question.wrongCount = (question.wrongCount ?? 0) + 1;
    }
    const finished = run.currentIndex >= run.questions.length;
    if (finished) {
      await this.finalizeRun(run, config);
    } else {
      await this.repo.updateRun(run);
    }
    return {
      correct,
      answer: correct ? answerTitle : "",
      scoreDelta,
      totalScore: run.totalScore,
      correctCount: run.correctCount,
      nextQuestion: finished ? undefined : toPublicQuestion(run.questions[run.currentIndex], run.currentIndex, config),
      finished
    };
  }

  async finish(userId: string, runId: string): Promise<PveFinishResult> {
    const run = await this.requireRunForUser(runId, userId);
    const config = this.requireLevel(run.level);
    if (run.status === "playing") {
      await this.finalizeRun(run, config);
    }
    if (!run.summary) {
      throw new Error("PVE结算状态异常");
    }
    return { runId: run.id, level: run.level, ...run.summary };
  }

  private async getRecoveredStamina(userId: string): Promise<StaminaRecord> {
    const existing = await this.repo.getStamina(userId);
    const now = this.now();
    const stamina: StaminaRecord =
      existing ?? { userId, current: this.maxStamina, max: this.maxStamina, lastRecoveredAt: now, adRestoreCount: 0 };
    if (stamina.current >= stamina.max) {
      stamina.lastRecoveredAt = now;
      await this.repo.upsertStamina(stamina);
      return stamina;
    }
    const recovered = Math.floor((now - stamina.lastRecoveredAt) / this.staminaRecoveryMs);
    if (recovered > 0) {
      stamina.current = Math.min(stamina.max, stamina.current + recovered);
      stamina.lastRecoveredAt += recovered * this.staminaRecoveryMs;
      if (stamina.current >= stamina.max) {
        stamina.lastRecoveredAt = now;
      }
      await this.repo.upsertStamina(stamina);
    }
    return stamina;
  }

  private async requireLevelUnlocked(userId: string, level: number): Promise<void> {
    const progress = await this.repo.listProgress(userId);
    const highestUnlocked = resolveHighestUnlockedLevel(progress);
    if (level > highestUnlocked) {
      throw new Error(`关卡未解锁：${level}`);
    }
  }

  private pickQuestions(config: PveLevelConfig): PveRunQuestionRecord[] {
    if (this.songPool.length < config.songCount) {
      throw new Error(`歌曲题库不足：关卡 ${config.level} 需要 ${config.songCount} 首歌`);
    }
    const deck = [...this.songPool];
    const questions: PveRunQuestionRecord[] = [];
    for (let i = 0; i < config.songCount; i += 1) {
      const index = Math.min(deck.length - 1, Math.floor(this.random() * deck.length));
      const [song] = deck.splice(index, 1);
      if (!song) {
        throw new Error("歌曲题库状态异常：无法抽取PVE歌曲");
      }
      questions.push({
        questionId: `q_${i + 1}_${this.randomId()}`,
        song,
        timeLimitSeconds: config.timeLimitSeconds
      });
    }
    return questions;
  }

  private async requireRunForUser(runId: string, userId: string): Promise<PveRunRecord> {
    const run = await this.repo.getRun(runId);
    if (!run) {
      throw new Error(`PVE挑战记录不存在：${runId}`);
    }
    if (run.userId !== userId) {
      throw new Error("不能操作其他玩家的挑战记录");
    }
    return run;
  }

  private requireLevel(level: number): PveLevelConfig {
    const config = this.levelConfigs.find((item) => item.level === level);
    if (!config) {
      throw new Error(`关卡不存在：${level}`);
    }
    return config;
  }

  private async finalizeRun(run: PveRunRecord, config: PveLevelConfig): Promise<void> {
    if (run.status === "finished" && run.summary) {
      return;
    }
    const stars = calculateStars(run.totalScore, config.starScores);
    const passed = run.totalScore >= config.passScore;
    run.status = "finished";
    run.finishedAt = this.now();
    run.summary = {
      totalScore: run.totalScore,
      correctCount: run.correctCount,
      fastestMs: run.fastestMs,
      stars,
      passed
    };
    await this.upsertBestProgress(run, stars, passed);
    await this.repo.updateRun(run);
  }

  private async upsertBestProgress(run: PveRunRecord, stars: number, passed: boolean): Promise<void> {
    const existing = await this.repo.getProgress(run.userId, run.level);
    const next: PveProgressRecord = {
      userId: run.userId,
      level: run.level,
      highestScore: Math.max(existing?.highestScore ?? 0, run.totalScore),
      stars: Math.max(existing?.stars ?? 0, stars),
      passed: Boolean(existing?.passed || passed),
      updatedAt: this.now()
    };
    await this.repo.upsertProgress(next);
  }
}

function validateOptions(options: CreatePveServiceOptions): void {
  if (options.levels.length === 0) {
    throw new Error("PVE关卡配置不能为空");
  }
  if (options.songs.length === 0) {
    throw new Error("PVE歌曲题库不能为空");
  }
}

function toPublicQuestion(question: PveRunQuestionRecord, index: number, config: PveLevelConfig): PublicPveQuestion {
  return {
    questionId: question.questionId,
    songId: question.song.id,
    index: index + 1,
    total: config.songCount,
    audioUrl: question.song.previewUrl,
    sourceUrl: question.song.sourceUrl,
    timeLimitSeconds: question.timeLimitSeconds,
    audioFilter: config.audioFilter
  };
}

function isSongAnswer(answer: string, song: SongEntry): boolean {
  const normalized = normalizeAnswer(answer);
  return [song.title, ...song.aliases].some((candidate) => normalizeAnswer(candidate) === normalized);
}

function normalizeAnswer(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[《》“”"'‘’\s,，.。!！?？:：;；\-_/\\()[\]【】]/g, "");
}

function scoreQuestion(elapsedMs: number, timeLimitSeconds: number, combo: number): number {
  const limitMs = timeLimitSeconds * 1000;
  if (elapsedMs > limitMs) {
    return 0;
  }
  const baseScore = 400;
  const speedScore = Math.round(500 * Math.max(0, 1 - elapsedMs / limitMs));
  const comboScore = Math.min(100, Math.max(0, combo - 1) * 25);
  return Math.min(1000, baseScore + speedScore + comboScore);
}

function calculateStars(score: number, starScores: [number, number, number]): number {
  if (score >= starScores[2]) {
    return 3;
  }
  if (score >= starScores[1]) {
    return 2;
  }
  if (score >= starScores[0]) {
    return 1;
  }
  return 0;
}

function resolveHighestUnlockedLevel(progress: PveProgressRecord[]): number {
  const passedLevels = progress.filter((row) => row.passed).map((row) => row.level);
  return passedLevels.length === 0 ? 1 : Math.max(...passedLevels) + 1;
}
