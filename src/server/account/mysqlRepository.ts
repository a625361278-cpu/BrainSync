import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import type {
  AccountRepository,
  AccountUserRecord,
  AdRewardEventRecord,
  PveProgressRecord,
  PveRunRecord,
  SessionRecord,
  StaminaRecord
} from "./repository";

export interface MysqlConfig {
  uri?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
}

export function readMysqlConfig(env: NodeJS.ProcessEnv): MysqlConfig | undefined {
  if (env.MYSQL_CONNECTION_URI) {
    return { uri: env.MYSQL_CONNECTION_URI };
  }
  if (!env.MYSQL_HOST || !env.MYSQL_USER || !env.MYSQL_DATABASE) {
    return undefined;
  }
  return {
    host: env.MYSQL_HOST,
    port: Number(env.MYSQL_PORT ?? 3306),
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD ?? "",
    database: env.MYSQL_DATABASE
  };
}

export async function createMysqlAccountRepository(config: MysqlConfig): Promise<AccountRepository> {
  const pool = config.uri
    ? mysql.createPool(config.uri)
    : mysql.createPool({
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

class MysqlAccountRepository implements AccountRepository {
  constructor(private readonly pool: Pool) {}

  async ensureSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(64) PRIMARY KEY,
        username VARCHAR(64) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        nickname VARCHAR(64) NOT NULL,
        title VARCHAR(64) NOT NULL,
        avatar_url VARCHAR(255) NULL,
        openid VARCHAR(128) NULL,
        created_at_ms BIGINT NOT NULL,
        UNIQUE KEY uk_users_openid (openid)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await this.ensureColumn("users", "avatar_url", "ALTER TABLE users ADD COLUMN avatar_url VARCHAR(255) NULL AFTER title");
    await this.ensureUniqueIndex("users", "uk_users_openid", "openid");
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
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ad_reward_events (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        reward_type VARCHAR(32) NOT NULL,
        status VARCHAR(24) NOT NULL,
        platform_trace_id VARCHAR(128) NULL,
        created_at_ms BIGINT NOT NULL,
        verified_at_ms BIGINT NULL,
        claimed_at_ms BIGINT NULL,
        INDEX idx_ad_reward_events_user_id (user_id),
        CONSTRAINT fk_ad_reward_events_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }

  async findUserByUsername(username: string): Promise<AccountUserRecord | undefined> {
    const rows = await this.select<UserRow>("SELECT * FROM users WHERE username = ? LIMIT 1", [username]);
    return rows[0] ? toUserRecord(rows[0]) : undefined;
  }

  async findUserByOpenid(openid: string): Promise<AccountUserRecord | undefined> {
    const rows = await this.select<UserRow>("SELECT * FROM users WHERE openid = ? LIMIT 1", [openid]);
    return rows[0] ? toUserRecord(rows[0]) : undefined;
  }

  async findUserById(userId: string): Promise<AccountUserRecord | undefined> {
    const rows = await this.select<UserRow>("SELECT * FROM users WHERE id = ? LIMIT 1", [userId]);
    return rows[0] ? toUserRecord(rows[0]) : undefined;
  }

  async createUser(user: AccountUserRecord): Promise<void> {
    await this.pool.execute(
      `INSERT INTO users (id, username, password_hash, nickname, title, avatar_url, openid, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [user.id, user.username, user.passwordHash, user.nickname, user.title, user.avatarUrl ?? null, user.openid ?? null, user.createdAt]
    );
  }

  async updateUserProfile(userId: string, profile: { nickname: string; avatarUrl?: string }): Promise<void> {
    const [result] = await this.pool.execute(
      "UPDATE users SET nickname = ?, avatar_url = COALESCE(?, avatar_url) WHERE id = ?",
      [profile.nickname, profile.avatarUrl ?? null, userId]
    );
    if ("affectedRows" in result && result.affectedRows === 0) {
      throw new Error(`账号状态异常：找不到用户 ${userId}`);
    }
  }

  async createSession(session: SessionRecord): Promise<void> {
    await this.pool.execute(
      `REPLACE INTO sessions (token, user_id, expires_at_ms, created_at_ms) VALUES (?, ?, ?, ?)`,
      [session.token, session.userId, session.expiresAt, session.createdAt]
    );
  }

  async findSession(token: string): Promise<SessionRecord | undefined> {
    const rows = await this.select<SessionRow>("SELECT * FROM sessions WHERE token = ? LIMIT 1", [token]);
    return rows[0] ? toSessionRecord(rows[0]) : undefined;
  }

  async deleteSession(token: string): Promise<void> {
    await this.pool.execute("DELETE FROM sessions WHERE token = ?", [token]);
  }

  async getStamina(userId: string): Promise<StaminaRecord | undefined> {
    const rows = await this.select<StaminaRow>("SELECT * FROM stamina WHERE user_id = ? LIMIT 1", [userId]);
    return rows[0] ? toStaminaRecord(rows[0]) : undefined;
  }

  async upsertStamina(stamina: StaminaRecord): Promise<void> {
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

  async listProgress(userId: string): Promise<PveProgressRecord[]> {
    const rows = await this.select<ProgressRow>("SELECT * FROM pve_progress WHERE user_id = ? ORDER BY level_no ASC", [userId]);
    return rows.map(toProgressRecord);
  }

  async getProgress(userId: string, level: number): Promise<PveProgressRecord | undefined> {
    const rows = await this.select<ProgressRow>("SELECT * FROM pve_progress WHERE user_id = ? AND level_no = ? LIMIT 1", [
      userId,
      level
    ]);
    return rows[0] ? toProgressRecord(rows[0]) : undefined;
  }

  async upsertProgress(progress: PveProgressRecord): Promise<void> {
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

  async createRun(run: PveRunRecord): Promise<void> {
    await this.pool.execute(
      `INSERT INTO pve_runs (id, user_id, level_no, status, state_json, started_at_ms, finished_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [run.id, run.userId, run.level, run.status, JSON.stringify(run), run.startedAt, run.finishedAt ?? null]
    );
  }

  async getRun(runId: string): Promise<PveRunRecord | undefined> {
    const rows = await this.select<RunRow>("SELECT * FROM pve_runs WHERE id = ? LIMIT 1", [runId]);
    return rows[0] ? parseRun(rows[0]) : undefined;
  }

  async updateRun(run: PveRunRecord): Promise<void> {
    await this.pool.execute(
      `UPDATE pve_runs
       SET status = ?, state_json = ?, finished_at_ms = ?
       WHERE id = ?`,
      [run.status, JSON.stringify(run), run.finishedAt ?? null, run.id]
    );
  }

  async createAdRewardEvent(event: AdRewardEventRecord): Promise<void> {
    await this.pool.execute(
      `INSERT INTO ad_reward_events
        (id, user_id, reward_type, status, platform_trace_id, created_at_ms, verified_at_ms, claimed_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.id,
        event.userId,
        event.rewardType,
        event.status,
        event.platformTraceId ?? null,
        event.createdAt,
        event.verifiedAt ?? null,
        event.claimedAt ?? null
      ]
    );
  }

  async getAdRewardEvent(eventId: string): Promise<AdRewardEventRecord | undefined> {
    const rows = await this.select<AdRewardEventRow>("SELECT * FROM ad_reward_events WHERE id = ? LIMIT 1", [eventId]);
    return rows[0] ? toAdRewardEventRecord(rows[0]) : undefined;
  }

  async updateAdRewardEvent(event: AdRewardEventRecord): Promise<void> {
    await this.pool.execute(
      `UPDATE ad_reward_events
       SET status = ?, platform_trace_id = ?, verified_at_ms = ?, claimed_at_ms = ?
       WHERE id = ?`,
      [event.status, event.platformTraceId ?? null, event.verifiedAt ?? null, event.claimedAt ?? null, event.id]
    );
  }

  private async select<T extends RowDataPacket>(sql: string, values: (string | number | null)[]): Promise<T[]> {
    const [rows] = await this.pool.execute<T[]>(sql, values);
    return rows;
  }

  private async ensureUniqueIndex(table: string, indexName: string, columnName: string): Promise<void> {
    const rows = await this.select<RowDataPacket>(
      "SELECT COUNT(*) AS count FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?",
      [table, indexName]
    );
    if (Number(rows[0]?.count ?? 0) > 0) {
      return;
    }
    await this.pool.query(`ALTER TABLE ${table} ADD UNIQUE KEY ${indexName} (${columnName})`);
  }

  private async ensureColumn(table: string, columnName: string, alterSql: string): Promise<void> {
    const rows = await this.select<RowDataPacket>(
      "SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?",
      [table, columnName]
    );
    if (Number(rows[0]?.count ?? 0) > 0) {
      return;
    }
    await this.pool.query(alterSql);
  }
}

interface UserRow extends RowDataPacket {
  id: string;
  username: string;
  password_hash: string;
  nickname: string;
  title: string;
  avatar_url: string | null;
  openid: string | null;
  created_at_ms: number;
}

interface SessionRow extends RowDataPacket {
  token: string;
  user_id: string;
  expires_at_ms: number;
  created_at_ms: number;
}

interface StaminaRow extends RowDataPacket {
  user_id: string;
  current_value: number;
  max_value: number;
  last_recovered_at_ms: number;
  ad_restore_count: number;
}

interface ProgressRow extends RowDataPacket {
  user_id: string;
  level_no: number;
  highest_score: number;
  stars: number;
  passed: 0 | 1;
  updated_at_ms: number;
}

interface RunRow extends RowDataPacket {
  state_json: string | object;
}

interface AdRewardEventRow extends RowDataPacket {
  id: string;
  user_id: string;
  reward_type: "stamina" | "settlement";
  status: "started" | "verified" | "claimed";
  platform_trace_id: string | null;
  created_at_ms: number;
  verified_at_ms: number | null;
  claimed_at_ms: number | null;
}

function toUserRecord(row: UserRow): AccountUserRecord {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    nickname: row.nickname,
    title: row.title,
    avatarUrl: row.avatar_url,
    openid: row.openid,
    createdAt: Number(row.created_at_ms)
  };
}

function toSessionRecord(row: SessionRow): SessionRecord {
  return {
    token: row.token,
    userId: row.user_id,
    expiresAt: Number(row.expires_at_ms),
    createdAt: Number(row.created_at_ms)
  };
}

function toStaminaRecord(row: StaminaRow): StaminaRecord {
  return {
    userId: row.user_id,
    current: row.current_value,
    max: row.max_value,
    lastRecoveredAt: Number(row.last_recovered_at_ms),
    adRestoreCount: row.ad_restore_count
  };
}

function toProgressRecord(row: ProgressRow): PveProgressRecord {
  return {
    userId: row.user_id,
    level: row.level_no,
    highestScore: row.highest_score,
    stars: row.stars,
    passed: row.passed === 1,
    updatedAt: Number(row.updated_at_ms)
  };
}

function parseRun(row: RunRow): PveRunRecord {
  if (typeof row.state_json === "string") {
    return JSON.parse(row.state_json) as PveRunRecord;
  }
  return row.state_json as PveRunRecord;
}

function toAdRewardEventRecord(row: AdRewardEventRow): AdRewardEventRecord {
  return {
    id: row.id,
    userId: row.user_id,
    rewardType: row.reward_type,
    status: row.status,
    platformTraceId: row.platform_trace_id ?? undefined,
    createdAt: Number(row.created_at_ms),
    verifiedAt: row.verified_at_ms === null ? undefined : Number(row.verified_at_ms),
    claimedAt: row.claimed_at_ms === null ? undefined : Number(row.claimed_at_ms)
  };
}

function requireConfig(value: string | undefined, key: string): string {
  if (!value) {
    throw new Error(`MySQL配置缺失：${key}`);
  }
  return value;
}
