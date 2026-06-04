import type {
  ChatMessage,
  CharacterEntry,
  GameType,
  IdiomEntry,
  MovieEntry,
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
  characters?: CharacterEntry[];
  movies?: MovieEntry[];
  roundSeconds: number;
  idiomRounds?: number;
  songRounds?: number;
  imageRounds?: number;
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
  questionId: string;
  gameType: GameType;
  roundIndex: number;
  totalRounds: number;
  answer: string;
  prompt: string;
  hinted: boolean;
  audioUrl?: string;
  imageUrl?: string;
  sourceUrl?: string;
  previousIdiom?: IdiomEntry;
  song?: SongEntry;
  character?: CharacterEntry;
  movie?: MovieEntry;
}

export interface GameRoom {
  join(name: string, playerId?: string): Player;
  leave(playerId: string): void;
  start(gameType: GameType, requesterId?: string): ChatMessage[];
  submitMessage(playerId: string, text: string): SubmitResult;
  hintRound(questionId?: string): ChatMessage[];
  timeoutRound(questionId?: string): ChatMessage[];
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
  private readonly characters: CharacterEntry[];
  private readonly movies: MovieEntry[];
  private readonly idiomRounds: number;
  private readonly songRounds: number;
  private readonly imageRounds: number;
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
  private characterCursor = 0;
  private characterDeck: CharacterEntry[] = [];
  private movieCursor = 0;
  private movieDeck: MovieEntry[] = [];
  private idiomCursor = 0;

