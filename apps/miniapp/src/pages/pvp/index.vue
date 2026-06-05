<template>
  <view class="landing">
    <view class="login-panel pvp-entry-panel">
      <button class="ghost-button back-home" @tap="goHome">返回大厅</button>

      <view class="brand-row">
        <image class="brand-avatar" :src="botAvatar" mode="aspectFit" />
        <view>
          <text class="brand-title">开房间对战</text>
          <text class="brand-copy">像微信群一样抢答：成语接龙、猜歌名、剪影猜人、剧照猜电影。</text>
        </view>
      </view>

      <view class="pvp-player-chip">当前玩家：{{ nickname || "登录状态读取中" }}</view>

      <view class="pvp-choice-grid">
        <button class="pvp-create-card" :disabled="busy" @tap="create">
          <text class="choice-title">创建房间</text>
          <text class="choice-copy">生成 6 位数字房间号，邀请好友加入</text>
        </button>

        <view class="pvp-join-card">
          <text class="choice-title">加入房间</text>
          <input :value="roomCode" class="room-input" placeholder="输入6位房间号" maxlength="6" type="number" @input="onRoomCodeInput" />
          <button class="green-button" :disabled="busy || roomCode.length !== 6" @tap="join">加入</button>
        </view>
      </view>
    </view>

    <BsToast :message="error" />
  </view>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { onShow } from "@dcloudio/uni-app";
import BsToast from "../../components/BsToast.vue";
import { apiRequest } from "../../services/request";
import type { PublicUser } from "../../services/types";

const roomCode = ref("");
const nickname = ref("");
const error = ref("");
const busy = ref(false);
const botAvatar = "/static/avatars/bot.svg";

onShow(() => {
  void restoreMe();
});

async function restoreMe() {
  error.value = "";
  try {
    const result = await apiRequest<{ user: PublicUser }>("/api/me");
    nickname.value = result.user.nickname;
  } catch (err) {
    nickname.value = "";
    error.value = err instanceof Error ? err.message : "登录状态读取失败";
  }
}

function onRoomCodeInput(event: { detail: { value: string } }) {
  roomCode.value = event.detail.value.replace(/\D/g, "").slice(0, 6);
}

function create() {
  uni.navigateTo({ url: "/pages/pvp/room?mode=create" });
}

function join() {
  if (roomCode.value.length !== 6) {
    error.value = "请输入6位房间号";
    return;
  }
  uni.navigateTo({ url: `/pages/pvp/room?mode=join&roomCode=${encodeURIComponent(roomCode.value)}` });
}

function goHome() {
  uni.navigateBack();
}
</script>

<style scoped>
.landing {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 32rpx;
  background: #ededed;
}

.login-panel {
  width: 100%;
  max-width: 860rpx;
  display: grid;
  gap: 24rpx;
  padding: 44rpx;
  border-radius: 18rpx;
  background: #fff;
  box-shadow: 0 16rpx 60rpx rgba(0, 0, 0, 0.08);
}

.back-home {
  justify-self: start;
  margin: -16rpx 0 4rpx;
  font-size: 26rpx;
}

.brand-row {
  display: flex;
  gap: 26rpx;
  align-items: center;
}

.brand-avatar {
  width: 104rpx;
  height: 104rpx;
  border-radius: 16rpx;
}

.brand-row view {
  display: grid;
  gap: 12rpx;
}

.brand-title {
  color: #1f2329;
  font-size: 44rpx;
  font-weight: 900;
}

.brand-copy {
  color: #6b7280;
  font-size: 26rpx;
  line-height: 1.5;
}

.pvp-player-chip {
  width: fit-content;
  padding: 14rpx 24rpx;
  border-radius: 999rpx;
  color: #087443;
  background: #e9fbf1;
  font-size: 24rpx;
  font-weight: 800;
}

.pvp-choice-grid {
  display: grid;
  gap: 24rpx;
}

.pvp-create-card,
.pvp-join-card {
  display: grid;
  gap: 16rpx;
  padding: 32rpx;
  border-radius: 24rpx;
  text-align: left;
}

.pvp-create-card {
  color: #fff;
  background: linear-gradient(135deg, #20c46f, #0aa66c);
}

.choice-title {
  font-size: 42rpx;
  font-weight: 900;
}

.choice-copy {
  color: rgba(255, 255, 255, 0.9);
  font-size: 24rpx;
  line-height: 1.45;
}

.pvp-join-card {
  border: 2rpx solid #e5efe9;
  background: #f7fffa;
}

.pvp-join-card .choice-title {
  color: #1f2329;
}

.room-input {
  min-height: 86rpx;
  padding: 0 24rpx;
  border: 2rpx solid #d0d5dd;
  border-radius: 12rpx;
  background: #fff;
  font-size: 40rpx;
  letter-spacing: 6rpx;
  text-align: center;
}
</style>
