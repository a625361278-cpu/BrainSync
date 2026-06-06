<template>
  <view class="wechat-shell">
    <view class="room-header">
      <button class="ghost-button" @tap="leave">返回</button>
      <view class="room-title">
        <text class="room-name">房间 {{ room?.code ?? "-" }}</text>
        <text class="room-subtitle">{{ subtitle }}</text>
      </view>
      <text class="online-count">{{ onlineCount }} 人</text>
    </view>

    <view class="game-toolbar">
      <button v-for="item in gameTypes" :key="item.value" :disabled="startDisabled" @tap="start(item.value)">
        {{ item.label }}
      </button>
      <text>{{ meLabel }}</text>
    </view>

    <scroll-view class="message-list" scroll-y :scroll-into-view="lastMessageId">
      <view v-for="message in room?.messages ?? []" :id="`msg-${message.id}`" :key="message.id" :class="messageClass(message)">
        <image v-if="message.sender !== 'system' && message.playerId !== playerId" class="avatar" :src="avatarUrl(message.avatar, false)" mode="aspectFit" />
        <view class="bubble-stack">
          <text v-if="message.sender === 'player' && message.playerId !== playerId" class="sender-name">{{ message.playerName }}</text>
          <view :class="bubbleClass(message)">
            <view v-if="message.kind === 'image' && message.imageUrl" class="image-question">
              <image :src="assetUrl(message.imageUrl)" :alt="message.imageAlt ?? message.text" mode="aspectFit" />
              <text>{{ message.text }}</text>
            </view>
            <button v-else-if="message.kind === 'audio' && message.audioUrl" class="audio-message" @tap="playAudio(message.audioUrl)">
              <text>{{ message.text }}</text>
              <text class="audio-wave">{{ audioStatusText(message.audioUrl) }}</text>
            </button>
            <text v-else>{{ message.text }}</text>
          </view>
        </view>
        <image v-if="message.sender !== 'system' && message.playerId === playerId" class="avatar" :src="avatarUrl(message.avatar, true)" mode="aspectFit" />
      </view>

      <view v-if="room?.status === 'finished' && room.settlement" class="settlement-panel">
        <text class="settlement-title">本局结算</text>
        <view v-for="(row, index) in room.settlement" :key="row.playerId" class="settlement-row">
          <text>{{ index + 1 }}. {{ row.name }}</text>
          <text>{{ row.score }} 题</text>
        </view>
      </view>

      <view id="message-bottom" class="message-bottom"></view>
    </scroll-view>

    <view class="input-bar">
      <input v-model="text" class="chat-input" :placeholder="room?.status === 'playing' ? '输入答案或聊天...' : '输入聊天内容...'" confirm-type="send" @confirm="send" />
      <button class="green-button send-button" :disabled="busy || !text.trim()" @tap="send">发送</button>
    </view>

    <BsToast :message="error" />
  </view>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { API_BASE_URL } from "../../services/config";
import BsToast from "../../components/BsToast.vue";
import { PvpSocket } from "../../services/pvpSocket";
import { clearLegacyPlayerId, clearPlayerId, readPlayerId, readToken, writePlayerId } from "../../services/storage";
import type { ChatMessage, GameType, RoomSnapshot } from "../../services/types";

const gameTypes: Array<{ value: GameType; label: string }> = [
  { value: "idiom", label: "成语接龙" },
  { value: "song", label: "猜歌名" },
  { value: "silhouette", label: "剪影猜人" },
  { value: "movie", label: "剧照猜电影" }
];

const socket = new PvpSocket();
const room = ref<RoomSnapshot>();
const playerId = ref("");
const text = ref("");
const error = ref("");
const busy = ref(false);
const currentAudioUrl = ref("");
const audioPlaying = ref(false);
let audio: UniApp.InnerAudioContext | undefined;

const isHost = computed(() => Boolean(room.value && room.value.hostId === playerId.value));
const onlineCount = computed(() => room.value?.players.filter((player) => player.connected).length ?? 0);
const startDisabled = computed(() => busy.value || !isHost.value || room.value?.status === "playing");
const lastMessageId = computed(() => {
  const messages = room.value?.messages ?? [];
  const last = messages[messages.length - 1];
  return last ? `msg-${last.id}` : "message-bottom";
});
const meLabel = computed(() => {
  const me = room.value?.players.find((player) => player.id === playerId.value);
  if (!me) {
    return "未识别玩家";
  }
  return `我：${me.name}${isHost.value ? "（房主）" : ""}`;
});
const subtitle = computed(() => {
  if (!room.value) {
    return "连接中";
  }
  if (room.value.status === "waiting") {
    return "等待开始";
  }
  if (room.value.status === "finished") {
    return "已结束";
  }
  const q = room.value.currentQuestion;
  return q ? `${gameTypeLabel(q.gameType)} ${q.round}/${q.totalRounds}` : "游戏中";
});

