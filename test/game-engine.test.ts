import { describe, expect, it } from "vitest";
import { createGameRoom } from "../src/server/game/room";
import type { IdiomEntry, SongEntry } from "../src/shared/types";

const idioms: IdiomEntry[] = [
  { text: "一心一意", pinyin: ["yi", "xin", "yi", "yi"] },
  { text: "意气风发", pinyin: ["yi", "qi", "feng", "fa"] },
  { text: "发愤图强", pinyin: ["fa", "fen", "tu", "qiang"], aliases: ["发奋图强"] },
  { text: "强词夺理", pinyin: ["qiang", "ci", "duo", "li"] },
  { text: "海阔天空", pinyin: ["hai", "kuo", "tian", "kong"] },
  { text: "空前绝后", pinyin: ["kong", "qian", "jue", "hou"] },
  { text: "画蛇添足", pinyin: ["hua", "she", "tian", "zu"] }
];

const songs: SongEntry[] = [
  {
    id: "qing-tian",
    title: "晴天",
    artist: "周杰伦",
    aliases: ["晴 天"],
    searchTerm: "周杰伦 晴天",
    previewUrl: "https://example.test/qingtian.m4a",
    sourceUrl: "https://music.example.test/qingtian"
  },
  {
    id: "hong-dou",
    title: "红豆",
    artist: "王菲",
    aliases: [],
    searchTerm: "王菲 红豆",
    previewUrl: "https://example.test/hongdou.m4a",
    sourceUrl: "https://music.example.test/hongdou"
  }
];

