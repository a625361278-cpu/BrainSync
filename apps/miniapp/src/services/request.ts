import { API_BASE_URL } from "./config";
import { readToken } from "./storage";

export interface ApiResponse<T> {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

export async function apiRequest<T>(path: string, options: { method?: "GET" | "POST"; data?: unknown; token?: string } = {}): Promise<T> {
  const token = options.token ?? readToken();
  const response = await new Promise<UniApp.RequestSuccessCallbackResult>((resolve, reject) => {
    uni.request({
      url: `${API_BASE_URL}${path}`,
      method: options.method ?? "GET",
      data: options.data,
      header: token ? { Authorization: `Bearer ${token}` } : undefined,
      success: resolve,
      fail: reject
    });
  });
  const body = response.data as ApiResponse<T>;
  if (response.statusCode < 200 || response.statusCode >= 300 || body.ok === false) {
    throw new Error(body.error || `请求失败：${response.statusCode}`);
  }
  return body as T;
}
