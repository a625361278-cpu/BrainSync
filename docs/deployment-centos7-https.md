# BrainSync 腾讯云 CentOS 7 HTTPS/WSS 部署说明

本文档用于普通微信小程序正式版部署。当前阶段不是微信小游戏 runtime；小程序端需要 HTTPS API 和 WSS PVP 房间连接。

## 1. 前置条件

- 已备案域名已经解析到腾讯云服务器公网 IP。
- 腾讯云安全组只需要开放公网 `80` 和 `443`。
- 不建议开放公网 `3000`；Node 服务由 Nginx 反代到 `127.0.0.1:3000`。
- 腾讯云 SSL 证书已经签发，并已下载 Nginx 格式证书。

## 2. 初始化服务器

部署原则：服务器已经有的就不要新建。先检查现状，缺什么再补什么；如果已存在但版本不满足要求，要明确处理原因，不自动覆盖或替换。

如果是全新的 CentOS 7 服务器，可以执行：

```bash
sudo bash scripts/setup-centos7-server.sh
```

脚本会先检测 Git、curl、Nginx、Node.js、PM2 是否已经存在。已存在且满足要求的组件会跳过；Node.js 已存在但低于 20 会直接报错，要求你有意识地升级，不会自动替换已有 Node 环境。

如果服务器已经有 Nginx，不要覆盖现有 `/etc/nginx/nginx.conf`，也不要直接替换已有站点配置。此时建议跳过 Nginx 安装和启动，只补 Node.js 20 LTS、PM2 等运行依赖：

```bash
sudo SKIP_NGINX=1 bash scripts/setup-centos7-server.sh
```

已有 Nginx 的服务器需要先确认现状：

```bash
sudo nginx -t
sudo nginx -V 2>&1 | tr ' ' '\n' | grep conf-path
sudo ls -la /etc/nginx/conf.d
```

如果你的服务器使用的是宝塔、LNMP、OpenResty 或自定义路径，实际站点配置目录可能不是 `/etc/nginx/conf.d`。以 `nginx -V` 输出的 `--conf-path` 和主配置里的 `include` 为准。

## 3. 配置项目环境变量

在服务器项目根目录检查 `.env`。如果已经存在，直接编辑原文件，不要覆盖；如果不存在，再创建。不要提交到 Git：

```bash
PORT=3000
ROUND_SECONDS=30
PVP_HINT_REMAINING_SECONDS=15

MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=brainsync
MYSQL_PASSWORD=真实密码
MYSQL_DATABASE=brainsync

WECHAT_APP_ID=真实小程序AppID
WECHAT_APP_SECRET=真实小程序AppSecret
UNI_AD_CALLBACK_SECRET=真实广告回调密钥
```

如果 MySQL 没有配置好，账号、微信登录、PVE 和广告奖励接口会明确返回不可用；不要用假配置绕过。

## 4. 配置 Nginx HTTPS/WSS

BrainSync 只需要新增一个独立站点配置，不要覆盖现有站点。模板里的 `server_name your-domain.com` 必须替换成 BrainSync 小程序使用的备案域名；如果这个域名已经被其他 server 块占用，需要合并到那个 server 块，不能保留两个相同 `server_name` 的 443 配置。

先检查证书目录和站点配置是否已经存在：

```bash
sudo test -d /etc/nginx/ssl && echo "ssl dir exists" || echo "ssl dir missing"
sudo test -f /etc/nginx/conf.d/brainsync.conf && echo "brainsync nginx config exists" || echo "brainsync nginx config missing"
```

只在不存在时创建证书目录，不要覆盖已有证书目录：

```bash
sudo test -d /etc/nginx/ssl || sudo mkdir -p /etc/nginx/ssl
```

如果 BrainSync 配置文件不存在，再复制模板：

```bash
sudo test -f /etc/nginx/conf.d/brainsync.conf || sudo cp deploy/nginx/brainsync.conf.template /etc/nginx/conf.d/brainsync.conf
```

如果 `/etc/nginx/conf.d/brainsync.conf` 已存在，只编辑它，不要覆盖已有配置文件。

把腾讯云下载的证书放到不存在的目标文件；如果目标文件已经存在，先确认是不是同一个域名的有效证书，不要直接覆盖：

```text
/etc/nginx/ssl/your-domain.com.pem
/etc/nginx/ssl/your-domain.com.key
```

然后编辑 `/etc/nginx/conf.d/brainsync.conf`：

- 把 `your-domain.com` 替换为真实备案域名。
- 把证书路径替换为真实证书文件路径。
- 保留 `/pvp-ws` 的 WebSocket Upgrade 配置。
- 保留 `/socket.io/` 的 WebSocket Upgrade 配置，用于 H5 房间。
- 如果服务器已经有 Nginx，只新增或合并 BrainSync 的 `server` / `location` 配置，不要覆盖现有业务配置。
- 如果已有同域名 HTTPS 站点，把 `/`、`/pvp-ws`、`/socket.io/` 三组反代 location 合并进去；不要再复制一个重复的 `listen 443 ssl` 同域名 server。
- 如果现有站点已经占用了 `/`，不能直接改成 BrainSync 反代；需要给 BrainSync 使用独立子域名，或只合并 `/api`、`/pvp-ws`、`/socket.io/` 等不会冲突的路径。

检查并重载：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 5. 部署服务

在服务器项目根目录执行：

```bash
bash scripts/deploy-server.sh
```

默认使用当前 Git 分支。指定分支：

```bash
BRANCH=feature/home-and-pve bash scripts/deploy-server.sh
```

脚本会：

- 检查服务器工作区是否干净。
- `git pull --ff-only` 拉取代码。
- `npm ci` 安装依赖。
- `npm run build` 构建 H5 和服务端。
- `npm prune --omit=dev` 移除开发依赖。
- `pm2 startOrReload ecosystem.config.cjs` 启动或重载服务。
- 检查 `http://127.0.0.1:3000/api/health`。

如果服务器工作区有未提交改动，脚本会停止，不会强制覆盖。

## 6. 小程序构建配置

本地或 CI 构建小程序前，设置：

```bash
VITE_API_BASE_URL=https://your-domain.com
VITE_WS_URL=wss://your-domain.com/pvp-ws
VITE_REWARD_AD_UNIT_ID=真实激励视频广告位ID
```

构建：

```bash
npm run miniapp:build:mp-weixin
```

微信开发者工具导入：

```text
apps/miniapp/dist/build/mp-weixin
```

## 7. 微信公众平台配置

在微信公众平台配置服务器域名：

- request 合法域名：`https://your-domain.com`
- socket 合法域名：`wss://your-domain.com`

不要填写 IP、HTTP、localhost 或未备案域名。

## 8. 上线前验证

本地构建验证：

```bash
npm run check:release
```

服务器验证：

```bash
curl -fsS http://127.0.0.1:3000/api/health
curl -I https://your-domain.com
pm2 status
sudo nginx -t
```

微信开发者工具验证：

- 微信登录接口不报 AppID/AppSecret 配置缺失。
- PVE 能拉取关卡和播放音频代理。
- PVP 能创建房间、加入房间、同步消息。
- 广告奖励必须收到真实回调后才能领取，不能用前端播放完成伪造奖励。
