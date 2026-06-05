<template>
  <view class="pve-shell">
    <view class="pve-phone-page">
      <view class="pve-header">
        <button class="ghost-button" @tap="goBack">返回关卡</button>
        <text class="header-title">听歌抢答</text>
        <text class="header-score">{{ currentScore }} 分</text>
      </view>

      <view v-if="summary" class="pve-summary">
        <text class="summary-title">{{ summary.passed ? "闯关成功" : "再试一次" }}</text>
        <text class="summary-score">{{ summary.totalScore }}</text>
        <text class="summary-copy">答对 {{ summary.correctCount }} 首 / 星级 {{ renderStars(summary.stars) }} / 最快 {{ fastestText }}</text>
        <button class="green-button" @tap="goBack">返回关卡</button>
      </view>

      <view v-else-if="question" class="challenge-card">
        <view class="challenge-top">
          <text class="round-label">第 {{ question.index }}/{{ question.total }} 首</text>
          <text class="challenge-title">{{ phase === "countdown" ? "准备听歌" : `${run?.level ?? "-"} 关挑战中` }}</text>
          <text class="challenge-copy">{{ phase === "playing" ? `剩余 ${secondsLeft} 秒` : "倒计时结束后开始计时，限时抢答" }}</text>
        </view>

        <view class="score-strip">
          <text>当前得分</text>
          <text>{{ currentScore }}</text>
        </view>

        <view v-if="phase === 'countdown'" class="countdown-overlay">{{ countdown || "GO" }}</view>

        <view class="time-bar">
          <view :style="{ width: `${timePercent}%` }"></view>
        </view>

        <view :class="['pve-audio', question.audioFilter]">
          <button class="audio-button" @tap="playAudio">播放语音 15''</button>
          <text class="audio-copy">小程序端通过真实音频代理播放，不缓存、不伪造歌曲源。</text>
        </view>

        <view class="answer-row">
          <input v-model="answer" class="answer-input" :disabled="phase !== 'playing'" :placeholder="phase === 'playing' ? '输入歌名' : '等待倒计时...'" confirm-type="send" @confirm="submit" />
          <button class="green-button answer-button" :disabled="phase !== 'playing' || !answer.trim() || busy" @tap="submit">抢答</button>
        </view>

        <view v-if="feedback" :class="['answer-result', feedbackCorrect ? 'correct' : 'wrong']">{{ feedback }}</view>
      </view>
    </view>

    <BsToast :message="error" />
  </view>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import BsToast from "../../components/BsToast.vue";
import { answerQuestion, createQuestionAudio, finishPve, markQuestionStarted, timeoutQuestion } from "../../services/pve";
import type { PveQuestion, PveRun, PveSummary } from "../../services/types";

type Phase = "countdown" | "playing" | "feedback";

const run = ref<PveRun | undefined>(uni.getStorageSync("brainsync.pve.run") as PveRun | undefined);
const question = ref<PveQuestion | undefined>(run.value?.currentQuestion);
const summary = ref<PveSummary>();
const phase = ref<Phase>("countdown");
const countdown = ref(3);
const secondsLeft = ref(question.value?.timeLimitSeconds ?? 0);
const currentScore = ref(0);
const answer = ref("");
const feedback = ref("");
const feedbackCorrect = ref(false);
const error = ref("");
const busy = ref(false);
let timer: number | undefined;
let audio: UniApp.InnerAudioContext | undefined;
let timeoutBusy = false;

const timePercent = computed(() => {
  if (!question.value?.timeLimitSeconds) {
    return 0;
  }
  return Math.max(0, Math.min(100, (secondsLeft.value / question.value.timeLimitSeconds) * 100));
});

const fastestText = computed(() => {
  if (!summary.value?.fastestMs) {
    return "-";
  }
  return `${(summary.value.fastestMs / 1000).toFixed(1)} 秒`;
});

void begin();

async function begin() {
  if (!run.value || !question.value) {
    error.value = "PVE挑战状态缺失";
    return;
  }
  audio?.destroy();
  feedback.value = "";
  feedbackCorrect.value = false;
  answer.value = "";
  timeoutBusy = false;
  countdown.value = 3;
  secondsLeft.value = question.value.timeLimitSeconds;
  phase.value = "countdown";
  resetTimer(async () => {
    countdown.value -= 1;
    if (countdown.value <= 0) {
      clearTimer();
      await startQuestionClock();
    }
  }, 1000);
}

async function startQuestionClock() {
  if (!run.value || !question.value) {
    return;
  }
  try {
    await markQuestionStarted(run.value.runId, question.value.questionId);
    phase.value = "playing";
    playAudio();
    resetTimer(async () => {
      secondsLeft.value -= 1;
      if (secondsLeft.value <= 0) {
        clearTimer();
        await timeoutCurrent();
      }
    }, 1000);
  } catch (err) {
    phase.value = "feedback";
    error.value = err instanceof Error ? err.message : "题目开始失败";
  }
}

function resetTimer(handler: () => void | Promise<void>, delay: number) {
  clearTimer();
  timer = setInterval(() => {
    void handler();
  }, delay) as unknown as number;
}

function clearTimer() {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}

function playAudio() {
  if (!question.value) {
    return;
  }
  audio?.destroy();
  audio = createQuestionAudio(question.value);
  audio.play();
}

