import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("正式小程序HTTPS部署配置", () => {
  it("提供PM2生产进程配置并只监听本地Node端口", () => {
    const ecosystemPath = resolve("ecosystem.config.cjs");

    expect(existsSync(ecosystemPath)).toBe(true);

    const ecosystem = readFileSync(ecosystemPath, "utf8");

    expect(ecosystem).toContain("brainsync");
    expect(ecosystem).toContain("dist-server/index.js");
    expect(ecosystem).toContain("PORT: process.env.PORT || \"3000\"");
  });

  it("提供Nginx HTTPS和小程序WebSocket反代模板", () => {
    const nginxPath = resolve("deploy/nginx/brainsync.conf.template");

    expect(existsSync(nginxPath)).toBe(true);

    const nginx = readFileSync(nginxPath, "utf8");

    expect(nginx).toContain("return 301 https://$host$request_uri");
    expect(nginx).toContain("ssl_certificate");
    expect(nginx).toContain("location /pvp-ws");
    expect(nginx).toContain("proxy_set_header Upgrade $http_upgrade");
    expect(nginx).toContain("proxy_pass http://127.0.0.1:3000");
  });

  it("服务器脚本不使用强制重置并包含构建、PM2和健康检查", () => {
    const deployScript = readFileSync(resolve("scripts/deploy-server.sh"), "utf8");
    const setupScript = readFileSync(resolve("scripts/setup-centos7-server.sh"), "utf8");

    expect(deployScript).not.toContain("reset --hard");
    expect(deployScript).toContain("git pull --ff-only");
    expect(deployScript).toContain("npm ci");
    expect(deployScript).toContain("npm run build");
    expect(deployScript).toContain("pm2 startOrReload ecosystem.config.cjs");
    expect(deployScript).toContain("/api/health");

    expect(setupScript).toContain("setup_20.x");
    expect(setupScript).toContain("SKIP_NGINX");
    expect(setupScript).toContain("yum install");
    expect(setupScript).toContain("nginx");
    expect(setupScript).toContain("pm2 startup");
  });

  it("部署文档覆盖已有Nginx服务器的非覆盖式配置路线", () => {
    const doc = readFileSync(resolve("docs/deployment-centos7-https.md"), "utf8");

    expect(doc).toContain("如果服务器已经有 Nginx");
    expect(doc).toContain("不要覆盖现有");
    expect(doc).toContain("SKIP_NGINX=1");
    expect(doc).toContain("server_name your-domain.com");
  });

  it("初始化脚本只补缺失项，不覆盖服务器已有运行环境", () => {
    const setupScript = readFileSync(resolve("scripts/setup-centos7-server.sh"), "utf8");
    const doc = readFileSync(resolve("docs/deployment-centos7-https.md"), "utf8");

    expect(setupScript).toContain("command_exists");
    expect(setupScript).toContain("install_package_if_missing");
    expect(setupScript).toContain("Node.js version is lower than 20");
    expect(setupScript).toContain("PM2 already exists");
    expect(setupScript).toContain("Nginx already exists");

    expect(doc).toContain("服务器已经有的就不要新建");
    expect(doc).toContain("只在不存在时创建");
    expect(doc).toContain("不要覆盖已有证书目录");
    expect(doc).toContain("不要覆盖已有配置文件");
  });
});
