# 语桥 Web 安装与运行

本目录是软件项目根，所有命令先进入`software`。目标Windows 10/11 x64；ARM、Linux、macOS和原生安卓不在本次验证范围。

## 内容和能力

`web`页面、`server`后端、`shared`词典动作协议、`models`四词小权重、`scripts`运行下载工具、`tests`隔离检查、`database/schema.sql`10张空表。

内置实时谢谢、帮助、需要、我，不选动作。词典词数、数字人动作数与识别词数不同；不得将开发成绩当独立准确率。达标自训练结果有共用模型库逻辑，任务和原片按账号保存。公开包不含原作者私人任务和模型库，首次仅有随包基线；新增动作由使用者自行采集训练。

## 四岗独立演示代码

这四个模块是独立演示，不进入正式Web、数据库或实时识别链路，互不import。命令先在`software`目录执行：

| 角色 | 文件地址 | 独立运行 |
|---|---|---|
| 大模型工程师 | `server/llm/minicpm_camera.py` | `python server/llm/minicpm_camera.py --demo` |
| 视觉工程师 | `server/vision/yolo_segmentation.py` | `python server/vision/yolo_segmentation.py --demo` |
| AI应用工程师 | `server/service/fastapi_workflow.py` | `python server/service/fastapi_workflow.py --demo` |
| 项目经理 | `scripts/project_cockpit.py` | `python scripts/project_cockpit.py` |

运行产出在`outputs/four-role/`，已被Git忽略。完整代码、文件地址和展示行号见[docs/四岗独立代码.md](docs/四岗独立代码.md)；现场需要敲出的行见[docs/四岗代码摘录.md](docs/四岗代码摘录.md)，源码内用`# [敲]`标记。真实MiniCPM、YOLO和FastAPI服务需要各自依赖和模型；`--demo`只用标准库。不能把demo结果称为识别准确率或医院现场验收。

医院互助30词训练计划见[项目计划/医院互助场景训练计划_30动作_2026-11-11.xlsx](项目计划/医院互助场景训练计划_30动作_2026-11-11.xlsx)；`项目计划/项目进度数据.json`只是公开摘要，完整项目台账不随源码发布。该计划尚未实施，实时仍为谢谢、帮助、需要、我四词。

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
| 基础分类器 | 随包保留，缺失可运行`node scripts/setup-sign-assets.mjs`；[上游](https://github.com/wuli-git/gesture_languish_recognize)，固定版本与哈希见docs/assets/sign-word-source.json |
| 帮助、需要、我权重 | 随包weights.npz与manifest.json必须一并保留，是本项目自训练权重，没有可替代的公共通用模型，不需重训 |
| 数字人和固定动作 | 随包保留运行资源；[Anny来源](https://github.com/naver/anny)，见docs/assets/anny-export.json及web/public/avatar-candidates/anny-data-LICENSE.md |
| 安卓专用Tasks/WASM | 本轮不用。恢复安卓工作时再读prepare-local-vision.mjs及prepare-hbuilder.mjs，不是Web部署步骤 |

Ollama使用项目11435端口与models/ollama目录。直接在默认11434运行pull可能下载到另一目录，应使用本项目脚本。校验失败要重试正规来源，不以空文件代替模型。

## 第四步 启动与填写自己的API Key

Deploy完成依赖、模型检查和构建后启动。日常双击`Start-Yuqiao.cmd`，成功标志：

```text
Ready: http://127.0.0.1:5173/
```

首页`/`，学习`/learning.html`，训练`/training.html`，实时`/realtime.html`，词典`/sign-dictionary.html`。

注册自己的账号。密码登录验证码为5位字母数字、不分大小写。点击头像进入账号设置，填写**阿里云百炼中国内地**API Key；当前TTS为qwen3-tts-flash、Cherry。[获取Key方法](https://help.aliyun.com/zh/model-studio/get-api-key)。保存后试听验证权限与额度，调用可能计费。

Key按账号在后端DPAPI加密，不回显、不放前端。没有Key时不会使用原作者Key，识别仍可输出文字，云播报提示不可用。本机ASR处理语音输入；云TTS会发送播报文字，不上传摄像头画面。含云播报时不能称整套系统完全离线。

## 日常使用与验收

`Stop-Yuqiao.cmd`关闭本项目Web/API及关联子进程，保留MySQL和独立Ollama。下次Start复用配置。

接收人依次检查：首页和`/api/health`正常、database为mysql；数字人可显示；新账号注册登录和文字记录正常；现有动作可播放；文字规划模型可用；摄像头骨架和四词现场试用；停止后设备释放；自己的Key可试听。

浏览器设备权限需localhost/127.0.0.1安全上下文。本机开发服务不要直接暴露到公网；生产HTTPS与服务器部署另行设计。

## 本次交付验证

2026-11-10，在本机独立公开交付目录按package-lock执行npm ci成功（首次下载ECONNRESET，按原锁文件复用npm缓存重试成功）；TypeScript与Vite生产构建通过，四词权重/运行入口检查通过；另复用原机.venv-sign执行交付目录check-windows-runtime.py，四个模型加载与Python导入通过（不是新机安装或准确率测试）。19项后台隔离测试通过，包含账号、验证码、分区、模型库及新机配置入口。空库SQL与当前mysql-schema.mjs的10个定义逐项一致，不含业务数据。页面首轮16项通过、1项启动按钮等待超时、1项真实云语音跳过；超时项单独复核通过（1.2秒），故本次17个非付费用例均有通过记录，保留首轮偶发加载超时事实。页面使用测试账号、模拟摄像头和模拟语音，不代表真实用户现场效果。

本轮未在全新实体电脑完整安装Python/MySQL/Ollama，未替接收人调用真实Key或真实摄像头。数据库连接配置的自动化检查采用模拟连接；不把这些技术检查称为新机全部功能验收。

## 常见问题

- Node/Python找不到：重开终端，核对Node 24.x和`py -3.12`，不要混用32位或ARM环境。
- MySQL connection/schema unavailable：检查本机服务、自己的凭据和10表；不要创建SQLite替代。
- 复制旧mysql.json不可用：DPAPI不能跨Windows用户/机器直接迁移，重新用本机配置入口。
- 端口5173/5174冲突：确认所属项目后处理，启动器不会杀掉其他项目。
- 规划超时：检查11435的Ollama和qwen3:4b，保留原话，不能假装已转换。
- 源不可访问：使用上列官方源重试，保留版本和哈希，不绕过验证挑战。
- 新词未达标：按质量、分区、独立测试与旧动作回归处理，不因词典已有条目就宣称能识别。
- 旧研究报告路径不存在：公开包排除私人开发报告，不能补造；需要时向项目负责人索取授权资料。
