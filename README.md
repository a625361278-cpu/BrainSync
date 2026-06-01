# BrainSync 群聊小游戏

一个微信聊天风格的实时网页小游戏原型，包含成语接龙和猜歌名。服务端是唯一裁判，玩家消息通过 WebSocket 到达后端后再判题和广播，避免前端伪造命中结果。

## 本地运行

```bash
npm install
npm run dev
```

- 前端开发地址：`http://localhost:5173`
- 后端地址：`http://localhost:3000`
- 健康检查：`http://localhost:3000/api/health`

也可以先构建前端，再用一个 Node 服务托管静态页面和 WebSocket：

```bash
npm run build
npm start
```

访问 `http://localhost:3000`。

## 玩法

- 创建房间：输入昵称，生成 6 位房间号。
- 加入房间：输入昵称和房间号。
- 房间 UI：灰色聊天背景，自己消息在右侧绿色气泡，机器人和其他玩家在左侧白色气泡。
- 成语接龙：默认 10 轮，同音接龙，答案必须存在于真实成语题库，且本局不可重复。
- 猜歌名：默认 5 轮，播放歌曲预览音频，答歌名、歌手或别名都可命中。
- 答错：机器人发送 `@玩家 答案不对`。
- 答对：机器人发送命中消息、加分并进入下一题。
- 结算：游戏结束后显示每个玩家答对数。

## 数据文件

- 成语题库：`src/server/data/idioms.json`
- 歌曲题库：`src/server/data/songs.json`
- 头像资源：`public/avatars/`

题库启动时会校验关键字段。字段缺失、拼音异常、URL 不合法会直接报错，不会用默认值或假题掩盖问题。

## 云服务器部署

1. 在服务器安装 Node.js 20+。
2. 上传项目代码。
3. 执行：

```bash
npm ci
npm run build
PORT=3000 npm start
```

4. 用 Nginx/Caddy 反向代理到 `http://127.0.0.1:3000`，并开启 HTTPS。Socket.IO 会复用同一域名的 WebSocket/WSS 连接。

### 服务器一键更新

如果服务器已经通过 Git clone 部署，并且 PM2/Node/npm 已安装，在服务器项目目录执行：

```bash
bash scripts/deploy-server.sh
```

脚本会执行：拉取 `origin/main`、安装生产依赖、重启 PM2 应用 `brainsync`、检查 `http://127.0.0.1:3000/api/health`。

可用环境变量覆盖默认值：

```bash
APP_NAME=brainsync BRANCH=main HEALTH_URL=http://127.0.0.1:3000/api/health bash scripts/deploy-server.sh
```

## 音乐来源说明

当前歌曲题库使用 Apple Music / iTunes 可公开访问的在线试听 `previewUrl`，只作为私玩原型的预览源，不下载、不缓存、不伪装成自有音频。正式公开运营前应替换为你拥有授权的音频来源。

## 验证

```bash
npm test
npm run build
```
