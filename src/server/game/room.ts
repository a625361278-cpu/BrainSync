import type {
  ChatMessage,
  GameType,
  IdiomEntry,
  Player,
  PublicQuestion,
  RoomSnapshot,
  RoomStatus,
  SettlementRow,
  SongEntry
} from "../../shared/types";

const BOT_AVATAR = "/avatars/bot.svg";
const PLAYER_AVATARS = [
  "/avatars/player-1.svg",
  "/avatars/player-2.svg",
  "/avatars/player-3.svg",
  "/avatars/player-4.svg",
  "/avatars/player-5.svg",
  "/avatars/player-6.svg"
];

export interface CreateRoomOptions {
  code?: string;
  idioms: IdiomEntry[];
  songs: SongEntry[];
  roundSeconds: number;
  idiomRounds?: number;
  songRounds?: number;
  now?: () => number;
  random?: () => number;
}

export interface SubmitResult {
  playerMessage: ChatMessage;
  botMessages: ChatMessage[];
  hit?: {
    playerId: string;
    answer: string;
  };
}

interface ActiveQuestion {
  gameType: GameType;
  roundIndex: number;
  totalRounds: number;
  answer: string;
  prompt: string;
  audioUrl?: string;
  sourceUrl?: string;
  previousIdiom?: IdiomEntry;
  song?: SongEntry;
}

export interface GameRoom {
  join(name: string, playerId?: string): Player;
  leave(playerId: string): void;
  start(gameType: GameType, requesterId?: string): ChatMessage[];
  submitMessage(playerId: string, text: string): SubmitResult;
  timeoutRound(): ChatMessage[];
  snapshot(): RoomSnapshot;
}

export function createGameRoom(options: CreateRoomOptions): GameRoom {
  validateOptions(options);
  return new InMemoryGameRoom(options);
}

class InMemoryGameRoom implements GameRoom {
  private readonly code: string;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly idioms: IdiomEntry[];
  private readonly songs: SongEntry[];
  private readonly idiomRounds: number;
  private readonly songRounds: number;
  private readonly players = new Map<string, Player>();
  private readonly usedIdioms = new Set<string>();
  private readonly messages: ChatMessage[] = [];
  private status: RoomStatus = "waiting";
  private hostId = "";
  private gameType?: GameType;
  private activeQuestion?: ActiveQuestion;
  private settlement?: SettlementRow[];
  private playerSeq = 0;
  private messageSeq = 0;
  private songCursor = 0;
  private songDeck: SongEntry[] = [];
  private idiomCursor = 0;

  constructor(options: CreateRoomOptions) {
    this.code = options.code ?? createRoomCode();
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.idioms = [...options.idioms];
    this.songs = [...options.songs];
    this.idiomRounds = options.idiomRounds ?? 10;
    this.songRounds = options.songRounds ?? 5;
  }

  join(name: string, playerId?: string): Player {
    const normalizedName = name.trim();
    if (!normalizedName) {
      throw new Error("昵称不能为空");
    }

    const existingById = playerId ? this.players.get(playerId) : undefined;
    if (existingById) {
      existingById.connected = true;
      return clonePlayer(existingById);
    }

    for (const player of this.players.values()) {
      if (player.name === normalizedName) {
        throw new Error(`昵称已存在：${normalizedName}`);
      }
    }

    const id = playerId ?? `p_${++this.playerSeq}_${randomToken(4)}`;
    const avatar = PLAYER_AVATARS[this.players.size % PLAYER_AVATARS.length];
    const player: Player = { id, name: normalizedName, avatar, score: 0, connected: true };
    this.players.set(id, player);
    if (!this.hostId) {
      this.hostId = id;
    }
    this.pushBot(`${normalizedName} 加入了房间`, "system");
    return clonePlayer(player);
  }

  leave(playerId: string): void {
    const player = this.requirePlayer(playerId);
    player.connected = false;
  }

  start(gameType: GameType, requesterId?: string): ChatMessage[] {
    if (this.players.size === 0) {
      throw new Error("没有玩家，不能开始游戏");
    }
    if (!this.hostId) {
      throw new Error("房主状态异常，不能开始游戏");
    }
    if (requesterId && requesterId !== this.hostId) {
      throw new Error("只有房主可以开始游戏");
    }
    if (this.status === "playing") {
      throw new Error("游戏已经开始");
    }

    this.status = "playing";
    this.gameType = gameType;
    this.settlement = undefined;
    this.usedIdioms.clear();
    this.songCursor = 0;
    this.songDeck = [];
    this.idiomCursor = 0;
    for (const player of this.players.values()) {
      player.score = 0;
    }

    const intro =
      gameType === "song"
        ? `开始猜歌名或歌手！总共 ${this.songRounds} 题。听音猜歌！`
        : `开始成语接龙！总共 ${this.idiomRounds} 题。同音接龙！`;
    const messages = [this.pushBot(intro, "round")];
    messages.push(...this.advanceToNextRound());
    return messages;
  }

