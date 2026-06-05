<template>
  <view class="home-shell">
    <view class="mini-home-page">
      <view class="home-topbar">
        <view class="home-player">
          <image class="player-avatar" :src="displayAvatar" mode="aspectFill" />
          <view>
            <text class="player-name">{{ user?.nickname ?? "欢迎来到 BrainSync" }}</text>
            <text class="player-title">{{ user?.title ?? "未登录" }}</text>
          </view>
        </view>
        <view class="home-actions">
          <button class="round-action" @tap="showPending('好友功能筹备中')">
            <text class="action-icon">👥</text>
            <text class="action-label">好友</text>
          </button>
          <button class="round-action has-dot" @tap="showPending('消息功能筹备中')">
            <text class="action-icon">💬</text>
            <text class="action-label">消息</text>
          </button>
          <button class="capsule-action" @tap="showPending('更多功能筹备中')">•••</button>
        </view>
      </view>

      <view class="home-title-stage">
        <image class="floating-note note-left" :src="homeAssets.note" mode="aspectFit" />
        <image class="floating-note note-right" :src="homeAssets.note" mode="aspectFit" />
        <image class="home-logo" :src="homeAssets.logo" mode="aspectFit" />
        <view class="bot-speech">嗨！欢迎来到BrainSync，一起猜歌接龙，快乐翻倍！</view>
        <image class="hero-microphone" :src="homeAssets.microphone" mode="aspectFit" />
        <image class="hero-robot" :src="homeAssets.robot" mode="aspectFit" />
      </view>

      <view class="home-main-modes">
        <view class="big-mode guess-mode">
          <text class="mode-ribbon">主打玩法</text>
          <text class="mode-title">猜歌挑战</text>
          <text class="mode-desc">听歌猜歌名，赢星星！</text>
          <view class="stamina-badge">⚡ {{ staminaText }}</view>
          <view class="star-track">★★★★</view>
          <image class="mode-art record-art" :src="homeAssets.record" mode="aspectFit" />
          <button class="primary-pill mode-button" @tap="openPve">开始挑战</button>
        </view>

        <view class="big-mode room-mode">
          <text class="mode-title">开房间对战</text>
          <text class="mode-desc">邀请好友，实时对战</text>
          <view class="room-game-tags">
            <text>成语</text>
            <text>猜歌</text>
            <text class="more-tag">...</text>
          </view>
          <view class="chat-vs">
            <text>•••</text>
            <text class="vs-label">VS</text>
            <text>•••</text>
          </view>
          <button class="primary-pill mode-button" @tap="openPvp">快速开始</button>
        </view>
      </view>

      <view class="home-sub-modes">
        <button class="small-mode blue" @tap="showPending('每日挑战筹备中')">
          <view>
            <text class="small-title">每日挑战</text>
            <text class="small-desc">筹备中，暂不开放</text>
          </view>
          <image :src="homeAssets.calendar" mode="aspectFit" />
        </button>
        <button class="small-mode pink" @tap="showPending('好友排行筹备中')">
          <view>
            <text class="small-title">好友排行</text>
            <text class="small-desc">筹备中，暂不开放</text>
          </view>
          <image :src="homeAssets.trophy" mode="aspectFit" />
        </button>
      </view>

      <view class="online-strip">
        <text class="online-dot"></text>
        <text>好友在线功能筹备中</text>
        <view class="friend-stack">
          <image :src="homeAssets.friend1" mode="aspectFit" />
          <image :src="homeAssets.friend2" mode="aspectFit" />
          <image :src="homeAssets.avatarDog" mode="aspectFit" />
          <image :src="homeAssets.friend3" mode="aspectFit" />
        </view>
        <button @tap="showPending('邀请好友功能筹备中')">邀请好友</button>
      </view>

      <view class="system-strip">
        <text>💬</text>
        <text class="system-message">系统消息：欢迎来到 BrainSync 欢乐房间！</text>
        <text class="system-arrow">›</text>
      </view>
    </view>

    <view v-if="showLoginModal" class="home-auth-modal">
      <view class="auth-modal-card">
        <button class="modal-close" @tap="showLoginModal = false">×</button>
        <button class="avatar-picker" open-type="chooseAvatar" @chooseavatar="chooseAvatar">
          <image :src="displayAvatar" mode="aspectFill" />
        </button>
        <text class="modal-title">欢迎来到 BrainSync</text>
        <text class="modal-copy">登录后保存体力、星级和闯关进度；开房对战会使用你确认的微信昵称。</text>
        <input
          v-model="wechatNickname"
          class="nickname-input"
          type="nickname"
          maxlength="16"
          placeholder="请选择或填写微信昵称"
        />
        <button class="green-button" :loading="busy" @tap="login">{{ user ? "刷新微信登录" : "微信一键登录" }}</button>
      </view>
    </view>

    <BsToast :message="error" />
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { onShow } from "@dcloudio/uni-app";
import BsToast from "../../components/BsToast.vue";
import { API_BASE_URL } from "../../services/config";
import { loginWithWechat, readWechatAvatarImage } from "../../services/platform";
import { loadPveHome } from "../../services/pve";
import { apiRequest } from "../../services/request";
import { readToken } from "../../services/storage";
import type { PublicUser, PveProfile } from "../../services/types";

