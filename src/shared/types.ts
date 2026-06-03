export type GameType = "idiom" | "song" | "silhouette" | "movie";
export type RoomStatus = "waiting" | "playing" | "finished";
export type MessageSender = "bot" | "player" | "system";
export type MessageKind = "chat" | "round" | "audio" | "image" | "hint" | "result" | "system";

export interface IdiomEntry {
  text: string;
  pinyin: string[];
  aliases?: string[];
}

export interface SongEntry {
  id: string;
  title: string;
  artist: string;
  aliases: string[];
  searchTerm: string;
  previewUrl: string;
  sourceUrl: string;
}

export interface CharacterEntry {
  id: string;
  name: string;
  aliases: string[];
  work: string;
  imageUrl: string;
}

export interface MovieEntry {
  id: string;
  title: string;
  aliases: string[];
  year: number;
  region: string;
  genre: string;
  imageUrl: string;
}

export interface Player {
  id: string;
  name: string;
  avatar: string;
  score: number;
  connected: boolean;
}

export interface ChatMessage {
  id: string;
  sender: MessageSender;
  kind: MessageKind;
  text: string;
  atPlayerId?: string;
  playerId?: string;
  playerName?: string;
  avatar?: string;
  audioUrl?: string;
  imageUrl?: string;
  imageAlt?: string;
  createdAt: number;
}

export interface SettlementRow {
  playerId: string;
  name: string;
  score: number;
}

export interface PublicQuestion {
  questionId: string;
  gameType: GameType;
  round: number;
  totalRounds: number;
  prompt: string;
  audioUrl?: string;
  imageUrl?: string;
  sourceUrl?: string;
  endsWithPinyin?: string;
}

export interface RoomSnapshot {
  code: string;
  status: RoomStatus;
  hostId: string;
  gameType?: GameType;
  currentQuestion?: PublicQuestion;
  players: Player[];
  messages: ChatMessage[];
  settlement?: SettlementRow[];
}
