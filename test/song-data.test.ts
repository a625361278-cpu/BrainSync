import { describe, expect, it } from "vitest";
import songs from "../src/server/data/songs.json";

describe("歌曲题库质量", () => {
  it("至少包含50首歌，避免猜歌名反复循环", () => {
    expect(songs.length).toBeGreaterThanOrEqual(50);
  });

  it("歌曲字段完整且主答案不重复", () => {
    const answers = new Set<string>();

    for (const song of songs) {
      expect(song.id).toBeTruthy();
      expect(song.title).toBeTruthy();
      expect(song.artist).toBeTruthy();
      expect(song.searchTerm).toBeTruthy();
      expect(song.aliases).toBeInstanceOf(Array);
      expect(() => new URL(song.previewUrl)).not.toThrow();
      expect(() => new URL(song.sourceUrl)).not.toThrow();
      const key = `${song.title}|${song.artist}`;
      expect(answers.has(key)).toBe(false);
      answers.add(key);
    }
  });
});
