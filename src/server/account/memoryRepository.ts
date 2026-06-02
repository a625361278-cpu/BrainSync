import type {
  AccountRepository,
  AccountUserRecord,
  PveProgressRecord,
  PveRunRecord,
  SessionRecord,
  StaminaRecord
} from "./repository";

export function createMemoryAccountRepository(): AccountRepository {
  return new MemoryAccountRepository();
}

class MemoryAccountRepository implements AccountRepository {
  private readonly users = new Map<string, AccountUserRecord>();
  private readonly usernameToId = new Map<string, string>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly stamina = new Map<string, StaminaRecord>();
  private readonly progress = new Map<string, PveProgressRecord>();
  private readonly runs = new Map<string, PveRunRecord>();

  async findUserByUsername(username: string): Promise<AccountUserRecord | undefined> {
    const id = this.usernameToId.get(username);
    return id ? cloneOptional(this.users.get(id)) : undefined;
  }

  async findUserById(userId: string): Promise<AccountUserRecord | undefined> {
    return cloneOptional(this.users.get(userId));
  }

  async createUser(user: AccountUserRecord): Promise<void> {
    if (this.usernameToId.has(user.username)) {
      throw new Error(`账号已存在：${user.username}`);
    }
    this.users.set(user.id, cloneValue(user));
    this.usernameToId.set(user.username, user.id);
  }

  async createSession(session: SessionRecord): Promise<void> {
    this.sessions.set(session.token, cloneValue(session));
  }

  async findSession(token: string): Promise<SessionRecord | undefined> {
    return cloneOptional(this.sessions.get(token));
  }

  async deleteSession(token: string): Promise<void> {
    this.sessions.delete(token);
  }

  async getStamina(userId: string): Promise<StaminaRecord | undefined> {
    return cloneOptional(this.stamina.get(userId));
  }

  async upsertStamina(stamina: StaminaRecord): Promise<void> {
    this.stamina.set(stamina.userId, cloneValue(stamina));
  }

  async listProgress(userId: string): Promise<PveProgressRecord[]> {
    return [...this.progress.values()].filter((row) => row.userId === userId).map(cloneValue);
  }

  async getProgress(userId: string, level: number): Promise<PveProgressRecord | undefined> {
    return cloneOptional(this.progress.get(progressKey(userId, level)));
  }

  async upsertProgress(progress: PveProgressRecord): Promise<void> {
    this.progress.set(progressKey(progress.userId, progress.level), cloneValue(progress));
  }

  async createRun(run: PveRunRecord): Promise<void> {
    if (this.runs.has(run.id)) {
      throw new Error(`PVE挑战记录已存在：${run.id}`);
    }
    this.runs.set(run.id, cloneValue(run));
  }

  async getRun(runId: string): Promise<PveRunRecord | undefined> {
    return cloneOptional(this.runs.get(runId));
  }

  async updateRun(run: PveRunRecord): Promise<void> {
    if (!this.runs.has(run.id)) {
      throw new Error(`PVE挑战记录不存在：${run.id}`);
    }
    this.runs.set(run.id, cloneValue(run));
  }
}

function progressKey(userId: string, level: number): string {
  return `${userId}:${level}`;
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function cloneOptional<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : structuredClone(value);
}