  constructor(options: CreateRoomOptions) {
    this.code = options.code ?? createRoomCode();
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.idioms = [...options.idioms];
    this.songs = [...options.songs];
    this.characters = [...(options.characters ?? [])];
    this.movies = [...(options.movies ?? [])];
    this.idiomRounds = options.idiomRounds ?? 10;
    this.songRounds = options.songRounds ?? 5;
    this.imageRounds = options.imageRounds ?? 5;
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
    this.characterCursor = 0;
    this.characterDeck = [];
    this.movieCursor = 0;
    this.movieDeck = [];
    this.idiomCursor = 0;
    for (const player of this.players.values()) {
      player.score = 0;
    }

    const intro = this.buildIntro(gameType);
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

  hintRound(questionId?: string): ChatMessage[] {
    if (this.status !== "playing" || !this.activeQuestion) {
      if (questionId) {
        return [];
      }
      throw new Error("当前没有可提示的题目");
    }
    if (questionId && this.activeQuestion.questionId !== questionId) {
      return [];
    }
    if (this.activeQuestion.hinted) {
      return [];
    }
    const hint = this.resolveHint();
    this.activeQuestion.hinted = true;
    return [this.pushBot(hint, "hint")];
  }

  timeoutRound(questionId?: string): ChatMessage[] {
    if (this.status !== "playing" || !this.activeQuestion) {
      if (questionId) {
        return [];
      }
      throw new Error("当前没有可超时的题目");
    }
    if (questionId && this.activeQuestion.questionId !== questionId) {
      return [];
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

    const nextQuestion = this.nextQuestion(fromTimeout);
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

    if (nextQuestion.gameType === "silhouette") {
      return [
        this.pushBot(`第 ${questionNo}/${nextQuestion.totalRounds} 题，看剪影猜动漫角色。`, "round"),
        this.pushBot("剪影题", "image", undefined, undefined, nextQuestion.imageUrl, "动漫角色剪影")
      ];
    }

    if (nextQuestion.gameType === "movie") {
      return [
        this.pushBot(`第 ${questionNo}/${nextQuestion.totalRounds} 题，看剧照猜电影名。`, "round"),
        this.pushBot("剧照题", "image", undefined, undefined, nextQuestion.imageUrl, "电影剧照题")
      ];
    }

    return [
      this.pushBot(
        `第 ${questionNo}/${nextQuestion.totalRounds} 题，请接：${nextQuestion.previousIdiom?.text}（${nextQuestion.previousIdiom?.pinyin.at(-1)}）`,
        "round"
      )
    ];
  }

  private nextQuestion(fromTimeout: boolean): ActiveQuestion | undefined {
    if (!this.gameType) {
      throw new Error("游戏类型缺失，无法抽题");
    }
    if (this.gameType === "song") {
      return this.nextSongQuestion();
    }
    if (this.gameType === "silhouette") {
      return this.nextCharacterQuestion();
    }
    if (this.gameType === "movie") {
      return this.nextMovieQuestion();
    }
    return this.nextIdiomQuestion(fromTimeout);
  }

  private nextSongQuestion(): ActiveQuestion | undefined {
    if (this.songCursor >= this.songRounds) {
      return undefined;
    }
    const song = this.pickNextSong();
    const question: ActiveQuestion = {
      questionId: this.nextQuestionId("song", this.songCursor),
      gameType: "song",
      roundIndex: this.songCursor,
      totalRounds: this.songRounds,
      answer: song.title,
      prompt: `猜歌名：${song.artist}`,
      hinted: false,
      audioUrl: song.previewUrl,
      sourceUrl: song.sourceUrl,
      song
    };
    this.songCursor += 1;
    return question;
  }

  private nextCharacterQuestion(): ActiveQuestion | undefined {
    if (this.characterCursor >= this.imageRounds) {
      return undefined;
    }
    const character = this.pickNextCharacter();
    const question: ActiveQuestion = {
      questionId: this.nextQuestionId("silhouette", this.characterCursor),
      gameType: "silhouette",
      roundIndex: this.characterCursor,
      totalRounds: this.imageRounds,
      answer: character.name,
      prompt: "看剪影猜动漫角色",
      hinted: false,
      imageUrl: character.imageUrl,
      character
    };
    this.characterCursor += 1;
    return question;
  }

  private nextMovieQuestion(): ActiveQuestion | undefined {
    if (this.movieCursor >= this.imageRounds) {
      return undefined;
    }
    const movie = this.pickNextMovie();
    const question: ActiveQuestion = {
      questionId: this.nextQuestionId("movie", this.movieCursor),
      gameType: "movie",
      roundIndex: this.movieCursor,
      totalRounds: this.imageRounds,
      answer: movie.title,
      prompt: "看剧照猜电影名",
      hinted: false,
      imageUrl: movie.imageUrl,
      movie
    };
    this.movieCursor += 1;
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

  private pickNextCharacter(): CharacterEntry {
    if (this.characterDeck.length === 0) {
      this.characterDeck = [...this.characters];
    }
    const index = Math.min(this.characterDeck.length - 1, Math.floor(this.random() * this.characterDeck.length));
    const [character] = this.characterDeck.splice(index, 1);
    if (!character) {
      throw new Error("剪影猜人题库状态异常：无法抽取角色");
    }
    return character;
  }

  private pickNextMovie(): MovieEntry {
    if (this.movieDeck.length === 0) {
      this.movieDeck = [...this.movies];
    }
    const index = Math.min(this.movieDeck.length - 1, Math.floor(this.random() * this.movieDeck.length));
    const [movie] = this.movieDeck.splice(index, 1);
    if (!movie) {
      throw new Error("剧照猜电影题库状态异常：无法抽取电影");
    }
    return movie;
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
      questionId: this.nextQuestionId("idiom", this.idiomCursor),
      gameType: "idiom",
      roundIndex: this.idiomCursor,
      totalRounds: this.idiomRounds,
      answer: "",
      prompt: `请接：${previous.text}`,
      hinted: false,
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

    if (this.activeQuestion.gameType === "silhouette") {
      const character = this.activeQuestion.character;
      if (!character) {
        throw new Error("剪影猜人题目状态异常：缺少角色数据");
      }
      const normalized = normalizeAnswer(text);
      const candidates = [character.name, ...character.aliases].map(normalizeAnswer);
      return candidates.includes(normalized) ? character.name : undefined;
    }

    if (this.activeQuestion.gameType === "movie") {
      const movie = this.activeQuestion.movie;
      if (!movie) {
        throw new Error("剧照猜电影题目状态异常：缺少电影数据");
      }
      const normalized = normalizeAnswer(text);
      const candidates = [movie.title, ...movie.aliases].map(normalizeAnswer);
      return candidates.includes(normalized) ? movie.title : undefined;
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
    if (this.activeQuestion.gameType === "silhouette") {
      if (!this.activeQuestion.answer) {
        throw new Error("剪影猜人题目状态异常：缺少正确答案");
      }
      return {
        chosenAnswer: this.activeQuestion.answer,
        message: `本轮超时，正确答案是《${this.activeQuestion.answer}》`
      };
    }
    if (this.activeQuestion.gameType === "movie") {
      if (!this.activeQuestion.answer) {
        throw new Error("剧照猜电影题目状态异常：缺少正确答案");
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

  private resolveHint(): string {
    if (!this.activeQuestion) {
      throw new Error("当前题目缺失");
    }
    if (this.activeQuestion.gameType === "song") {
      const song = this.activeQuestion.song;
      if (!song?.artist) {
        throw new Error("歌曲题目状态异常：缺少歌手提示数据");
      }
      return `提示：歌手是「${song.artist}」，歌名共 ${countChineseChars(song.title)} 个字`;
    }
    if (this.activeQuestion.gameType === "silhouette") {
      const character = this.activeQuestion.character;
      if (!character?.work) {
        throw new Error("剪影猜人题目状态异常：缺少作品提示数据");
      }
      return `提示：来自《${character.work}》，角色名共 ${countChineseChars(character.name)} 个字`;
    }
    if (this.activeQuestion.gameType === "movie") {
      const movie = this.activeQuestion.movie;
      if (!movie?.year || !movie.region || !movie.genre) {
        throw new Error("剧照猜电影题目状态异常：缺少年代/地区/类型提示数据");
      }
      return `提示：${movie.year} 年，${movie.region}${movie.genre}，片名共 ${countChineseChars(movie.title)} 个字`;
    }

    const previous = this.activeQuestion.previousIdiom;
    if (!previous) {
      throw new Error("成语接龙状态异常：缺少上一成语");
    }
    const answers = this.findNextIdioms(previous);
    if (answers.length === 0) {
      throw new Error(`成语题库异常：找不到可接 ${previous.text} 的成语`);
    }
    const firstChars = [...new Set(answers.map((entry) => [...entry.text][0]).filter(Boolean))].slice(0, 3).join("、");
    return `提示：可接成语共 ${answers.length} 个，首字可以从「${firstChars}」里想`;
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

  private buildIntro(gameType: GameType): string {
    if (gameType === "song") {
      return `开始猜歌名！总共 ${this.songRounds} 题。听音猜歌！`;
    }
    if (gameType === "silhouette") {
      return `开始剪影猜人！总共 ${this.imageRounds} 题。看剪影抢答角色名！`;
    }
    if (gameType === "movie") {
      return `开始剧照猜电影！总共 ${this.imageRounds} 题。看图抢答电影名！`;
    }
    return `开始成语接龙！总共 ${this.idiomRounds} 题。同音接龙！`;
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

  private pushBot(
    text: string,
    kind: ChatMessage["kind"],
    atPlayerId?: string,
    audioUrl?: string,
    imageUrl?: string,
    imageAlt?: string
  ): ChatMessage {
    const message: ChatMessage = {
      id: this.nextMessageId(),
      sender: "bot",
      kind,
      text,
      atPlayerId,
      avatar: BOT_AVATAR,
      audioUrl,
      imageUrl,
      imageAlt,
      createdAt: this.now()
    };
    this.messages.push(message);
    return message;
  }

  private nextMessageId(): string {
    this.messageSeq += 1;
    return `m_${this.messageSeq}_${randomToken(5)}`;
  }

  private nextQuestionId(gameType: GameType, roundIndex: number): string {
    return `q_${gameType}_${roundIndex + 1}_${randomToken(5)}`;
  }
}

function validateOptions(options: CreateRoomOptions): void {
  if (!Number.isInteger(options.roundSeconds) || options.roundSeconds <= 0) {
    throw new Error("回合秒数必须是正整数");
  }
  validateIdioms(options.idioms);
  validateSongs(options.songs);
  validateCharacters(options.characters ?? []);
  validateMovies(options.movies ?? []);
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

function validateCharacters(characters: CharacterEntry[]): void {
  for (const character of characters) {
    if (
      !character.id ||
      !character.name ||
      !character.work ||
      !character.imageUrl ||
      !Array.isArray(character.aliases) ||
      !Number.isInteger(character.difficulty) ||
      character.difficulty < 1 ||
      character.difficulty > 5 ||
      !character.referenceNote ||
      !["processed-reference", "generated-reference"].includes(character.assetMode)
    ) {
      throw new Error(`剪影猜人题库异常：${character.name || character.id || "未知角色"} 字段不完整`);
    }
  }
}

function validateMovies(movies: MovieEntry[]): void {
  for (const movie of movies) {
    if (
      !movie.id ||
      !movie.title ||
      !Number.isInteger(movie.year) ||
      !movie.region ||
      !movie.genre ||
      !movie.imageUrl ||
      !Array.isArray(movie.aliases)
    ) {
      throw new Error(`剧照猜电影题库异常：${movie.title || movie.id || "未知电影"} 字段不完整`);
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
    questionId: question.questionId,
    gameType: question.gameType,
    round: question.roundIndex + 1,
    totalRounds: question.totalRounds,
    prompt: question.prompt,
    audioUrl: question.audioUrl,
    imageUrl: question.imageUrl,
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

function countChineseChars(value: string): number {
  return [...value.replace(/\s/g, "")].length;
}

function createRoomCode(): string {
  return randomToken(6).toUpperCase();
}

function randomToken(length: number): string {
  return Math.random().toString(36).slice(2, 2 + length);
}
