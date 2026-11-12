#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
04 项目经理：项目驾驶舱（独立可运行）

用途
----
读取项目计划 JSON、医院互助 30 词工作簿和另外三个模块的输出，生成一份
项目例会用的一页报告：
    - 30 词计划进度：总数、内置、新增、已有示范
    - 四岗模块输出是否真的存在
    - 数据与验证缺口
    - 下一步建议

独立运行
--------
    Run-ProjectCockpit.cmd                  # Windows 自动找本机 Python 3.8+
    py -3 scripts/project_cockpit.py
    python scripts/project_cockpit.py
    python scripts/project_cockpit.py --live          # 额外检查三个模块的健康地址

只依赖 Python 标准库，不需要 .venv。不要把其他电脑的 .venv 复制过来，
它里面写死了原机器的 Python 绝对路径。

输出
----
    outputs/four-role/04_项目经理/standup.md
    outputs/four-role/04_项目经理/standup.html
    outputs/four-role/04_项目经理/standup.json

边界
----
- 只报告计划和证据状态，不把“文件存在”写成“功能完成”。
- 不读取私人录像、数据库或模型权重。
"""

from __future__ import annotations

import argparse
import html
import json
import sys
import time
import urllib.request
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1
MODULE_ID = "04_项目经理"
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


class CockpitError(RuntimeError):
    """计划文件或工作簿结构不符合预期。"""


def enable_utf8() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def read_xlsx_rows(path: Path, sheet_name: str) -> list[dict[str, str]]:
    """只依赖标准库读取 xlsx：定位工作表、共享字符串、表头和数据行。"""
    if not path.exists():
        raise CockpitError(f"工作簿不存在：{path}")
    with zipfile.ZipFile(path) as archive:
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        rel_map = {item.attrib["Id"]: item.attrib["Target"] for item in rels}
        sheet_target = None
        for sheet in workbook.findall(f".//{NS}sheet"):
            if sheet.attrib.get("name") == sheet_name:
                rid = sheet.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
                sheet_target = rel_map.get(rid)
                break
        if not sheet_target:
            raise CockpitError(f"找不到工作表：{sheet_name}")
        target = sheet_target.lstrip("/")
        if not target.startswith("xl/"):
            target = "xl/" + target
        shared: list[str] = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            for item in root.findall(f"{NS}si"):
                shared.append("".join(node.text or "" for node in item.iter(f"{NS}t")))
        sheet = ET.fromstring(archive.read(target))

    def value_of(cell: ET.Element) -> str:
        kind = cell.attrib.get("t")
        if kind == "inlineStr":
            return "".join(node.text or "" for node in cell.iter(f"{NS}t"))
        node = cell.find(f"{NS}v")
        if node is None or node.text is None:
            return ""
        if kind == "s":
            return shared[int(node.text)]
        return node.text

    rows: list[list[str]] = []
    for row in sheet.findall(f".//{NS}row"):
        cells: dict[int, str] = {}
        for cell in row.findall(f"{NS}c"):
            ref = cell.attrib.get("r", "")
            letters = "".join(ch for ch in ref if ch.isalpha())
            index = 0
            for ch in letters:
                index = index * 26 + (ord(ch.upper()) - 64)
            cells[index - 1] = value_of(cell)
        if cells:
            rows.append([cells.get(i, "") for i in range(max(cells) + 1)])

    header_index = next((i for i, row in enumerate(rows) if row and row[0] in ("序号", "任务")), None)
    if header_index is None:
        raise CockpitError(f"工作表 {sheet_name} 找不到表头")
    header = rows[header_index]
    data = []
    for row in rows[header_index + 1 :]:
        if not any(row):
            continue
        data.append({header[i]: row[i] if i < len(row) else "" for i in range(len(header))})
    return data


# ===== 展示代码 START =====
def compute_stats(actions: list[dict[str, str]], tasks: list[dict[str, str]]) -> dict[str, Any]:
    """把工作簿行变成例会能直接读的数字，不把空状态算成完成。"""
    total = len(actions)                                                  # [敲]
    builtin = sum(1 for row in actions if row.get("内置识别") == "已有内置识别")  # [敲]
    new_targets = total - builtin                                         # [敲]
    animated = sum(1 for row in actions if str(row.get("数字人示范", "")).startswith("已有"))  # [敲]
    status = Counter(row.get("跟进状态", "未填") for row in actions)       # [敲]
    task_status = Counter(row.get("状态", "未填") for row in tasks)        # [敲]
    return {                                                              # [敲]
        "total": total,
        "builtin": builtin,
        "newTargets": new_targets,
        "animated": animated,
        "actionStatus": dict(status),
        "taskStatus": dict(task_status),
        "completionClaimAllowed": False,
        "note": "数字来自计划表；内置识别和已有示范都不等于连续段落验收。",
    }


def render_markdown(
    plan: dict[str, Any],
    stats: dict[str, Any],
    outputs: list[dict[str, Any]],
    health: list[dict[str, Any]] | None,
) -> str:
    """生成一页 Markdown 例会报告。"""
    lines = [                                                            # [敲]
        "# 语桥四岗项目例会 · 自动生成",
        "",
        f"- 生成时间：{time.strftime('%Y-%m-%d %H:%M:%S')}",
        f"- 项目计划更新：{plan.get('updated', '未知')}",
        f"- 当前下一步：{plan.get('nextCaption', '未填写')}",
        "",
        "## 医院互助 30 词计划",
        "",
        f"- 场景动作总数：{stats['total']}",                               # [敲]
        f"- 已有内置识别：{stats['builtin']}",                             # [敲]
        f"- 计划新增识别：{stats['newTargets']}",                          # [敲]
        f"- 已有数字人示范：{stats['animated']}（未专业验收）",             # [敲]
        f"- 跟进状态：{json.dumps(stats['actionStatus'], ensure_ascii=False)}",
        "",
        "## 四岗输出",
        "",
    ]                                                                    # [敲]
    for item in outputs:                                                 # [敲]
        mark = "存在" if item["exists"] else "缺失"
        lines.append(f"- {item['role']}：{mark}｜{item['path']}")         # [敲]
    if health:
        lines += ["", "## 健康检查", ""]
        for item in health:
            lines.append(f"- {item['role']}：{item['status']}（{item['url']}）")
    lines += [
        "",
        "## 边界",
        "",
        "- 计划数字不等于识别准确率。",                                    # [敲]
        "- 缺失输出如实报缺，不按“文件存在”推断完成。",                      # [敲]
        "- 医院互助只做沟通辅助，不替代诊断、挂号受理或医疗决策。",          # [敲]
    ]
    return "\n".join(lines) + "\n"                                      # [敲]
# ===== 展示代码 END =====


def read_plan(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"updated": "未找到", "nextCaption": "未找到项目计划 JSON"}
    return json.loads(path.read_text(encoding="utf-8"))


def read_module_outputs(root: Path) -> list[dict[str, Any]]:
    candidates = [
        ("大模型工程师", root / "outputs/four-role/01_大模型工程师/observation.json"),
        ("视觉工程师", root / "outputs/four-role/02_视觉工程师/segmentation.json"),
        ("AI应用工程师", root / "outputs/four-role/03_AI应用工程师/workflow.json"),
    ]
    result = []
    for role, path in candidates:
        exists = path.exists()
        summary = ""
        if exists:
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                summary = data.get("status") or data.get("mode") or "已生成"
            except Exception:
                summary = "存在但无法解析"
        result.append(
            {
                "role": role,
                "path": str(path.relative_to(root)).replace("\\", "/"),
                "exists": exists,
                "summary": summary,
                "mtime": time.strftime("%Y-%m-%d %H:%M", time.localtime(path.stat().st_mtime)) if exists else None,
            }
        )
    return result


def check_health(urls: list[tuple[str, str]]) -> list[dict[str, str]]:
    result = []
    for role, url in urls:
        try:
            with urllib.request.urlopen(url, timeout=1.5) as response:
                result.append({"role": role, "url": url, "status": f"在线 {response.status}"})
        except Exception:
            result.append({"role": role, "url": url, "status": "离线"})
    return result


def render_html(markdown: str, stats: dict[str, Any], outputs: list[dict[str, Any]]) -> str:
    cards = "".join(
        f"<div class='card'><b>{html.escape(item['role'])}</b>"
        f"<span class='{'ok' if item['exists'] else 'bad'}'>{'存在' if item['exists'] else '缺失'}</span>"
        f"<p>{html.escape(item['path'])}</p></div>"
        for item in outputs
    )
    return f"""<!doctype html>
