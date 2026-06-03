export type PveAudioFilter = "phone" | "muffled" | "short";

export interface PveLevelConfig {
  level: number;
  name: string;
  songCount: number;
  timeLimitSeconds: number;
  passScore: number;
  starScores: [number, number, number];
  audioFilter: PveAudioFilter;
  difficultyRange: [number, number];
}

export const DEFAULT_PVE_LEVELS: PveLevelConfig[] = [
  level(1, "初听旋律", 30, 1800, [1800, 3000, 4200], "phone", [1, 2]),
  level(2, "副歌雷达", 28, 2200, [2200, 3400, 4400], "phone", [1, 3]),
  level(3, "热门回忆", 26, 2500, [2500, 3600, 4600], "phone", [1, 3]),
  level(4, "耳朵热身", 24, 2800, [2800, 3800, 4700], "muffled", [2, 4]),
  level(5, "旋律追击", 22, 3000, [3000, 4000, 4800], "muffled", [2, 4]),
  level(6, "歌名捕手", 20, 3200, [3200, 4200, 4900], "muffled", [2, 5]),
  level(7, "电话音挑战", 18, 3400, [3400, 4300, 5000], "short", [3, 5]),
  level(8, "快问快答", 16, 3600, [3600, 4400, 5050], "short", [3, 5]),
  level(9, "金曲盲听", 15, 3800, [3800, 4500, 5100], "short", [4, 5]),
  level(10, "好友歌王", 15, 4000, [4000, 4600, 5200], "short", [4, 5]),
  level(11, "高能辨音", 14, 4200, [4200, 4700, 5250], "short", [4, 5]),
  level(12, "歌王冲刺", 13, 4400, [4400, 4800, 5300], "short", [5, 5]),
  level(13, "混响复盘", 12, 4600, [4600, 4900, 5350], "short", [5, 5])
];

function level(
  levelNo: number,
  name: string,
  timeLimitSeconds: number,
  passScore: number,
  starScores: [number, number, number],
  audioFilter: PveAudioFilter,
  difficultyRange: [number, number]
): PveLevelConfig {
  return {
    level: levelNo,
    name,
    songCount: 5,
    timeLimitSeconds,
    passScore,
    starScores,
    audioFilter,
    difficultyRange
  };
}
