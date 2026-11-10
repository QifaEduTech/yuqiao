# -*- coding: utf-8 -*-
"""
语桥无界 第二版 45 页对齐逐字稿 生成器
数据直接复用 build_yuqiao_ppt_v2.py 中的 S（与 PPT 同源），保证页码、时长、角色一致。
"""
import importlib.util
import datetime
from docx import Document
from docx.shared import Pt, RGBColor, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn

spec = importlib.util.spec_from_file_location(
    "pv2", r"E:\Desktop\项目\scripts\build_yuqiao_ppt_v2.py")
pv2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pv2)

S = pv2.S
CHAPTERS = pv2.CHAPTERS
ROLE = pv2.ROLE
ROLE_NAME = pv2.ROLE_NAME
NARR = pv2.NARR
ACCENT = pv2.ACCENT
fmt_dur = pv2.fmt_dur

FONT = "微软雅黑"


def dx(c):
    """pptx RGBColor -> docx RGBColor"""
    if c is None:
        return None
    v = int(str(c), 16)
    return RGBColor((v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF)


def set_run(run, size=11, bold=False, color=None):
    run.font.size = Pt(size)
    run.font.bold = bold
    if color is not None:
        run.font.color.rgb = dx(color)
    run.font.name = FONT
    rPr = run._element.get_or_add_rPr()
    rFonts = rPr.find(qn("w:rFonts"))
    if rFonts is None:
        rFonts = rPr.makeelement(qn("w:rFonts"), {})
        rPr.append(rFonts)
    rFonts.set(qn("w:eastAsia"), FONT)
    rFonts.set(qn("w:ascii"), FONT)
    rFonts.set(qn("w:hAnsi"), FONT)
    return run


def para(doc, text="", size=11, bold=False, color=None, align=None, space_after=4):
    p = doc.add_paragraph()
    if align is not None:
        p.alignment = align
    p.paragraph_format.space_after = Pt(space_after)
    if text:
        set_run(p.add_run(text), size, bold, color)
    return p


def chapter_label(d):
    ci = d.get("chapter_idx")
    if ci is None:
        return d.get("tag") or ("开场" if d["type"] in ("cover", "team", "toc") else "结束")
    return "%s %s" % (CHAPTERS[ci][0], CHAPTERS[ci][1])


def page_title(d):
    return d.get("title") or d.get("name") or d["sub"]


def build(out_path):
    doc = Document()
    st = doc.styles["Normal"]
    st.font.name = FONT
    st.font.size = Pt(11)
    st.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)

    para(doc, "语桥无界 四人技能展示逐字稿", 20, True, None, WD_ALIGN_PARAGRAPH.CENTER, 6)
    para(doc, "公共服务窗口双向辅助沟通", 14, False, None, WD_ALIGN_PARAGRAPH.CENTER, 4)
    para(doc, "第二版    %s" % datetime.date.today().isoformat(), 12, False,
         None, WD_ALIGN_PARAGRAPH.CENTER, 10)

    para(doc, "本稿与《语桥无界 四人汇报 第二版》45 页 PPT 逐页对应，章节结构对齐莓开眼笑六章骨架。"
              "角色暂用一号至四号，姓名可在排练时替换。", 11, False, None, None, 4)
    para(doc, "建议排练时长 60 分钟（含现场操作），不代表正式赛制规定。PPT 备注中已放入相同台词、操作与来源。",
         11, False, None, None, 4)
    para(doc, "口述内容见逐字稿，现场操作和交接语另列。实时识别、网络和播放失败时，应说明实际结果，"
              "不能按预设台词宣布成功。", 11, False, None, None, 4)
    para(doc, "不引用参考案例的准确率、收益、专利或部署成果。原片和账号资料只在已授权范围内演示，"
              "真实 API Key 不得投屏。", 11, False, None, None, 10)

    # 时间分配表
    para(doc, "时间分配（总时长 60 分钟）", 13, True, None, None, 6)
    t = doc.add_table(rows=1, cols=4)
    t.style = "Table Grid"
    hdr = ["段落", "页码", "时长", "内容"]
    for i, h in enumerate(hdr):
        c = t.rows[0].cells[i]
        c.text = ""
        set_run(c.paragraphs[0].add_run(h), 10.5, True)
    rows = [
        ("开场", "P01 - P03", "1.5 分钟", "封面、四岗分工、汇报安排"),
        ("01 项目背景", "P04 - P09", "4 分钟", "任务来源、沟通障碍、政策与输入输出"),
        ("02 项目设计", "P10 - P13", "2.5 分钟", "验收指标、系统架构、技术链与工作包"),
        ("03 工作流程", "P14 - P17", "2 分钟", "双向流程、质量门、岗位接口、操作前检查"),
        ("04 技能要点", "P18 - P38", "48 分钟", "技能展示 40 分钟 + 技能联调 8 分钟"),
        ("05 创新成果", "P39 - P42", "1.2 分钟", "技术改进、阶段成果、过程证据"),
        ("06 价值展望", "P43 - P45", "0.8 分钟", "应用价值、下一阶段计划、结束"),
    ]
    for r in rows:
        cells = t.add_row().cells
        for i, v in enumerate(r):
            cells[i].text = ""
            set_run(cells[i].paragraphs[0].add_run(v), 10.5, False)
    para(doc, "", 11)

    para(doc, "前 10 分钟介绍项目主体（开场 + 项目背景 + 项目设计 + 工作流程）；"
              "中间 40 分钟技能展示（二号 10 分钟、三号 16 分钟、四号 14 分钟）；"
              "后 8 分钟技能联调（一号，P35 - P38）。", 11, True, None, None, 10)

    para(doc, "本版演示范围", 13, True, None, None, 6)
    para(doc, "实时识别：谢谢、帮助、需要、我，不选类别或模型。数字人：目录内表达，例如“我需要帮助”“好，请等候”。"
              "“我”完成后双手出画约一秒再继续；现场分步骤演练，不宣称连续句翻译已完成。",
         11, False, None, None, 10)

    para(doc, "四个岗位的职责与交付", 13, True, None, None, 6)
    roles = [
        (1, "项目负责人", "需求分析、架构设计、接口联调和最终验收；交付场景联调结论与验收记录。"),
        (2, "AI 数据工程师", "采集与登记，核对样本质量和真实拍摄分组；交付样本集与质检结论。"),
        (3, "手语识别算法工程师", "骨骼特征、模型训练、运动判断和误识别改进；交付识别模型与现场实测记录。"),
        (4, "智能交互开发工程师", "文字到动作规划、数字人播放和语音输出；交付动作表达与播报链路。"),
    ]
    for rid, name, txt in roles:
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(3)
        set_run(p.add_run("%s  %s：" % (ROLE_NAME[rid], name)), 11, True, ROLE[rid])
        set_run(p.add_run(txt), 11, False)
    para(doc, "", 11)

    para(doc, "岗位交接方式", 13, True, None, None, 6)
    para(doc, "二号把来源、标签、质量和分组依据交给三号；三号把模型版本、特征协议和识别证据交给四号；"
              "四号把动作表达和播报流程交给一号。最终由四人共同核对场景任务。", 11, False, None, None, 10)

    para(doc, "演示前准备", 13, True, None, None, 6)
    for x in ["投屏与页面：首页、学习、实时、数字人预览、安卓浏览器预览。",
              "三号确认摄像头与四词模型，四号确认动作资源、演示账号与云语音网络。",
              "二号只使用授权演示样本，不现场批量改标签、删录像或重新划分训练测试。",
              "一号准备纸面或既有记录方式，按实际结果登记通过、未通过、待复测。"]:
        para(doc, "· " + x, 11, False, None, None, 3)
    para(doc, "", 11)

    # ===== 正文 =====
    for i, d in enumerate(S, start=1):
        title = page_title(d)
        spk = d.get("speaker")
        spk_txt = "全员" if spk == "all" else ROLE_NAME.get(spk, "—")
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(3)
        set_run(p.add_run("P%02d  " % i), 12, True, ACCENT)
        set_run(p.add_run(title), 12, True, RGBColor(0x16, 0x32, 0x4F))

        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(4)
        set_run(p.add_run("主讲 %s" % spk_txt), 10.5, True,
                ROLE.get(spk, NARR) if isinstance(spk, int) else NARR)
        set_run(p.add_run("    时长 %s" % fmt_dur(d["dur"])), 10.5, True, RGBColor(0xB5, 0x6A, 0x00))
        set_run(p.add_run("    章节 %s" % chapter_label(d)), 10.5, True, NARR)

        for role, text in d["notes"]:
            p = doc.add_paragraph()
            p.paragraph_format.space_after = Pt(3)
            if role == "narr":
                set_run(p.add_run("· " + text), 11, False, NARR)
            elif role == "all":
                set_run(p.add_run("全体："), 11, True, NARR)
                set_run(p.add_run(text), 11, False, NARR)
            else:
                set_run(p.add_run("%s：" % ROLE_NAME[role]), 11, True, ROLE[role])
                set_run(p.add_run(text), 11, False, ROLE[role])
        para(doc, "", 8)

    # 现场异常与答辩口径
    para(doc, "现场异常与答辩口径", 14, True, None, None, 6)
    qa = [("摄像头或跟踪失败", "本次摄像头或跟踪状态未满足演示条件，我们保留当前问题。接下来如展示已有回放，会明确说明它不是现场识别。"),
          ("候选错误或没有出现", "本次实际结果是未识别或识别有误。我们先检查画面与运动证据，不调整标签来迎合模型。"),
          ("语音服务失败", "本次云语音未能返回，文字结果仍可查看。需要检查网络、Key 权限或额度。"),
          ("问到准确率", "请先区分训练、开发回归和独立测试。当前资料不能支持宣称整体跨用户准确率达到 95% 以上。"),
          ("问到安卓或硬件", "安卓已推进浏览器本地试用，原生与实际设备尚待验证。桌面硬件终端目前不作为已落地成果。"),
          ("问到创新或竞品", "本版按通用问答、单向播放、分类演示等方案类型比较设计重点，没有完成具体竞品的同条件性能和成本测试。")]
    for k, v in qa:
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(3)
        set_run(p.add_run(k + "："), 11, True)
        set_run(p.add_run(v), 11, False)

    para(doc, "", 8)
    para(doc, "依据与参考材料", 14, True, None, None, 6)
    para(doc, "参考材料只用于组织讲解、岗位交接和演示结构，不把案例中的数据与成果当作语桥事实。",
         11, False, None, None, 4)
    for x in ["从手语银行到无声警务室 他们传递着无声的温暖（央视网／焦点访谈，2021-06-09）",
              "天津 12345 热线开通手语视频专席服务（天津日报；天津政务网，2025-12-12）",
              "中华人民共和国无障碍环境建设法（全国人大常委会，2023-06-28）",
              "我国公共服务领域将提供国家通用手语、盲文服务（新华社，2026-10-09）"]:
        para(doc, "· " + x, 11, False, None, None, 3)
    para(doc, "", 8)
    para(doc, "项目事实来源：AGENTS.md、项目进度数据.json、产品需求.md、技术架构与开发规范.md、"
              "运行与维护.md、实时动作配置和相应源码。既有文档仍在更新时，以实际代码、验证证据和最新用户要求共同核对。",
         11, False, None, None, 3)

    doc.save(out_path)
    return len(S)


if __name__ == "__main__":
    out = r"E:\Desktop\项目\逐字稿与ppt\语桥无界_45页对齐逐字稿_第二版.docx"
    n = build(out)
    print("saved:", out, "pages:", n)