  submitMessage(playerId: string, text: string): SubmitResult {
    const player = this.requirePlayer(playerId);
    const cleanText = text.trim();
    if (!cleanText) {
      throw new Error("消息不能为空");
    }

    const playerMessage = this.pushPlayer(player, cleanText);
    const botMessages: ChatMessage[] = [];
    const result: SubmitResult = { playerMessage, botMessages };

    if (this.status !== "playing" || !this.activeQuestion) {
      return result;
    }

    const hitAnswer = this.checkAnswer(cleanText);
    if (!hitAnswer) {
      botMessages.push(this.pushBot(`@${player.name} 答案不对`, "result", player.id));
      return result;
    }

    player.score += 1;
    result.hit = { playerId: player.id, answer: hitAnswer };
    botMessages.push(this.pushBot(`@${player.name} 答对了！答案是《${hitAnswer}》`, "result", player.id));
    this.advanceToNextRound();
    return result;
  }

  timeoutRound(): ChatMessage[] {
    if (this.status !== "playing" || !this.activeQuestion) {
      throw new Error("当前没有可超时的题目");
    }
    const timeoutAnswer = this.resolveTimeoutAnswer();
    const messages = [this.pushBot(timeoutAnswer.message, "result")];
    if (this.activeQuestion.gameType === "idiom") {
      this.activeQuestion.answer = timeoutAnswer.chosenAnswer;
      this.usedIdioms.add(timeoutAnswer.chosenAnswer);
      messages.push(...this.advanceToNextRound());
      return messages;
    }
    messages.push(...this.advanceToNextRound(true));
    return messages;
  }

  snapshot(): RoomSnapshot {
    return {
      code: this.code,
      status: this.status,
      hostId: this.hostId,
      gameType: this.gameType,
      currentQuestion: this.activeQuestion ? toPublicQuestion(this.activeQuestion) : undefined,
      players: [...this.players.values()].map(clonePlayer),
      messages: [...this.messages],
      settlement: this.settlement ? [...this.settlement] : undefined
    };
  }

  private advanceToNextRound(fromTimeout = false): ChatMessage[] {
    if (!this.gameType) {
      throw new Error("游戏类型缺失，无法进入下一题");
    }

    const nextQuestion =
      this.gameType === "song" ? this.nextSongQuestion() : this.nextIdiomQuestion(fromTimeout);
    if (!nextQuestion) {
      this.finishGame();
      return [this.pushBot(formatSettlement(this.requireSettlement()), "result")];
    }

    this.activeQuestion = nextQuestion;
    const questionNo = nextQuestion.roundIndex + 1;
    if (nextQuestion.gameType === "song") {
      return [
        this.pushBot(`第 ${questionNo}/${nextQuestion.totalRounds} 题，听这段音乐猜歌名。`, "round"),
        this.pushBot("语音 15''", "audio", undefined, nextQuestion.audioUrl)
      ];
    }

    return [
      this.pushBot(
        `第 ${questionNo}/${nextQuestion.totalRounds} 题，请接：${nextQuestion.previousIdiom?.text}（${nextQuestion.previousIdiom?.pinyin.at(-1)}）`,
        "round"
      )
    ];
  }

  private nextSongQuestion(): ActiveQuestion | undefined {
    if (this.songCursor >= this.songRounds) {
      return undefined;
    }
    const song = this.pickNextSong();
    const question: ActiveQuestion = {
      gameType: "song",
      roundIndex: this.songCursor,
      totalRounds: this.songRounds,
      answer: song.title,
      prompt: `猜歌名：${song.artist}`,
      audioUrl: song.previewUrl,
      sourceUrl: song.sourceUrl,
      song
    };
    this.songCursor += 1;
    return question;
  }

  private pickNextSong(): SongEntry {
    if (this.songDeck.length === 0) {
      this.songDeck = [...this.songs];
    }
    const index = Math.min(this.songDeck.length - 1, Math.floor(this.random() * this.songDeck.length));
    const [song] = this.songDeck.splice(index, 1);
    if (!song) {
      throw new Error("歌曲题库状态异常：无法抽取歌曲");
    }
    return song;
  }