describe("game room裁判逻辑", () => {
  it("成语接龙答错会产生@玩家答案不对，答对只给第一个命中的玩家加分", () => {
    const room = createGameRoom({ idioms, songs, roundSeconds: 30, random: () => 0 });
    const alice = room.join("阿明");
    const bob = room.join("小红");

    room.start("idiom");
    const wrong = room.submitMessage(alice.id, "画蛇添足");
    const correct = room.submitMessage(bob.id, "意气风发");
    const lateCorrect = room.submitMessage(alice.id, "意气风发");

    expect(wrong.botMessages.at(-1)?.text).toBe("@阿明 答案不对");
    expect(correct.hit?.playerId).toBe(bob.id);
    expect(correct.botMessages.at(-1)?.text).toContain("@小红 答对了");
    expect(lateCorrect.hit).toBeUndefined();
    expect(room.snapshot().players.find((p) => p.id === bob.id)?.score).toBe(1);
    expect(room.snapshot().players.find((p) => p.id === alice.id)?.score).toBe(0);
  });

  it("猜歌名支持歌名别名和标点空格归一化，但不接受歌手名", () => {
    const room = createGameRoom({ idioms, songs, roundSeconds: 30, random: () => 0 });
    const alice = room.join("阿明");

    room.start("song");
    const artistResult = room.submitMessage(alice.id, "周杰伦");
    const result = room.submitMessage(alice.id, "晴 天");

    expect(artistResult.hit).toBeUndefined();
    expect(artistResult.botMessages.at(-1)?.text).toBe("@阿明 答案不对");
    expect(result.hit?.answer).toBe("晴天");
    expect(room.snapshot().players.find((p) => p.id === alice.id)?.score).toBe(1);
  });

  it("猜歌名每局随机抽取歌曲且不重复", () => {
    const room = createGameRoom({ idioms, songs, roundSeconds: 30, songRounds: 2, random: () => 0.99 });
    const alice = room.join("阿明");

    room.start("song");
    const first = room.snapshot().currentQuestion?.audioUrl;
    room.submitMessage(alice.id, "红豆");
    const second = room.snapshot().currentQuestion?.audioUrl;

    expect(first).toBe("https://example.test/hongdou.m4a");
    expect(second).toBe("https://example.test/qingtian.m4a");
  });

  it("游戏结束后生成每个玩家答对数结算", () => {
    const room = createGameRoom({ idioms, songs, roundSeconds: 30, songRounds: 1, random: () => 0 });
    const alice = room.join("阿明");
    const bob = room.join("小红");

    room.start("song");
    room.submitMessage(alice.id, "晴天");

    const snapshot = room.snapshot();
    expect(snapshot.status).toBe("finished");
    expect(snapshot.settlement).toEqual([
      { playerId: alice.id, name: "阿明", score: 1 },
      { playerId: bob.id, name: "小红", score: 0 }
    ]);
  });

  it("成语接龙接受繁体输入匹配真实词库成语", () => {
    const room = createGameRoom({ idioms, songs, roundSeconds: 30, random: () => 0 });
    const alice = room.join("阿明");

    room.start("idiom");
    room.submitMessage(alice.id, "意气风发");
    room.submitMessage(alice.id, "发愤图强");
    const result = room.submitMessage(alice.id, "強詞奪理");

    expect(result.hit?.answer).toBe("强词夺理");
    expect(result.botMessages.at(-1)?.text).toContain("@阿明 答对了");
  });

  it("成语接龙接受常见异写命中真实词库成语", () => {
    const room = createGameRoom({ idioms, songs, roundSeconds: 30, random: () => 0 });
    const alice = room.join("阿明");

    room.start("idiom");
    room.submitMessage(alice.id, "意气风发");
    const result = room.submitMessage(alice.id, "发奋图强");

    expect(result.hit?.answer).toBe("发愤图强");
    expect(result.botMessages.at(-1)?.text).toContain("答案是《发愤图强》");
  });

  it("成语接龙同一个尾音允许多个真实答案命中", () => {
    const multiAnswerIdioms: IdiomEntry[] = [
      { text: "七上八落", pinyin: ["qi", "shang", "ba", "luo"] },
      { text: "落井下石", pinyin: ["luo", "jing", "xia", "shi"] },
      { text: "落花流水", pinyin: ["luo", "hua", "liu", "shui"] },
      { text: "石破天惊", pinyin: ["shi", "po", "tian", "jing"] },
      { text: "水到渠成", pinyin: ["shui", "dao", "qu", "cheng"] }
    ];
    const firstRoom = createGameRoom({ idioms: multiAnswerIdioms, songs, roundSeconds: 30, random: () => 0 });
    const secondRoom = createGameRoom({ idioms: multiAnswerIdioms, songs, roundSeconds: 30, random: () => 0 });
    const firstPlayer = firstRoom.join("阿明");
    const secondPlayer = secondRoom.join("小红");

    firstRoom.start("idiom");
    secondRoom.start("idiom");
    const firstResult = firstRoom.submitMessage(firstPlayer.id, "落井下石");
    const secondResult = secondRoom.submitMessage(secondPlayer.id, "落花流水");

    expect(firstResult.hit?.answer).toBe("落井下石");
    expect(secondResult.hit?.answer).toBe("落花流水");
  });

  it("成语接龙允许败化伤风接风调雨顺", () => {
    const pairIdioms: IdiomEntry[] = [
      { text: "败化伤风", pinyin: ["bai", "hua", "shang", "feng"] },
      { text: "风调雨顺", pinyin: ["feng", "tiao", "yu", "shun"] },
      { text: "顺理成章", pinyin: ["shun", "li", "cheng", "zhang"] }
    ];
    const room = createGameRoom({ idioms: pairIdioms, songs, roundSeconds: 30, random: () => 0 });
    const player = room.join("阿明");

    room.start("idiom");
    const result = room.submitMessage(player.id, "风调雨顺");

    expect(result.hit?.answer).toBe("风调雨顺");
  });

  it("成语接龙开局从可接的成语中随机选择，不固定一心一意", () => {
    const room = createGameRoom({ idioms, songs, roundSeconds: 30, random: () => 0.75 });
    room.join("阿明");

    room.start("idiom");

    expect(room.snapshot().currentQuestion?.prompt).toBe("请接：海阔天空");
  });

  it("成语接龙超时时公布真实可接答案，不公布空答案", () => {
    const room = createGameRoom({ idioms, songs, roundSeconds: 30, random: () => 0 });
    room.join("阿明");

    room.start("idiom");
    const messages = room.timeoutRound();

    expect(messages[0].text).toBe("本轮超时，参考答案：意气风发");
  });

  it("题库字段异常时直接报错，不生成假题", () => {
    expect(() =>
      createGameRoom({
        idioms: [{ text: "一心一意", pinyin: ["yi"] }],
        songs,
        roundSeconds: 30
      })
    ).toThrow("成语题库异常");
  });
});
