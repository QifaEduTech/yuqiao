# Nginx 反向代理：HTTP 局域网（默认）与可选 HTTPS

更新：2026-11-12。按用户最新决定，默认 **HTTP 局域网 8080**，同一 Wi-Fi/热点下的
手机或电脑可以直接访问；HTTPS 改为可选 `-Https`，公网隧道另见[公网部署](公网部署.md)。

## 模式

| 模式 | 启动方式 | 入口 | 说明 |
|---|---|---|---|
| HTTP 局域网（默认） | `Start-Yuqiao.cmd` | `http://127.0.0.1:8080/` 或 `http://局域网IP:8080/` | Nginx 监听 `0.0.0.0:8080`，无证书 |
| HTTPS 局域网（可选） | `Start-Yuqiao.cmd -Https` | `https://127.0.0.1:8443/` 或 `https://局域网IP:8443/` | 本地 CA + 服务器证书 |
| 开发模式 | `Start-Yuqiao.cmd -Dev` | `http://127.0.0.1:5173/` | Vite，仅本机 |
| 公网临时隧道 | `Start-Public.cmd` | `https://*.trycloudflare.com/` | Cloudflare 快速隧道 |
| 公网固定域名 | `-Public -PublicDomain 域名` + `CLOUDFLARE_TUNNEL_TOKEN` | `https://域名/` | 命名隧道 |

`-Http` 仍可用，等同默认 HTTP；`Stop-Yuqiao.cmd` 停止 cloudflared、Nginx、Node/Vite。

**HTTP 局域网的限制**：手机通过 `http://<电脑IP>:8080/` 可以打开页面、登录、词典、
学习和记录，但浏览器只允许 `localhost`/HTTPS 使用摄像头。手机的实时手语/摄像头
需要 HTTPS（`-Https`）或公网 HTTPS 隧道。电脑本机用 `http://127.0.0.1:8080/`
摄像头可用。

## 架构

```text
浏览器
  ├─ http://127.0.0.1:8080   → Nginx → 静态 web/dist / /api → Node 5174
  ├─ http://局域网IP:8080     → 同上（同一 Wi-Fi/热点）
  ├─ https://127.0.0.1:8443  → 可选 TLS（-Https）
  └─ https://公网域名         → Cloudflare Tunnel → Nginx HTTP 127.0.0.1:8080
```

Node API 始终只监听 `127.0.0.1:5174`；对外只有 Nginx/Cloudflare 隧道。

## 为什么使用 ASCII 运行目录

Nginx for Windows 对非 ASCII 路径支持不可靠，项目路径含中文时会报
`CreateFile() ... failed`。运行目录固定为：

```text
%LOCALAPPDATA%\Yuqiao\nginx-runtime\
  nginx.exe
  conf\yuqiao.conf
  conf\env.json
  logs\
  temp\
  web\  →  junction 到 <项目>\web\dist
  certs\（只有 -Https 时才使用）
```

配置由 `scripts/prepare-nginx.mjs` 生成，不要手改 `conf/yuqiao.conf`。

## 启动与停止

```text
Start-Yuqiao.cmd          # 默认 HTTP 局域网 8080
Start-Yuqiao.cmd -Https   # 可选 HTTPS 8443
Start-Yuqiao.cmd -Dev     # Vite 5173
Start-Public.cmd          # Cloudflare 快速公网隧道
Stop-Yuqiao.cmd           # 停 cloudflared、Nginx、Node/Vite
```

默认 HTTP 启动流程：

1. 确保 `web/dist` 存在；缺失时执行一次 `npm run build`。
2. 检查/安装 Nginx（`scripts/install-nginx.ps1`，固定 1.30.6 + SHA256）。
3. 准备 ASCII runtime、复制 `nginx.exe`、建立 `web` junction。
4. 取得当前局域网 IP，生成 HTTP-only 配置，监听 `0.0.0.0:8080`。
5. 以 `APP_ORIGINS=http://127.0.0.1:8080,http://localhost:8080,http://<LAN IP>:8080`
   启动 Node API，`COOKIE_SECURE=false`。
6. 启动 Nginx，等待 `http://127.0.0.1:8080/api/health` 通过。

`Stop-Yuqiao.cmd` 先停 cloudflared（如果有），再优雅停 Nginx，再停 Node/Vite；
只停止可核验的本项目进程，不停 MySQL、Ollama 或别的项目。

## 局域网访问

1. 确认手机和电脑连同一 Wi-Fi/热点。
2. 电脑上运行 `Start-Yuqiao.cmd`，看到类似：
   ```text
   Ready: http://127.0.0.1:8080/ -- LAN: http://<电脑IP>:8080/
   ```
