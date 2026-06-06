# BrainSync 群聊小游戏

BrainSync 是一个微信小游戏大厅 + 微信聊天风格实时房间原型。当前包含账号系统、PVE 猜歌挑战、PVP 成语接龙、PVP 猜歌名、PVP 剪影猜人和 PVP 剧照猜电影。

核心原则是服务端维护真实状态：PVP 由服务端抽题、判题、计分、广播和结算；PVE 由服务端创建挑战记录、记录题目开始时间、计算分数、扣体力、保存进度。缺少题库、账号、图片、MySQL 等关键数据时会明确报错，不用假数据或默认值伪装成功。

## 本地运行

```bash
npm install
npm run dev
```

- 前端开发地址：`http://localhost:5173`
- 后端地址：`http://localhost:3000`
- 健康检查：`http://localhost:3000/api/health`

PVP 开房间不需要数据库。账号登录和 PVE 猜歌挑战需要 MySQL，请复制 `.env.example` 到 `.env` 并填写真实连接信息。

也可以先构建前端，再用 Node 服务托管静态页面和 WebSocket：

```bash
npm run build
npm start
```

访问 `http://localhost:3000`。

## 配置

```bash
PORT=3000
ROUND_SECONDS=30
PVP_HINT_REMAINING_SECONDS=15

MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=brainsync
MYSQL_PASSWORD=你的密码
MYSQL_DATABASE=brainsync

WECHAT_APP_ID=wx-your-app-id
WECHAT_APP_SECRET=你的微信小程序密钥
UNI_AD_CALLBACK_SECRET=广告回调密钥
```

也可以使用 `MYSQL_CONNECTION_URI` 替代 MySQL 分项配置。未配置 MySQL 时，账号和 PVE API 会返回服务不可用，PVP 房间仍可使用。

小程序前端构建时还需要配置：

```bash
VITE_API_BASE_URL=https://like2022.online
VITE_WS_URL=wss://like2022.online/pvp-ws
VITE_REWARD_AD_UNIT_ID=微信激励视频广告位ID
```

## 功能概览

- 首页大厅：展示账号区域、PVE 关卡入口和 PVP 开房间入口。
- 账号系统：H5 支持注册、登录、登出、登录态恢复；小程序使用微信登录，并要求用户确认昵称和选择微信头像，头像保存到服务端。
- PVE 猜歌挑战：登录后进入，每关 5 首歌，消耗体力开始挑战，按服务端时间和连击计算分数。
- PVP 房间：游客可创建或加入 6 位房间号，房主选择玩法并开始游戏。
- 微信聊天风格房间：自己消息在右侧，机器人和其他玩家在左侧，题目、提示、结果都通过聊天消息展示。
- PVP 同步：玩家身份按账号和房间绑定，网页端 Socket.IO 断线重连后会重新加入当前房间，避免人数和消息广播状态错位。
- 自动提示：默认每轮 30 秒，剩余 15 秒时服务端发一次提示；如果已经答对进入下一题，旧提示定时器不会误发。
- 超时处理：无人答对时服务端公布答案或参考答案，并推进下一题。
- 结算：PVP 按答对题数排序；PVE 保存总分、正确数、最快答题、星级和通关状态。

## PVP 玩法

- 成语接龙：默认 10 轮，同音接龙；答案必须存在于真实成语题库，且本局不可重复。
- 猜歌名：默认 5 轮，播放歌曲预览音频；只认歌名和别名，不认歌手。
- 剪影猜人：默认 5 轮，展示本地剪影 PNG；只认角色名和别名。
- 剧照猜电影：默认 5 轮，展示本地剧照 SVG；只认电影名和别名。

提示来源不是 AI 生成，也不是独立 prompt 配置，而是根据当前题目的真实数据拼接：

- 猜歌名：歌手 + 歌名字数。
- 剪影猜人：作品名 + 角色名字数。
- 剧照猜电影：年份、地区、类型 + 片名字数。
- 成语接龙：可接成语数量 + 部分候选首字。

## PVE 规则

- 关卡配置在 `src/server/pve/levels.ts`，当前默认 13 关。
- 每关固定 5 首歌，服务端按关卡难度范围从歌曲题库抽题。
- 开始关卡会扣 1 点体力；体力恢复和进度保存在 MySQL。
- 前端播放题目前会调用 `/api/pve/question/start`，服务端记录真实开始时间。
- 答题分数由服务端按耗时、连击和答错次数计算。
- 超时必须等服务端判断确实超过题目时限，不能由前端直接伪造。
- 结算后更新最高分、星级和是否通关；下一关解锁取决于已通关最高关卡。

## HTTP 接口

账号和 PVE 接口使用 MySQL 保存真实状态。MySQL 未就绪时相关接口会明确返回不可用。

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/wechat-login`：小程序登录，接收微信 `code`、用户确认的昵称和头像图片；昵称和头像都不能为空，不用默认玩家名或系统头像代替。
- `POST /api/auth/logout`
- `GET /api/me`
- `GET /api/audio/preview/:songId`
- `GET /api/pve/profile`
- `GET /api/pve/levels`
- `POST /api/pve/start`
- `POST /api/pve/question/start`
- `POST /api/pve/answer`
- `POST /api/pve/timeout`
- `POST /api/pve/finish`
- `POST /api/ad/reward/start`
- `POST /api/ad/reward/callback`
- `POST /api/ad/reward/claim`

## WebSocket 事件

Socket.IO 连接用于 PVP 房间同步：

- `createRoom`
- `joinRoom`
- `startGame`
- `sendMessage`
- `leaveRoom`
- `roomSnapshot`

服务端只广播 `RoomSnapshot`，其中包含房间状态、玩家、当前公开题目、聊天消息和结算信息。

微信小程序不使用浏览器版 Socket.IO 客户端，改用原生 WebSocket：`wss://域名/pvp-ws`。消息格式为 JSON envelope，包含 `type/requestId/payload`；服务端返回 `ack` 和 `roomSnapshot`。

