// src/server/index.ts
import { existsSync as existsSync2 } from "node:fs";
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

// src/server/index.ts
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
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});
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
