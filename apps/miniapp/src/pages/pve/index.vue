<template>
  <view class="pve-shell">
    <view class="pve-phone-page">
      <view class="pve-header">
        <button class="ghost-button" @tap="goHome">返回大厅</button>
        <text class="header-title">猜歌挑战</text>
        <text class="header-stamina">体力 {{ profile?.stamina.current ?? "-" }}/{{ profile?.stamina.max ?? "-" }}</text>
      </view>

      <view class="pve-hero">
        <image :src="recordAsset" mode="aspectFit" />
        <view>
          <text class="hero-title">听歌闯关</text>
          <text class="hero-copy">每关 5 首歌，服务端计时判分，星级和进度真实保存。</text>
        </view>
      </view>

      <view class="level-actions">
        <button class="green-button" :loading="loading" @tap="refresh">刷新关卡</button>
        <button class="ghost-ad-button" @tap="restoreStamina">看广告补体力</button>
      </view>

      <view class="level-list">
        <view v-for="level in levels" :key="level.level" :class="['level-card', isLocked(level.level) ? 'locked' : '']">
          <view class="level-main">
            <text class="level-index">第 {{ level.level }} 关</text>
            <text class="level-name">{{ level.name }}</text>
            <text class="level-desc">{{ level.songCount }} 首 / {{ level.timeLimitSeconds }} 秒 / 过关 {{ level.passScore }} 分</text>
          </view>
          <view class="level-meta">
            <text class="stars">{{ renderStars(progressOf(level.level)?.stars ?? 0) }}</text>
            <text class="score">最高 {{ progressOf(level.level)?.highestScore ?? 0 }}</text>
            <button class="green-button start-button" :disabled="!canStart(level.level)" @tap="start(level.level)">
              {{ isLocked(level.level) ? "未解锁" : staminaEmpty ? "体力不足" : "开始" }}
            </button>
          </view>
        </view>
      </view>
    </view>

    <BsToast :message="error" />
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { onShow } from "@dcloudio/uni-app";
import BsToast from "../../components/BsToast.vue";
import { loadPveHome, startPveLevel } from "../../services/pve";
import { restoreStaminaByAd } from "../../services/platform";
import type { PveLevel, PveProfile, PveProgress } from "../../services/types";

const levels = ref<PveLevel[]>([]);
const profile = ref<PveProfile>();
const error = ref("");
const loading = ref(false);
const recordAsset = "/static/home-assets/record.svg";

const staminaEmpty = computed(() => (profile.value?.stamina.current ?? 0) <= 0);

onShow(() => {
  void refresh();
});

async function refresh() {
  loading.value = true;
  error.value = "";
  try {
    const data = await loadPveHome();
    levels.value = data.levels;
    profile.value = data.profile;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

function progressOf(level: number): PveProgress | undefined {
  return profile.value?.progress.find((row) => row.level === level);
}

function isLocked(level: number): boolean {
  return level > (profile.value?.highestUnlockedLevel ?? 1);
}

function canStart(level: number): boolean {
  return !isLocked(level) && !staminaEmpty.value && !loading.value;
}

async function start(level: number) {
  error.value = "";
  try {
    const run = await startPveLevel(level);
    uni.setStorageSync("brainsync.pve.run", run);
    uni.navigateTo({ url: "/pages/pve/play" });
  } catch (err) {
    error.value = err instanceof Error ? err.message : "开始失败";
  }
}

async function restoreStamina() {
  error.value = "";
  try {
    const stamina = await restoreStaminaByAd();
    if (profile.value) {
      profile.value.stamina = stamina;
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : "广告奖励失败";
  }
}

function renderStars(stars: number): string {
  return "★".repeat(stars) + "☆".repeat(Math.max(0, 3 - stars));
}

function goHome() {
  uni.navigateBack();
}
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

.header-stamina {
  color: #087443;
  font-size: 24rpx;
  font-weight: 800;
}

.pve-hero {
  display: flex;
  align-items: center;
  gap: 22rpx;
  margin: 24rpx 28rpx 0;
  padding: 26rpx;
  border: 4rpx solid rgba(255, 255, 255, 0.86);
  border-radius: 26rpx;
  background: linear-gradient(135deg, rgba(255, 247, 199, 0.94), rgba(200, 255, 217, 0.9));
  box-shadow: 0 16rpx 40rpx rgba(31, 35, 41, 0.08);
}

.pve-hero image {
  width: 124rpx;
  height: 124rpx;
}

.pve-hero view {
  display: grid;
  gap: 8rpx;
}

.hero-title {
  color: #0c6b3e;
  font-size: 42rpx;
  font-weight: 900;
}

.hero-copy {
  color: #43715a;
  font-size: 24rpx;
  line-height: 1.45;
}

.level-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16rpx;
  padding: 24rpx 28rpx 0;
}

.ghost-ad-button {
  min-height: 42px;
  border-radius: 8px;
  color: #087443;
  background: #e9fbf1;
  font-weight: 800;
}

.level-list {
  display: grid;
  gap: 20rpx;
  padding: 24rpx 28rpx 48rpx;
}

.level-card {
  min-height: 184rpx;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 24rpx;
  align-items: center;
  padding: 28rpx;
  border: 4rpx solid rgba(255, 255, 255, 0.86);
  border-radius: 26rpx;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 16rpx 40rpx rgba(31, 35, 41, 0.05);
}

.level-main,
.level-meta {
  display: grid;
  gap: 10rpx;
}

.level-index {
  color: #07a85a;
  font-size: 24rpx;
  font-weight: 800;
}

.level-name {
  color: #1f2329;
  font-size: 36rpx;
  font-weight: 900;
}

.level-desc,
.score {
  color: #687076;
  font-size: 24rpx;
}

.level-meta {
  justify-items: end;
}

.stars {
  color: #f5b700;
  font-size: 28rpx;
  letter-spacing: 2rpx;
}

.start-button {
  min-width: 132rpx;
  min-height: 64rpx;
  font-size: 24rpx;
}

.level-card.locked {
  opacity: 0.58;
}
</style>
