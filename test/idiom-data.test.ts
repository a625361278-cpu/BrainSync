import { describe, expect, it } from "vitest";
import idioms from "../src/server/data/idioms.json";

describe("成语题库质量", () => {
  it("至少包含500条成语，避免短局频繁重复", () => {
    expect(idioms.length).toBeGreaterThanOrEqual(500);
  });

  it("包含常见同音接龙答案：败化伤风可以接风调雨顺", () => {
    const previous = idioms.find((idiom) => idiom.text === "败化伤风");
    const answer = idioms.find((idiom) => idiom.text === "风调雨顺");

    expect(previous?.pinyin.at(-1)).toBe("feng");
    expect(answer?.pinyin[0]).toBe("feng");
  });

  it("成语文本不重复，拼音字段完整且无声调", () => {
    const seen = new Set<string>();

    for (const idiom of idioms) {
      expect(seen.has(idiom.text)).toBe(false);
      seen.add(idiom.text);
      expect(idiom.text).toMatch(/^[\u4e00-\u9fff]{4}$/);
      expect(idiom.pinyin).toHaveLength([...idiom.text].length);
      for (const syllable of idiom.pinyin) {
        expect(syllable).toMatch(/^[a-z]+$/);
      }
    }
  });
});
