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

    expect(platform).toContain("uni.login");
    expect(platform).toContain("createRewardedVideoAd");
    expect(pvp).toContain("uni.connectSocket");
    expect(pve).toContain("/api/audio/preview/");
  });

  it("小程序首页复刻网页版正式大厅结构并使用本地视觉资产", () => {
    const home = readFileSync(resolve("apps/miniapp/src/pages/index/index.vue"), "utf8");

    expect(existsSync(resolve("apps/miniapp/src/static/home-assets/bg-living-room.svg"))).toBe(true);
    expect(existsSync(resolve("apps/miniapp/src/static/home-assets/robot.svg"))).toBe(true);
    expect(home).toContain("mini-home-page");
    expect(home).toContain("home-title-stage");
    expect(home).toContain("bot-speech");
    expect(home).toContain("home-main-modes");
    expect(home).toContain("每日挑战");
    expect(home).toContain("筹备中");
    expect(home).toContain('type="nickname"');
    expect(home).toContain('open-type="chooseAvatar"');
    expect(home).toContain("点击选择微信头像");
    expect(home).toContain("头像已选择");
    expect(home).toContain("请先选择微信头像");
    expect(home).toContain("确认资料并登录");
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
    expect(pvpRoom).toContain("wechat-shell");
    expect(pvpRoom).toContain("game-toolbar");
    expect(pvpRoom).toContain("message-row");
    expect(pvpRoom).toContain("settlement-panel");
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
