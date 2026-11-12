# Nginx（Windows）：HTTP / HTTPS / 局域网 / 公网

更新：2026-11-12。默认是 HTTP 局域网 8080；HTTPS 为可选 `-Https`；公网走
Cloudflare Tunnel。

## 入口

| 命令 | 入口 |
|---|---|
| `Start-Yuqiao.cmd` | `http://127.0.0.1:8080/`，局域网 `http://<IP>:8080/` |
| `Start-Yuqiao.cmd -Https` | `https://127.0.0.1:8443/`，局域网 `https://<IP>:8443/` |
| `Start-Yuqiao.cmd -Dev` | Vite `http://127.0.0.1:5173/` |
| `Start-Public.cmd` | 脚本打印的 `https://*.trycloudflare.com/` |
| `Start-Yuqiao.cmd -Public -PublicDomain 域名` + `CLOUDFLARE_TUNNEL_TOKEN` | `https://域名/` |
| `Stop-Yuqiao.cmd` | 停 cloudflared、Nginx、Node/Vite |

## 运行目录

Nginx for Windows 不能可靠读取中文路径。运行目录固定为 ASCII：

```text
%LOCALAPPDATA%\Yuqiao\nginx-runtime\
  nginx.exe
  certs\
  conf\yuqiao.conf
  conf\env.json
  logs\
  temp\
  acme\
  web\  →  junction 到 <项目>\web\dist
```

配置由 `scripts/prepare-nginx.mjs` 生成，不要手改 `conf/yuqiao.conf`。

## 证书

只有 `-Https` 会调用 `scripts/create-local-cert.ps1` 生成本地 CA 和服务器证书，SAN 包含
`yuqiao.local`、`localhost`、`127.0.0.1` 和当前局域网 IP。

如需手机摄像头（HTTPS）才需要以下步骤；默认 HTTP 局域网可直接打开 `http://<IP>:8080/`，但手机摄像头会被浏览器限制。

手机 HTTPS 访问：

1. 手机打开 `http://<电脑IP>:8080/yuqiao-ca.crt` 下载 CA。
2. iOS 安装描述文件并在“证书信任设置”启用；Android 安装 CA 证书。
3. 打开 `https://<电脑IP>:8443/`。

本机 Windows 可用 `scripts/trust-local-ca.ps1` 把 CA 加入当前用户受信任根；不会自动执行。

局域网 IP 变化后运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/create-local-cert.ps1 -Force
```

只换服务器证书，CA 不变。

## 防火墙

脚本不自动改防火墙。需要管理员运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/allow-lan-firewall.ps1
```

只允许 `LocalSubnet` 访问 8080/8443。公网/局域网使用前还应运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/harden-public-firewall.ps1
```

阻断 3306（MySQL）和 11434（Ollama）的入站。

## 检查

```powershell
npm run nginx:check
```

HTTPS 模式会自动读取 `.runtime-logs/nginx-runtime.json`，用本地自签证书检查。
公网临时隧道验证完请立即 `Stop-Yuqiao.cmd`。

## 常见问题

- **手机打不开**：确认同一 Wi-Fi/热点、IP 正确、防火墙允许 8443；手机是否已信任 CA。
- **证书警告**：手机未安装/未信任 `yuqiao-ca.crt`，或 IP 变化后未重新生成证书。
- **502/503**：Node API 没起或 5174 被占用；看 `logs/error.log` 和
  `.runtime-logs/nginx-api.stderr.log`。
- **POST 403**：`APP_ORIGINS` 不包含当前入口；先 `Stop-Yuqiao.cmd` 再启动。
- **公网隧道没 URL**：看 `.runtime-logs/cloudflared.stderr.log`；确认网络可访问
  Cloudflare。
- **临时 URL 泄露**：立即 `Stop-Yuqiao.cmd`；临时隧道不要长期运行。

## 公网

详细方案、Cloudflare 固定域名、路由器端口映射和 VPS 迁移见
[docs/公网部署.md](../docs/公网部署.md)。