  private nextIdiomQuestion(fromTimeout: boolean): ActiveQuestion | undefined {
    if (this.idiomCursor >= this.idiomRounds) {
      return undefined;
    }

    let previous: IdiomEntry;
    if (!this.activeQuestion?.previousIdiom || this.gameType !== "idiom") {
      previous = this.pickRandomStartIdiom();
      this.usedIdioms.add(previous.text);
    } else if (fromTimeout) {
      previous = this.findNextIdiom(this.activeQuestion.previousIdiom) ?? failNoIdiom(this.activeQuestion.previousIdiom);
      this.usedIdioms.add(previous.text);
    } else {
      previous = this.requireIdiom(this.activeQuestion.answer);
    }

    const question: ActiveQuestion = {
      gameType: "idiom",
      roundIndex: this.idiomCursor,
      totalRounds: this.idiomRounds,
      answer: "",
      prompt: `请接：${previous.text}`,
      previousIdiom: previous
    };
    this.idiomCursor += 1;
    return question;
  }

  private checkAnswer(text: string): string | undefined {
    if (!this.activeQuestion) {
      throw new Error("当前题目缺失");
    }

    if (this.activeQuestion.gameType === "song") {
      const song = this.activeQuestion.song;
      if (!song) {
        throw new Error("歌曲题目状态异常：缺少歌曲数据");
      }
      const normalized = normalizeAnswer(text);
      const candidates = [song.title, ...song.aliases].map(normalizeAnswer);
      return candidates.includes(normalized) ? song.title : undefined;
    }

    const previous = this.activeQuestion.previousIdiom;
    if (!previous) {
      throw new Error("成语接龙状态异常：缺少上一成语");
    }
    const idiom = this.findIdiomByAnswerText(text);
    if (!idiom) {
      return undefined;
    }
    if (this.usedIdioms.has(idiom.text)) {
      return undefined;
    }
    const expected = previous.pinyin.at(-1);
    const actual = idiom.pinyin[0];
    if (!expected || !actual) {
      throw new Error("成语拼音状态异常");
    }
    if (expected !== actual) {
      return undefined;
    }
    this.usedIdioms.add(idiom.text);
    this.activeQuestion.answer = idiom.text;
    return idiom.text;
  }

  private findNextIdiom(previous: IdiomEntry): IdiomEntry | undefined {
    return this.findNextIdioms(previous)[0];
  }

  private findNextIdioms(previous: IdiomEntry): IdiomEntry[] {
    const expected = previous.pinyin.at(-1);
    return this.idioms.filter((entry) => entry.pinyin[0] === expected && !this.usedIdioms.has(entry.text));
  }

  private findIdiomByAnswerText(text: string): IdiomEntry | undefined {
    const normalizedText = normalizeIdiomText(text);
    return this.idioms.find((entry) => {
      const candidates = [entry.text, ...(entry.aliases ?? [])];
      return candidates.some((candidate) => normalizeIdiomText(candidate) === normalizedText);
    });
  }

  private pickRandomStartIdiom(): IdiomEntry {
    const candidates = this.idioms.filter((entry) => {
      const expected = entry.pinyin.at(-1);
      return Boolean(expected && this.idioms.some((candidate) => candidate.text !== entry.text && candidate.pinyin[0] === expected));
    });
    if (candidates.length === 0) {
      throw new Error("成语题库异常：没有任何可接龙的开局成语");
    }
    const index = Math.min(candidates.length - 1, Math.floor(this.random() * candidates.length));
    return candidates[index];
  }

  private resolveTimeoutAnswer(): { chosenAnswer: string; message: string } {
    if (!this.activeQuestion) {
      throw new Error("当前题目缺失");
    }
    if (this.activeQuestion.gameType === "song") {
      if (!this.activeQuestion.answer) {
        throw new Error("歌曲题目状态异常：缺少正确答案");
      }
      return {
        chosenAnswer: this.activeQuestion.answer,
        message: `本轮超时，正确答案是《${this.activeQuestion.answer}》`
      };
    }

    const previous = this.activeQuestion.previousIdiom;
    if (!previous) {
      throw new Error("成语接龙状态异常：缺少上一成语");
    }
    const answers = this.findNextIdioms(previous);
    if (answers.length === 0) {
      throw new Error(`成语题库异常：找不到可接 ${previous.text} 的成语`);
    }
    const chosen = answers[Math.min(answers.length - 1, Math.floor(this.random() * answers.length))];
    const sample = answers.slice(0, 5).map((entry) => entry.text).join("、");
    const suffix = answers.length > 5 ? " 等" : "";
    return {
      chosenAnswer: chosen.text,
      message: `本轮超时，参考答案：${sample}${suffix}`
    };
  }

  private requireIdiom(text: string): IdiomEntry {
    const idiom = this.idioms.find((entry) => entry.text === text);
    if (!idiom) {
      throw new Error(`成语状态异常，找不到已命中成语：${text}`);
    }
    return idiom;
  }

  private requirePlayer(playerId: string): Player {
    const player = this.players.get(playerId);
    if (!player) {
      throw new Error(`玩家不存在：${playerId}`);
    }
    return player;
  }

  private requireSettlement(): SettlementRow[] {
    if (!this.settlement) {
      throw new Error("结算状态异常");
    }
    return this.settlement;
  }