const user = ref<PublicUser>();
const profile = ref<PveProfile>();
const busy = ref(false);
const error = ref("");
const showLoginModal = ref(false);
const wechatNickname = ref("");
const selectedAvatarPath = ref("");
const homeAssets = {
  avatarDog: "/static/home-assets/avatar-dog.svg",
  note: "/static/home-assets/note.svg",
  logo: "/static/home-assets/logo.svg",
  microphone: "/static/home-assets/microphone.svg",
  robot: "/static/home-assets/robot.svg",
  record: "/static/home-assets/record.svg",
  calendar: "/static/home-assets/calendar.svg",
  trophy: "/static/home-assets/trophy.svg",
  friend1: "/static/home-assets/friend-1.svg",
  friend2: "/static/home-assets/friend-2.svg",
  friend3: "/static/home-assets/friend-3.svg"
};

const staminaText = computed(() => {
  if (!user.value) {
    return "登录查看体力";
  }
  if (!profile.value) {
    return "体力加载中";
  }
  return `体力 ${profile.value.stamina.current}/${profile.value.stamina.max}`;
});
const displayAvatar = computed(() => {
  if (selectedAvatarPath.value) {
    return selectedAvatarPath.value;
  }
  if (user.value?.avatarUrl) {
    return assetUrl(user.value.avatarUrl);
  }
  return homeAssets.avatarDog;
});

onShow(() => {
  void restoreSession();
});

async function restoreSession() {
  error.value = "";
  if (!readToken()) {
    user.value = undefined;
    profile.value = undefined;
    showLoginModal.value = true;
    return;
  }
  try {
    const result = await apiRequest<{ user: PublicUser }>("/api/me");
    user.value = result.user;
    wechatNickname.value = result.user.nickname;
    selectedAvatarPath.value = "";
    await refreshProfile();
    showLoginModal.value = false;
  } catch (err) {
    user.value = undefined;
    profile.value = undefined;
    showLoginModal.value = true;
    error.value = err instanceof Error ? err.message : "登录状态失效";
  }
}

async function refreshProfile() {
  try {
    const result = await loadPveHome();
    profile.value = result.profile;
  } catch (err) {
    profile.value = undefined;
    error.value = err instanceof Error ? err.message : "体力和进度加载失败";
  }
}

async function login() {
  const nickname = wechatNickname.value.trim();
  if (!nickname) {
    error.value = "请先填写微信昵称";
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    const avatarImage = selectedAvatarPath.value ? await readWechatAvatarImage(selectedAvatarPath.value) : undefined;
    const result = await loginWithWechat(nickname, avatarImage);
    user.value = result.user;
    wechatNickname.value = result.user.nickname;
    selectedAvatarPath.value = "";
    await refreshProfile();
    showLoginModal.value = false;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "微信登录失败";
  } finally {
    busy.value = false;
  }
}

function openPve() {
  if (!user.value) {
    showLoginModal.value = true;
    return;
  }
  uni.navigateTo({ url: "/pages/pve/index" });
}

