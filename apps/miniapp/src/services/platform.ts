import { INTERSTITIAL_AD_UNIT_ID, REWARD_AD_UNIT_ID } from "./config";
import { errorMessage } from "./errors";
import { apiRequest } from "./request";
import { writeToken } from "./storage";
import type { PublicUser, Stamina } from "./types";

declare const wx: {
  createRewardedVideoAd?: (options: { adUnitId: string }) => RewardedVideoAd;
  createInterstitialAd?: (options: { adUnitId: string }) => InterstitialAd;
  getFileSystemManager?: () => {
    readFile: (options: {
      filePath: string;
      encoding: "base64";
      success: (result: { data: string }) => void;
      fail: (error: unknown) => void;
    }) => void;
  };
};

interface RewardedVideoAd {
  load: () => Promise<void>;
  show: () => Promise<void>;
  onClose: (handler: (result: { isEnded?: boolean }) => void) => void;
  offClose?: (handler: (result: { isEnded?: boolean }) => void) => void;
  onError?: (handler: (error: unknown) => void) => void;
  offError?: (handler: (error: unknown) => void) => void;
}

interface InterstitialAd {
  load?: () => Promise<void>;
  show: () => Promise<void>;
  onError?: (handler: (error: unknown) => void) => void;
  offError?: (handler: (error: unknown) => void) => void;
  onClose?: (handler: () => void) => void;
  offClose?: (handler: () => void) => void;
}

export interface WechatAvatarImage {
  data: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
}

const INTERSTITIAL_START_DELAY_MS = 30_000;
const INTERSTITIAL_INTERVAL_MS = 180_000;
const INTERSTITIAL_AFTER_REWARD_MS = 60_000;
const appStartedAt = Date.now();
let lastInterstitialShownAt = 0;
let lastRewardShownAt = 0;

export async function loginWithWechat(nickname: string, avatarImage: WechatAvatarImage): Promise<{ token: string; user: PublicUser }> {
  const normalizedNickname = nickname.trim();
  if (!normalizedNickname) {
    throw new Error("请先填写微信昵称");
  }
  if (!avatarImage.data) {
    throw new Error("请先选择微信头像");
  }
  const loginResult = await new Promise<UniApp.LoginRes>((resolve, reject) => {
    uni.login({
      provider: "weixin",
      success: resolve,
      fail: (error) => reject(new Error(`微信登录失败：${errorMessage(error, "uni.login失败")}`))
    });
  });
  if (!loginResult.code) {
    throw new Error("微信登录失败：缺少code");
  }
  const result = await apiRequest<{ token: string; user: PublicUser }>("/api/auth/wechat-login", {
    method: "POST",
    data: { code: loginResult.code, nickname: normalizedNickname, avatarImage },
    token: ""
  });
  if (result.user.nickname !== normalizedNickname) {
    throw new Error("服务端未更新微信昵称，请先部署最新后端");
  }
  if (!result.user.avatarUrl) {
    throw new Error("服务端未保存微信头像，请先部署最新后端");
  }
  writeToken(result.token);
  return result;
}

export async function readWechatAvatarImage(filePath: string): Promise<WechatAvatarImage> {
  const fileSystem = wx.getFileSystemManager?.();
  if (!fileSystem) {
    throw new Error("当前平台不支持读取微信头像文件");
  }
  const data = await new Promise<string>((resolve, reject) => {
    fileSystem.readFile({
      filePath,
      encoding: "base64",
      success: (result) => resolve(result.data),
      fail: (error) => reject(new Error(`微信头像读取失败：${errorMessage(error, "readFile失败")}`))
    });
  });
  return { data, mimeType: inferAvatarMimeType(filePath) };
}

function inferAvatarMimeType(filePath: string): WechatAvatarImage["mimeType"] {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  return "image/jpeg";
}

export async function showRewardedVideoAd(): Promise<void> {
  if (!REWARD_AD_UNIT_ID) {
    throw new Error("激励视频广告位未配置");
  }
  const factory = wx.createRewardedVideoAd;
  if (!factory) {
    throw new Error("当前平台不支持激励视频广告");
  }
  const ad = factory({ adUnitId: REWARD_AD_UNIT_ID });
  await new Promise<void>((resolve, reject) => {
    const onClose = (result: { isEnded?: boolean }) => {
      cleanup();
      if (result.isEnded) {
        lastRewardShownAt = Date.now();
        resolve();
      } else {
        reject(new Error("广告未完整观看，不能发放奖励"));
      }
    };
    const onError = (error: unknown) => {
      cleanup();
      reject(new Error(`激励视频广告加载失败：${errorMessage(error, "广告错误")}`));
    };
    const cleanup = () => {
      ad.offClose?.(onClose);
      ad.offError?.(onError);
    };
    ad.onClose(onClose);
    ad.onError?.(onError);
    showRewardedVideo(ad).catch((error) => {
      cleanup();
      reject(error);
    });
  });
}

async function showRewardedVideo(ad: RewardedVideoAd): Promise<void> {
  try {
    await ad.show();
  } catch {
    await ad.load();
    await ad.show();
  }
}

export async function showInterstitialAd(): Promise<boolean> {
  if (!shouldShowInterstitialAd()) {
    return false;
  }
  const factory = wx.createInterstitialAd;
  if (!INTERSTITIAL_AD_UNIT_ID || !factory) {
    return false;
  }
  const ad = factory({ adUnitId: INTERSTITIAL_AD_UNIT_ID });
  await new Promise<void>((resolve, reject) => {
    const onClose = () => {
      cleanup();
      resolve();
    };
    const onError = (error: unknown) => {
      cleanup();
      reject(new Error(`插屏广告加载失败：${errorMessage(error, "广告错误")}`));
    };
    const cleanup = () => {
      ad.offClose?.(onClose);
      ad.offError?.(onError);
    };
    ad.onClose?.(onClose);
    ad.onError?.(onError);
    showInterstitial(ad)
      .then(() => {
        lastInterstitialShownAt = Date.now();
        if (!ad.onClose) {
          cleanup();
          resolve();
        }
      })
      .catch((error) => {
        cleanup();
        reject(error);
      });
  });
  return true;
}

function shouldShowInterstitialAd(): boolean {
  const now = Date.now();
  if (now - appStartedAt < INTERSTITIAL_START_DELAY_MS) {
    return false;
  }
  if (now - lastInterstitialShownAt < INTERSTITIAL_INTERVAL_MS) {
    return false;
  }
  if (now - lastRewardShownAt < INTERSTITIAL_AFTER_REWARD_MS) {
    return false;
  }
  return true;
}

async function showInterstitial(ad: InterstitialAd): Promise<void> {
  try {
    await ad.show();
  } catch {
    await ad.load?.();
    await ad.show();
  }
}

export async function restoreStaminaByAd(): Promise<Stamina> {
  const started = await apiRequest<{ reward: { eventId: string } }>("/api/ad/reward/start", {
    method: "POST",
    data: { rewardType: "stamina" }
  });
  await showRewardedVideoAd();
  await apiRequest<{ status: string }>("/api/ad/reward/complete", {
    method: "POST",
    data: { eventId: started.reward.eventId }
  });
  const claimed = await apiRequest<{ reward: { stamina: Stamina } }>("/api/ad/reward/claim", {
    method: "POST",
    data: { eventId: started.reward.eventId }
  });
  return claimed.reward.stamina;
}
