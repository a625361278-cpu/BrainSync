import { REWARD_AD_UNIT_ID } from "./config";
import { apiRequest } from "./request";
import { writeToken } from "./storage";
import type { PublicUser, Stamina } from "./types";

declare const wx: {
  createRewardedVideoAd?: (options: { adUnitId: string }) => RewardedVideoAd;
};

interface RewardedVideoAd {
  load: () => Promise<void>;
  show: () => Promise<void>;
  onClose: (handler: (result: { isEnded?: boolean }) => void) => void;
  offClose?: (handler: (result: { isEnded?: boolean }) => void) => void;
}

export async function loginWithWechat(nickname = "微信玩家"): Promise<{ token: string; user: PublicUser }> {
  const loginResult = await new Promise<UniApp.LoginRes>((resolve, reject) => {
    uni.login({ provider: "weixin", success: resolve, fail: reject });
  });
  if (!loginResult.code) {
    throw new Error("微信登录失败：缺少code");
  }
  const result = await apiRequest<{ token: string; user: PublicUser }>("/api/auth/wechat-login", {
    method: "POST",
    data: { code: loginResult.code, nickname },
    token: ""
  });
  writeToken(result.token);
  return result;
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
