# BrainSync 群聊小游戏

一个微信小游戏大厅 + 微信聊天风格实时房间原型。当前包含 PVE 猜歌挑战、PVP 成语接龙和 PVP 猜歌名。服务端是唯一裁判，PVP 玩家消息通过 WebSocket 到达后端后再判题和广播，PVE 分数按服务端挑战记录和服务端时间计算，避免前端伪造命中结果。

## 本地运行

```bash
npm install
npm run dev
```

- 前端开发地址：`http://localhost:5173`
- 后端地址：`http://localhost:3000`
- 健康检查：`http://localhost:3000/api/health`

PVP 开房间不需要数据库。账号登录和 PVE 猜歌挑战需要 MySQL，请复制 `.env.example` 到 `.env` 并填写连接信息。

也可以先构建前端，再用一个 Node 服务托管静态页面和 WebSocket：

```bash
npm run build
npm start
```

访问 `http://localhost:3000`。

## 玩法

- 主界面：优先进入 `猜歌挑战`，也可以选择 `开房间对战`。
- 账号：PVE 必须注册/登录；PVP 创建/加入房间仍支持游客昵称。
- PVE 猜歌挑战：每关 5 首歌，开始关卡消耗 1 点体力，越快答对分越高，通关后保存最高分、星级和下一关解锁。
- 创建房间：输入昵称，生成 6 位房间号。
- 加入房间：输入昵称和房间号。
- 房间 UI：灰色聊天背景，自己消息在右侧绿色气泡，机器人和其他玩家在左侧白色气泡。
- 成语接龙：默认 10 轮，同音接龙，答案必须存在于真实成语题库，且本局不可重复。
- PVP 猜歌名：默认 5 轮，播放歌曲预览音频，只认歌名或别名，不认歌手。
- 答错：机器人发送 `@玩家 答案不对`。
- 答对：机器人发送命中消息、加分并进入下一题。
- 结算：游戏结束后显示每个玩家答对数。

## 账号与PVE接口

账号和 PVE 接口使用 MySQL 保存真实状态；如果 MySQL 未配置，相关接口会明确返回不可用，不会使用临时假数据。

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/me`
- `GET /api/pve/profile`
- `GET /api/pve/levels`
- `POST /api/pve/start`
- `POST /api/pve/answer`
- `POST /api/pve/finish`

生产环境需要配置：

```bash
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=brainsync
MYSQL_PASSWORD=你的密码
MYSQL_DATABASE=brainsync
```

## 数据文件

- 成语题库：`src/server/data/idioms.json`
- 歌曲题库：`src/server/data/songs.json`
- 头像资源：`public/avatars/`

题库启动时会校验关键字段。字段缺失、拼音异常、URL 不合法会直接报错，不会用默认值或假题掩盖问题。

## 云服务器部署

1. 在服务器安装 Node.js 20+。
2. 上传项目代码。
3. 配置 MySQL 环境变量，或把 `.env.example` 复制为 `.env` 后填写真实密码。
4. 执行：

```bash
npm ci --omit=dev --no-audit --no-fund
PORT=3000 npm start
```

5. 用 Nginx/Caddy 反向代理到 `http://127.0.0.1:3000`，并开启 HTTPS。Socket.IO 会复用同一域名的 WebSocket/WSS 连接。

### 服务器一键更新

如果服务器已经通过 Git clone 部署，并且 PM2/Node/npm 已安装，在服务器项目目录执行：

```bash
bash scripts/deploy-server.sh
```

脚本会执行：拉取 `origin/feature/home-and-pve`、安装生产依赖、重启 PM2 应用 `brainsync`、检查 `http://127.0.0.1:3000/api/health`。服务器默认使用当前新首页/PVE分支。

可用环境变量覆盖默认值：

```bash
APP_NAME=brainsync BRANCH=feature/home-and-pve HEALTH_URL=http://127.0.0.1:3000/api/health bash scripts/deploy-server.sh
```

如果以后要临时部署其他分支，可以覆盖 `BRANCH`：

```bash
APP_NAME=brainsync BRANCH=main bash scripts/deploy-server.sh
```

## 音乐来源说明

当前歌曲题库使用 Apple Music / iTunes 可公开访问的在线试听 `previewUrl`，只作为私玩原型的预览源，不下载、不缓存、不伪装成自有音频。正式公开运营前应替换为你拥有授权的音频来源。

## 验证

```bash
npm test
npm run build
```
