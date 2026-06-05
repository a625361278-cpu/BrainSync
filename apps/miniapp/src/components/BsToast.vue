<template>
  <view v-if="message" class="bs-toast">{{ message }}</view>
</template>

<script setup lang="ts">
defineProps<{ message?: string }>();
</script>

<style scoped>
.bs-toast {
  position: fixed;
  z-index: 90;
  left: 32rpx;
  right: 32rpx;
  bottom: 96rpx;
  padding: 20rpx 24rpx;
  border-radius: 12rpx;
  color: #b42318;
  background: #fff1f0;
  box-shadow: 0 12rpx 40rpx rgba(0, 0, 0, 0.12);
  font-size: 26rpx;
  line-height: 1.45;
}
</style>
