import { describe, expect, it } from "vitest";
import { createAuthService } from "../src/server/account/authService";
import { createMemoryAccountRepository } from "../src/server/account/memoryRepository";
import { createPveService } from "../src/server/pve/pveService";
import type { PveLevelConfig } from "../src/server/pve/levels";
import type { SongEntry } from "../src/shared/types";

const songs: SongEntry[] = [
  song("qing-tian", "晴天", "周杰伦", ["晴 天"]),
  song("hong-dou", "红豆", "王菲"),
  song("jiang-nan", "江南", "林俊杰"),
  song("yu-jian", "遇见", "孙燕姿"),
  song("zhi-zu", "知足", "五月天"),
  song("shi-nian", "十年", "陈奕迅")
];

const levels: PveLevelConfig[] = [
  {
    level: 1,
    name: "初听旋律",
    songCount: 5,
    timeLimitSeconds: 30,
    passScore: 1800,
    starScores: [1800, 2800, 3800],
    audioFilter: "phone",
    difficultyRange: [1, 2]
  }
];

describe("账号服务", () => {
  it("注册、登录和重复账号校验走真实密码哈希", async () => {
    const repo = createMemoryAccountRepository();
    const auth = createAuthService({ repo, now: () => 1000, tokenTtlMs: 60_000, randomToken: () => "token-1" });

    const registered = await auth.register({ username: "jim", password: "secret123", nickname: "Jim" });
    await expect(auth.register({ username: "jim", password: "another123", nickname: "Jim2" })).rejects.toThrow("账号已存在");
    await expect(auth.login({ username: "jim", password: "wrong-password" })).rejects.toThrow("账号或密码错误");

    const login = await auth.login({ username: "jim", password: "secret123" });

    expect(login.token).toBe("token-1");
    expect(login.user.id).toBe(registered.user.id);
    expect(login.user).not.toHaveProperty("passwordHash");
  });

  it("token过期后不能继续当作登录用户", async () => {
    let now = 1000;
    const repo = createMemoryAccountRepository();
    const auth = createAuthService({ repo, now: () => now, tokenTtlMs: 100, randomToken: () => "token-expired" });
    const { token } = await auth.register({ username: "amy", password: "secret123", nickname: "Amy" });

    now = 1200;

    await expect(auth.requireUserByToken(token)).rejects.toThrow("登录已过期");
  });
});

describe("PVE猜歌挑战服务端规则", () => {
  it("开始关卡消耗体力，返回题目不泄露答案，每关歌曲不重复", async () => {
    const { auth, pve } = createServices();
    const { user } = await auth.register({ username: "jim", password: "secret123", nickname: "Jim" });

    const started = await pve.start(user.id, 1);
    const profile = await pve.profile(user.id);

    expect(profile.stamina.current).toBe(4);
    expect(started.questions).toHaveLength(5);
    expect(new Set(started.questions.map((question) => question.songId)).size).toBe(5);
    expect(started.questions[0]).not.toHaveProperty("answer");
    expect(started.currentQuestion.questionId).toBe(started.questions[0].questionId);
  });

  it("体力不足时不能开始PVE关卡", async () => {
    const { auth, pve } = createServices();
    const { user } = await auth.register({ username: "jim", password: "secret123", nickname: "Jim" });

    for (let i = 0; i < 5; i += 1) {
      await pve.start(user.id, 1);
    }

    await expect(pve.start(user.id, 1)).rejects.toThrow("体力不足");
  });

  it("答案只认歌名和别名，不认歌手，分数由服务端时间计算", async () => {
    let now = 1000;
    const { auth, pve } = createServices({ now: () => now });
    const { user } = await auth.register({ username: "jim", password: "secret123", nickname: "Jim" });
    const started = await pve.start(user.id, 1);

    now += 10_000;
    const wrong = await pve.answer(user.id, {
      runId: started.runId,
      questionId: started.currentQuestion.questionId,
      answer: "周杰伦",
      clientScore: 999999
    } as never);

    expect(wrong.correct).toBe(false);
    expect(wrong.scoreDelta).toBe(0);

    now += 2_000;
    const correct = await pve.answer(user.id, {
      runId: started.runId,
      questionId: started.currentQuestion.questionId,
      answer: "晴 天",
      clientScore: 999999
    } as never);

    expect(correct.correct).toBe(true);
    expect(correct.scoreDelta).toBeLessThan(999999);
    expect(correct.scoreDelta).toBeGreaterThan(0);
  });

  it("完成关卡后写入最高分、星级和下一关解锁", async () => {
    let now = 1000;
    const { auth, pve } = createServices({ now: () => now });
    const { user } = await auth.register({ username: "jim", password: "secret123", nickname: "Jim" });
    const started = await pve.start(user.id, 1);
    const answers = ["晴天", "红豆", "江南", "遇见", "知足"];

    for (let i = 0; i < started.questions.length; i += 1) {
      now += 2000;
      const result = await pve.answer(user.id, {
        runId: started.runId,
        questionId: started.questions[i].questionId,
        answer: answers[i]
      });
      expect(result.correct).toBe(true);
    }
    const summary = await pve.finish(user.id, started.runId);
    const profile = await pve.profile(user.id);

    expect(summary.passed).toBe(true);
    expect(summary.stars).toBeGreaterThanOrEqual(1);
    expect(profile.highestUnlockedLevel).toBe(2);
    expect(profile.progress.find((row) => row.level === 1)?.highestScore).toBe(summary.totalScore);
  });
});

function createServices(options: { now?: () => number } = {}) {
  const repo = createMemoryAccountRepository();
  const auth = createAuthService({
    repo,
    now: options.now ?? (() => 1000),
    tokenTtlMs: 60_000,
    randomToken: () => `token-${Math.random()}`
  });
  const pve = createPveService({
    repo,
    songs,
    levels,
    now: options.now ?? (() => 1000),
    random: () => 0
  });
  return { auth, pve };
}

function song(id: string, title: string, artist: string, aliases: string[] = []): SongEntry {
  return {
    id,
    title,
    artist,
    aliases,
    searchTerm: `${artist} ${title}`,
    previewUrl: `https://example.test/${id}.m4a`,
    sourceUrl: `https://music.example.test/${id}`
  };
}