void initialize();

async function initialize() {
  error.value = "";
  busy.value = true;
  try {
    const pages = getCurrentPages();
    const current = pages[pages.length - 1] as { options?: { mode?: string; roomCode?: string } };
    const mode = current.options?.mode ?? "create";
    const targetRoomCode = current.options?.roomCode ?? "";
    clearLegacyPlayerId();
    const token = readToken();
    await socket.connect((snapshot) => {
      room.value = snapshot;
    });
    const storedPlayerId = mode === "join" ? readPlayerId(targetRoomCode) : "";
    const ack = mode === "join" ? await socket.joinRoom(token, targetRoomCode, storedPlayerId) : await socket.createRoom(token);
    if (!ack.ok) {
      throw new Error(ack.error || "房间连接失败");
    }
    if (ack.playerId) {
      playerId.value = ack.playerId;
    }
    if (ack.room) {
      room.value = ack.room;
      if (ack.playerId) {
        writePlayerId(ack.room.code, ack.playerId);
      }
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : "房间连接失败";
  } finally {
    busy.value = false;
  }
}

async function start(gameType: GameType) {
  if (!room.value) {
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    const ack = await socket.startGame(room.value.code, playerId.value, gameType);
    if (!ack.ok) {
      error.value = ack.error || "开始失败";
    }
  } finally {
    busy.value = false;
  }
}

async function send() {
  if (!room.value || !text.value.trim()) {
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    const ack = await socket.sendChat(room.value.code, playerId.value, text.value);
    if (!ack.ok) {
      error.value = ack.error || "发送失败";
    }
    text.value = "";
  } finally {
    busy.value = false;
  }
}

async function leave() {
  if (room.value && playerId.value) {
    await socket.leaveRoom(room.value.code, playerId.value).catch(() => undefined);
    clearPlayerId(room.value.code);
  }
  socket.close();
  destroyAudio();
  uni.navigateBack();
}

function playAudio(url: string) {
  const normalizedUrl = assetUrl(url);
  error.value = "";
  if (audio && currentAudioUrl.value === normalizedUrl) {
    if (audioPlaying.value) {
      audio.pause();
      return;
    }
    audio.play();
    return;
  }
  destroyAudio();
  currentAudioUrl.value = normalizedUrl;
  audio = uni.createInnerAudioContext();
  audio.src = normalizedUrl;
  bindAudioEvents(audio, normalizedUrl);
  audio.play();
}

function audioStatusText(url: string): string {
  return currentAudioUrl.value === assetUrl(url) && audioPlaying.value ? "暂停 15''" : "▶ 语音 15''";
}

function bindAudioEvents(context: UniApp.InnerAudioContext, url: string): void {
  context.onPlay(() => {
    if (currentAudioUrl.value === url) {
      audioPlaying.value = true;
    }
  });
  context.onPause(() => {
    if (currentAudioUrl.value === url) {
      audioPlaying.value = false;
    }
  });
  context.onStop(() => {
    if (currentAudioUrl.value === url) {
      audioPlaying.value = false;
    }
  });
  context.onEnded(() => {
    if (currentAudioUrl.value === url) {
      audioPlaying.value = false;
    }
  });
  context.onError((event) => {
    if (currentAudioUrl.value === url) {
      audioPlaying.value = false;
      error.value = event.errMsg || "语音播放失败";
    }
  });
}

function destroyAudio(): void {
  audio?.destroy();
  audio = undefined;
  currentAudioUrl.value = "";
  audioPlaying.value = false;
}

function messageClass(message: ChatMessage): string {
  if (message.sender === "system") {
    return "message-row system-row";
  }
  return `message-row ${message.playerId === playerId.value ? "mine" : "other"}`;
}

function bubbleClass(message: ChatMessage): string {
  return `bubble ${message.kind === "audio" ? "audio-bubble" : ""} ${message.kind === "image" ? "image-bubble" : ""} ${message.kind === "hint" ? "hint-bubble" : ""}`;
}

function avatarUrl(url: string | undefined, mine: boolean): string {
  if (!url) {
    return mine ? "/static/avatars/player-1.svg" : "/static/avatars/bot.svg";
  }
  return assetUrl(url);
}

function assetUrl(path: string): string {
  if (path.startsWith("http") || path.startsWith("/static/")) {
    return path;
  }
  return `${API_BASE_URL}${path}`;
}

function gameTypeLabel(gameType: GameType): string {
  if (gameType === "song") {
    return "猜歌名";
  }
  if (gameType === "silhouette") {
    return "剪影猜人";
  }
  if (gameType === "movie") {
    return "剧照猜电影";
  }
  return "成语接龙";
}

onBeforeUnmount(() => {
  socket.close();
  destroyAudio();
});
</script>

<style scoped>
.wechat-shell {
  height: 100vh;
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  background: #e5e5e5;
}

.room-header {
  min-height: 104rpx;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 20rpx;
  padding: 16rpx 28rpx;
  border-bottom: 2rpx solid #d6d6d6;
  background: #f7f7f7;
}

.room-title {
  display: grid;
  justify-items: center;
  gap: 4rpx;
  min-width: 0;
}

.room-name {
  max-width: 100%;
  overflow: hidden;
  color: #1f2329;
  font-size: 30rpx;
  font-weight: 900;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.room-subtitle,
.online-count,
.game-toolbar text {
  color: #6b7280;
  font-size: 22rpx;
}

.game-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12rpx;
  padding: 16rpx 24rpx;
  border-bottom: 2rpx solid #d8d8d8;
  background: #eeeeee;
}

.game-toolbar button {
  flex: 0 0 auto;
  min-height: 56rpx;
  padding: 0 20rpx;
  border-radius: 12rpx;
  color: #fff;
  background: #07c160;
  font-size: 24rpx;
  font-weight: 800;
}

.game-toolbar button[disabled] {
  opacity: 0.45;
  background: #a8d9bf;
}

.game-toolbar text {
  margin-left: auto;
}

.message-list {
  min-height: 0;
  padding: 28rpx 20rpx 36rpx;
  scroll-behavior: smooth;
}

.message-row {
  display: flex;
  align-items: flex-start;
  gap: 16rpx;
  margin-bottom: 24rpx;
}

.message-row.mine {
  justify-content: flex-end;
}

.message-row.other {
  justify-content: flex-start;
}

.system-row {
  justify-content: center;
}

.avatar {
  width: 72rpx;
  height: 72rpx;
  flex: 0 0 auto;
  border-radius: 12rpx;
  background: #fff;
}

.bubble-stack {
  max-width: 68vw;
  display: grid;
  gap: 6rpx;
}

.sender-name {
  color: #7b7f87;
  font-size: 22rpx;
  padding-left: 4rpx;
}

.bubble {
  position: relative;
  width: fit-content;
  max-width: 100%;
  min-height: 68rpx;
  padding: 16rpx 20rpx;
  border-radius: 8rpx;
  color: #1f2329;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  background: #fff;
  box-shadow: 0 2rpx 0 rgba(0, 0, 0, 0.03);
  font-size: 28rpx;
}

.mine .bubble {
  background: #95ec69;
}

.system-row .bubble {
  min-height: 0;
  color: #fff;
  border-radius: 8rpx;
  background: rgba(0, 0, 0, 0.22);
  font-size: 22rpx;
}

.hint-bubble {
  color: #7a4b00;
  background: #fff7d6;
}

.image-bubble {
  width: 520rpx;
  max-width: calc(68vw - 24rpx);
  box-sizing: border-box;
  padding: 12rpx;
}

.image-question {
  display: grid;
  gap: 12rpx;
  width: 100%;
}

.image-question image {
  width: 100%;
  height: 420rpx;
  border-radius: 14rpx;
  background: #f3f4f6;
}

.image-question text {
  color: #4b5563;
  font-size: 24rpx;
}

.audio-message {
  min-width: 320rpx;
  display: grid;
  gap: 12rpx;
  padding: 0;
  color: #1f2329;
  background: transparent;
  text-align: left;
}

.audio-wave {
  color: #087443;
  font-size: 24rpx;
  font-weight: 800;
}

.settlement-panel {
  width: calc(100% - 40rpx);
  display: grid;
  gap: 8rpx;
  margin: 40rpx auto;
  padding: 32rpx;
  border-radius: 16rpx;
  background: #fff;
}

.settlement-title {
  margin-bottom: 8rpx;
  font-size: 34rpx;
  font-weight: 900;
}

.settlement-row {
  display: flex;
  justify-content: space-between;
  padding: 16rpx 0;
  border-top: 2rpx solid #eeeeee;
}

.message-bottom {
  height: 2rpx;
}

.input-bar {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 16rpx;
  padding: 16rpx;
  border-top: 2rpx solid #d6d6d6;
  background: #f7f7f7;
}

.chat-input {
  min-height: 72rpx;
  padding: 0 20rpx;
  border: 0;
  border-radius: 8rpx;
  background: #fff;
}

.send-button {
  min-width: 112rpx;
  min-height: 72rpx;
  border-radius: 8rpx;
}
</style>
