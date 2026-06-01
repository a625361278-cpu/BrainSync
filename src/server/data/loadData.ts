import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { IdiomEntry, SongEntry } from "../../shared/types";

export interface GameData {
  idioms: IdiomEntry[];
  songs: SongEntry[];
}

export function loadGameData(): GameData {
  return {
    idioms: readJson<IdiomEntry[]>("./idioms.json"),
    songs: readJson<SongEntry[]>("./songs.json")
  };
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
