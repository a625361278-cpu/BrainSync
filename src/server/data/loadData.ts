import { readFileSync } from "node:fs";
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
  const url = new URL(relativePath, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as T;
}