async function submit() {
  if (!run.value || !question.value || !answer.value.trim() || phase.value !== "playing") {
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    const result = await answerQuestion(run.value.runId, question.value.questionId, answer.value);
    currentScore.value = result.totalScore;
    feedbackCorrect.value = result.correct;
    feedback.value = result.correct ? `答对 +${result.scoreDelta}，总分 ${result.totalScore}` : "答案不对，继续听继续猜";
    answer.value = "";
    if (result.finished) {
      clearTimer();
      summary.value = result.summary ?? (await finishPve(run.value.runId));
      return;
    }
    if (result.correct && result.nextQuestion) {
      phase.value = "feedback";
      setTimeout(() => {
        question.value = result.nextQuestion;
        void begin();
      }, 1200);
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : "提交答案失败";
  } finally {
    busy.value = false;
  }
}

async function timeoutCurrent() {
  if (!run.value || !question.value || timeoutBusy) {
    return;
  }
  timeoutBusy = true;
  busy.value = true;
  error.value = "";
  try {
    const result = await timeoutQuestion(run.value.runId, question.value.questionId);
    currentScore.value = result.totalScore;
    feedbackCorrect.value = false;
    feedback.value = `本题超时，正确答案是《${result.answer}》`;
    if (result.finished) {
      summary.value = result.summary ?? (await finishPve(run.value.runId));
      return;
    }
    if (result.nextQuestion) {
      phase.value = "feedback";
      setTimeout(() => {
        question.value = result.nextQuestion;
        void begin();
      }, 1500);
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : "超时结算失败";
    phase.value = "playing";
    timeoutBusy = false;
  } finally {
    busy.value = false;
  }
}

function renderStars(stars: number): string {
  return "★".repeat(stars) + "☆".repeat(Math.max(0, 3 - stars));
}

function goBack() {
  clearTimer();
  audio?.destroy();
  uni.redirectTo({ url: "/pages/pve/index" });
}

onBeforeUnmount(() => {
  clearTimer();
  audio?.destroy();
});
</script>

<style scoped>
.pve-shell {
  min-height: 100vh;
  display: grid;
  justify-items: center;
  background: #dfeff7;
}

.pve-phone-page {
  width: 100vw;
  max-width: 493px;
  min-height: 100vh;
  background:
    radial-gradient(circle at 80% 11%, rgba(255, 245, 175, 0.42), transparent 18%),
    url("/static/home-assets/bg-living-room.svg") top center / cover no-repeat;
  box-shadow: 0 36rpx 92rpx rgba(35, 71, 58, 0.2);
}

.pve-header {
  min-height: 116rpx;
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 20rpx;
  align-items: center;
  padding: 20rpx 28rpx;
  border-bottom: 2rpx solid #e5e8eb;
  background: rgba(255, 255, 255, 0.9);
}

.header-title {
  text-align: center;
  font-size: 32rpx;
  font-weight: 900;
}

.header-score {
  color: #087443;
  font-size: 24rpx;
  font-weight: 800;
}

.challenge-card,
.pve-summary {
  position: relative;
  width: calc(100% - 56rpx);
  display: grid;
  gap: 28rpx;
  margin: 220rpx auto 0;
  padding: 36rpx;
  border: 4rpx solid rgba(255, 255, 255, 0.9);
  border-radius: 32rpx;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 28rpx 68rpx rgba(31, 35, 41, 0.08);
}

.challenge-top {
  display: grid;
  gap: 8rpx;
}

.round-label {
  color: #07a85a;
  font-size: 24rpx;
  font-weight: 800;
}

.challenge-title {
  color: #1f2329;
  font-size: 42rpx;
  font-weight: 900;
}

.challenge-copy {
  color: #687076;
  font-size: 24rpx;
}

.score-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 24rpx;
  border-radius: 24rpx;
  color: #087443;
  background: linear-gradient(90deg, #e8fbef, #fff7c2);
  box-shadow: inset 0 0 0 2rpx rgba(7, 193, 96, 0.12);
  font-weight: 900;
}

.score-strip text:last-child {
  font-size: 40rpx;
  line-height: 1;
}

.countdown-overlay {
  position: absolute;
  inset: 0;
  z-index: 4;
  display: grid;
  place-items: center;
  border-radius: 32rpx;
  color: #07a85a;
  background: rgba(255, 255, 255, 0.84);
  font-size: 160rpx;
  font-weight: 900;
  text-shadow: 0 10rpx 0 rgba(7, 193, 96, 0.16);
}

.time-bar {
  height: 18rpx;
  overflow: hidden;
  border-radius: 999rpx;
  background: #dcefe6;
}

.time-bar view {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #07c160, #ffe15c);
  transition: width 0.2s linear;
}

.pve-audio {
  display: grid;
  gap: 12rpx;
  padding: 28rpx;
  border-radius: 16rpx;
  background: #effcf4;
}

.pve-audio.short {
  background: #fff8dc;
}

.pve-audio.muffled {
  background: #eef5ff;
}

.audio-button {
  min-height: 68rpx;
  border-radius: 14rpx;
  color: #087443;
  background: #fff;
  font-weight: 900;
}

.audio-copy {
  color: #687076;
  font-size: 22rpx;
  line-height: 1.45;
}

.answer-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 16rpx;
}

.answer-input {
  min-height: 76rpx;
  padding: 0 22rpx;
  border: 2rpx solid #d0d5dd;
  border-radius: 12rpx;
  background: #fff;
}

.answer-button {
  min-width: 120rpx;
}

.answer-result {
  padding: 20rpx 24rpx;
  border-radius: 16rpx;
  font-size: 26rpx;
  line-height: 1.45;
}

.answer-result.correct {
  color: #087443;
  background: #e9fbf1;
}

.answer-result.wrong {
  color: #b42318;
  background: #fff1f0;
}

.pve-summary {
  margin-top: 180rpx;
  text-align: center;
  background: #fff7d6;
}

.summary-title {
  color: #133a26;
  font-size: 44rpx;
  font-weight: 900;
}

.summary-score {
  color: #07a85a;
  font-size: 76rpx;
  font-weight: 900;
}

.summary-copy {
  color: #5f674f;
  font-size: 26rpx;
  line-height: 1.5;
}
</style>