function openPvp() {
  if (!user.value) {
    showLoginModal.value = true;
    return;
  }
  uni.navigateTo({ url: "/pages/pvp/index" });
}

function showPending(message: string) {
  error.value = message;
}

function chooseAvatar(event: { detail?: { avatarUrl?: string } }) {
  const avatarUrl = event.detail?.avatarUrl?.trim();
  if (!avatarUrl) {
    error.value = "微信头像选择失败";
    return;
  }
  selectedAvatarPath.value = avatarUrl;
}

function assetUrl(path: string): string {
  if (path.startsWith("http") || path.startsWith("/static/")) {
    return path;
  }
  return `${API_BASE_URL}${path}`;
}
</script>

<style scoped>
.home-shell {
  min-height: 100vh;
  display: grid;
  justify-items: center;
  background: #dfeff7;
}

.mini-home-page {
  position: relative;
  width: 100vw;
  max-width: 493px;
  min-height: 100vh;
  overflow: hidden;
  padding: 18rpx 20rpx 32rpx;
  background: url("/static/home-assets/bg-living-room.svg") top center / cover no-repeat;
  box-shadow: 0 36rpx 92rpx rgba(35, 71, 58, 0.2);
}

.home-topbar {
  position: relative;
  z-index: 3;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14rpx;
  padding-top: 8rpx;
}

.home-player {
  display: flex;
  align-items: center;
  gap: 14rpx;
  min-width: 0;
}

.player-avatar {
  width: 100rpx;
  height: 100rpx;
  border-radius: 50%;
  box-shadow: 0 8rpx 24rpx rgba(36, 76, 54, 0.22);
}

.home-player view {
  display: grid;
  gap: 6rpx;
}