3. 手机浏览器打开 `http://<电脑IP>:8080/`。
4. 如果打不开，检查 Windows 防火墙；需要管理员运行：
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/allow-lan-firewall.ps1
   ```
   它只允许 `LocalSubnet` 访问 8080/8443，不开放公网。

当前热点网络可能被 Windows 归为 Public；脚本会提示 Public 防火墙状态。不要为了
省事直接关闭防火墙。

## 可选 HTTPS / 手机摄像头

只有需要手机摄像头或 HTTPS 时才用 `-Https`：

1. 首次会运行 `scripts/create-local-cert.ps1`，生成本地 CA 和服务器证书，SAN 包含
   `yuqiao.local`、`localhost`、`127.0.0.1` 和当前局域网 IP。
2. 手机先打开 `http://<电脑IP>:8080/yuqiao-ca.crt` 下载 CA，安装并信任。
3. 打开 `https://<电脑IP>:8443/`。
4. 本机 Windows 可运行 `scripts/trust-local-ca.ps1` 信任 CA，避免浏览器警告；不会自动执行。
5. 局域网 IP 变化后运行 `scripts/create-local-cert.ps1 -Force`，只换服务器证书，CA 不变。

## 关键配置

生成文件：`%LOCALAPPDATA%\Yuqiao\nginx-runtime\conf\yuqiao.conf`

| 配置 | 默认 HTTP | 可选 HTTPS | 原因 |
|---|---|---|---|
| `listen` | `0.0.0.0:8080` | `0.0.0.0:8443 ssl` + HTTP 8080 跳转 | 局域网访问 |
| `root` | `runtime/web` → `web/dist` | 同左 | ASCII 路径 |
| `client_max_body_size` | `64m` | `64m` | 覆盖 32MB 视频上传 |
| `proxy_read_timeout` | `300s` | `300s` | ASR/TTS/训练轮询 |
| `proxy_buffering` | `off`（`/api/`） | `off`（`/api/`） | 音频和长请求不等待缓冲 |
| `COOKIE_SECURE` | `false` | `true` | HTTP 不能设 Secure Cookie |
| `APP_ORIGINS` | 本机 + 局域网 IP | 再加 HTTPS 来源和域名 | Node 的 Origin 校验仍生效 |

公网固定域名/临时隧道会额外启用 `/api/auth/` 3r/s、`/api/` 20r/s 限流。

## 验证

```powershell
npm run nginx:check
```

自动读取 `.runtime-logs/nginx-runtime.json`：HTTP 模式检查 `http://127.0.0.1:8080`；
HTTPS 模式检查 `https://127.0.0.1:8443`（本地自签证书）。

检查内容：

- `/api/health` 为 `service=yuqiao`、`database=mysql`，origins 含当前入口。
- `/`、`/learning.html`、`/realtime.html`、`/sign-dictionary.html` 返回 HTML 200。
- 伪造 Origin 的 POST 返回 403。
- 缺少 `X-Yuqiao-Request` 的 POST 返回 403。
- 正确 Origin 不被 403。

手工补充：

1. 同一局域网手机打开 `http://<电脑IP>:8080/`。
2. 登录后刷新，HTTP 会话保持。
3. 上传 30 秒录像，确认不是 Nginx 413。
4. `Stop-Yuqiao.cmd` 后 8080/8443/5174 释放，MySQL/Ollama 不受影响。

本机 2026-11-12 实测：默认 HTTP 8080 本机和局域网 IP 访问通过；`npm run nginx:check`
9 项通过；`-Https` 8443、Secure Cookie、HTTP 301 通过；Cloudflare 快速隧道验证后已停止。
证据见[nginx-https-public-2026-11-12.json](assets/nginx-https-public-2026-11-12.json)。

## 回退

- HTTP 模式出问题：`Stop-Yuqiao.cmd`，再 `Start-Yuqiao.cmd`。
- 需要 HTTPS：`Start-Yuqiao.cmd -Https`。
- 开发调试：`Start-Yuqiao.cmd -Dev`，Vite 5173。
- 删除 `%LOCALAPPDATA%\Yuqiao\nginx-runtime` 可重置 Nginx/证书状态；不删除
  `web/dist`、账号、录像或模型。
- 不要手动改运行目录里的 `yuqiao.conf`；改 `scripts/prepare-nginx.mjs` 后重新生成。

## 安全边界

- 默认只监听本机和同一局域网；不是公网。
- 公网隧道只暴露 Nginx 8080，不暴露 Node 5174、MySQL 3306、Ollama 11434。
- MySQL 当前监听所有接口；局域网/公网使用前，建议管理员运行
  `scripts/harden-public-firewall.ps1` 阻断 3306/11434。
- 临时 `trycloudflare.com` URL 是公开的，验证完立即 `Stop-Yuqiao.cmd`。
- 更多公网方案见[公网部署](公网部署.md)。
