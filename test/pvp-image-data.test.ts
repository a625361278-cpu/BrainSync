import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import characters from "../src/server/data/character-silhouettes.json";
import movies from "../src/server/data/movie-stills.json";

describe("PVP图片题库质量", () => {
  it("剪影猜人至少包含60题，剧照猜电影至少包含5题", () => {
    expect(characters.length).toBeGreaterThanOrEqual(60);
    expect(movies.length).toBeGreaterThanOrEqual(5);
  });

  it("图片题字段完整且本地图片存在", () => {
    const characterIds = new Set<string>();
    const characterNames = new Set<string>();
    for (const character of characters) {
      expect(character.id).toBeTruthy();
      expect(character.name).toBeTruthy();
      expect(character.work).toBeTruthy();
      expect(character.aliases).toBeInstanceOf(Array);
      expect(character.difficulty).toBeGreaterThanOrEqual(1);
      expect(character.difficulty).toBeLessThanOrEqual(5);
      expect(character.referenceNote).toBeTruthy();
      expect(["processed-reference", "generated-reference"]).toContain(character.assetMode);
      expect(character.imageUrl).toMatch(/^\/pvp-assets\/silhouettes\/.+\.png$/);
      expect(existsSync(resolve("public", character.imageUrl.slice(1)))).toBe(true);
      expect(characterIds.has(character.id)).toBe(false);
      expect(characterNames.has(character.name)).toBe(false);
      characterIds.add(character.id);
      characterNames.add(character.name);
    }

    for (const movie of movies) {
      expect(movie.id).toBeTruthy();
      expect(movie.title).toBeTruthy();
      expect(movie.year).toBeGreaterThan(1900);
      expect(movie.region).toBeTruthy();
      expect(movie.genre).toBeTruthy();
      expect(movie.aliases).toBeInstanceOf(Array);
      expect(movie.imageUrl).toMatch(/^\/pvp-assets\/movie-stills\/.+\.svg$/);
      expect(existsSync(resolve("public", movie.imageUrl.slice(1)))).toBe(true);
    }
  });
});
