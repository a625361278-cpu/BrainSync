import type { SongEntry } from "../../shared/types";

export function resolveSongPreviewUrl(songId: string, songs: SongEntry[]): string {
  const cleanId = songId.trim();
  if (!cleanId) {
    throw new Error("歌曲ID不能为空");
  }
  const song = songs.find((entry) => entry.id === cleanId);
  if (!song) {
    throw new Error(`歌曲不存在：${cleanId}`);
  }
  if (!/^https?:\/\//i.test(song.previewUrl)) {
    throw new Error(`歌曲试听地址异常：${song.id}`);
  }
  return song.previewUrl;
}
