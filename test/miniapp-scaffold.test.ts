import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("微信小程序前端工程", () => {
  it("保留H5前端并新增独立uni-app小程序工程", () => {
    expect(existsSync(resolve("src/client/main.tsx"))).toBe(true);
    expect(existsSync(resolve("apps/miniapp/src/pages.json"))).toBe(true);
    expect(existsSync(resolve("apps/miniapp/src/manifest.json"))).toBe(true);
    expect(readFileSync(resolve("apps/miniapp/vite.config.ts"), "utf8")).toContain("@dcloudio/vite-plugin-uni");
  });

  it("小程序平台层使用微信登录、原生WebSocket、音频代理和广告入口", () => {
    const platform = readFileSync(resolve("apps/miniapp/src/services/platform.ts"), "utf8");
    const pvp = readFileSync(resolve("apps/miniapp/src/services/pvpSocket.ts"), "utf8");
    const pve = readFileSync(resolve("apps/miniapp/src/services/pve.ts"), "utf8");
    const pveIndex = readFileSync(resolve("apps/miniapp/src/pages/pve/index.vue"), "utf8");
    const pvePlay = readFileSync(resolve("apps/miniapp/src/pages/pve/play.vue"), "utf8");
    const pvpRoom = readFileSync(resolve("apps/miniapp/src/pages/pvp/room.vue"), "utf8");
    const request = readFileSync(resolve("apps/miniapp/src/services/request.ts"), "utf8");
    const errors = readFileSync(resolve("apps/miniapp/src/services/errors.ts"), "utf8");
    const types = readFileSync(resolve("apps/miniapp/src/services/types.ts"), "utf8");

    expect(platform).toContain("uni.login");
    expect(platform).toContain("微信登录失败：");
    expect(platform).toContain("微信头像读取失败：");
    expect(platform).toContain("createRewardedVideoAd");
    expect(platform).toContain("createInterstitialAd");
    expect(platform).toContain("/api/ad/reward/start");
    expect(platform).toContain("/api/ad/reward/complete");
    expect(platform).toContain("/api/ad/reward/claim");
    expect(platform).toContain("INTERSTITIAL_INTERVAL_MS");
    expect(pveIndex).toContain("<ad");
    expect(pveIndex).toContain(':unit-id="BANNER_AD_UNIT_ID"');
    expect(pvePlay).toContain("showInterstitialAd");
    expect(pvePlay).toContain('console.warn("插屏广告展示失败"');
    expect(pvePlay).not.toContain('error.value = err instanceof Error ? err.message : "插屏广告展示失败"');
    expect(pvpRoom).toContain("showInterstitialAd");
    expect(pvpRoom).toContain('console.warn("插屏广告展示失败"');
    expect(pvpRoom).not.toContain('error.value = err instanceof Error ? err.message : "插屏广告展示失败"');
    expect(pvp).toContain("uni.connectSocket");
    expect(pve).toContain("/api/audio/preview/");
    expect(request).toContain("网络请求失败：");
    expect(errors).toContain("errMsg");
    expect(types).toContain('"riddle"');
  });

  it("小程序首页复刻网页版正式大厅结构并使用本地视觉资产", () => {
    const home = readFileSync(resolve("apps/miniapp/src/pages/index/index.vue"), "utf8");

    expect(existsSync(resolve("apps/miniapp/src/static/home-assets/bg-living-room.svg"))).toBe(true);
    expect(existsSync(resolve("apps/miniapp/src/static/home-assets/robot.svg"))).toBe(true);
    expect(home).toContain("mini-home-page");
    expect(home).toContain("home-title-stage");
    expect(home).toContain("bot-speech");
    expect(home).toContain("home-main-modes");
    expect(home).not.toContain("主打玩法");
    expect(home).toContain("每日挑战");
    expect(home).toContain("筹备中");
    expect(home).toContain('type="nickname"');
    expect(home).toContain('open-type="chooseAvatar"');
    expect(home).toContain("点击选择微信头像");
    expect(home).toContain("头像已选择");
    expect(home).toContain("请先选择微信头像");
    expect(home).toContain("确认资料并登录");
    expect(home).toContain('errorMessage(err, "微信登录失败")');
  });

  it("小程序PVE页面复刻网页版关卡和答题正式结构", () => {
    const pveIndex = readFileSync(resolve("apps/miniapp/src/pages/pve/index.vue"), "utf8");
    const pvePlay = readFileSync(resolve("apps/miniapp/src/pages/pve/play.vue"), "utf8");

    expect(pveIndex).toContain("pve-phone-page");
    expect(pveIndex).toContain("level-card");
    expect(pveIndex).toContain("最高");
    expect(pveIndex).toContain("未解锁");
    expect(pvePlay).toContain("challenge-card");
    expect(pvePlay).toContain("score-strip");
    expect(pvePlay).toContain("time-bar");
    expect(pvePlay).toContain("countdown-overlay");
  });

  it("小程序PVP页面复刻网页版开房入口和微信群聊结构", () => {
    const pvpIndex = readFileSync(resolve("apps/miniapp/src/pages/pvp/index.vue"), "utf8");
    const pvpRoom = readFileSync(resolve("apps/miniapp/src/pages/pvp/room.vue"), "utf8");

    expect(pvpIndex).toContain("pvp-entry-panel");
    expect(pvpIndex).toContain("pvp-create-card");
    expect(pvpIndex).toContain("pvp-join-card");
    expect(pvpIndex).not.toContain("返回大厅");
    expect(pvpIndex).not.toContain("像微信群一样抢答");
    expect(pvpIndex).toContain("成语接龙、猜歌名、剪影猜人、剧照猜电影、猜谜语");
    expect(pvpIndex).toContain("align-items: start");
    expect(pvpRoom).toContain("wechat-shell");
    expect(pvpRoom).toContain("game-toolbar");
    expect(pvpRoom).toContain('{ value: "riddle", label: "猜谜语" }');
    expect(pvpRoom).toContain("message-row");
    expect(pvpRoom).toContain("settlement-panel");
    expect(pvpRoom).not.toContain('@tap="leave">返回</button>');
    expect(pvpRoom).toContain("onBackPress");
    expect(pvpRoom).toContain('class="avatar" :src="avatarUrl(message.avatar, true)" mode="aspectFit"');
    expect(pvpRoom).toContain(".message-list {\n  box-sizing: border-box;");
    expect(pvpRoom).toContain("width: 100%;\n  box-sizing: border-box;\n  display: flex;");
    expect(pvpRoom).toContain(".message-row.mine {\n  justify-content: flex-end;\n}");
    expect(pvpRoom).not.toContain("padding-right: 24rpx");
    expect(pvpRoom).toContain("min-width: 0");
  });

  it("小程序PVP聊天气泡保持微信聊天壳的紧凑排版", () => {
    const pvpRoom = readFileSync(resolve("apps/miniapp/src/pages/pvp/room.vue"), "utf8");

    expect(pvpRoom).toContain(".other .bubble::before");
    expect(pvpRoom).toContain(".mine .bubble::after");
    expect(pvpRoom).toContain("line-height: 36rpx");
    expect(pvpRoom).toContain("min-height: 0");
    expect(pvpRoom).toContain(".audio-message::after");
  });

  it("小程序大厅和PVP玩法胶囊使用完整文案且文字居中", () => {
    const home = readFileSync(resolve("apps/miniapp/src/pages/index/index.vue"), "utf8");
    const pvpRoom = readFileSync(resolve("apps/miniapp/src/pages/pvp/room.vue"), "utf8");

    expect(home).toContain("<text>成语接龙</text>");
    expect(home).toContain("<text>猜歌名</text>");
    expect(home).toContain("<text>剪影猜人</text>");
    expect(home).toContain("<text>剧照猜电影</text>");
    expect(home).toContain("<text>猜谜语</text>");
    expect(home).not.toContain('class="more-tag"');
    expect(home).toContain("max-width: 172rpx");
    expect(home).toContain("white-space: nowrap");
    expect(pvpRoom).toContain("height: 52rpx");
    expect(pvpRoom).toContain("line-height: 52rpx");
    expect(pvpRoom).toContain(".game-toolbar button::after");
  });

  it("小程序PVP图片题完整适配显示且语音点击支持暂停和继续播放", () => {
    const pvpRoom = readFileSync(resolve("apps/miniapp/src/pages/pvp/room.vue"), "utf8");

    expect(pvpRoom).toContain('mode="aspectFit"');
    expect(pvpRoom).toContain("width: 520rpx");
    expect(pvpRoom).toContain("currentAudioUrl");
    expect(pvpRoom).toContain("audioPlaying");
    expect(pvpRoom).toContain("syncLatestAudioQuestion");
    expect(pvpRoom).toContain("audio.pause()");
    expect(pvpRoom).toContain("audio.play()");
  });

  it("小程序生产构建使用like2022正式域名且不保留example占位域名", () => {
    const config = readFileSync(resolve("apps/miniapp/src/services/config.ts"), "utf8");
    const productionEnv = readFileSync(resolve("apps/miniapp/.env.production"), "utf8");

    expect(config).toContain("https://like2022.online");
    expect(config).toContain("wss://like2022.online/pvp-ws");
    expect(config).not.toContain("example.com");
    expect(productionEnv).toContain("VITE_API_BASE_URL=https://like2022.online");
    expect(productionEnv).toContain("VITE_WS_URL=wss://like2022.online/pvp-ws");
  });
});
