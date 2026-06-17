import { describe, expect, it } from "vitest";
import riddles from "../src/server/data/riddles.json";

describe("PVP猜谜语题库质量", () => {
  it("第一版通用谜语库不少于100条，且字段完整", () => {
    expect(riddles.length).toBeGreaterThanOrEqual(100);

    const ids = new Set<string>();
    for (const riddle of riddles) {
      expect(riddle.id).toMatch(/^riddle-\d{3}$/);
      expect(ids.has(riddle.id)).toBe(false);
      ids.add(riddle.id);
      expect(riddle.question.trim().length).toBeGreaterThan(4);
      expect(riddle.answer.trim().length).toBeGreaterThan(0);
      expect(riddle.aliases).toBeInstanceOf(Array);
      expect(riddle.category.trim().length).toBeGreaterThan(0);
      expect(riddle.difficulty).toBeGreaterThanOrEqual(1);
      expect(riddle.difficulty).toBeLessThanOrEqual(5);
      expect(riddle.source).toBe("project-curated");
    }
  });

  it("题库覆盖多种通用生活分类，适合房间抢答", () => {
    const categories = new Set(riddles.map((riddle) => riddle.category));

    for (const expected of ["动物", "自然", "日用品", "食物", "学习用品", "交通", "身体"]) {
      expect(categories.has(expected)).toBe(true);
    }
  });
});
