# 语桥 Web 安装与运行

本目录是软件项目根，所有命令先进入`software`。目标Windows 10/11 x64；ARM、Linux、macOS和原生安卓不在本次验证范围。

## 2026-11-22 MediaPipe视频实操

[详细操作手册](docs/mediapipe-demo/MediaPipe视频选段与骨架提取详细操作手册.md)和[逐字稿修改版](docs/mediapipe-demo/逐字稿_MediaPipe选段与骨架演示修改版.docx)已按用户要求收录。先进入本software目录并准备本机`.venv-sign`，再运行：

```powershell
& ".\.venv-sign\Scripts\python.exe" -B ".\scripts\mediapipe-demo.py" check
```

脚本提供可视化select、按秒mark、骨架extract、模型test和同步play；详细命令与每个按键见手册。导出原片段、骨架叠加、左右对照、截图和178维特征，不调用数据库、不自动训练、不改活动权重。真人媒体只保存在本机data目录。正式训练仍通过现有训练页面，由后台重新校验原片与分区。

验证：`tests/python/check-mediapipe-demo.py`使用程序生成的非人物录像，检查范围、覆盖保护、哈希、三路视频、特征和镜像转换，已在公开副本通过。逐字稿通过12页渲染检查。GUI窗口按键、真实摄像头与真人跟踪未完成现场验收。

## 2026-11-21 更新

- 手语转文字提供录像确认识别和独立实时识别。整段中文由后台整理。
- 训练页按实际资料数量训练和测试，细分录像识别与自动收尾成绩。
- Windows 浏览器可打开独立安卓预览 `/android.html`。

[查看完整更新表](docs/更新说明.md)。

## 内容和能力

`web`页面、`server`后端、`shared`词典动作协议、`models`本机自行配置的识别模型、`scripts`运行下载工具、`tests`隔离检查、`database/schema.sql`10张空表。

实时识别不选动作，类别以本机有效模型为准。词典词数、数字人动作数与识别词数不同；不得将开发成绩当独立准确率。达标自训练结果有共用模型库逻辑，任务和原片按账号保存。交付分支含公开六词权重及v3g实验版本。模型详情见[权重说明](models/unified-sign/README.md)。可先采集和联合训练；缺模型时识别明确不可用，不伪装已识别。

## 四岗独立演示代码

演示入口复用项目的分区、模型评估和文字匹配。命令先在`software`目录执行。

| 角色 | 文件地址 | 独立运行 |
|---|---|---|
| 大模型工程师 | `scripts/four-role-samples.mjs` | `node scripts/four-role-samples.mjs --help` |
| 视觉工程师 | `scripts/mediapipe-demo.py` | `.\.venv-sign\Scripts\python.exe -B scripts/mediapipe-demo.py check` |
| AI应用工程师 | `scripts/four-role-avatar.mjs` | `node scripts/four-role-avatar.mjs --text "我需要帮助"`（需启动语桥后端） |
| 项目经理 | `scripts/project_cockpit.py` | `Run-ProjectCockpit.cmd` 或 `py -3 scripts/project_cockpit.py` |

### Windows 换机运行（四岗演示代码）

- 项目经理模块只依赖 Python 标准库，**不需要 `.venv`**。双击 `Run-ProjectCockpit.cmd`，它会自动寻找本机的 `py -3` 或 `python`。
- 不要把其他电脑的 `.venv`、`.venv-sign`、`.venv-anny` 整个复制过来；这些目录写死了原机器的 Python 绝对路径，换机后会报 `did not find executable ...`。新机按本 README 重新安装依赖。
- 出现 `did not find executable at C:/Users/.../python.exe` 时，说明用了旧的虚拟环境；改用 `Run-ProjectCockpit.cmd` 或系统 Python 即可。

