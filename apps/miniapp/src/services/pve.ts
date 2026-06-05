import { API_BASE_URL } from "./config";
import { apiRequest } from "./request";
import type { PveAnswerResult, PveLevel, PveProfile, PveQuestion, PveRun, PveSummary } from "./types";

export async function loadPveHome(): Promise<{ levels: PveLevel[]; profile: PveProfile }> {
  const levels = await apiRequest<{ levels: PveLevel[] }>("/api/pve/levels", { token: "" });
  const profile = await apiRequest<{ profile: PveProfile }>("/api/pve/profile");
  return { levels: levels.levels, profile: profile.profile };
}

export async function startPveLevel(level: number): Promise<PveRun> {
  const result = await apiRequest<{ run: PveRun }>("/api/pve/start", { method: "POST", data: { level } });
  return normalizeRun(result.run);
}

export async function markQuestionStarted(runId: string, questionId: string): Promise<void> {
  await apiRequest("/api/pve/question/start", { method: "POST", data: { runId, questionId } });
}

export async function answerQuestion(runId: string, questionId: string, answer: string): Promise<PveAnswerResult> {
  const result = await apiRequest<{ result: PveAnswerResult }>("/api/pve/answer", {
    method: "POST",
    data: { runId, questionId, answer }
  });
  return normalizeAnswerResult(result.result);
}

export async function timeoutQuestion(runId: string, questionId: string): Promise<PveAnswerResult> {
  const result = await apiRequest<{ result: PveAnswerResult }>("/api/pve/timeout", { method: "POST", data: { runId, questionId } });
  return normalizeAnswerResult(result.result);
}

export async function finishPve(runId: string): Promise<PveSummary> {
  const result = await apiRequest<{ summary: PveSummary }>("/api/pve/finish", { method: "POST", data: { runId } });
  return result.summary;
}

export function createQuestionAudio(question: PveQuestion): UniApp.InnerAudioContext {
  const audio = uni.createInnerAudioContext();
  audio.src = question.audioUrl;
  return audio;
}

function normalizeRun(run: PveRun): PveRun {
  return {
    ...run,
    questions: run.questions.map(normalizeQuestion),
    currentQuestion: normalizeQuestion(run.currentQuestion)
  };
}

function normalizeAnswerResult(result: PveAnswerResult): PveAnswerResult {
  return {
    ...result,
    nextQuestion: result.nextQuestion ? normalizeQuestion(result.nextQuestion) : undefined
  };
}

function normalizeQuestion(question: PveQuestion): PveQuestion {
  return {
    ...question,
    audioUrl: `${API_BASE_URL}/api/audio/preview/${question.songId}`
  };
}
