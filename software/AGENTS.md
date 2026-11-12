# 语桥软件接手约定

先读仓库根AGENTS.md和本目录README。本目录是可运行项目根，终端必须先进入software。

- 本次是公开源码交付，不携带原作者数据库、账号、录像、密钥、环境或私有Git历史。旧Gitee私有备份规则不适用于这里。
- `web`前端、`server`后端、`shared`词典/动作协议、`models`已有小权重、`scripts`运行与构建、`tests`隔离测试。React/TypeScript、Node、Python、MySQL；生产栈没有迁移为Spring或FastAPI，`server/service/fastapi_workflow.py`只是独立演示。
- 四岗独立演示代码：`server/llm/minicpm_camera.py`（MiniCPM观察）、`server/vision/yolo_segmentation.py`（YOLO分割）、`server/service/fastapi_workflow.py`（FastAPI编排）、`scripts/project_cockpit.py`（项目驾驶舱）。四者互不import，`--demo`各自可跑，产出在`outputs/four-role/`；不进入正式Web、数据库或实时识别链路。文件地址、展示行和需敲行见`docs/四岗独立代码.md`与`docs/四岗代码摘录.md`。
- Nginx默认HTTP `0.0.0.0:8080`，同一局域网可访问；`-Https`可选8443+本地CA，`-Dev`回Vite 5173；`Start-Public.cmd`/`-Public`为Cloudflare隧道；`Stop-Yuqiao.cmd`停cloudflared/Nginx/Node。Node只监听127.0.0.1:5174；默认Cookie非Secure，HTTPS/公网为Secure；`APP_ORIGINS`含本机+LAN IP/域名。运行目录必须是ASCII `%LOCALAPPDATA%\Yuqiao\nginx-runtime`，`runtime/web`为指向`web/dist`的junction；配置由`scripts/prepare-nginx.mjs`生成。手机HTTP可打开页面但摄像头受浏览器限制，手机摄像头需`-Https`并信任本地CA。防火墙脚本需管理员。
- 项目经理演示只依赖 Python 标准库；用 `Run-ProjectCockpit.cmd` 或 `py -3 scripts/project_cockpit.py`。不要复制其他电脑的 `.venv`/`.venv-sign`/`.venv-anny`，它们写死了原机器 Python 绝对路径，换机后用 Deploy-Web.cmd 重建。
- `npm run agent:brief`查看入口，`npm run agent:check`检查公共运行文件。这些命令不读取私人数据，不证明独立准确率或完整部署成功。
- 先按README安装MySQL并导入`database/schema.sql`的10张空表；Configure-Database.cmd只校验表可访问并写新机DPAPI连接配置，不创建/清空数据库、不覆盖已有配置。API Key在注册后的账号设置中填写。
- 发布只在新分支提交，遵循根目录的审阅流程，不直接推main、不自行合并。负责人姓名、飞书链接与比赛最终版本未确认，不能编造。
- 实时内置谢谢、帮助、需要、我；自训练达标结果有共用模型库逻辑，实际发布与加载须核验。模型分数、训练成绩与独立准确率不能混淆。保存不自动训练；不要替用户运行私人训练。
- 词典/数字人能展示不代表能识别。动作专业审核尚未完成；未知动作不得靠标签或语言模型造答案。
- 实时候选首次出现即播报；持势不复读，停止/后台/离开取消。未恢复整句拼接面板、实时麦克风或自动保存。
- 安卓工程保留但研发搁置；本次只验证Web。JDK、安卓SDK及HBuilderX不是Web依赖。
- 原始采集审计、逐轮开发报告、PPT和录像不在公开包；源码中旧开发报告路径可能仅作历史引用，不能因为找不到就补造证据。需要此类资料时由项目负责人提供授权位置。
- 变更说明与复现步骤更新本目录README，项目总台账按根约定维护，不新增大量任务文档。
