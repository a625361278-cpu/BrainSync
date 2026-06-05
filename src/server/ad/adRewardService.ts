import type { AccountRepository, AdRewardEventRecord, AdRewardType, StaminaRecord } from "../account/repository";

export interface CreateAdRewardServiceOptions {
  repo: AccountRepository;
  now?: () => number;
  randomId?: () => string;
}

export interface AdRewardService {
  start(userId: string, rewardType: AdRewardType): Promise<{ eventId: string; rewardType: AdRewardType }>;
  verifyCallback(payload: VerifyAdRewardPayload): Promise<AdRewardEventRecord>;
  claim(userId: string, eventId: string): Promise<{ rewardType: AdRewardType; stamina: StaminaRecord }>;
}

export interface VerifyAdRewardPayload {
  eventId: string;
  rewardType: AdRewardType;
  platformTraceId: string;
}

export function createAdRewardService(options: CreateAdRewardServiceOptions): AdRewardService {
  return new DefaultAdRewardService(options);
}

class DefaultAdRewardService implements AdRewardService {
  private readonly repo: AccountRepository;
  private readonly now: () => number;
  private readonly randomId: () => string;

  constructor(options: CreateAdRewardServiceOptions) {
    this.repo = options.repo;
    this.now = options.now ?? Date.now;
    this.randomId = options.randomId ?? (() => Math.random().toString(36).slice(2, 12));
  }

  async start(userId: string, rewardType: AdRewardType): Promise<{ eventId: string; rewardType: AdRewardType }> {
    validateRewardType(rewardType);
    await this.requireUser(userId);
    const event: AdRewardEventRecord = {
      id: `ad_${this.randomId()}`,
      userId,
      rewardType,
      status: "started",
      createdAt: this.now()
    };
    await this.repo.createAdRewardEvent(event);
    return { eventId: event.id, rewardType };
  }

  async verifyCallback(payload: VerifyAdRewardPayload): Promise<AdRewardEventRecord> {
    validateRewardType(payload.rewardType);
    const event = await this.requireEvent(payload.eventId);
    if (event.rewardType !== payload.rewardType) {
      throw new Error("广告奖励类型异常");
    }
    if (!payload.platformTraceId.trim()) {
      throw new Error("广告回调缺少平台流水号");
    }
    if (event.status === "claimed") {
      return event;
    }
    const next: AdRewardEventRecord = {
      ...event,
      status: "verified",
      platformTraceId: payload.platformTraceId.trim(),
      verifiedAt: event.verifiedAt ?? this.now()
    };
    await this.repo.updateAdRewardEvent(next);
    return next;
  }

  async claim(userId: string, eventId: string): Promise<{ rewardType: AdRewardType; stamina: StaminaRecord }> {
    const event = await this.requireEvent(eventId);
    if (event.userId !== userId) {
      throw new Error("不能领取其他玩家的广告奖励");
    }
    if (event.status === "started") {
      throw new Error("广告奖励尚未验证");
    }
    if (event.status === "claimed") {
      throw new Error("广告奖励已经领取");
    }
    if (event.rewardType !== "stamina") {
      throw new Error(`广告奖励类型暂不支持领取：${event.rewardType}`);
    }

    const stamina = await this.restoreOneStamina(userId);
    const next: AdRewardEventRecord = {
      ...event,
      status: "claimed",
      claimedAt: this.now()
    };
    await this.repo.updateAdRewardEvent(next);
    return { rewardType: event.rewardType, stamina };
  }

  private async restoreOneStamina(userId: string): Promise<StaminaRecord> {
    const existing = await this.repo.getStamina(userId);
    const now = this.now();
    const stamina: StaminaRecord = existing ?? { userId, current: 0, max: 5, lastRecoveredAt: now, adRestoreCount: 0 };
    stamina.current = Math.min(stamina.max, stamina.current + 1);
    stamina.adRestoreCount += 1;
    stamina.lastRecoveredAt = now;
    await this.repo.upsertStamina(stamina);
    return stamina;
  }

  private async requireEvent(eventId: string): Promise<AdRewardEventRecord> {
    const cleanId = eventId.trim();
    if (!cleanId) {
      throw new Error("广告奖励事件不能为空");
    }
    const event = await this.repo.getAdRewardEvent(cleanId);
    if (!event) {
      throw new Error(`广告奖励事件不存在：${cleanId}`);
    }
    return event;
  }

  private async requireUser(userId: string): Promise<void> {
    const user = await this.repo.findUserById(userId);
    if (!user) {
      throw new Error(`账号状态异常：找不到用户 ${userId}`);
    }
  }
}

function validateRewardType(rewardType: AdRewardType): void {
  if (!["stamina", "settlement"].includes(rewardType)) {
    throw new Error(`广告奖励类型异常：${rewardType}`);
  }
}
