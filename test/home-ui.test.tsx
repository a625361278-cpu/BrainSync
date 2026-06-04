import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/client/main";
import type { RoomSnapshot } from "../src/shared/types";

const socketMock = vi.hoisted(() => {
  const handlers: Record<string, (payload: unknown) => void> = {};
  return {
    handlers,
    emitWithAck: vi.fn(),
    on: vi.fn((event: string, handler: (payload: unknown) => void) => {
      handlers[event] = handler;
    }),
    disconnect: vi.fn()
  };
});

vi.mock("socket.io-client", () => ({
  io: () => ({
    on: socketMock.on,
    disconnect: socketMock.disconnect,
    timeout: () => ({
      emitWithAck: socketMock.emitWithAck
    })
  })
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("首页登录入口", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<div id="root"></div>';
    socketMock.emitWithAck.mockReset();
    socketMock.on.mockClear();
    socketMock.disconnect.mockClear();
    for (const key of Object.keys(socketMock.handlers)) {
      delete socketMock.handlers[key];
    }
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: vi.fn(() => Promise.resolve())
    });
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn()
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/pve/levels") {
          return jsonResponse({ ok: true, levels: [] });
        }
        return jsonResponse({ ok: false, error: "未登录" }, 401);
      })
    );
  });

  it("未登录进入首页时弹出登录注册弹窗，首页不内嵌登录卡片", async () => {
    await act(async () => {
      createRoot(document.getElementById("root")!).render(<App />);
    });

    expect(document.querySelector(".home-auth-modal")).not.toBeNull();
    expect(document.querySelector(".profile-card .auth-box")).toBeNull();
    expect(document.body.textContent).toContain("欢迎来到 BrainSync");
  });

  it("首页开房间卡片只展示核心玩法标签和省略号", async () => {
    await act(async () => {
      createRoot(document.getElementById("root")!).render(<App />);
    });

    const tagWrap = document.querySelector(".room-game-tags");
    const labels = Array.from(document.querySelectorAll(".room-game-tags span")).map((node) => node.textContent);

    expect(tagWrap?.getAttribute("aria-label")).toBe("开房间支持成语接龙、猜歌名、剪影猜人、剧照猜电影");
    expect(labels).toEqual(["成语", "猜歌", "..."]);
  });

  it("关闭弹窗后点击猜歌挑战会重新要求登录", async () => {
    await act(async () => {
      createRoot(document.getElementById("root")!).render(<App />);
    });

    await act(async () => {
      document.querySelector<HTMLButtonElement>(".modal-close")?.click();
    });
    expect(document.querySelector(".home-auth-modal")).toBeNull();

    await act(async () => {
      document.querySelector<HTMLButtonElement>(".guess-mode button")?.click();
    });

    expect(document.querySelector(".home-auth-modal")).not.toBeNull();
  });

  it("登录后进入PVP入口不再显示昵称输入，只输入6位数字房间号", async () => {
    localStorage.setItem("brainsync.authToken", "token-1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/pve/levels") {
          return jsonResponse({ ok: true, levels: [] });
        }
        if (url === "/api/me") {
          return jsonResponse({ ok: true, user: { id: "u1", username: "jim", nickname: "jim", title: "新声挑战者", createdAt: 1 } });
        }
        if (url === "/api/pve/profile") {
          return jsonResponse({
            ok: true,
            profile: {
              stamina: { current: 4, max: 5, lastRecoveredAt: 1, adRestoreCount: 0 },
              highestUnlockedLevel: 1,
              progress: []
            }
          });
        }
        return jsonResponse({ ok: false, error: "未知接口" }, 404);
      })
    );

    await act(async () => {
      createRoot(document.getElementById("root")!).render(<App />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".room-mode button")?.click();
    });

    expect(document.body.textContent).not.toContain("昵称");
    expect(document.body.textContent).toContain("创建房间");
    expect(document.querySelector<HTMLInputElement>('input[placeholder="6位数字房间号"]')).not.toBeNull();
  });

  it("猜歌挑战中显示当前得分并在答对后更新", async () => {
    localStorage.setItem("brainsync.authToken", "token-1");
    vi.useFakeTimers();
    const question = {
      questionId: "q1",
      songId: "s1",
      index: 1,
      total: 5,
      audioUrl: "/audio/demo.mp3",
      sourceUrl: "",
      timeLimitSeconds: 30,
      audioFilter: "phone"
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/pve/levels") {
          return jsonResponse({
            ok: true,
            levels: [
              {
                level: 1,
                name: "初听旋律",
                songCount: 5,
                timeLimitSeconds: 30,
                passScore: 1800,
                starScores: [1800, 2600, 3400],
                audioFilter: "phone",
                difficultyRange: [1, 2]
              }
            ]
          });
        }
        if (url === "/api/me") {
          return jsonResponse({ ok: true, user: { id: "u1", username: "jim", nickname: "jim", title: "新声挑战者", createdAt: 1 } });
        }
        if (url === "/api/pve/profile") {
          return jsonResponse({
            ok: true,
            profile: {
              stamina: { current: 4, max: 5, lastRecoveredAt: 1, adRestoreCount: 0 },
              highestUnlockedLevel: 1,
              progress: []
            }
          });
        }
        if (url === "/api/pve/start") {
          return jsonResponse({
            ok: true,
            run: {
              runId: "run-1",
              level: 1,
              questions: [question],
              currentQuestion: question,
              stamina: { current: 3, max: 5, lastRecoveredAt: 1, adRestoreCount: 0 }
            }
          });
        }
        if (url === "/api/pve/question/start") {
          return jsonResponse({ ok: true, result: { timeLimitSeconds: 30 } });
        }
        if (url === "/api/pve/answer") {
          return jsonResponse({
            ok: true,
            result: {
              correct: true,
              answer: "晴天",
              scoreDelta: 850,
              totalScore: 850,
              correctCount: 1,
              finished: false
            }
          });
        }
        return jsonResponse({ ok: false, error: "未知接口" }, 404);
      })
    );

    await act(async () => {
      createRoot(document.getElementById("root")!).render(<App />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".guess-mode button")?.click();
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".level-card button")?.click();
    });

    expect(document.querySelector(".score-strip")?.textContent).toContain("当前得分");
    expect(document.querySelector(".score-strip strong")?.textContent).toBe("0");

    for (let second = 0; second < 4; second += 1) {
      await act(async () => {
        vi.advanceTimersByTime(1000);
        await Promise.resolve();
      });
    }
    await act(async () => {
      setNativeInputValue(document.querySelector<HTMLInputElement>(".answer-row input")!, "晴天");
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain("剩余");
    expect(document.querySelector<HTMLButtonElement>(".answer-row button")?.disabled).toBe(false);
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".answer-row button")?.click();
    });

    expect(document.querySelector(".score-strip strong")?.textContent).toBe("850");
    vi.useRealTimers();
  });

  it("返回大厅会离开房间，并忽略旧房间后续快照", async () => {
    localStorage.setItem("brainsync.authToken", "token-1");
    const room = roomSnapshot("123456");
    socketMock.emitWithAck.mockImplementation(async (event: string) => {
      if (event === "createRoom") {
        return { ok: true, room, playerId: "p1" };
      }
      if (event === "leaveRoom") {
        return { ok: true };
      }
      return { ok: false, error: `未预期事件：${event}` };
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/pve/levels") {
          return jsonResponse({ ok: true, levels: [] });
        }
        if (url === "/api/me") {
          return jsonResponse({ ok: true, user: { id: "u1", username: "jim", nickname: "jim", title: "新声挑战者", createdAt: 1 } });
        }
        if (url === "/api/pve/profile") {
          return jsonResponse({
            ok: true,
            profile: {
              stamina: { current: 4, max: 5, lastRecoveredAt: 1, adRestoreCount: 0 },
              highestUnlockedLevel: 1,
              progress: []
            }
          });
        }
        return jsonResponse({ ok: false, error: "未知接口" }, 404);
      })
    );

    await act(async () => {
      createRoot(document.getElementById("root")!).render(<App />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".room-mode button")?.click();
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".pvp-create-card")?.click();
    });

    expect(document.body.textContent).toContain("房间 123456");

    await act(async () => {
      document.querySelector<HTMLButtonElement>(".room-header button")?.click();
      await Promise.resolve();
    });

    expect(socketMock.emitWithAck).toHaveBeenCalledWith("leaveRoom", { roomCode: "123456", playerId: "p1" });
    expect(document.body.textContent).toContain("BrainSync 欢乐房间");

    await act(async () => {
      socketMock.handlers.roomSnapshot?.(room);
    });

    expect(document.body.textContent).toContain("BrainSync 欢乐房间");
    expect(document.body.textContent).not.toContain("房间 123456");
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as Response;
}

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  const reactPropsKey = Object.keys(input).find((key) => key.startsWith("__reactProps$"));
  const reactProps = reactPropsKey ? (input as unknown as Record<string, { onChange?: (event: { target: { value: string } }) => void }>)[reactPropsKey] : undefined;
  reactProps?.onChange?.({ target: { value } });
}

function roomSnapshot(code: string): RoomSnapshot {
  return {
    code,
    status: "waiting",
    hostId: "p1",
    players: [{ id: "p1", name: "jim", avatar: "/avatars/player-1.svg", score: 0, connected: true }],
    messages: [
      {
        id: "m1",
        sender: "bot",
        kind: "system",
        text: "房间已创建",
        avatar: "/avatars/bot.svg",
        createdAt: 1
      }
    ]
  };
}