## 微信小程序

当前 H5 版本保留在 `src/client`，微信小程序是独立 uni-app 工程：`apps/miniapp`。

安装小程序依赖：

```bash
npm run miniapp:install
```

构建微信小程序：

```bash
npm run miniapp:build:mp-weixin
```

构建完成后，用微信开发者工具导入：

```bash
apps/miniapp/dist/build/mp-weixin
```

小程序版本使用普通 uni-app，不是 uni-app x。第一版能力包括微信登录、用户确认昵称、微信头像持久化、PVE、PVP四种玩法、原生 WebSocket、音频代理和体力广告入口。

小程序 PVP 房间内的图片题使用完整适配显示，剪影和剧照都不裁剪题目主体。PVP 猜歌名语音复用当前音频实例，同一条语音再次点击会暂停，暂停后再点继续播放；切换到另一条语音时停止旧语音并播放新语音。

## 数据文件

- 成语题库：`src/server/data/idioms.json`
- 歌曲题库：`src/server/data/songs.json`
- 剪影猜人题库：`src/server/data/character-silhouettes.json`
- 剧照猜电影题库：`src/server/data/movie-stills.json`
- 头像资源：`public/avatars/`
- 剪影图片：`public/pvp-assets/silhouettes/`
- 剧照图片：`public/pvp-assets/movie-stills/`
- 小程序用户头像：运行时保存到服务端 `user-avatars/`，通过 `/user-avatars/...` 对外访问。

服务端启动时会校验题库和图片资源。字段缺失、拼音异常、URL 不合法、图片文件不存在都会直接报错。

## 剪影资产制作

剪影题使用透明参考图生成黑色轮廓 PNG。现有处理脚本：

```bash
powershell -ExecutionPolicy Bypass -File scripts/process-silhouette-assets.ps1
```

固定流程：

1. 准备真实参考图到 `tmp/silhouette_refs/`。
2. 生成剪影 PNG 到 `public/pvp-assets/silhouettes/`。
3. 在 `src/server/data/character-silhouettes.json` 补全 `id/name/aliases/work/difficulty/referenceNote/imageUrl/assetMode`。
4. 跑图片题库测试确认字段和本地文件都存在。

本机还封装了 `$make-silhouette-assets` skill，用于以后批量制作和校验新剪影题。

## 构建与部署

构建命令：

```bash
npm run build
```

构建服务端时会把四个题库 JSON 复制到 `dist-server/data/`，保证生产环境仍从真实题库读取。

正式发布前建议跑完整验证：

```bash
npm run check:release
```

这会依次执行全量测试、H5/服务端构建和微信小程序构建。

### 腾讯云 CentOS 7 HTTPS/WSS 部署

当前小程序正式版按真实线上环境设计，不默认做轻量版。腾讯云服务器推荐使用 Nginx + PM2：

1. 在服务器安装 Node.js 20+。
2. 配置腾讯云 SSL 证书和 Nginx HTTPS。
3. Node 服务监听 `127.0.0.1:3000`，公网只开放 `80/443`。
4. Nginx 反代 `/`、`/socket.io/` 和 `/pvp-ws` 到 `http://127.0.0.1:3000`。
5. 微信公众平台配置合法域名：
   - request 合法域名：`https://like2022.online`
   - socket 合法域名：`wss://like2022.online`

完整步骤见：

```text
docs/deployment-centos7-https.md
```

初始化服务器：

```bash
sudo bash scripts/setup-centos7-server.sh
```

生产进程由 PM2 配置文件管理：

```text
ecosystem.config.cjs
```

Nginx 模板：

```text
deploy/nginx/brainsync.conf.template
```

### 服务器一键更新

如果服务器已经通过 Git clone 部署，并且 PM2/Node/npm 已安装，在服务器项目目录执行：

```bash
bash scripts/deploy-server.sh
```

脚本会检查服务器工作区是否干净，执行 `git pull --ff-only`、安装依赖、构建项目、重载 PM2 应用 `brainsync`，并检查 `http://127.0.0.1:3000/api/health`。如果服务器工作区存在未提交改动，脚本会停止，不会强制覆盖。

可用环境变量覆盖默认值：

```bash
APP_NAME=brainsync BRANCH=feature/home-and-pve HEALTH_URL=http://127.0.0.1:3000/api/health bash scripts/deploy-server.sh
```

## 音乐来源说明

当前歌曲题库使用 Apple Music / iTunes 可公开访问的在线试听 `previewUrl`，只作为私玩原型的预览源，不下载、不缓存、不伪装成自有音频。正式公开运营前应替换为你拥有授权的音频来源。

## 验证

```bash
npm test
npm run build
```

重点测试：

```bash
npm test -- --run test/auth-pve.test.ts
npm test -- --run test/game-engine.test.ts
npm test -- --run test/pvp-image-data.test.ts
npm test -- --run test/home-ui.test.tsx
```
