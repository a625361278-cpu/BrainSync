import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { AccountRepository, PublicUser } from "./repository";
import { toPublicUser } from "./repository";

const scrypt = promisify(scryptCallback);
const PASSWORD_KEY_LENGTH = 64;

export interface CreateAuthServiceOptions {
  repo: AccountRepository;
  now?: () => number;
  tokenTtlMs?: number;
  randomToken?: () => string;
}

export interface RegisterPayload {
  username: string;
  password: string;
  nickname: string;
}

export interface LoginPayload {
  username: string;
  password: string;
}

export interface AuthResult {
  user: PublicUser;
  token: string;
  expiresAt: number;
}

export interface AuthService {
  register(payload: RegisterPayload): Promise<AuthResult>;
  login(payload: LoginPayload): Promise<AuthResult>;
  requireUserByToken(token: string): Promise<PublicUser>;
  logout(token: string): Promise<void>;
}

export function createAuthService(options: CreateAuthServiceOptions): AuthService {
  return new DefaultAuthService(options);
}

class DefaultAuthService implements AuthService {
  private readonly repo: AccountRepository;
  private readonly now: () => number;
  private readonly tokenTtlMs: number;
  private readonly randomToken: () => string;

  constructor(options: CreateAuthServiceOptions) {
    this.repo = options.repo;
    this.now = options.now ?? Date.now;
    this.tokenTtlMs = options.tokenTtlMs ?? 7 * 24 * 60 * 60 * 1000;
    this.randomToken = options.randomToken ?? (() => randomBytes(32).toString("hex"));
  }

  async register(payload: RegisterPayload): Promise<AuthResult> {
    const username = normalizeUsername(payload.username);
    const nickname = payload.nickname.trim();
    validatePassword(payload.password);
    if (!nickname) {
      throw new Error("昵称不能为空");
    }
    if (nickname.length > 16) {
      throw new Error("昵称不能超过16个字");
    }
    const existing = await this.repo.findUserByUsername(username);
    if (existing) {
      throw new Error("账号已存在");
    }

    const createdAt = this.now();
    const user = {
      id: `u_${this.randomToken().slice(0, 18)}`,
      username,
      passwordHash: await hashPassword(payload.password),
      nickname,
      title: "新声挑战者",
      openid: null,
      createdAt
    };
    await this.repo.createUser(user);
    return this.createLoginResult(user.id);
  }

  async login(payload: LoginPayload): Promise<AuthResult> {
    const username = normalizeUsername(payload.username);
    const user = await this.repo.findUserByUsername(username);
    if (!user || !(await verifyPassword(payload.password, user.passwordHash))) {
      throw new Error("账号或密码错误");
    }
    return this.createLoginResult(user.id);
  }

  async requireUserByToken(token: string): Promise<PublicUser> {
    const cleanToken = token.trim();
    if (!cleanToken) {
      throw new Error("未登录");
    }
    const session = await this.repo.findSession(cleanToken);
    if (!session) {
      throw new Error("登录状态不存在");
    }
    if (session.expiresAt <= this.now()) {
      await this.repo.deleteSession(cleanToken);
      throw new Error("登录已过期");
    }
    const user = await this.repo.findUserById(session.userId);
    if (!user) {
      throw new Error(`账号状态异常：找不到用户 ${session.userId}`);
    }
    return toPublicUser(user);
  }

  async logout(token: string): Promise<void> {
    await this.repo.deleteSession(token.trim());
  }

  private async createLoginResult(userId: string): Promise<AuthResult> {
    const user = await this.repo.findUserById(userId);
    if (!user) {
      throw new Error(`账号状态异常：找不到用户 ${userId}`);
    }
    const token = this.randomToken();
    const createdAt = this.now();
    const expiresAt = createdAt + this.tokenTtlMs;
    await this.repo.createSession({ token, userId, createdAt, expiresAt });
    return { user: toPublicUser(user), token, expiresAt };
  }
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, PASSWORD_KEY_LENGTH)) as Buffer;
  return `scrypt:${salt}:${key.toString("hex")}`;
}

async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  const [algorithm, salt, hash] = passwordHash.split(":");
  if (algorithm !== "scrypt" || !salt || !hash) {
    throw new Error("密码哈希状态异常");
  }
  const expected = Buffer.from(hash, "hex");
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function normalizeUsername(username: string): string {
  const normalized = username.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(normalized)) {
    throw new Error("账号只能使用3-24位英文、数字或下划线");
  }
  return normalized;
}

function validatePassword(password: string): void {
  if (password.length < 6 || password.length > 64) {
    throw new Error("密码长度必须是6-64位");
  }
}