.player-name {
  max-width: 236rpx;
  overflow: hidden;
  color: #1e2d25;
  font-size: 30rpx;
  font-weight: 900;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player-title {
  width: fit-content;
  padding: 4rpx 16rpx;
  border-radius: 999rpx;
  color: #fff;
  background: #33c766;
  font-size: 22rpx;
  font-weight: 800;
}

.home-actions {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.round-action,
.capsule-action {
  color: #223128;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 10rpx 28rpx rgba(36, 76, 54, 0.12);
}

.round-action {
  position: relative;
  width: 76rpx;
  height: 88rpx;
  display: grid;
  place-items: center;
  gap: 2rpx;
  border-radius: 26rpx;
}

.action-icon {
  font-size: 32rpx;
  line-height: 1;
}

.action-label {
  color: #5a675f;
  font-size: 18rpx;
  line-height: 1;
}

.round-action.has-dot::after {
  content: "";
  position: absolute;
  top: 10rpx;
  right: 10rpx;
  width: 14rpx;
  height: 14rpx;
  border: 4rpx solid #fff;
  border-radius: 50%;
  background: #f04438;
}

.capsule-action {
  width: 114rpx;
  height: 68rpx;
  border-radius: 34rpx;
  font-size: 30rpx;
  font-weight: 900;
  letter-spacing: 4rpx;
}

.home-title-stage {
  position: relative;
  min-height: 410rpx;
  margin-top: 4rpx;
}

.home-logo {
  position: absolute;
  z-index: 2;
  top: 56rpx;
  left: 116rpx;
  width: 520rpx;
  height: 160rpx;
}

.floating-note {
  position: absolute;
  z-index: 1;
  width: 68rpx;
  height: 68rpx;
}

.note-left {
  top: 186rpx;
  left: 36rpx;
}

.note-right {
  top: 112rpx;
  right: 32rpx;
}

.bot-speech {
  position: absolute;
  z-index: 3;
  left: 96rpx;
  bottom: 18rpx;
  width: 344rpx;
  padding: 18rpx 22rpx;
  border: 4rpx solid rgba(56, 179, 115, 0.4);
  border-radius: 24rpx;
  color: #37815c;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 10rpx 28rpx rgba(34, 99, 69, 0.12);
  font-size: 24rpx;
  font-weight: 800;
  line-height: 1.35;
}

.hero-robot {
  position: absolute;
  z-index: 4;
  right: -6rpx;
  bottom: 0;
  width: 312rpx;
  height: 250rpx;
}

.hero-microphone {
  position: absolute;
  z-index: 5;
  right: 230rpx;
  bottom: 0;
  width: 104rpx;
  height: 120rpx;
  transform: rotate(-6deg);
}

.home-main-modes {
  position: relative;
  z-index: 5;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18rpx;
  margin-top: -4rpx;
}

.big-mode {
  position: relative;
  min-height: 440rpx;
  overflow: hidden;
  display: grid;
  align-content: start;
  gap: 12rpx;
  padding: 40rpx 24rpx 26rpx;
  border: 4rpx solid rgba(255, 255, 255, 0.86);
  border-radius: 30rpx;
  box-shadow: 0 16rpx 30rpx rgba(20, 123, 70, 0.22);
}

.guess-mode {
  background: linear-gradient(135deg, #35d55d, #0fa562);
}

.room-mode {
  background: linear-gradient(135deg, #26c7a2, #19b97b);
}

.mode-ribbon {
  position: absolute;
  top: 0;
  left: 20rpx;
  z-index: 4;
  padding: 8rpx 22rpx 10rpx;
  border-radius: 0 0 20rpx 20rpx;
  color: #6f4d00;
  background: linear-gradient(#ffe66d, #ffc742);
  font-size: 24rpx;
  font-weight: 900;
}

.mode-title {
  position: relative;
  z-index: 2;
  color: #fff;
  font-size: 52rpx;
  font-weight: 900;
  line-height: 1.06;
  text-shadow: 0 6rpx 0 rgba(6, 132, 65, 0.28);
}

.mode-desc {
  position: relative;
  z-index: 2;
  color: rgba(255, 255, 255, 0.9);
  font-size: 24rpx;
  font-weight: 800;
}

.stamina-badge {
  position: relative;
  z-index: 3;
  width: fit-content;
  margin-top: 86rpx;
  padding: 12rpx 20rpx;
  border-radius: 999rpx;
  color: #f5fff7;
  background: rgba(0, 95, 64, 0.32);
  font-size: 22rpx;
  font-weight: 900;
}

.star-track {
  position: relative;
  z-index: 3;
  width: 260rpx;
  padding: 10rpx 16rpx;
  border-radius: 999rpx;
  color: #ffd84b;
  background: rgba(2, 91, 59, 0.66);
  font-size: 36rpx;
  letter-spacing: 10rpx;
  line-height: 1;
}

.mode-art {
  position: absolute;
  pointer-events: none;
}

.record-art {
  right: -32rpx;
  bottom: 138rpx;
  width: 244rpx;
  height: 210rpx;
}

.mode-button {
  position: absolute;
  z-index: 6;
  left: 28rpx;
  right: 28rpx;
  bottom: 24rpx;
}

.room-game-tags {
  position: absolute;
  z-index: 3;
  left: 24rpx;
  top: 156rpx;
  display: flex;
  gap: 8rpx;
}

.room-game-tags text {
  padding: 6rpx 12rpx;
  border-radius: 999rpx;
  color: #07754d;
  background: rgba(255, 255, 255, 0.82);
  font-size: 22rpx;
  font-weight: 900;
}

.chat-vs {
  position: absolute;
  left: 28rpx;
  right: 28rpx;
  bottom: 138rpx;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 10rpx;
}

.chat-vs text:not(.vs-label) {
  width: 88rpx;
  height: 88rpx;
  display: grid;
  place-items: center;
  border-radius: 36rpx;
  color: #7ef7a9;
  background: rgba(255, 255, 255, 0.82);
  font-size: 44rpx;
  letter-spacing: 4rpx;
}

.vs-label {
  color: #ffdf4a;
  font-size: 62rpx;
  font-style: italic;
  font-weight: 900;
  text-shadow: 0 8rpx 0 #c27013, 0 14rpx 20rpx rgba(88, 63, 10, 0.22);
}

.home-sub-modes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18rpx;
  margin-top: 20rpx;
}

.small-mode {
  min-height: 144rpx;
  display: grid;
  grid-template-columns: 1fr 128rpx;
  gap: 8rpx;
  align-items: center;
  padding: 20rpx 14rpx 20rpx 26rpx;
  border: 4rpx solid rgba(255, 255, 255, 0.9);
  border-radius: 24rpx;
  color: #223128;
  text-align: left;
  box-shadow: 0 10rpx 24rpx rgba(68, 94, 82, 0.12);
}

.small-mode view {
  display: grid;
  gap: 10rpx;
}

.small-title {
  font-size: 36rpx;
  font-weight: 900;
}

.small-desc {
  font-size: 22rpx;
  font-weight: 800;
}

.small-mode image {
  width: 128rpx;
  height: 120rpx;
}

.small-mode.blue {
  background: linear-gradient(135deg, #eef8ff, #d5ebff);
}

.small-mode.blue .small-title {
  color: #3280dc;
}

.small-mode.pink {
  background: linear-gradient(135deg, #fff2f5, #ffdce6);
}

.small-mode.pink .small-title {
  color: #e55b8b;
}

.online-strip,
.system-strip {
  display: flex;
  align-items: center;
  margin-top: 20rpx;
  border-radius: 26rpx;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 8rpx 22rpx rgba(68, 94, 82, 0.1);
}

.online-strip {
  gap: 10rpx;
  min-height: 82rpx;
  padding: 12rpx 16rpx 12rpx 24rpx;
  color: #58645e;
  font-size: 24rpx;
}

.online-dot {
  width: 18rpx;
  height: 18rpx;
  border-radius: 50%;
  background: #27c65d;
}

.friend-stack {
  display: flex;
  margin-left: auto;
}

.friend-stack image {
  width: 60rpx;
  height: 60rpx;
  margin-left: -14rpx;
  border: 4rpx solid #fff;
  border-radius: 50%;
}

.online-strip button {
  padding-left: 10rpx;
  color: #17a65a;
  background: transparent;
  font-size: 22rpx;
  font-weight: 900;
}

.system-strip {
  gap: 14rpx;
  min-height: 76rpx;
  padding: 0 24rpx;
  color: #5e6862;
}

.system-message {
  flex: 1;
  overflow: hidden;
  font-size: 24rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.system-arrow {
  color: #9aa29d;
  font-size: 48rpx;
}

.home-auth-modal {
  position: fixed;
  z-index: 50;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 44rpx;
  background: rgba(23, 35, 31, 0.36);
}

.auth-modal-card {
  position: relative;
  width: min(680rpx, 100%);
  display: grid;
  gap: 24rpx;
  padding: 44rpx;
  border-radius: 28rpx;
  background: #fff;
  box-shadow: 0 40rpx 96rpx rgba(15, 37, 28, 0.28);
}

.auth-modal-card image {
  width: 116rpx;
  height: 116rpx;
  justify-self: center;
}

.avatar-picker {
  width: 132rpx;
  height: 132rpx;
  justify-self: center;
  overflow: hidden;
  display: grid;
  place-items: center;
  padding: 0;
  border: 6rpx solid #e8f4ee;
  border-radius: 50%;
  background: #f5fbf7;
  box-shadow: 0 12rpx 28rpx rgba(24, 116, 71, 0.14);
}

.avatar-picker::after {
  border: 0;
}

.avatar-picker image {
  width: 100%;
  height: 100%;
}

.modal-title,
.modal-copy {
  text-align: center;
}

.modal-title {
  color: #133a26;
  font-size: 40rpx;
  font-weight: 900;
}

.modal-copy {
  color: #69746f;
  font-size: 24rpx;
  line-height: 1.55;
}

.nickname-input {
  height: 88rpx;
  padding: 0 26rpx;
  border: 2rpx solid #dcebe2;
  border-radius: 22rpx;
  color: #1b3326;
  background: #f7fbf8;
  font-size: 28rpx;
  font-weight: 800;
}

.modal-close {
  position: absolute;
  top: 20rpx;
  right: 20rpx;
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  color: #66726c;
  background: #eef3f0;
  font-size: 48rpx;
  line-height: 1;
}
</style>
