import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/client/main";

vi.mock("socket.io-client", () => ({
  io: () => ({
    on: vi.fn(),
    disconnect: vi.fn(),
    timeout: () => ({
      emitWithAck: vi.fn()
    })
  })
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("首页登录入口", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<div id="root"></div>';
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
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as Response;
}
