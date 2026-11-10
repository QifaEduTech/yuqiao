# -*- coding: utf-8 -*-
"""
语桥无界 第三版 逐页对齐逐字稿 生成器
数据直接复用 build_yuqiao_ppt_v3.py 中的 S（与 PPT 同源），保证页码、主讲、章节一致。
第三版不含任何时间提示；岗位为：一号全栈、二号数据与算法、三号智能体与知识库、四号智能交互。
"""
import importlib.util
import datetime
from docx import Document
from docx.shared import Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn

spec = importlib.util.spec_from_file_location(
    "pv3", r"E:\Desktop\项目\scripts\build_yuqiao_ppt_v3.py")
pv3 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pv3)

S = pv3.S
CHAPTERS = pv3.CHAPTERS
ROLE = pv3.ROLE
ROLE_NAME = pv3.ROLE_NAME
NARR = pv3.NARR
ACCENT = pv3.ACCENT
BRAND = pv3.BRAND

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

    para(doc, "语桥无界 四人技能展示逐字稿（第三版）", 20, True, None, WD_ALIGN_PARAGRAPH.CENTER, 6)
    para(doc, "公共服务窗口双向援助系统", 14, False, None, WD_ALIGN_PARAGRAPH.CENTER, 4)
    para(doc, "人工智能赛道 · 四人展示 · 第三版    %s" % datetime.date.today().isoformat(),
         12, False, None, WD_ALIGN_PARAGRAPH.CENTER, 10)

    para(doc, "本稿与《语桥无界 四人汇报 第三版》PPT 逐页对应，章节结构对齐莓开眼笑六章骨架。"
              "角色暂用一号至四号，姓名可在排练时替换。全篇不设时间提示，按内容节奏推进。",
         11, False, None, None, 4)
    para(doc, "口述内容见逐字稿，现场操作和交接语另列。实时识别、网络和播放失败时，应说明实际结果，"
              "不能按预设台词宣布成功。", 11, False, None, None, 4)
    para(doc, "案例与政策只用于说明需求真实存在，不引用其他案例的准确率、收益、专利或部署成果。"
              "原片和账号资料只在已授权范围内演示，真实 API Key 不得投屏。", 11, False, None, None, 10)

    # 汇报结构（不含时间、不含页数）
    para(doc, "汇报结构（六个部分）", 13, True, None, None, 6)
    for num, name in CHAPTERS:
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(3)
        set_run(p.add_run("%s  %s" % (num, name)), 11, True, BRAND)
    para(doc, "", 11)

    para(doc, "本版演示范围", 13, True, None, None, 6)
    para(doc, "实时识别：谢谢、帮助、需要、我，不选类别或模型。法律问答：知识库内的问题给出途径与依据，"
              "超出范围明确转人工。数字人：目录内表达，例如“我需要帮助”“好，请等候”。"
              "“我”完成后先双手出画再继续；现场分步骤演练，不宣称连续句翻译已完成。",
         11, False, None, None, 10)

    para(doc, "四个岗位的职责与交付", 13, True, None, None, 6)
    roles = [
        (1, "项目负责人兼全栈开发", "需求分析、架构设计、前端与后端开发、接口联调与最终验收；交付全栈可运行系统与验收记录。"),
        (2, "数据与算法工程师", "采集登记、样本质检、真实拍摄分组、骨骼特征、模型训练、运动判断与误识别改进；交付样本集、识别模型与现场实测记录。"),
        (3, "智能体与知识库工程师", "法律与政策知识库构建、检索问答智能体、引用核对与拒答转人工策略；交付知识库、问答接口与引用记录。"),
        (4, "智能交互开发工程师", "文字到动作规划、数字人播放、候选播报与语音输出、Web 与安卓终端适配；交付动作表达、播报链路与终端试用结论。"),
    ]
    for rid, name, txt in roles:
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(3)
        set_run(p.add_run("%s  %s：" % (ROLE_NAME[rid], name)), 11, True, ROLE[rid])
        set_run(p.add_run(txt), 11, False)
    para(doc, "", 11)

    para(doc, "岗位交接方式", 13, True, None, None, 6)
    para(doc, "二号交付样本集与识别模型给三号做知识对齐；三号交付问答接口与引用格式给四号做呈现；"
              "四号交付表达与播报链路给一号做联调；最终由四人共同核对同一个紧急求助与法律援助场景任务。",
         11, False, None, None, 10)

    para(doc, "演示前准备", 13, True, None, None, 6)
    for x in ["投屏与页面：首页、学习、实时、问答区、数字人预览、安卓浏览器预览。",
              "二号确认摄像头与四词模型权重、特征协议一致。",
              "三号确认知识库条目来源与检索引用正常，不展示个人案情。",
              "四号确认动作资源、播报链路与演示账号，不投屏真实密钥。",
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
        set_run(p.add_run(title), 12, True, dx(pv3.INK))

        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(4)
        set_run(p.add_run("主讲 %s" % spk_txt), 10.5, True,
                ROLE.get(spk, NARR) if isinstance(spk, int) else NARR)
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
          ("法律问答没有依据", "知识库没有依据时明确说明暂无依据，给出 12348、12385 与法援中心的真实渠道，不猜测、不编造法条。"),
          ("语音服务失败", "本次云语音未能返回，文字结果仍可查看。需要检查网络、Key 权限或额度。"),
          ("问到准确率", "请先区分训练、开发回归和独立测试。当前资料不能支持宣称整体跨用户准确率。"),
          ("问到案例数据", "引用案例只用于说明需求真实存在，不把其中的金额、获救人数或办案成果当作语桥的成绩。"),
          ("问到安卓或硬件", "安卓已推进浏览器本地试用，原生与实际设备尚待验证。桌面硬件终端目前不作为已落地成果。"),
          ("问到创新或竞品", "本版按通用问答、单向播放、分类演示等方案类型比较设计重点，没有完成具体竞品的同条件性能和成本测试。")]
    for k, v in qa:
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(3)
        set_run(p.add_run(k + "："), 11, True)
        set_run(p.add_run(v), 11, False)

    para(doc, "", 8)
    para(doc, "依据与参考材料", 14, True, None, None, 6)
    para(doc, "参考材料只用于说明需求真实存在与组织讲解，不把案例中的数据与成果当作语桥事实。",
         11, False, None, None, 4)
    for x in ["突发求助：湖北荆州 119/120 一键报警（荆州检察院 2026-02 立案，2026-05-12 首次独立报出火警）",
              "突发求助：陕西城固“城固急救”小程序（全县 4000 余名听力言语障碍者，20 余人通过文字呼救获救）",
              "突发求助：安徽马鞍山推出全省首个听障人士“文字 120”",
              "法律场景：长春聋哑夫妇房屋被低价转让，撤销权除斥期间仅剩 7 个工作日（法治网 2025-07-18）",
              "法律场景：杭州西湖聋哑骑手 4 万余元借款纠纷（法治网 2026-09-29）",
              "法律场景：贵州晴隆 8 名听障人士被骗 9 万余元（检察日报 2026-09-27）",
              "法律场景：山西中阳聋哑当事人离婚援助、长春九台人身损害案件手语翻译保障",
              "法律依据：中华人民共和国法律援助法（2022-01-01 施行）",
              "法律依据：中华人民共和国无障碍环境建设法（2023-09-01 施行）",
              "政策依据：司法部与中国残联关于残疾人法律援助的意见（12348 与 12385 互联互通、法律服务网无障碍改造）",
              "政策依据：青海关于一二级残疾人免于核查经济困难状况、绿色通道与手语翻译的意见（2026-08-20 起施行）"]:
        para(doc, "· " + x, 11, False, None, None, 3)
    para(doc, "", 8)
    para(doc, "项目事实来源：AGENTS.md、项目进度数据.json、产品需求.md、技术架构与开发规范.md、"
              "运行与维护.md、实时动作配置和相应源码。既有文档仍在更新时，以实际代码、验证证据和最新用户要求共同核对。",
         11, False, None, None, 3)

    doc.save(out_path)
    return len(S)


if __name__ == "__main__":
    out = r"E:\Desktop\项目\逐字稿与ppt\语桥无界_43页对齐逐字稿_第三版.docx"
    n = build(out)
    print("saved:", out, "pages:", n)
