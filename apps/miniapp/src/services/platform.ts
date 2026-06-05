import { REWARD_AD_UNIT_ID } from "./config";
import { apiRequest } from "./request";
import { writeToken } from "./storage";
import type { PublicUser, Stamina } from "./types";

declare const wx: {
  createRewardedVideoAd?: (options: { adUnitId: string }) => RewardedVideoAd;
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
}

export interface WechatAvatarImage {
  data: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
}

export async function loginWithWechat(nickname: string, avatarImage: WechatAvatarImage): Promise<{ token: string; user: PublicUser }> {
  const normalizedNickname = nickname.trim();
  if (!normalizedNickname) {
    throw new Error("请先填写微信昵称");
  }
  if (!avatarImage.data) {
    throw new Error("请先选择微信头像");
  }
  const loginResult = await new Promise<UniApp.LoginRes>((resolve, reject) => {
    uni.login({ provider: "weixin", success: resolve, fail: reject });
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
      fail: reject
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
  await ad.load();
  await new Promise<void>((resolve, reject) => {
    const onClose = (result: { isEnded?: boolean }) => {
      ad.offClose?.(onClose);
      if (result.isEnded) {
        resolve();
      } else {
        reject(new Error("广告未完整观看，不能发放奖励"));
      }
    };
    ad.onClose(onClose);
    ad.show().catch(reject);
  });
}

export async function restoreStaminaByAd(): Promise<Stamina> {
  const started = await apiRequest<{ reward: { eventId: string } }>("/api/ad/reward/start", {
    method: "POST",
    data: { rewardType: "stamina" }
  });
  await showRewardedVideoAd();
  const claimed = await apiRequest<{ reward: { stamina: Stamina } }>("/api/ad/reward/claim", {
    method: "POST",
    data: { eventId: started.reward.eventId }
  });
  return claimed.reward.stamina;
}