<html lang="zh-CN"><meta charset="utf-8">
<title>语桥四岗项目例会</title>
<style>
body{{font-family:"Microsoft YaHei",sans-serif;max-width:960px;margin:40px auto;color:#253C3B;line-height:1.7}}
h1{{color:#176A64}} .grid{{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}}
.metric{{background:#EFF6F3;border-radius:10px;padding:16px}} .metric b{{font-size:26px;color:#176A64}}
.card{{border:1px solid #D9E2DF;border-radius:10px;padding:12px}} .ok{{color:#176A64}} .bad{{color:#B3261E}}
pre{{white-space:pre-wrap;background:#F7FAF9;padding:16px;border-radius:10px}}
</style>
<h1>语桥四岗项目例会</h1>
<div class="grid">
<div class="metric">30词总数<br><b>{stats['total']}</b></div>
<div class="metric">内置识别<br><b>{stats['builtin']}</b></div>
<div class="metric">计划新增<br><b>{stats['newTargets']}</b></div>
<div class="metric">已有示范<br><b>{stats['animated']}</b></div>
</div>
<h2>四岗输出</h2><div class="grid">{cards}</div>
<h2>例会报告原文</h2><pre>{html.escape(markdown)}</pre>
</html>"""


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description="04 项目经理：项目驾驶舱")
    parser.add_argument("--plan", default=str(root / "项目计划/项目进度数据.json"))
    parser.add_argument("--workbook", default=str(root / "项目计划/医院互助场景训练计划_30动作_2026-11-11.xlsx"))
    parser.add_argument("--root", default=str(root), help="项目根目录")
    parser.add_argument("--live", action="store_true", help="检查三个模块健康地址")
    parser.add_argument("--out", default=str(Path(__file__).resolve().parents[1] / "outputs/four-role/04_项目经理"))
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    enable_utf8()
    args = parse_args(argv)
    root = Path(args.root)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        plan = read_plan(Path(args.plan))
        actions = read_xlsx_rows(Path(args.workbook), "30个动作")
        tasks = read_xlsx_rows(Path(args.workbook), "执行计划")
        tasks = [row for row in tasks if str(row.get("任务", "")).startswith("T")]
        stats = compute_stats(actions, tasks)
    except CockpitError as exc:
        print(f"[失败] {exc}", file=sys.stderr)
        return 2

    outputs = read_module_outputs(root)
    health = None
    if args.live:
        health = check_health([
            ("大模型工程师", "http://127.0.0.1:8011/health"),
            ("视觉工程师", "http://127.0.0.1:8012/health"),
            ("AI应用工程师", "http://127.0.0.1:8010/health"),
        ])

    markdown = render_markdown(plan, stats, outputs, health)
    (out_dir / "standup.md").write_text(markdown, encoding="utf-8")
    (out_dir / "standup.html").write_text(render_html(markdown, stats, outputs), encoding="utf-8")
    (out_dir / "standup.json").write_text(
        json.dumps(
            {"schema_version": SCHEMA_VERSION, "module": MODULE_ID, "plan": plan, "stats": stats, "outputs": outputs, "health": health},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(json.dumps(
        {
            "stats": stats,
            "outputs": [{k: v for k, v in item.items() if k in ("role", "exists")} for item in outputs],
            "markdown": str(out_dir / "standup.md"),
            "html": str(out_dir / "standup.html"),
        },
        ensure_ascii=False,
        indent=2,
    ))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
