export interface ExchangeWechatLoginCodeOptions {
  code: string;
  appId: string | undefined;
  appSecret: string | undefined;
  fetchImpl?: typeof fetch;
}

interface WechatSessionResponse {
  openid?: string;
  session_key?: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
}

export async function exchangeWechatLoginCode(options: ExchangeWechatLoginCodeOptions): Promise<string> {
  const code = options.code.trim();
  if (!code) {
    throw new Error("微信登录code不能为空");
  }
  if (!options.appId) {
    throw new Error("微信小程序配置缺失：WECHAT_APP_ID");
  }
  if (!options.appSecret) {
    throw new Error("微信小程序配置缺失：WECHAT_APP_SECRET");
  }

  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.searchParams.set("appid", options.appId);
  url.searchParams.set("secret", options.appSecret);
  url.searchParams.set("js_code", code);
  url.searchParams.set("grant_type", "authorization_code");

  const response = await (options.fetchImpl ?? fetch)(url);
  if (!response.ok) {
    throw new Error(`微信登录请求失败：HTTP ${response.status}`);
  }
  const body = (await response.json()) as WechatSessionResponse;
  if (body.errcode) {
    throw new Error(`微信登录失败：${body.errmsg || body.errcode}`);
  }
  if (!body.openid) {
    throw new Error("微信登录状态异常：缺少openid");
  }
  return body.openid;
}
