// src/server/index.ts
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import express from "express";
import { Server } from "socket.io";

// src/server/game/room.ts
var BOT_AVATAR = "/avatars/bot.svg";
var PLAYER_AVATARS = [
  "/avatars/player-1.svg",
  "/avatars/player-2.svg",
  "/avatars/player-3.svg",
  "/avatars/player-4.svg",
  "/avatars/player-5.svg",
  "/avatars/player-6.svg"
];
function createGameRoom(options) {
  validateOptions(options);
  return new InMemoryGameRoom(options);
}
var InMemoryGameRoom = class {
  code;
  now;
  random;
  idioms;
  songs;
  idiomRounds;
  songRounds;
  players = /* @__PURE__ */ new Map();
  usedIdioms = /* @__PURE__ */ new Set();
  messages = [];
  status = "waiting";
  hostId = "";
  gameType;
  activeQuestion;
  settlement;
  playerSeq = 0;
  messageSeq = 0;
  songCursor = 0;
  songDeck = [];
  idiomCursor = 0;
  constructor(options) {
    this.code = options.code ?? createRoomCode();
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.idioms = [...options.idioms];
    this.songs = [...options.songs];
    this.idiomRounds = options.idiomRounds ?? 10;
    this.songRounds = options.songRounds ?? 5;
  }
  join(name, playerId) {
    const normalizedName = name.trim();
    if (!normalizedName) {
      throw new Error("\u6635\u79F0\u4E0D\u80FD\u4E3A\u7A7A");
    }
    const existingById = playerId ? this.players.get(playerId) : void 0;
    if (existingById) {
      existingById.connected = true;
      return clonePlayer(existingById);
    }
    for (const player2 of this.players.values()) {
      if (player2.name === normalizedName) {
        throw new Error(`\u6635\u79F0\u5DF2\u5B58\u5728\uFF1A${normalizedName}`);
      }
    }
    const id = playerId ?? `p_${++this.playerSeq}_${randomToken(4)}`;
    const avatar = PLAYER_AVATARS[this.players.size % PLAYER_AVATARS.length];
    const player = { id, name: normalizedName, avatar, score: 0, connected: true };
    this.players.set(id, player);
    if (!this.hostId) {
      this.hostId = id;
    }
    this.pushBot(`${normalizedName} \u52A0\u5165\u4E86\u623F\u95F4`, "system");
    return clonePlayer(player);
  }
  leave(playerId) {
    const player = this.requirePlayer(playerId);
    player.connected = false;
  }
  start(gameType, requesterId) {
    if (this.players.size === 0) {
      throw new Error("\u6CA1\u6709\u73A9\u5BB6\uFF0C\u4E0D\u80FD\u5F00\u59CB\u6E38\u620F");
    }
    if (!this.hostId) {
      throw new Error("\u623F\u4E3B\u72B6\u6001\u5F02\u5E38\uFF0C\u4E0D\u80FD\u5F00\u59CB\u6E38\u620F");
    }
    if (requesterId && requesterId !== this.hostId) {
      throw new Error("\u53EA\u6709\u623F\u4E3B\u53EF\u4EE5\u5F00\u59CB\u6E38\u620F");
    }
    if (this.status === "playing") {
      throw new Error("\u6E38\u620F\u5DF2\u7ECF\u5F00\u59CB");
    }
    this.status = "playing";
    this.gameType = gameType;
    this.settlement = void 0;
    this.usedIdioms.clear();
    this.songCursor = 0;
    this.songDeck = [];
    this.idiomCursor = 0;
    for (const player of this.players.values()) {
      player.score = 0;
    }
    const intro = gameType === "song" ? `\u5F00\u59CB\u731C\u6B4C\u540D\u6216\u6B4C\u624B\uFF01\u603B\u5171 ${this.songRounds} \u9898\u3002\u542C\u97F3\u731C\u6B4C\uFF01` : `\u5F00\u59CB\u6210\u8BED\u63A5\u9F99\uFF01\u603B\u5171 ${this.idiomRounds} \u9898\u3002\u540C\u97F3\u63A5\u9F99\uFF01`;
    const messages = [this.pushBot(intro, "round")];
    messages.push(...this.advanceToNextRound());
    return messages;
  }
  submitMessage(playerId, text) {
    const player = this.requirePlayer(playerId);
    const cleanText = text.trim();
    if (!cleanText) {
      throw new Error("\u6D88\u606F\u4E0D\u80FD\u4E3A\u7A7A");
    }
    const playerMessage = this.pushPlayer(player, cleanText);
    const botMessages = [];
    const result = { playerMessage, botMessages };
    if (this.status !== "playing" || !this.activeQuestion) {
      return result;
    }
    const hitAnswer = this.checkAnswer(cleanText);
    if (!hitAnswer) {
      botMessages.push(this.pushBot(`@${player.name} \u7B54\u6848\u4E0D\u5BF9`, "result", player.id));
      return result;
    }
    player.score += 1;
    result.hit = { playerId: player.id, answer: hitAnswer };
    botMessages.push(this.pushBot(`@${player.name} \u7B54\u5BF9\u4E86\uFF01\u7B54\u6848\u662F\u300A${hitAnswer}\u300B`, "result", player.id));
    this.advanceToNextRound();
    return result;
  }
  timeoutRound() {
    if (this.status !== "playing" || !this.activeQuestion) {
      throw new Error("\u5F53\u524D\u6CA1\u6709\u53EF\u8D85\u65F6\u7684\u9898\u76EE");
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
  snapshot() {
    return {
      code: this.code,
      status: this.status,
      hostId: this.hostId,
      gameType: this.gameType,
      currentQuestion: this.activeQuestion ? toPublicQuestion(this.activeQuestion) : void 0,
      players: [...this.players.values()].map(clonePlayer),
      messages: [...this.messages],
      settlement: this.settlement ? [...this.settlement] : void 0
    };
  }
  advanceToNextRound(fromTimeout = false) {
    if (!this.gameType) {
      throw new Error("\u6E38\u620F\u7C7B\u578B\u7F3A\u5931\uFF0C\u65E0\u6CD5\u8FDB\u5165\u4E0B\u4E00\u9898");
    }
    const nextQuestion = this.gameType === "song" ? this.nextSongQuestion() : this.nextIdiomQuestion(fromTimeout);
    if (!nextQuestion) {
      this.finishGame();
      return [this.pushBot(formatSettlement(this.requireSettlement()), "result")];
    }
    this.activeQuestion = nextQuestion;
    const questionNo = nextQuestion.roundIndex + 1;
    if (nextQuestion.gameType === "song") {
      return [
        this.pushBot(`\u7B2C ${questionNo}/${nextQuestion.totalRounds} \u9898\uFF0C\u542C\u8FD9\u6BB5\u97F3\u4E50\u731C\u6B4C\u540D\u3002`, "round"),
        this.pushBot("\u8BED\u97F3 15''", "audio", void 0, nextQuestion.audioUrl)
      ];
    }
    return [
      this.pushBot(
        `\u7B2C ${questionNo}/${nextQuestion.totalRounds} \u9898\uFF0C\u8BF7\u63A5\uFF1A${nextQuestion.previousIdiom?.text}\uFF08${nextQuestion.previousIdiom?.pinyin.at(-1)}\uFF09`,
        "round"
      )
    ];
  }
  nextSongQuestion() {
    if (this.songCursor >= this.songRounds) {
      return void 0;
    }
    const song = this.pickNextSong();
    const question = {
      gameType: "song",
      roundIndex: this.songCursor,
      totalRounds: this.songRounds,
      answer: song.title,
      prompt: `\u731C\u6B4C\u540D\uFF1A${song.artist}`,
      audioUrl: song.previewUrl,
      sourceUrl: song.sourceUrl,
      song
    };
    this.songCursor += 1;
    return question;
  }
  pickNextSong() {
    if (this.songDeck.length === 0) {
      this.songDeck = [...this.songs];
    }
    const index = Math.min(this.songDeck.length - 1, Math.floor(this.random() * this.songDeck.length));
    const [song] = this.songDeck.splice(index, 1);
    if (!song) {
      throw new Error("\u6B4C\u66F2\u9898\u5E93\u72B6\u6001\u5F02\u5E38\uFF1A\u65E0\u6CD5\u62BD\u53D6\u6B4C\u66F2");
    }
    return song;
  }
  nextIdiomQuestion(fromTimeout) {
    if (this.idiomCursor >= this.idiomRounds) {
      return void 0;
    }
    let previous;
    if (!this.activeQuestion?.previousIdiom || this.gameType !== "idiom") {
      previous = this.pickRandomStartIdiom();
      this.usedIdioms.add(previous.text);
    } else if (fromTimeout) {
      previous = this.findNextIdiom(this.activeQuestion.previousIdiom) ?? failNoIdiom(this.activeQuestion.previousIdiom);
      this.usedIdioms.add(previous.text);
    } else {
      previous = this.requireIdiom(this.activeQuestion.answer);
    }
    const question = {
      gameType: "idiom",
      roundIndex: this.idiomCursor,
      totalRounds: this.idiomRounds,
      answer: "",
      prompt: `\u8BF7\u63A5\uFF1A${previous.text}`,
      previousIdiom: previous
    };
    this.idiomCursor += 1;
    return question;
  }
  checkAnswer(text) {
    if (!this.activeQuestion) {
      throw new Error("\u5F53\u524D\u9898\u76EE\u7F3A\u5931");
    }
    if (this.activeQuestion.gameType === "song") {
      const song = this.activeQuestion.song;
      if (!song) {
        throw new Error("\u6B4C\u66F2\u9898\u76EE\u72B6\u6001\u5F02\u5E38\uFF1A\u7F3A\u5C11\u6B4C\u66F2\u6570\u636E");
      }
      const normalized = normalizeAnswer(text);
      const candidates = [song.title, ...song.aliases].map(normalizeAnswer);
      return candidates.includes(normalized) ? song.title : void 0;
    }
    const previous = this.activeQuestion.previousIdiom;
    if (!previous) {
      throw new Error("\u6210\u8BED\u63A5\u9F99\u72B6\u6001\u5F02\u5E38\uFF1A\u7F3A\u5C11\u4E0A\u4E00\u6210\u8BED");
    }
    const idiom = this.findIdiomByAnswerText(text);
    if (!idiom) {
      return void 0;
    }
    if (this.usedIdioms.has(idiom.text)) {
      return void 0;
    }
    const expected = previous.pinyin.at(-1);
    const actual = idiom.pinyin[0];
    if (!expected || !actual) {
      throw new Error("\u6210\u8BED\u62FC\u97F3\u72B6\u6001\u5F02\u5E38");
    }
    if (expected !== actual) {
      return void 0;
    }
    this.usedIdioms.add(idiom.text);
    this.activeQuestion.answer = idiom.text;
    return idiom.text;
  }
  findNextIdiom(previous) {
    return this.findNextIdioms(previous)[0];
  }
  findNextIdioms(previous) {
    const expected = previous.pinyin.at(-1);
    return this.idioms.filter((entry) => entry.pinyin[0] === expected && !this.usedIdioms.has(entry.text));
  }
  findIdiomByAnswerText(text) {
    const normalizedText = normalizeIdiomText(text);
    return this.idioms.find((entry) => {
      const candidates = [entry.text, ...entry.aliases ?? []];
      return candidates.some((candidate) => normalizeIdiomText(candidate) === normalizedText);
    });
  }
  pickRandomStartIdiom() {
    const candidates = this.idioms.filter((entry) => {
      const expected = entry.pinyin.at(-1);
      return Boolean(expected && this.idioms.some((candidate) => candidate.text !== entry.text && candidate.pinyin[0] === expected));
    });
    if (candidates.length === 0) {
      throw new Error("\u6210\u8BED\u9898\u5E93\u5F02\u5E38\uFF1A\u6CA1\u6709\u4EFB\u4F55\u53EF\u63A5\u9F99\u7684\u5F00\u5C40\u6210\u8BED");
    }
    const index = Math.min(candidates.length - 1, Math.floor(this.random() * candidates.length));
    return candidates[index];
  }
  resolveTimeoutAnswer() {
    if (!this.activeQuestion) {
      throw new Error("\u5F53\u524D\u9898\u76EE\u7F3A\u5931");
    }
    if (this.activeQuestion.gameType === "song") {
      if (!this.activeQuestion.answer) {
        throw new Error("\u6B4C\u66F2\u9898\u76EE\u72B6\u6001\u5F02\u5E38\uFF1A\u7F3A\u5C11\u6B63\u786E\u7B54\u6848");
      }
      return {
        chosenAnswer: this.activeQuestion.answer,
        message: `\u672C\u8F6E\u8D85\u65F6\uFF0C\u6B63\u786E\u7B54\u6848\u662F\u300A${this.activeQuestion.answer}\u300B`
      };
    }
    const previous = this.activeQuestion.previousIdiom;
    if (!previous) {
      throw new Error("\u6210\u8BED\u63A5\u9F99\u72B6\u6001\u5F02\u5E38\uFF1A\u7F3A\u5C11\u4E0A\u4E00\u6210\u8BED");
    }
    const answers = this.findNextIdioms(previous);
    if (answers.length === 0) {
      throw new Error(`\u6210\u8BED\u9898\u5E93\u5F02\u5E38\uFF1A\u627E\u4E0D\u5230\u53EF\u63A5 ${previous.text} \u7684\u6210\u8BED`);
    }
    const chosen = answers[Math.min(answers.length - 1, Math.floor(this.random() * answers.length))];
    const sample = answers.slice(0, 5).map((entry) => entry.text).join("\u3001");
    const suffix = answers.length > 5 ? " \u7B49" : "";
    return {
      chosenAnswer: chosen.text,
      message: `\u672C\u8F6E\u8D85\u65F6\uFF0C\u53C2\u8003\u7B54\u6848\uFF1A${sample}${suffix}`
    };
  }
  requireIdiom(text) {
    const idiom = this.idioms.find((entry) => entry.text === text);
    if (!idiom) {
      throw new Error(`\u6210\u8BED\u72B6\u6001\u5F02\u5E38\uFF0C\u627E\u4E0D\u5230\u5DF2\u547D\u4E2D\u6210\u8BED\uFF1A${text}`);
    }
    return idiom;
  }
  requirePlayer(playerId) {
    const player = this.players.get(playerId);
    if (!player) {
      throw new Error(`\u73A9\u5BB6\u4E0D\u5B58\u5728\uFF1A${playerId}`);
    }
    return player;
  }
  requireSettlement() {
    if (!this.settlement) {
      throw new Error("\u7ED3\u7B97\u72B6\u6001\u5F02\u5E38");
    }
    return this.settlement;
  }
  finishGame() {
    this.status = "finished";
    this.activeQuestion = void 0;
    this.settlement = [...this.players.values()].map((player) => ({ playerId: player.id, name: player.name, score: player.score })).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "zh-CN"));
  }
  pushPlayer(player, text) {
    const message = {
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
  pushBot(text, kind, atPlayerId, audioUrl) {
    const message = {
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
  nextMessageId() {
    this.messageSeq += 1;
    return `m_${this.messageSeq}_${randomToken(5)}`;
  }
};
function validateOptions(options) {
  if (!Number.isInteger(options.roundSeconds) || options.roundSeconds <= 0) {
    throw new Error("\u56DE\u5408\u79D2\u6570\u5FC5\u987B\u662F\u6B63\u6574\u6570");
  }
  validateIdioms(options.idioms);
  validateSongs(options.songs);
}
function validateIdioms(idioms) {
  if (idioms.length === 0) {
    throw new Error("\u6210\u8BED\u9898\u5E93\u5F02\u5E38\uFF1A\u4E0D\u80FD\u4E3A\u7A7A");
  }
  for (const idiom of idioms) {
    if (!idiom.text || !Array.isArray(idiom.pinyin) || idiom.pinyin.length !== [...idiom.text].length) {
      throw new Error(`\u6210\u8BED\u9898\u5E93\u5F02\u5E38\uFF1A${idiom.text || "\u672A\u77E5\u6210\u8BED"} \u62FC\u97F3\u5B57\u6BB5\u4E0D\u5B8C\u6574`);
    }
    if (idiom.aliases && !Array.isArray(idiom.aliases)) {
      throw new Error(`\u6210\u8BED\u9898\u5E93\u5F02\u5E38\uFF1A${idiom.text} aliases \u5FC5\u987B\u662F\u6570\u7EC4`);
    }
    for (const syllable of idiom.pinyin) {
      if (!syllable || /[1-5āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/i.test(syllable)) {
        throw new Error(`\u6210\u8BED\u9898\u5E93\u5F02\u5E38\uFF1A${idiom.text} \u62FC\u97F3\u5FC5\u987B\u53BB\u58F0\u8C03`);
      }
    }
  }
}
function validateSongs(songs) {
  if (songs.length === 0) {
    throw new Error("\u6B4C\u66F2\u9898\u5E93\u5F02\u5E38\uFF1A\u4E0D\u80FD\u4E3A\u7A7A");
  }
  for (const song of songs) {
    if (!song.id || !song.title || !song.artist || !song.searchTerm || !song.previewUrl || !song.sourceUrl) {
      throw new Error(`\u6B4C\u66F2\u9898\u5E93\u5F02\u5E38\uFF1A${song.title || song.id || "\u672A\u77E5\u6B4C\u66F2"} \u5B57\u6BB5\u4E0D\u5B8C\u6574`);
    }
    try {
      new URL(song.previewUrl);
      new URL(song.sourceUrl);
    } catch {
      throw new Error(`\u6B4C\u66F2\u9898\u5E93\u5F02\u5E38\uFF1A${song.title} URL \u4E0D\u5408\u6CD5`);
    }
  }
}
function normalizeAnswer(value) {
  return value.normalize("NFKC").toLowerCase().replace(/[《》“”"'‘’\s,，.。!！?？:：;；\-_/\\()[\]【】]/g, "");
}
function normalizeIdiomText(value) {
  const traditionalToSimplified = {
    \u5F37: "\u5F3A",
    \u8A5E: "\u8BCD",
    \u596A: "\u593A",
    \u767C: "\u53D1",
    \u5716: "\u56FE",
    \u96E3: "\u96BE",
    \u98A8: "\u98CE",
    \u6A02: "\u4E50",
    \u9580: "\u95E8",
    \u898B: "\u89C1",
    \u958B: "\u5F00",
    \u58EF: "\u58EE",
    \u96F2: "\u4E91",
    \u7570: "\u5F02",
    \u5F8C: "\u540E",
    \u4F86: "\u6765"
  };
  return [...value.normalize("NFKC").trim()].map((char) => traditionalToSimplified[char] ?? char).join("").replace(/[《》“”"'‘’\s,，.。!！?？:：;；\-_/\\()[\]【】]/g, "");
}
function toPublicQuestion(question) {
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
function clonePlayer(player) {
  return { ...player };
}
function formatSettlement(rows) {
  const details = rows.map((row, index) => `${index + 1}. ${row.name}\uFF1A${row.score} \u9898`).join("\n");
  return `\u6E38\u620F\u7ED3\u675F\uFF0C\u7ED3\u7B97\u5982\u4E0B\uFF1A
${details}`;
}
function failNoIdiom(previous) {
  throw new Error(`\u6210\u8BED\u9898\u5E93\u5F02\u5E38\uFF1A\u627E\u4E0D\u5230\u53EF\u63A5 ${previous.text} \u7684\u6210\u8BED`);
}
function createRoomCode() {
  return randomToken(6).toUpperCase();
}
function randomToken(length) {
  return Math.random().toString(36).slice(2, 2 + length);
}

// src/server/data/loadData.ts
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
function loadGameData() {
  return {
    idioms: readJson("./idioms.json"),
    songs: readJson("./songs.json")
  };
}
function readJson(relativePath) {
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
    throw new Error(`\u9898\u5E93\u6587\u4EF6\u4E0D\u5B58\u5728\uFF1A${fileName}`);
  }
  return JSON.parse(readFileSync(filePath, "utf8"));
}

// src/server/account/authService.ts
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// src/server/account/repository.ts
function toPublicUser(user) {
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    title: user.title,
    createdAt: user.createdAt
  };
}

// src/server/account/authService.ts
var scrypt = promisify(scryptCallback);
var PASSWORD_KEY_LENGTH = 64;
function createAuthService(options) {
  return new DefaultAuthService(options);
}
var DefaultAuthService = class {
  repo;
  now;
  tokenTtlMs;
  randomToken;
  constructor(options) {
    this.repo = options.repo;
    this.now = options.now ?? Date.now;
    this.tokenTtlMs = options.tokenTtlMs ?? 7 * 24 * 60 * 60 * 1e3;
    this.randomToken = options.randomToken ?? (() => randomBytes(32).toString("hex"));
  }
  async register(payload) {
    const username = normalizeUsername(payload.username);
    const nickname = payload.nickname.trim();
    validatePassword(payload.password);
    if (!nickname) {
      throw new Error("\u6635\u79F0\u4E0D\u80FD\u4E3A\u7A7A");
    }
    if (nickname.length > 16) {
      throw new Error("\u6635\u79F0\u4E0D\u80FD\u8D85\u8FC716\u4E2A\u5B57");
    }
    const existing = await this.repo.findUserByUsername(username);
    if (existing) {
      throw new Error("\u8D26\u53F7\u5DF2\u5B58\u5728");
    }
    const createdAt = this.now();
    const user = {
      id: `u_${this.randomToken().slice(0, 18)}`,
      username,
      passwordHash: await hashPassword(payload.password),
      nickname,
      title: "\u65B0\u58F0\u6311\u6218\u8005",
      openid: null,
      createdAt
    };
    await this.repo.createUser(user);
    return this.createLoginResult(user.id);
  }
  async login(payload) {
    const username = normalizeUsername(payload.username);
    const user = await this.repo.findUserByUsername(username);
    if (!user || !await verifyPassword(payload.password, user.passwordHash)) {
      throw new Error("\u8D26\u53F7\u6216\u5BC6\u7801\u9519\u8BEF");
    }
    return this.createLoginResult(user.id);
  }
  async requireUserByToken(token) {
    const cleanToken = token.trim();
    if (!cleanToken) {
      throw new Error("\u672A\u767B\u5F55");
    }
    const session = await this.repo.findSession(cleanToken);
    if (!session) {
      throw new Error("\u767B\u5F55\u72B6\u6001\u4E0D\u5B58\u5728");
    }
    if (session.expiresAt <= this.now()) {
      await this.repo.deleteSession(cleanToken);
      throw new Error("\u767B\u5F55\u5DF2\u8FC7\u671F");
    }
    const user = await this.repo.findUserById(session.userId);
    if (!user) {
      throw new Error(`\u8D26\u53F7\u72B6\u6001\u5F02\u5E38\uFF1A\u627E\u4E0D\u5230\u7528\u6237 ${session.userId}`);
    }
    return toPublicUser(user);
  }
  async logout(token) {
    await this.repo.deleteSession(token.trim());
  }
  async createLoginResult(userId) {
    const user = await this.repo.findUserById(userId);
    if (!user) {
      throw new Error(`\u8D26\u53F7\u72B6\u6001\u5F02\u5E38\uFF1A\u627E\u4E0D\u5230\u7528\u6237 ${userId}`);
    }
    const token = this.randomToken();
    const createdAt = this.now();
    const expiresAt = createdAt + this.tokenTtlMs;
    await this.repo.createSession({ token, userId, createdAt, expiresAt });
    return { user: toPublicUser(user), token, expiresAt };
  }
};
async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, PASSWORD_KEY_LENGTH);
  return `scrypt:${salt}:${key.toString("hex")}`;
}
async function verifyPassword(password, passwordHash) {
  const [algorithm, salt, hash] = passwordHash.split(":");
  if (algorithm !== "scrypt" || !salt || !hash) {
    throw new Error("\u5BC6\u7801\u54C8\u5E0C\u72B6\u6001\u5F02\u5E38");
  }
  const expected = Buffer.from(hash, "hex");
  const actual = await scrypt(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
function normalizeUsername(username) {
  const normalized = username.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(normalized)) {
    throw new Error("\u8D26\u53F7\u53EA\u80FD\u4F7F\u75283-24\u4F4D\u82F1\u6587\u3001\u6570\u5B57\u6216\u4E0B\u5212\u7EBF");
  }
  return normalized;
}
function validatePassword(password) {
  if (password.length < 6 || password.length > 64) {
    throw new Error("\u5BC6\u7801\u957F\u5EA6\u5FC5\u987B\u662F6-64\u4F4D");
  }
}

// src/server/account/mysqlRepository.ts
import mysql from "mysql2/promise";
function readMysqlConfig(env) {
  if (env.MYSQL_CONNECTION_URI) {
    return { uri: env.MYSQL_CONNECTION_URI };
  }
  if (!env.MYSQL_HOST || !env.MYSQL_USER || !env.MYSQL_DATABASE) {
    return void 0;
  }
  return {
    host: env.MYSQL_HOST,
    port: Number(env.MYSQL_PORT ?? 3306),
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD ?? "",
    database: env.MYSQL_DATABASE
  };
}
async function createMysqlAccountRepository(config) {
  const pool = config.uri ? mysql.createPool(config.uri) : mysql.createPool({
    host: requireConfig(config.host, "MYSQL_HOST"),
    port: config.port ?? 3306,
    user: requireConfig(config.user, "MYSQL_USER"),
    password: config.password ?? "",
    database: requireConfig(config.database, "MYSQL_DATABASE"),
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: true
  });
  const repo = new MysqlAccountRepository(pool);
  await repo.ensureSchema();
  return repo;
}
var MysqlAccountRepository = class {
  constructor(pool) {
    this.pool = pool;
  }
  async ensureSchema() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(64) PRIMARY KEY,
        username VARCHAR(64) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        nickname VARCHAR(64) NOT NULL,
        title VARCHAR(64) NOT NULL,
        openid VARCHAR(128) NULL,
        created_at_ms BIGINT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        token VARCHAR(128) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        expires_at_ms BIGINT NOT NULL,
        created_at_ms BIGINT NOT NULL,
        INDEX idx_sessions_user_id (user_id),
        CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS stamina (
        user_id VARCHAR(64) PRIMARY KEY,
        current_value INT NOT NULL,
        max_value INT NOT NULL,
        last_recovered_at_ms BIGINT NOT NULL,
        ad_restore_count INT NOT NULL,
        CONSTRAINT fk_stamina_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS pve_progress (
        user_id VARCHAR(64) NOT NULL,
        level_no INT NOT NULL,
        highest_score INT NOT NULL,
        stars INT NOT NULL,
        passed TINYINT(1) NOT NULL,
        updated_at_ms BIGINT NOT NULL,
        PRIMARY KEY (user_id, level_no),
        CONSTRAINT fk_progress_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS pve_runs (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        level_no INT NOT NULL,
        status VARCHAR(24) NOT NULL,
        state_json JSON NOT NULL,
        started_at_ms BIGINT NOT NULL,
        finished_at_ms BIGINT NULL,
        INDEX idx_pve_runs_user_id (user_id),
        CONSTRAINT fk_runs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }
  async findUserByUsername(username) {
    const rows = await this.select("SELECT * FROM users WHERE username = ? LIMIT 1", [username]);
    return rows[0] ? toUserRecord(rows[0]) : void 0;
  }
  async findUserById(userId) {
    const rows = await this.select("SELECT * FROM users WHERE id = ? LIMIT 1", [userId]);
    return rows[0] ? toUserRecord(rows[0]) : void 0;
  }
  async createUser(user) {
    await this.pool.execute(
      `INSERT INTO users (id, username, password_hash, nickname, title, openid, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [user.id, user.username, user.passwordHash, user.nickname, user.title, user.openid ?? null, user.createdAt]
    );
  }
  async createSession(session) {
    await this.pool.execute(
      `REPLACE INTO sessions (token, user_id, expires_at_ms, created_at_ms) VALUES (?, ?, ?, ?)`,
      [session.token, session.userId, session.expiresAt, session.createdAt]
    );
  }
  async findSession(token) {
    const rows = await this.select("SELECT * FROM sessions WHERE token = ? LIMIT 1", [token]);
    return rows[0] ? toSessionRecord(rows[0]) : void 0;
  }
  async deleteSession(token) {
    await this.pool.execute("DELETE FROM sessions WHERE token = ?", [token]);
  }
  async getStamina(userId) {
    const rows = await this.select("SELECT * FROM stamina WHERE user_id = ? LIMIT 1", [userId]);
    return rows[0] ? toStaminaRecord(rows[0]) : void 0;
  }
  async upsertStamina(stamina) {
    await this.pool.execute(
      `INSERT INTO stamina (user_id, current_value, max_value, last_recovered_at_ms, ad_restore_count)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        current_value = VALUES(current_value),
        max_value = VALUES(max_value),
        last_recovered_at_ms = VALUES(last_recovered_at_ms),
        ad_restore_count = VALUES(ad_restore_count)`,
      [stamina.userId, stamina.current, stamina.max, stamina.lastRecoveredAt, stamina.adRestoreCount]
    );
  }
  async listProgress(userId) {
    const rows = await this.select("SELECT * FROM pve_progress WHERE user_id = ? ORDER BY level_no ASC", [userId]);
    return rows.map(toProgressRecord);
  }
  async getProgress(userId, level2) {
    const rows = await this.select("SELECT * FROM pve_progress WHERE user_id = ? AND level_no = ? LIMIT 1", [
      userId,
      level2
    ]);
    return rows[0] ? toProgressRecord(rows[0]) : void 0;
  }
  async upsertProgress(progress) {
    await this.pool.execute(
      `INSERT INTO pve_progress (user_id, level_no, highest_score, stars, passed, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        highest_score = VALUES(highest_score),
        stars = VALUES(stars),
        passed = VALUES(passed),
        updated_at_ms = VALUES(updated_at_ms)`,
      [progress.userId, progress.level, progress.highestScore, progress.stars, progress.passed ? 1 : 0, progress.updatedAt]
    );
  }
  async createRun(run) {
    await this.pool.execute(
      `INSERT INTO pve_runs (id, user_id, level_no, status, state_json, started_at_ms, finished_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [run.id, run.userId, run.level, run.status, JSON.stringify(run), run.startedAt, run.finishedAt ?? null]
    );
  }
  async getRun(runId) {
    const rows = await this.select("SELECT * FROM pve_runs WHERE id = ? LIMIT 1", [runId]);
    return rows[0] ? parseRun(rows[0]) : void 0;
  }
  async updateRun(run) {
    await this.pool.execute(
      `UPDATE pve_runs
       SET status = ?, state_json = ?, finished_at_ms = ?
       WHERE id = ?`,
      [run.status, JSON.stringify(run), run.finishedAt ?? null, run.id]
    );
  }
  async select(sql, values) {
    const [rows] = await this.pool.execute(sql, values);
    return rows;
  }
};
function toUserRecord(row) {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    nickname: row.nickname,
    title: row.title,
    openid: row.openid,
    createdAt: Number(row.created_at_ms)
  };
}
function toSessionRecord(row) {
  return {
    token: row.token,
    userId: row.user_id,
    expiresAt: Number(row.expires_at_ms),
    createdAt: Number(row.created_at_ms)
  };
}
function toStaminaRecord(row) {
  return {
    userId: row.user_id,
    current: row.current_value,
    max: row.max_value,
    lastRecoveredAt: Number(row.last_recovered_at_ms),
    adRestoreCount: row.ad_restore_count
  };
}
function toProgressRecord(row) {
  return {
    userId: row.user_id,
    level: row.level_no,
    highestScore: row.highest_score,
    stars: row.stars,
    passed: row.passed === 1,
    updatedAt: Number(row.updated_at_ms)
  };
}
function parseRun(row) {
  if (typeof row.state_json === "string") {
    return JSON.parse(row.state_json);
  }
  return row.state_json;
}
function requireConfig(value, key) {
  if (!value) {
    throw new Error(`MySQL\u914D\u7F6E\u7F3A\u5931\uFF1A${key}`);
  }
  return value;
}

// src/server/pve/levels.ts
var DEFAULT_PVE_LEVELS = [
  level(1, "\u521D\u542C\u65CB\u5F8B", 30, 1800, [1800, 3e3, 4200], "phone", [1, 2]),
  level(2, "\u526F\u6B4C\u96F7\u8FBE", 28, 2200, [2200, 3400, 4400], "phone", [1, 3]),
  level(3, "\u70ED\u95E8\u56DE\u5FC6", 26, 2500, [2500, 3600, 4600], "phone", [1, 3]),
  level(4, "\u8033\u6735\u70ED\u8EAB", 24, 2800, [2800, 3800, 4700], "muffled", [2, 4]),
  level(5, "\u65CB\u5F8B\u8FFD\u51FB", 22, 3e3, [3e3, 4e3, 4800], "muffled", [2, 4]),
  level(6, "\u6B4C\u540D\u6355\u624B", 20, 3200, [3200, 4200, 4900], "muffled", [2, 5]),
  level(7, "\u7535\u8BDD\u97F3\u6311\u6218", 18, 3400, [3400, 4300, 5e3], "short", [3, 5]),
  level(8, "\u5FEB\u95EE\u5FEB\u7B54", 16, 3600, [3600, 4400, 5050], "short", [3, 5]),
  level(9, "\u91D1\u66F2\u76F2\u542C", 15, 3800, [3800, 4500, 5100], "short", [4, 5]),
  level(10, "\u597D\u53CB\u6B4C\u738B", 15, 4e3, [4e3, 4600, 5200], "short", [4, 5])
];
function level(levelNo, name, timeLimitSeconds, passScore, starScores, audioFilter, difficultyRange) {
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

// src/server/pve/pveService.ts
import { randomBytes as randomBytes2 } from "node:crypto";
var DEFAULT_MAX_STAMINA = 5;
var DEFAULT_STAMINA_RECOVERY_MS = 30 * 60 * 1e3;
function createPveService(options) {
  validateOptions2(options);
  return new DefaultPveService(options);
}
var DefaultPveService = class {
  repo;
  songPool;
  levelConfigs;
  now;
  random;
  randomId;
  maxStamina;
  staminaRecoveryMs;
  constructor(options) {
    this.repo = options.repo;
    this.songPool = [...options.songs];
    this.levelConfigs = [...options.levels].sort((a, b) => a.level - b.level);
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.randomId = options.randomId ?? (() => randomBytes2(12).toString("hex"));
    this.maxStamina = options.maxStamina ?? DEFAULT_MAX_STAMINA;
    this.staminaRecoveryMs = options.staminaRecoveryMs ?? DEFAULT_STAMINA_RECOVERY_MS;
  }
  async profile(userId) {
    const stamina = await this.getRecoveredStamina(userId);
    const progress = (await this.repo.listProgress(userId)).sort((a, b) => a.level - b.level);
    return {
      stamina,
      progress,
      highestUnlockedLevel: resolveHighestUnlockedLevel(progress)
    };
  }
  levels() {
    return this.levelConfigs.map((level2) => ({ ...level2, starScores: [...level2.starScores] }));
  }
  async start(userId, level2) {
    const config = this.requireLevel(level2);
    await this.requireLevelUnlocked(userId, level2);
    const stamina = await this.getRecoveredStamina(userId);
    if (stamina.current <= 0) {
      throw new Error("\u4F53\u529B\u4E0D\u8DB3");
    }
    const questions = this.pickQuestions(config);
    const now = this.now();
    const run = {
      id: `run_${this.randomId()}`,
      userId,
      level: level2,
      status: "playing",
      questions,
      currentIndex: 0,
      totalScore: 0,
      correctCount: 0,
      combo: 0,
      startedAt: now,
      currentQuestionStartedAt: now
    };
    stamina.current -= 1;
    await this.repo.upsertStamina(stamina);
    await this.repo.createRun(run);
    const publicQuestions = questions.map((question, index) => toPublicQuestion2(question, index, config));
    return {
      runId: run.id,
      level: level2,
      questions: publicQuestions,
      currentQuestion: publicQuestions[0],
      stamina
    };
  }
  async answer(userId, payload) {
    const run = await this.requireRunForUser(payload.runId, userId);
    if (run.status !== "playing") {
      throw new Error("\u6311\u6218\u5DF2\u7ED3\u675F");
    }
    const question = run.questions[run.currentIndex];
    if (!question) {
      throw new Error("PVE\u6311\u6218\u72B6\u6001\u5F02\u5E38\uFF1A\u5F53\u524D\u9898\u76EE\u7F3A\u5931");
    }
    if (question.questionId !== payload.questionId) {
      throw new Error("\u9898\u76EE\u987A\u5E8F\u5F02\u5E38\uFF0C\u8BF7\u5237\u65B0\u6311\u6218\u72B6\u6001");
    }
    const config = this.requireLevel(run.level);
    const elapsedMs = Math.max(0, this.now() - run.currentQuestionStartedAt);
    const correct = isSongAnswer(payload.answer, question.song);
    const answerTitle = question.song.title;
    let scoreDelta = 0;
    if (correct) {
      run.combo += 1;
      scoreDelta = Math.max(0, scoreQuestion(elapsedMs, config.timeLimitSeconds, run.combo) - (question.wrongCount ?? 0) * 100);
      run.totalScore += scoreDelta;
      run.correctCount += 1;
      run.fastestMs = run.fastestMs === void 0 ? elapsedMs : Math.min(run.fastestMs, elapsedMs);
      question.answeredAt = this.now();
      question.correct = true;
      question.scoreDelta = scoreDelta;
      run.currentIndex += 1;
      run.currentQuestionStartedAt = this.now();
    } else {
      run.combo = 0;
      question.wrongCount = (question.wrongCount ?? 0) + 1;
    }
    const finished = run.currentIndex >= run.questions.length;
    if (finished) {
      await this.finalizeRun(run, config);
    } else {
      await this.repo.updateRun(run);
    }
    return {
      correct,
      answer: correct ? answerTitle : "",
      scoreDelta,
      totalScore: run.totalScore,
      correctCount: run.correctCount,
      nextQuestion: finished ? void 0 : toPublicQuestion2(run.questions[run.currentIndex], run.currentIndex, config),
      finished
    };
  }
  async finish(userId, runId) {
    const run = await this.requireRunForUser(runId, userId);
    const config = this.requireLevel(run.level);
    if (run.status === "playing") {
      await this.finalizeRun(run, config);
    }
    if (!run.summary) {
      throw new Error("PVE\u7ED3\u7B97\u72B6\u6001\u5F02\u5E38");
    }
    return { runId: run.id, level: run.level, ...run.summary };
  }
  async getRecoveredStamina(userId) {
    const existing = await this.repo.getStamina(userId);
    const now = this.now();
    const stamina = existing ?? { userId, current: this.maxStamina, max: this.maxStamina, lastRecoveredAt: now, adRestoreCount: 0 };
    if (stamina.current >= stamina.max) {
      stamina.lastRecoveredAt = now;
      await this.repo.upsertStamina(stamina);
      return stamina;
    }
    const recovered = Math.floor((now - stamina.lastRecoveredAt) / this.staminaRecoveryMs);
    if (recovered > 0) {
      stamina.current = Math.min(stamina.max, stamina.current + recovered);
      stamina.lastRecoveredAt += recovered * this.staminaRecoveryMs;
      if (stamina.current >= stamina.max) {
        stamina.lastRecoveredAt = now;
      }
      await this.repo.upsertStamina(stamina);
    }
    return stamina;
  }
  async requireLevelUnlocked(userId, level2) {
    const progress = await this.repo.listProgress(userId);
    const highestUnlocked = resolveHighestUnlockedLevel(progress);
    if (level2 > highestUnlocked) {
      throw new Error(`\u5173\u5361\u672A\u89E3\u9501\uFF1A${level2}`);
    }
  }
  pickQuestions(config) {
    if (this.songPool.length < config.songCount) {
      throw new Error(`\u6B4C\u66F2\u9898\u5E93\u4E0D\u8DB3\uFF1A\u5173\u5361 ${config.level} \u9700\u8981 ${config.songCount} \u9996\u6B4C`);
    }
    const deck = [...this.songPool];
    const questions = [];
    for (let i = 0; i < config.songCount; i += 1) {
      const index = Math.min(deck.length - 1, Math.floor(this.random() * deck.length));
      const [song] = deck.splice(index, 1);
      if (!song) {
        throw new Error("\u6B4C\u66F2\u9898\u5E93\u72B6\u6001\u5F02\u5E38\uFF1A\u65E0\u6CD5\u62BD\u53D6PVE\u6B4C\u66F2");
      }
      questions.push({
        questionId: `q_${i + 1}_${this.randomId()}`,
        song,
        timeLimitSeconds: config.timeLimitSeconds
      });
    }
    return questions;
  }
  async requireRunForUser(runId, userId) {
    const run = await this.repo.getRun(runId);
    if (!run) {
      throw new Error(`PVE\u6311\u6218\u8BB0\u5F55\u4E0D\u5B58\u5728\uFF1A${runId}`);
    }
    if (run.userId !== userId) {
      throw new Error("\u4E0D\u80FD\u64CD\u4F5C\u5176\u4ED6\u73A9\u5BB6\u7684\u6311\u6218\u8BB0\u5F55");
    }
    return run;
  }
  requireLevel(level2) {
    const config = this.levelConfigs.find((item) => item.level === level2);
    if (!config) {
      throw new Error(`\u5173\u5361\u4E0D\u5B58\u5728\uFF1A${level2}`);
    }
    return config;
  }
  async finalizeRun(run, config) {
    if (run.status === "finished" && run.summary) {
      return;
    }
    const stars = calculateStars(run.totalScore, config.starScores);
    const passed = run.totalScore >= config.passScore;
    run.status = "finished";
    run.finishedAt = this.now();
    run.summary = {
      totalScore: run.totalScore,
      correctCount: run.correctCount,
      fastestMs: run.fastestMs,
      stars,
      passed
    };
    await this.upsertBestProgress(run, stars, passed);
    await this.repo.updateRun(run);
  }
  async upsertBestProgress(run, stars, passed) {
    const existing = await this.repo.getProgress(run.userId, run.level);
    const next = {
      userId: run.userId,
      level: run.level,
      highestScore: Math.max(existing?.highestScore ?? 0, run.totalScore),
      stars: Math.max(existing?.stars ?? 0, stars),
      passed: Boolean(existing?.passed || passed),
      updatedAt: this.now()
    };
    await this.repo.upsertProgress(next);
  }
};
function validateOptions2(options) {
  if (options.levels.length === 0) {
    throw new Error("PVE\u5173\u5361\u914D\u7F6E\u4E0D\u80FD\u4E3A\u7A7A");
  }
  if (options.songs.length === 0) {
    throw new Error("PVE\u6B4C\u66F2\u9898\u5E93\u4E0D\u80FD\u4E3A\u7A7A");
  }
}
function toPublicQuestion2(question, index, config) {
  return {
    questionId: question.questionId,
    songId: question.song.id,
    index: index + 1,
    total: config.songCount,
    audioUrl: question.song.previewUrl,
    sourceUrl: question.song.sourceUrl,
    timeLimitSeconds: question.timeLimitSeconds,
    audioFilter: config.audioFilter
  };
}
function isSongAnswer(answer, song) {
  const normalized = normalizeAnswer2(answer);
  return [song.title, ...song.aliases].some((candidate) => normalizeAnswer2(candidate) === normalized);
}
function normalizeAnswer2(value) {
  return value.normalize("NFKC").toLowerCase().replace(/[《》“”"'‘’\s,，.。!！?？:：;；\-_/\\()[\]【】]/g, "");
}
function scoreQuestion(elapsedMs, timeLimitSeconds, combo) {
  const limitMs = timeLimitSeconds * 1e3;
  if (elapsedMs > limitMs) {
    return 0;
  }
  const baseScore = 400;
  const speedScore = Math.round(500 * Math.max(0, 1 - elapsedMs / limitMs));
  const comboScore = Math.min(100, Math.max(0, combo - 1) * 25);
  return Math.min(1e3, baseScore + speedScore + comboScore);
}
function calculateStars(score, starScores) {
  if (score >= starScores[2]) {
    return 3;
  }
  if (score >= starScores[1]) {
    return 2;
  }
  if (score >= starScores[0]) {
    return 1;
  }
  return 0;
}
function resolveHighestUnlockedLevel(progress) {
  const passedLevels = progress.filter((row) => row.passed).map((row) => row.level);
  return passedLevels.length === 0 ? 1 : Math.max(...passedLevels) + 1;
}

// src/server/index.ts
loadDotEnv();
var PORT = Number(process.env.PORT ?? 3e3);
var ROUND_SECONDS = Number(process.env.ROUND_SECONDS ?? 30);
var data = loadGameData();
var app = express();
var httpServer = createServer(app);
var io = new Server(httpServer, {
  cors: {
    origin: true,
    credentials: false
  }
});
var rooms = /* @__PURE__ */ new Map();
var timers = /* @__PURE__ */ new Map();
var accountContext = await initializeAccountContext();
app.use(express.json({ limit: "1mb" }));
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, rooms: rooms.size, account: accountContext.ready ? "ready" : "unavailable" });
});
app.post(
  "/api/auth/register",
  asyncRoute(async (req, res) => {
    const { auth } = requireAccountContext();
    const result = await auth.register({
      username: String(req.body?.username ?? ""),
      password: String(req.body?.password ?? ""),
      nickname: String(req.body?.nickname ?? "")
    });
    res.json({ ok: true, ...result });
  })
);
app.post(
  "/api/auth/login",
  asyncRoute(async (req, res) => {
    const { auth } = requireAccountContext();
    const result = await auth.login({
      username: String(req.body?.username ?? ""),
      password: String(req.body?.password ?? "")
    });
    res.json({ ok: true, ...result });
  })
);
app.post(
  "/api/auth/logout",
  asyncRoute(async (req, res) => {
    const { auth } = requireAccountContext();
    const token = readBearerToken(req);
    if (token) {
      await auth.logout(token);
    }
    res.json({ ok: true });
  })
);
app.get(
  "/api/me",
  asyncRoute(async (req, res) => {
    const user = await requireHttpUser(req);
    res.json({ ok: true, user });
  })
);
app.get("/api/pve/levels", (_req, res) => {
  res.json({ ok: true, levels: DEFAULT_PVE_LEVELS });
});
app.get(
  "/api/pve/profile",
  asyncRoute(async (req, res) => {
    const { pve } = requireAccountContext();
    const user = await requireHttpUser(req);
    res.json({ ok: true, profile: await pve.profile(user.id) });
  })
);
app.post(
  "/api/pve/start",
  asyncRoute(async (req, res) => {
    const { pve } = requireAccountContext();
    const user = await requireHttpUser(req);
    res.json({ ok: true, run: await pve.start(user.id, Number(req.body?.level)) });
  })
);
app.post(
  "/api/pve/answer",
  asyncRoute(async (req, res) => {
    const { pve } = requireAccountContext();
    const user = await requireHttpUser(req);
    res.json({
      ok: true,
      result: await pve.answer(user.id, {
        runId: String(req.body?.runId ?? ""),
        questionId: String(req.body?.questionId ?? ""),
        answer: String(req.body?.answer ?? "")
      })
    });
  })
);
app.post(
  "/api/pve/finish",
  asyncRoute(async (req, res) => {
    const { pve } = requireAccountContext();
    const user = await requireHttpUser(req);
    res.json({ ok: true, summary: await pve.finish(user.id, String(req.body?.runId ?? "")) });
  })
);
var serverDir = path.dirname(fileURLToPath2(import.meta.url));
var distPath = [
  path.resolve(process.cwd(), "dist"),
  path.resolve(serverDir, "../dist"),
  path.resolve(serverDir, "../../dist")
].find((candidate) => existsSync2(candidate));
if (distPath) {
  app.use(express.static(distPath));
  app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
}
io.on("connection", (socket) => {
  socket.on("createRoom", (payload, ack) => {
    handleAck(ack, () => {
      const code = createUniqueRoomCode();
      const room = createGameRoom({ code, idioms: data.idioms, songs: data.songs, roundSeconds: ROUND_SECONDS });
      rooms.set(code, room);
      const player = room.join(payload.name);
      socket.join(socketRoom(code));
      socket.data.roomCode = code;
      socket.data.playerId = player.id;
      const snapshot = room.snapshot();
      emitRoom(code, snapshot);
      return { ok: true, room: snapshot, playerId: player.id };
    });
  });
  socket.on("joinRoom", (payload, ack) => {
    handleAck(ack, () => {
      const room = requireRoom(payload.roomCode);
      const player = room.join(payload.name, payload.playerId);
      socket.join(socketRoom(payload.roomCode));
      socket.data.roomCode = payload.roomCode;
      socket.data.playerId = player.id;
      const snapshot = room.snapshot();
      emitRoom(payload.roomCode, snapshot);
      return { ok: true, room: snapshot, playerId: player.id };
    });
  });
  socket.on("startGame", (payload, ack) => {
    handleAck(ack, () => {
      const room = requireRoom(payload.roomCode);
      room.start(payload.gameType, payload.playerId);
      scheduleRoundTimeout(payload.roomCode);
      const snapshot = room.snapshot();
      emitRoom(payload.roomCode, snapshot);
      return { ok: true, room: snapshot };
    });
  });
  socket.on("sendMessage", (payload, ack) => {
    handleAck(ack, () => {
      const room = requireRoom(payload.roomCode);
      room.submitMessage(payload.playerId, payload.text);
      scheduleRoundTimeout(payload.roomCode);
      const snapshot = room.snapshot();
      emitRoom(payload.roomCode, snapshot);
      return { ok: true, room: snapshot };
    });
  });
  socket.on("disconnect", () => {
    const roomCode = socket.data.roomCode;
    const playerId = socket.data.playerId;
    if (!roomCode || !playerId) {
      return;
    }
    const room = rooms.get(roomCode);
    if (!room) {
      return;
    }
    room.leave(playerId);
    emitRoom(roomCode, room.snapshot());
  });
});
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`BrainSync party games listening on http://localhost:${PORT}`);
});
function handleAck(ack, action) {
  try {
    ack?.(action());
  } catch (error) {
    const message = error instanceof Error ? error.message : "\u672A\u77E5\u9519\u8BEF";
    ack?.({ ok: false, error: message });
  }
}
function requireRoom(code) {
  const normalized = code.trim().toUpperCase();
  const room = rooms.get(normalized);
  if (!room) {
    throw new Error(`\u623F\u95F4\u4E0D\u5B58\u5728\uFF1A${normalized}`);
  }
  return room;
}
function createUniqueRoomCode() {
  for (let i = 0; i < 20; i += 1) {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    if (!rooms.has(code)) {
      return code;
    }
  }
  throw new Error("\u623F\u95F4\u53F7\u751F\u6210\u5931\u8D25");
}
function socketRoom(code) {
  return `room:${code.trim().toUpperCase()}`;
}
function emitRoom(code, snapshot) {
  io.to(socketRoom(code)).emit("roomSnapshot", snapshot);
}
function scheduleRoundTimeout(code) {
  const room = requireRoom(code);
  const snapshot = room.snapshot();
  const existing = timers.get(code);
  if (existing) {
    clearTimeout(existing);
    timers.delete(code);
  }
  if (snapshot.status !== "playing" || !snapshot.currentQuestion) {
    return;
  }
  const timer = setTimeout(() => {
    const liveRoom = rooms.get(code);
    if (!liveRoom) {
      return;
    }
    const before = liveRoom.snapshot().currentQuestion;
    if (!before) {
      return;
    }
    liveRoom.timeoutRound();
    const after = liveRoom.snapshot();
    emitRoom(code, after);
    if (after.status === "playing") {
      scheduleRoundTimeout(code);
    }
  }, ROUND_SECONDS * 1e3);
  timers.set(code, timer);
}
var ServiceUnavailableError = class extends Error {
  statusCode = 503;
};
async function initializeAccountContext() {
  const config = readMysqlConfig(process.env);
  if (!config) {
    return {
      ready: false,
      error: new Error("MySQL\u672A\u914D\u7F6E\uFF0C\u8D26\u53F7\u548CPVE\u529F\u80FD\u4E0D\u53EF\u7528\uFF1BPVP\u623F\u95F4\u4ECD\u53EF\u7EE7\u7EED\u4F7F\u7528")
    };
  }
  try {
    const repo = await createMysqlAccountRepository(config);
    return {
      ready: true,
      auth: createAuthService({ repo }),
      pve: createPveService({ repo, songs: data.songs, levels: DEFAULT_PVE_LEVELS })
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "\u672A\u77E5MySQL\u521D\u59CB\u5316\u9519\u8BEF";
    console.error(`\u8D26\u53F7/PVE MySQL\u521D\u59CB\u5316\u5931\u8D25\uFF1A${message}`);
    return {
      ready: false,
      error: new Error(`MySQL\u521D\u59CB\u5316\u5931\u8D25\uFF1A${message}`)
    };
  }
}
function requireAccountContext() {
  if (!accountContext.ready) {
    throw new ServiceUnavailableError(accountContext.error.message);
  }
  return accountContext;
}
async function requireHttpUser(req) {
  const { auth } = requireAccountContext();
  const token = readBearerToken(req);
  if (!token) {
    throw new HttpError(401, "\u672A\u767B\u5F55");
  }
  return auth.requireUserByToken(token);
}
function readBearerToken(req) {
  const authorization = req.header("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim();
}
var HttpError = class extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
};
function asyncRoute(handler) {
  return (req, res) => {
    handler(req, res).catch((error) => {
      const statusCode = error instanceof HttpError || error instanceof ServiceUnavailableError ? error.statusCode : inferStatusCode(error);
      const message = error instanceof Error ? error.message : "\u672A\u77E5\u9519\u8BEF";
      res.status(statusCode).json({ ok: false, error: message });
    });
  };
}
function inferStatusCode(error) {
  if (!(error instanceof Error)) {
    return 500;
  }
  if (["\u672A\u767B\u5F55", "\u767B\u5F55\u72B6\u6001\u4E0D\u5B58\u5728", "\u767B\u5F55\u5DF2\u8FC7\u671F"].some((message) => error.message.includes(message))) {
    return 401;
  }
  return 400;
}
function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!existsSync2(envPath)) {
    return;
  }
  const content = readFileSync2(envPath, "utf8");
  for (const [index, rawLine] of content.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      throw new Error(`.env \u914D\u7F6E\u683C\u5F0F\u9519\u8BEF\uFF1A\u7B2C ${index + 1} \u884C`);
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = stripEnvQuotes(line.slice(separatorIndex + 1).trim());
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
      throw new Error(`.env \u914D\u7F6E\u952E\u540D\u4E0D\u5408\u6CD5\uFF1A\u7B2C ${index + 1} \u884C`);
    }
    process.env[key] ??= value;
  }
}
function stripEnvQuotes(value) {
  if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}
