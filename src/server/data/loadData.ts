import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CharacterEntry, IdiomEntry, MovieEntry, RiddleEntry, SongEntry } from "../../shared/types";

export interface GameData {
  idioms: IdiomEntry[];
  songs: SongEntry[];
  characters: CharacterEntry[];
  movies: MovieEntry[];
  riddles: RiddleEntry[];
}

export function loadGameData(): GameData {
  const data = {
    idioms: readJson<IdiomEntry[]>("./idioms.json"),
    songs: readJson<SongEntry[]>("./songs.json"),
    characters: readJson<CharacterEntry[]>("./character-silhouettes.json"),
    movies: readJson<MovieEntry[]>("./movie-stills.json"),
    riddles: readJson<RiddleEntry[]>("./riddles.json")
  };
  validateImageQuestions(data.characters, "剪影猜人", "name");
  validateImageQuestions(data.movies, "剧照猜电影", "title");
  validateRiddles(data.riddles);
  return data;
}

function readJson<T>(relativePath: string): T {
  const fileName = relativePath.replace(/^\.\//, "");
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), "dist-server/data", fileName),
    resolve(process.cwd(), "src/server/data", fileName),
    resolve(moduleDir, "data", fileName),
    resolve(moduleDir, fileName)
  ];
  const filePath = candidates.find((candidate) => existsSync(candidate));
  if (!filePath) {
    throw new Error(`题库文件不存在：${fileName}`);
  }
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function validateImageQuestions<T extends { id: string; imageUrl: string }>(
  entries: T[],
  label: string,
  answerKey: keyof T
): void {
  if (entries.length === 0) {
    throw new Error(`${label}题库异常：不能为空`);
  }
  for (const entry of entries) {
    const answer = String(entry[answerKey] ?? "");
    if (!entry.id || !answer || !entry.imageUrl) {
      throw new Error(`${label}题库异常：${answer || entry.id || "未知题目"} 字段不完整`);
    }
    if (!entry.imageUrl.startsWith("/")) {
      throw new Error(`${label}题库异常：${answer} 图片路径必须是站内绝对路径`);
    }
    if (!assetExists(entry.imageUrl)) {
      throw new Error(`${label}题库异常：${answer} 图片文件不存在：${entry.imageUrl}`);
    }
  }
}

function assetExists(publicUrl: string): boolean {
  const relativePath = publicUrl.replace(/^\//, "");
  const candidates = [
    resolve(process.cwd(), "public", relativePath),
    resolve(process.cwd(), "dist", relativePath)
  ];
  return candidates.some((candidate) => existsSync(candidate));
}

function validateRiddles(riddles: RiddleEntry[]): void {
  if (riddles.length === 0) {
    throw new Error("猜谜语题库异常：不能为空");
  }
  const ids = new Set<string>();
  for (const riddle of riddles) {
    if (
      !riddle.id ||
      !riddle.question ||
      !riddle.answer ||
      !Array.isArray(riddle.aliases) ||
      !riddle.category ||
      !Number.isInteger(riddle.difficulty) ||
      riddle.difficulty < 1 ||
      riddle.difficulty > 5 ||
      !riddle.source
    ) {
      throw new Error(`猜谜语题库异常：${riddle.answer || riddle.id || "未知谜语"} 字段不完整`);
    }
    if (ids.has(riddle.id)) {
      throw new Error(`猜谜语题库异常：重复ID ${riddle.id}`);
    }
    ids.add(riddle.id);
  }
}