视觉岗的选段与导出步骤见[操作手册](docs/mediapipe-demo/MediaPipe视频选段与骨架提取详细操作手册.md)，其他岗位的产出位于`outputs/four-role/`。完整代码、文件地址和展示行号见[docs/四岗独立代码.md](docs/四岗独立代码.md)；现场需要敲出的行见[docs/四岗代码摘录.md](docs/四岗代码摘录.md)，源码内用`# [敲]`标记。视觉岗使用 .venv-sign 中的 MediaPipe、OpenCV 和 NumPy。不能把demo结果称为识别准确率或医院现场验收。

医院互助30词训练计划见[项目计划/医院互助场景训练计划_30动作_2026-11-11.xlsx](项目计划/医院互助场景训练计划_30动作_2026-11-11.xlsx)；`项目计划/项目进度数据.json`只是公开摘要，完整项目台账不随源码发布。数字人资产保留，固定场景已取消；识别范围由本机训练模型决定。

## Nginx 一键启动（HTTP 局域网）

默认由 Nginx 监听 `0.0.0.0:8080` 并反代 `/api/` 到 Node `127.0.0.1:5174`，同一 Wi-Fi/热点下的手机或电脑可访问：

```text
Start-Yuqiao.cmd          # 默认 HTTP 局域网 8080
Start-Yuqiao.cmd -Https   # 可选 HTTPS 8443 + 本地 CA
Start-Yuqiao.cmd -Dev     # Vite 开发 5173
Start-Public.cmd          # Cloudflare 临时公网隧道
Stop-Yuqiao.cmd           # 停 cloudflared、Nginx、Node
```

成功标志类似：

```text
Ready: http://127.0.0.1:8080/ -- LAN: http://<电脑IP>:8080/ -- sign in, then Settings > API Key
```

说明：

- 默认 HTTP 只用于本机和同一局域网，不是公网。
- 手机通过 HTTP 可以打开页面、登录、词典、学习和记录；手机摄像头需要 HTTPS，使用 `-Https` 并在手机信任 `http://<电脑IP>:8080/yuqiao-ca.crt`。
- 防火墙脚本需管理员：`scripts/allow-lan-firewall.ps1`、`scripts/harden-public-firewall.ps1`。
- 详细说明见[docs/Nginx反向代理.md](docs/Nginx反向代理.md)，公网见[docs/公网部署.md](docs/公网部署.md)。
- 检查：`npm run nginx:prepare`、`npm run nginx:check`。

## 所需软件

