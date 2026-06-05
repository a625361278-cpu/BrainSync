import { describe, expect, it } from "vitest";
import { createAuthService } from "../src/server/account/authService";
import { createMemoryAccountRepository } from "../src/server/account/memoryRepository";
import { createAdRewardService } from "../src/server/ad/adRewardService";
import { exchangeWechatLoginCode } from "../src/server/account/wechatLogin";
import { resolveSongPreviewUrl } from "../src/server/audio/audioProxy";
import { createMiniappPvpProtocol } from "../src/server/pvp/miniappPvpProtocol";
import { createGameRoom } from "../src/server/game/room";
import type { CharacterEntry, IdiomEntry, MovieEntry, RoomSnapshot, SongEntry } from "../src/shared/types";

describe("微信小程序登录", () => {
  it("同一个微信openid重复登录复用同一个真实用户并更新资料", async () => {
    const repo = createMemoryAccountRepository();
    const auth = createAuthService({ repo, now: () => 1000, randomToken: () => "token-wechat" });

    const first = await auth.loginWithWechat({ openid: "openid-1", nickname: "小林", avatarUrl: "/user-avatars/a.jpg" });
    const second = await auth.loginWithWechat({ openid: "openid-1", nickname: "林同学", avatarUrl: "/user-avatars/b.jpg" });

    expect(first.user.id).toBe(second.user.id);
    expect(first.user.username).toBe("wx_openid-1");
    expect(second.user.nickname).toBe("林同学");
    expect(second.user.avatarUrl).toBe("/user-avatars/b.jpg");
  });

  it("微信登录不能用空昵称创建默认玩家", async () => {
    const repo = createMemoryAccountRepository();
    const auth = createAuthService({ repo });

    await expect(auth.loginWithWechat({ openid: "openid-empty", nickname: " " })).rejects.toThrow("微信昵称不能为空");
  });

  it("微信code换openid失败时暴露平台错误", async () => {
    await expect(
      exchangeWechatLoginCode({
        code: "bad-code",
        appId: "wx-app",
        appSecret: "secret",
        fetchImpl: async () =>
          new Response(JSON.stringify({ errcode: 40029, errmsg: "invalid code" }), {
            status: 200,
            headers: { "content-type": "application/json" }
          })
      })
    ).rejects.toThrow("微信登录失败：invalid code");
  });
});

describe("小程序广告奖励", () => {
  it("激励视频必须先收到可信回调，领取后只补一次体力", async () => {
    const repo = createMemoryAccountRepository();
    const auth = createAuthService({ repo, now: () => 1000, randomToken: () => "token-ad" });
    const { user } = await auth.loginWithWechat({ openid: "openid-ad", nickname: "广告玩家" });
    await repo.upsertStamina({ userId: user.id, current: 0, max: 5, lastRecoveredAt: 1000, adRestoreCount: 0 });
    const rewards = createAdRewardService({ repo, now: () => 2000, randomId: () => "reward-1" });
    const started = await rewards.start(user.id, "stamina");

    await expect(rewards.claim(user.id, started.eventId)).rejects.toThrow("广告奖励尚未验证");

    await rewards.verifyCallback({
      eventId: started.eventId,
      rewardType: "stamina",
      platformTraceId: "wx-trace-1"
    });
    const claimed = await rewards.claim(user.id, started.eventId);

    expect(claimed.stamina.current).toBe(1);
    expect(claimed.stamina.adRestoreCount).toBe(1);
    await expect(rewards.claim(user.id, started.eventId)).rejects.toThrow("广告奖励已经领取");
  });
});

describe("小程序音频代理", () => {
  it("只允许代理题库里存在的歌曲试听地址", () => {
    expect(resolveSongPreviewUrl("qing-tian", songs)).toBe("https://example.test/qing-tian.m4a");
    expect(() => resolveSongPreviewUrl("missing", songs)).toThrow("歌曲不存在");
  });
});

describe("小程序PVP WebSocket协议", () => {
  it("用JSON envelope创建房间并广播roomSnapshot", async () => {
    const repo = createMemoryAccountRepository();
    const auth = createAuthService({ repo, now: () => 1000, randomToken: () => "token-pvp" });
    const { token } = await auth.loginWithWechat({ openid: "openid-pvp", nickname: "房主" });
    const rooms = new Map<string, ReturnType<typeof createGameRoom>>();
    const sent: Array<{ clientId: string; message: unknown }> = [];
    const protocol = createMiniappPvpProtocol({
      auth,
      createRoomCode: () => "123456",
      createRoom: (code) =>
        createGameRoom({
          code,
          idioms,
          songs,
          characters,
          movies,
          roundSeconds: 30,
          random: () => 0
        }),
      rooms,
      send: (clientId, message) => sent.push({ clientId, message }),
      broadcast: (roomCode, snapshot) => sent.push({ clientId: `room:${roomCode}`, message: { type: "roomSnapshot", payload: snapshot } })
    });

    await protocol.handle("client-1", { type: "createRoom", requestId: "r1", payload: { token } });

    expect(rooms.has("123456")).toBe(true);
    expect(sent.find((item) => item.clientId === "client-1")?.message).toMatchObject({
      type: "ack",
      requestId: "r1",
      ok: true,
      payload: { playerId: expect.any(String), room: { code: "123456" } }
    });
    expect((sent.find((item) => item.clientId === "room:123456")?.message as { payload: RoomSnapshot }).payload.players[0].name).toBe(
      "房主"
    );
  });
});

const idioms: IdiomEntry[] = [
  { text: "一心一意", pinyin: ["yi", "xin", "yi", "yi"] },
  { text: "意气风发", pinyin: ["yi", "qi", "feng", "fa"] },
  { text: "发愤图强", pinyin: ["fa", "fen", "tu", "qiang"] }
];

const songs: SongEntry[] = [
  {
    id: "qing-tian",
    title: "晴天",
    artist: "周杰伦",
    aliases: [],
    searchTerm: "周杰伦 晴天",
    previewUrl: "https://example.test/qing-tian.m4a",
    sourceUrl: "https://music.example.test/qing-tian"
  }
];

const characters: CharacterEntry[] = [
  {
    id: "nezha",
    name: "哪吒",
    aliases: ["三太子"],
    work: "哪吒闹海",
    difficulty: 1,
    referenceNote: "测试用剪影题",
    assetMode: "processed-reference",
    imageUrl: "/pvp-assets/silhouettes/nezha.svg"
  }
];

const movies: MovieEntry[] = [
  {
    id: "da-sheng-gui-lai",
    title: "西游记之大圣归来",
    aliases: ["大圣归来"],
    year: 2015,
    region: "中国",
    genre: "动画",
    imageUrl: "/pvp-assets/movie-stills/da-sheng-gui-lai.svg"
  }
];