  private finishGame(): void {
    this.status = "finished";
    this.activeQuestion = undefined;
    this.settlement = [...this.players.values()]
      .map((player) => ({ playerId: player.id, name: player.name, score: player.score }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "zh-CN"));
  }

  private pushPlayer(player: Player, text: string): ChatMessage {
    const message: ChatMessage = {
      id: this.nextMessageId(),
      sender: "player",
      kind: "chat",
      text,
      playerId: player.id,
      playerName: player.name,
      avatar: player.avatar,
      createdAt: this.now()
    };
    this.messages.push(message);
    return message;
  }

  private pushBot(text: string, kind: ChatMessage["kind"], atPlayerId?: string, audioUrl?: string): ChatMessage {
    const message: ChatMessage = {
      id: this.nextMessageId(),
      sender: "bot",
      kind,
      text,
      atPlayerId,
      avatar: BOT_AVATAR,
      audioUrl,
      createdAt: this.now()
    };
    this.messages.push(message);
    return message;
  }

  private nextMessageId(): string {
    this.messageSeq += 1;
    return `m_${this.messageSeq}_${randomToken(5)}`;
  }
}

function validateOptions(options: CreateRoomOptions): void {
  if (!Number.isInteger(options.roundSeconds) || options.roundSeconds <= 0) {
    throw new Error("回合秒数必须是正整数");
  }
  validateIdioms(options.idioms);
  validateSongs(options.songs);
}

function validateIdioms(idioms: IdiomEntry[]): void {
  if (idioms.length === 0) {
    throw new Error("成语题库异常：不能为空");
  }
  for (const idiom of idioms) {
    if (!idiom.text || !Array.isArray(idiom.pinyin) || idiom.pinyin.length !== [...idiom.text].length) {
      throw new Error(`成语题库异常：${idiom.text || "未知成语"} 拼音字段不完整`);
    }
    if (idiom.aliases && !Array.isArray(idiom.aliases)) {
      throw new Error(`成语题库异常：${idiom.text} aliases 必须是数组`);
    }
    for (const syllable of idiom.pinyin) {
      if (!syllable || /[1-5āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/i.test(syllable)) {
        throw new Error(`成语题库异常：${idiom.text} 拼音必须去声调`);
      }
    }
  }
}

function validateSongs(songs: SongEntry[]): void {
  if (songs.length === 0) {
    throw new Error("歌曲题库异常：不能为空");
  }
  for (const song of songs) {
    if (!song.id || !song.title || !song.artist || !song.searchTerm || !song.previewUrl || !song.sourceUrl) {
      throw new Error(`歌曲题库异常：${song.title || song.id || "未知歌曲"} 字段不完整`);
    }
    try {
      new URL(song.previewUrl);
      new URL(song.sourceUrl);
    } catch {
      throw new Error(`歌曲题库异常：${song.title} URL 不合法`);
    }
  }
}

function normalizeAnswer(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[《》“”"'‘’\s,，.。!！?？:：;；\-_/\\()[\]【】]/g, "");
}

function normalizeIdiomText(value: string): string {
  const traditionalToSimplified: Record<string, string> = {
    強: "强",
    詞: "词",
    奪: "夺",
    發: "发",
    圖: "图",
    難: "难",
    風: "风",
    樂: "乐",
    門: "门",
    見: "见",
    開: "开",
    壯: "壮",
    雲: "云",
    異: "异",
    後: "后",
    來: "来"
  };
  return [...value.normalize("NFKC").trim()]
    .map((char) => traditionalToSimplified[char] ?? char)
    .join("")
    .replace(/[《》“”"'‘’\s,，.。!！?？:：;；\-_/\\()[\]【】]/g, "");
}

function toPublicQuestion(question: ActiveQuestion): PublicQuestion {
  return {
    gameType: question.gameType,
    round: question.roundIndex + 1,
    totalRounds: question.totalRounds,
    prompt: question.prompt,
    audioUrl: question.audioUrl,
    sourceUrl: question.sourceUrl,
    endsWithPinyin: question.previousIdiom?.pinyin.at(-1)
  };
}

function clonePlayer(player: Player): Player {
  return { ...player };
}

function formatSettlement(rows: SettlementRow[]): string {
  const details = rows.map((row, index) => `${index + 1}. ${row.name}：${row.score} 题`).join("\n");
  return `游戏结束，结算如下：\n${details}`;
}

function failNoIdiom(previous: IdiomEntry): never {
  throw new Error(`成语题库异常：找不到可接 ${previous.text} 的成语`);
}

function createRoomCode(): string {
  return randomToken(6).toUpperCase();
}

function randomToken(length: number): string {
  return Math.random().toString(36).slice(2, 2 + length);
}