| 软件 | 版本和下载 | 用途 |
|---|---|---|
| Node.js | 24.x，原机24.21.0；[官方](https://nodejs.org/en/download) | Web/API，缺失时Deploy尝试winget安装 |
| Python | 3.12 x64；[官方](https://www.python.org/downloads/windows/) | 推理、ASR和CPU训练环境 |
| MySQL Community Server | 8.0，原机8.0.46；[官方归档](https://downloads.mysql.com/archives/community/) | 使用自己的本机账号密码 |
| Ollama | [Windows官方下载](https://ollama.com/download/windows) | 本机文字动作规划 |
| VC++运行库 | x64；[微软](https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist) | 本机二进制依赖 |
| Edge或Chrome | 当前稳定版 | 摄像头与WebGL |
| winget | [微软说明](https://learn.microsoft.com/windows/package-manager/winget/) | 自动安装缺失软件 |

Web不需要JDK、安卓SDK、HBuilderX。大模型约2.8GB，依赖和CPU训练环境另需数GB；内存建议至少16GB，速度仍取决于实际设备。初次安装需网络、磁盘和必要的UAC确认。

## 第一步 创建自己的空数据库

安装MySQL并设置自己的管理员密码，确认服务运行。通过交互密码登录，避免把密码写在命令行：

```powershell
mysql -h 127.0.0.1 -P 3306 -u root -p
```

先执行`SHOW DATABASES;`。**只有不存在业务库yuqiao的新环境才导入**：

```sql
source D:/Yuqiao/software/database/schema.sql;
USE yuqiao;
SHOW TABLES;
```

路径按实际目录修改，使用正斜杠。SQL包含建库和建表，不含DROP、INSERT、旧账号、会话或密钥。应出现10张表：users、sessions、records、profiles、voices、practice_attempts、sign_samples、sample_number_counters、sample_numbers、video_save_keys。

已有同名库不重复导入、不清空。建议自行创建项目运行账号，只授予`yuqiao.*`的SELECT、INSERT、UPDATE、DELETE；密码由使用者设置，不用原作者密码。后端不会自动创建缺失表。

## 第二步 准备依赖和本机凭据

双击仓库根或本目录的`Deploy-Web.cmd`。它安装缺失软件，执行npm ci，再在缺少连接配置时提示输入自己的MySQL用户名、端口和隐藏密码。MySQL服务和10表须预先准备。

也可手动先配置：

```powershell
npm.cmd ci
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/configure-local-mysql.ps1
```

成功应显示`checkedTables: 10`与`credentialStorage: Windows DPAPI`。生成`data/secrets/mysql.json`和`data/mysql-active.json`，均被Git忽略。配置工具只读取空表检查并保存新机密文，不创建/迁移/清空数据库。已有mysql.json拒绝覆盖；变更前由维护者保留原配置，不在升级中静默替换。

`database/mysql.example.json`仅示意字段，不能直接当作已加密配置。DPAPI密文绑定Windows用户和机器，换电脑必须重新配置。

Deploy随后准备三个隔离环境：`.venv`对应requirements-speech.txt，`.venv-sign`对应requirements-sign-lock.txt，`.venv-anny`为历史名称、当前用于CPU训练（Torch 2.7.1 CPU、NumPy 2.5.4）。不复制旧电脑环境，不自动训练录像。

## 第三步 下载大模型

Deploy会调用下列准备命令。需要补下载时在software执行：

| 资源 | 方法与来源 |
|---|---|
| Qwen3:4b，约2.5GB | `powershell -NoProfile -File scripts/start-local-language.ps1 -Pull`；[模型页](https://ollama.com/library/qwen3:4b) |
| SenseVoice Small INT8，约239MB | `node scripts/download-speech-mirror.mjs`；[原始仓库](https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17)，脚本用hf-mirror镜像并按清单哈希验证 |
| 手部与身体跟踪 | 安装`.venv-sign`的MediaPipe依赖；[来源](https://github.com/google-ai-edge/mediapipe)。Web推理走Python |
| 统一动作模型 | 不随公开源码分发。自行训练会生成本机活动模型；使用已有合法模型时需核对文件哈希、类别表和特征协议，不能只改文件名 |
| 数字人和固定动作 | 随包保留运行资源；[Anny来源](https://github.com/naver/anny)，见docs/assets/anny-export.json及web/public/avatar-candidates/anny-data-LICENSE.md |
| 安卓专用Tasks/WASM | 本轮不用。恢复安卓工作时再读prepare-local-vision.mjs及prepare-hbuilder.mjs，不是Web部署步骤 |

Ollama使用项目11435端口与models/ollama目录。直接在默认11434运行pull可能下载到另一目录，应使用本项目脚本。校验失败要重试正规来源，不以空文件代替模型。

## 第四步 启动与填写自己的API Key

Deploy完成依赖和构建后启动；未提供识别权重时可先采集/训练，不能进行摄像头动作识别。日常双击`Start-Yuqiao.cmd`，成功标志：

```text
Ready: http://127.0.0.1:8080/
```

首页`/`，数字人显示`/avatar`，摄像头`/camera`，训练`/training.html`，学习`/learning.html`，实时`/realtime.html`，词典`/sign-dictionary.html`；旧医院场景地址仅跳转首页。

注册自己的账号。密码登录验证码为5位字母数字、不分大小写。点击头像进入账号设置，填写**阿里云百炼中国内地**API Key；当前TTS为qwen3-tts-flash、Cherry。[获取Key方法](https://help.aliyun.com/zh/model-studio/get-api-key)。保存后试听验证权限与额度，调用可能计费。

Key按账号在后端DPAPI加密，不回显、不放前端。没有Key时不会使用原作者Key，识别仍可输出文字，云播报提示不可用。本机ASR处理语音输入；云TTS会发送播报文字，不上传摄像头画面。含云播报时不能称整套系统完全离线。

## 日常使用与验收

`Stop-Yuqiao.cmd`关闭本项目Web/API及关联子进程，保留MySQL和独立Ollama。下次Start复用配置。

接收人依次检查：首页和`/api/health`正常、database为mysql；数字人可显示；新账号注册登录和文字记录正常；现有动作可播放；文字规划模型可用；配置好本机模型后的摄像头骨架与对应动作现场试用；停止后设备释放；自己的Key可试听。

浏览器设备权限需localhost/127.0.0.1安全上下文。本机开发服务不要直接暴露到公网；生产HTTPS与服务器部署另行设计。

## 本次交付验证

2026-11-18公开源码验证范围以[本次验证记录](docs/assets/public-update-2026-11-18.json)为准。以下11月16日记录仅是旧版本历史，不代表已移除旧模型的新机识别可直接使用。


2026-11-16，在公开副本中完成生产构建与公开入口检查。34个定向后台用例均有通过结果；首次因公开目录没有Python环境出现2失败/2跳过，随后复用原机Python环境重跑实时相关12项，12/12通过。26项浏览器检查（含1项账号准备）通过，覆盖三端、训练文件夹和段落流程；Python当前词考试5项、段落边界13项通过。未复制Python环境，没有使用私人录像或真实付费语音。

这次是定向技术验证，不代表全量端到端、新机安装或真人准确率验收。摘要见[公开更新验证](docs/assets/public-update-2026-11-16.json)。


2026-11-10，在本机独立公开交付目录按package-lock执行npm ci成功（首次下载ECONNRESET，按原锁文件复用npm缓存重试成功）；TypeScript与Vite生产构建通过，四词权重/运行入口检查通过；另复用原机.venv-sign执行交付目录check-windows-runtime.py，四个模型加载与Python导入通过（不是新机安装或准确率测试）。19项后台隔离测试通过，包含账号、验证码、分区、模型库及新机配置入口。空库SQL与当前mysql-schema.mjs的10个定义逐项一致，不含业务数据。页面首轮16项通过、1项启动按钮等待超时、1项真实云语音跳过；超时项单独复核通过（1.2秒），故本次17个非付费用例均有通过记录，保留首轮偶发加载超时事实。页面使用测试账号、模拟摄像头和模拟语音，不代表真实用户现场效果。

本轮未在全新实体电脑完整安装Python/MySQL/Ollama，未替接收人调用真实Key或真实摄像头。数据库连接配置的自动化检查采用模拟连接；不把这些技术检查称为新机全部功能验收。

## 常见问题

- Node/Python找不到：重开终端，核对Node 24.x和`py -3.12`，不要混用32位或ARM环境。
- MySQL connection/schema unavailable：检查本机服务、自己的凭据和10表；不要创建SQLite替代。
- 复制旧mysql.json不可用：DPAPI不能跨Windows用户/机器直接迁移，重新用本机配置入口。
- 端口8080/8443/5174冲突：确认所属项目后处理，启动器不会杀掉其他项目。
- 规划超时：检查11435的Ollama和qwen3:4b，保留原话，不能假装已转换。
- 源不可访问：使用上列官方源重试，保留版本和哈希，不绕过验证挑战。
- 新词未达标：按质量检查和当前词考试结果补充资料；旧词回归不再是用户前置要求，不因词典已有条目就宣称能识别。
- 旧研究报告路径不存在：公开包排除私人开发报告，不能补造；需要时向项目负责人索取授权资料。
