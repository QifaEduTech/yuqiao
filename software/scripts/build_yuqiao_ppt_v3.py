# -*- coding: utf-8 -*-
"""
语桥无界 四人汇报 PPT 第三版 生成器
结构对齐《慧眼识株·莓开眼笑》六章骨架，内容取自语桥逐字稿。
底色与强调色统一为语桥青绿 #176A64；每页右上角放置语桥标识；全篇不出现时间提示。
"""
import copy
import math
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.dml import MSO_LINE_DASH_STYLE
from pptx.oxml.ns import qn
from pptx.oxml import parse_xml

FONT = "微软雅黑"

# ---------- 配色：语桥青绿为主色，不使用蓝色背景 ----------
BRAND = RGBColor(0x17, 0x6A, 0x64)     # 语桥青绿（标识色 / 深色页底色）
NAVY = BRAND                            # 封面、章节页、结束页底色
INK = RGBColor(0x14, 0x33, 0x2F)        # 主文字
SUB = RGBColor(0x5C, 0x6E, 0x6A)        # 次级文字
ACCENT = BRAND                          # 强调色
LINE = RGBColor(0xD5, 0xE3, 0xDF)       # 卡片描边
CARD = RGBColor(0xFF, 0xFF, 0xFF)
BG = RGBColor(0xF5, 0xF8, 0xF7)         # 内容页底色
SOFT = RGBColor(0xE6, 0xF0, 0xED)       # 浅块

# 四人角色色（旁白/全员用普通色 NARR）
ROLE = {
    1: RGBColor(0x17, 0x6A, 0x64),   # 一号 项目负责人兼全栈开发 - 语桥青绿
    2: RGBColor(0xC0, 0x74, 0x1A),   # 二号 数据与算法工程师 - 琥珀橙
    3: RGBColor(0x7A, 0x4F, 0xA3),   # 三号 智能体与知识库工程师 - 紫
    4: RGBColor(0xB0, 0x3A, 0x5B),   # 四号 智能交互开发工程师 - 玫红
}
NARR = RGBColor(0x4A, 0x53, 0x64)     # 旁白/说明：普通深灰
ROLE_NAME = {1: "一号", 2: "二号", 3: "三号", 4: "四号", "all": "全体"}

W, H = 13.333, 7.5

CHAPTERS = [
    ("01", "项目背景"),
    ("02", "项目设计"),
    ("03", "工作流程"),
    ("04", "技能要点"),
    ("05", "创新成果"),
    ("06", "价值展望"),
]


# ---------- 基础工具 ----------
def set_font(run, size=14, bold=False, color=INK, name=FONT):
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color
    run.font.name = name
    rPr = run._r.get_or_add_rPr()
    latin = rPr.find(qn("a:latin"))
    ea = rPr.find(qn("a:ea"))
    if ea is None:
        ea = parse_xml(
            '<a:ea xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" typeface="%s"/>' % name
        )
        if latin is not None:
            latin.addnext(ea)
        else:
            rPr.append(ea)
    else:
        ea.set("typeface", name)
    return run


def textbox(slide, x, y, w, h, anchor=MSO_ANCHOR.TOP):
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = Emu(0)
    tf.margin_top = tf.margin_bottom = Emu(0)
    return tf


def put(tf, text, size=14, bold=False, color=INK, align=PP_ALIGN.LEFT,
        space_after=0, line=1.35, first=False):
    p = tf.paragraphs[0] if first else tf.add_paragraph()
    p.alignment = align
    p.space_after = Pt(space_after)
    p.line_spacing = line
    r = p.add_run()
    r.text = text
    set_font(r, size, bold, color)
    return p


def rect(slide, x, y, w, h, fill=None, line=None, lw=1.0,
         shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.06):
    sh = slide.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
    if fill is None:
        sh.fill.background()
    else:
        sh.fill.solid()
        sh.fill.fore_color.rgb = fill
    if line is None:
        sh.line.fill.background()
    else:
        sh.line.color.rgb = line
        sh.line.width = Pt(lw)
    sh.shadow.inherit = False
    if shape == MSO_SHAPE.ROUNDED_RECTANGLE:
        try:
            sh.adjustments[0] = radius
        except Exception:
            pass
    tf = sh.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = Inches(0.16)
    tf.margin_top = tf.margin_bottom = Inches(0.08)
    return sh


def solid_bg(slide, color):
    sh = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(W), Inches(H))
    sh.fill.solid()
    sh.fill.fore_color.rgb = color
    sh.line.fill.background()
    sh.shadow.inherit = False
    return sh


def blank(prs):
    return prs.slides.add_slide(prs.slide_layouts[6])


def logo(slide, x=None, y=0.24, size=0.54, dark=False):
    """语桥标识：青绿圆角底 + 白色拱桥；深色页反白。默认右上角。"""
    if x is None:
        x = W - 0.56 - size
    tile = RGBColor(0xFF, 0xFF, 0xFF) if dark else BRAND
    mark = BRAND if dark else RGBColor(0xFF, 0xFF, 0xFF)
    rect(slide, x, y, size, size, fill=tile, line=None, radius=0.31)
    bw = size * 0.0667          # 线条粗细（对应 svg stroke-width 3.2/48）

    # 拱形：整椭圆描边 + 下半部同色遮挡
    ow = size * 0.542
    oh = size * 0.438
    ox = x + size / 2 - ow / 2
    oy = y + size * 0.302
    ov = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(ox), Inches(oy), Inches(ow), Inches(oh))
    ov.fill.background()
    ov.line.color.rgb = mark
    ov.line.width = Pt(size * 72 * 0.0667)
    ov.shadow.inherit = False
    rect(slide, ox - 0.01, oy + oh / 2, ow + 0.02, oh / 2 + 0.02, fill=tile, line=None, radius=0.0)

    for fx, fy0, fy1 in ((11, 19, 30), (37, 19, 30), (18, 20, 31), (30, 20, 31)):
        rect(slide, x + size * (fx - 1.6) / 48, y + size * fy0 / 48,
             bw, size * (fy1 - fy0) / 48, fill=mark, line=None, radius=0.0)
    return x


def set_notes(slide, blocks, meta):
    """blocks: [(role, text)] role in {1,2,3,4,'all','narr'}"""
    ns = slide.notes_slide
    tf = ns.notes_text_frame
    tf.word_wrap = True
    tf.text = ""
    first_flag = [True]

    def add(text, size=11, bold=False, color=NARR, space=2):
        p = tf.paragraphs[0] if first_flag[0] else tf.add_paragraph()
        first_flag[0] = False
        p.space_after = Pt(space)
        r = p.add_run()
        r.text = text
        set_font(r, size, bold, color)

    add("【%s】  主讲：%s" % (meta["title"], meta["speaker_txt"]), 11, True, ACCENT, space=4)
    add("—— 逐字稿 ——", 10.5, True, NARR, space=3)
    for role, text in blocks:
        if role == "narr":
            add("· " + text, 10.5, False, NARR)
        elif role == "all":
            add("全体：" + text, 10.5, True, NARR)
        else:
            add("%s：%s" % (ROLE_NAME[role], text), 10.5, False, ROLE[role])
    return ns


# ---------- 页面元件 ----------
def nav_bar(slide, cur_idx, dark=False):
    """底部六章导航，当前章高亮"""
    n = len(CHAPTERS)
    gap = 0.12
    total = W - 1.1
    bw = (total - gap * (n - 1)) / n
    for i, (num, name) in enumerate(CHAPTERS):
        x = 0.55 + i * (bw + gap)
        cur = (i == cur_idx)
        fill = ACCENT if cur else (RGBColor(0xFF, 0xFF, 0xFF) if not dark else RGBColor(0x11, 0x53, 0x4E))
        col = RGBColor(0xFF, 0xFF, 0xFF) if cur else (SUB if not dark else RGBColor(0xA8, 0xC6, 0xC1))
        sh = rect(slide, x, 6.92, bw, 0.34, fill=fill,
                  line=None if cur else (LINE if not dark else RGBColor(0x11, 0x53, 0x4E)),
                  radius=0.22)
        tf = sh.text_frame
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        put(tf, "%s  %s" % (num, name), 9.5, cur, col, PP_ALIGN.CENTER, first=True)


def page_head(slide, chapter_idx, title, subtitle, page, total, speaker=None):
    """页眉：章节标签 + 主讲徽章 + 页码；返回内容区起始 y"""
    y = 0.34
    # 章节标签
    num, name = CHAPTERS[chapter_idx]
    sh = rect(slide, 0.55, y, 1.72, 0.34, fill=ACCENT, radius=0.42)
    tf = sh.text_frame
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    put(tf, "%s  %s" % (num, name), 10.5, True, RGBColor(0xFF, 0xFF, 0xFF), PP_ALIGN.CENTER, first=True)

    x = 2.39
    if speaker:
        label = "主讲 " + (ROLE_NAME[speaker] if isinstance(speaker, int) else "全员")
        col = ROLE.get(speaker, NARR) if isinstance(speaker, int) else NARR
        sh = rect(slide, x, y, 1.18, 0.34, fill=None, line=col, lw=1.2, radius=0.42)
        tf = sh.text_frame
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        put(tf, label, 10, True, col, PP_ALIGN.CENTER, first=True)
        x += 1.30

    # 页码（避开右上角标识）
    tf = textbox(slide, W - 2.14, y, 0.95, 0.34, MSO_ANCHOR.MIDDLE)
    put(tf, "%02d / %d" % (page, total), 10.5, True, SUB, PP_ALIGN.RIGHT, first=True)

    # 标题
    tf = textbox(slide, 0.55, 0.86, W - 1.1, 0.62, MSO_ANCHOR.BOTTOM)
    put(tf, title, 27, True, INK, first=True)
    if subtitle:
        tf2 = textbox(slide, 0.55, 1.52, W - 2.6, 0.4)
        put(tf2, subtitle, 12.5, False, SUB, first=True)
    return 2.08


def foot_note(slide, text, top=6.42, color=SUB):
    if not text:
        return
    sh = rect(slide, 0.55, top, W - 1.1, 0.4, fill=SOFT, radius=0.3)
    tf = sh.text_frame
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    put(tf, text, 10.5, False, color, first=True)


def cards(slide, items, top, cols=3, height=2.0, gap=0.24, accent=ACCENT, num=True):
    """圆角卡片网格"""
    x0 = 0.55
    aw = W - 1.1
    cw = (aw - gap * (cols - 1)) / cols
    for i, it in enumerate(items):
        r, c = divmod(i, cols)
        x = x0 + c * (cw + gap)
        y = top + r * (height + gap)
        sh = rect(slide, x, y, cw, height, fill=CARD, line=LINE, radius=0.05)
        tf = sh.text_frame
        tf.vertical_anchor = MSO_ANCHOR.TOP
        head = it.get("h") or it.get("t")
        if num and it.get("n"):
            put(tf, it["n"], 13, True, accent, space_after=3, first=True)
        put(tf, head, 15, True, INK if not it.get("c") else it["c"], space_after=6,
            first=not (num and it.get("n")))
        body = it.get("d") or it.get("items")
        if isinstance(body, list):
            for b in body:
                put(tf, "· " + b, 11, False, SUB, space_after=3)
        elif body:
            put(tf, body, 11, False, SUB, line=1.3)
        if it.get("to"):
            put(tf, it["to"], 11.5, True, accent, space_after=0)


def steps(slide, items, top, height=1.5, gap=0.22, accent=ACCENT):
    """横向流程步骤"""
    n = len(items)
    x0 = 0.55
    aw = W - 1.1
    aw2 = aw - 0.42 * (n - 1)
    cw = aw2 / n
    for i, it in enumerate(items):
        x = x0 + i * (cw + 0.42)
        sh = rect(slide, x, top, cw, height, fill=CARD, line=LINE, radius=0.08)
        tf = sh.text_frame
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        put(tf, it.get("n", "%02d" % (i + 1)), 12, True, accent, PP_ALIGN.CENTER, space_after=4, first=True)
        put(tf, it["t"], 13.5, True, INK, PP_ALIGN.CENTER, space_after=3)
        if it.get("d"):
            put(tf, it["d"], 10.5, False, SUB, PP_ALIGN.CENTER, line=1.25)
        if i < n - 1:
            a = slide.shapes.add_shape(
                MSO_SHAPE.RIGHT_ARROW, Inches(x + cw + 0.06), Inches(top + height / 2 - 0.1),
                Inches(0.3), Inches(0.2))
            a.fill.solid()
            a.fill.fore_color.rgb = accent
            a.line.fill.background()
            a.shadow.inherit = False


def columns(slide, secs, top, height=3.0, gap=0.24, accent=ACCENT):
    """多列：标题 + 条目列表"""
    n = len(secs)
    x0 = 0.55
    aw = W - 1.1
    cw = (aw - gap * (n - 1)) / n
    for i, s in enumerate(secs):
        x = x0 + i * (cw + gap)
        sh = rect(slide, x, top, cw, height, fill=CARD, line=LINE, radius=0.05)
        tf = sh.text_frame
        head = s["h"]
        put(tf, head, 15, True, s.get("c", accent), space_after=8, first=True)
        for b in s.get("items", []):
            put(tf, "· " + b, 11.5, False, SUB, space_after=4, line=1.3)


def compare(slide, left, right, top, height=2.4):
    """左右对照：{'h':..,'c':..,'items':[]}"""
    gap = 0.4
    cw = (W - 1.1 - gap) / 2
    for i, s in enumerate([left, right]):
        x = 0.55 + i * (cw + gap)
        sh = rect(slide, x, top, cw, height, fill=CARD, line=s.get("c", LINE), lw=1.4, radius=0.05)
        tf = sh.text_frame
        put(tf, s["h"], 15, True, s.get("c", INK), space_after=8, first=True)
        for b in s.get("items", []):
            put(tf, "· " + b, 11.5, False, SUB, space_after=4, line=1.3)


def band(slide, text, top, height=0.62, color=ACCENT, size=12.5):
    sh = rect(slide, 0.55, top, W - 1.1, height, fill=SOFT, radius=0.25)
    tf = sh.text_frame
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    put(tf, text, size, True, color, first=True)


def wp_page(slide, chapter_idx, wp, role, title, subtitle, steps_in, deliver, duty, page, total):
    """工作包岗位页：输入 → 步骤 → 交付"""
    col = ROLE[role]
    top = page_head(slide, chapter_idx, title, subtitle, page, total, speaker=role)
    band(slide, "输入：%s" % steps_in, top, 0.6, color=col, size=12)
    steps(slide, deliver, top + 0.78, height=1.35, accent=col)
    band(slide, "交付：%s" % duty, top + 2.36, 0.6, color=col, size=12)
    foot_note(slide, wp)
    nav_bar(slide, chapter_idx)


def arch_bridge(slide, rows):
    """整页一座拱桥：上面一条平的桥面，下面一个真正的圆弧拱圈（不用方块拼接）"""
    x0, x1 = 0.55, W - 0.55
    bw = x1 - x0
    cx = (x0 + x1) / 2          # 6.665
    deck_y, deck_h = 2.28, 0.86  # 桥面
    wat_y = 5.20                 # 水面，同时是拱脚线
    rx, ry = 5.25, 1.55          # 拱圈中线半径
    ring = 0.40                  # 拱圈厚度

    # 1) 桥身实体：桥面以下到水面（勾青绿边，让桥的外轮廓立起来）
    rect(slide, x0, deck_y + deck_h, bw, wat_y - deck_y - deck_h,
         fill=RGBColor(0xDC, 0xEA, 0xE6), line=BRAND, lw=1.25, radius=0.02)

    # 2) 挖出拱洞：半椭圆，弧线是真正的曲线
    hole = slide.shapes.add_shape(
        MSO_SHAPE.OVAL,
        Inches(cx - (rx - ring / 2)), Inches(wat_y - (ry - ring / 2)),
        Inches(2 * (rx - ring / 2)), Inches(2 * (ry - ring / 2)))
    hole.fill.solid()
    hole.fill.fore_color.rgb = BG
    hole.line.fill.background()
    hole.shadow.inherit = False

    # 3) 拱圈：一条有厚度的粗弧线
    arc = slide.shapes.add_shape(
        MSO_SHAPE.OVAL, Inches(cx - rx), Inches(wat_y - ry),
        Inches(2 * rx), Inches(2 * ry))
    arc.fill.background()
    arc.line.color.rgb = BRAND
    arc.line.width = Pt(ring * 72)
    arc.shadow.inherit = False

    # 4) 水面：不透明，正好盖住拱圈伸到水下的那半圈
    rect(slide, x0, wat_y, bw, 0.60, fill=RGBColor(0xC9, 0xDE, 0xD8), line=None, radius=0.0)
    rect(slide, x0, wat_y, bw, 0.06, fill=RGBColor(0xB9, 0xD2, 0xCD), line=None, radius=0.0)
    for hx, hw, hy in ((1.2, 3.2, 5.38), (4.9, 2.4, 5.54), (8.5, 3.0, 5.38)):
        rect(slide, hx, hy, hw, 0.04, fill=RGBColor(0xDF, 0xEB, 0xE6), line=None, radius=0.0)
    rect(slide, 0, 5.80, W, 1.3, fill=BG, line=None, radius=0.0)  # 清掉水下多余弧线

    # 5) 桥面：平的；上面加一道栏杆
    rect(slide, x0, deck_y, bw, deck_h, fill=BRAND, line=None, radius=0.10)
    rail = RGBColor(0x8F, 0xC4, 0xBC)
    rect(slide, x0 + 0.10, 2.10, bw - 0.20, 0.035, fill=rail, line=None, radius=0.0)
    posts = 15
    span = bw - 0.30
    for k in range(posts):
        px = x0 + 0.15 + k * (span / (posts - 1))
        rect(slide, px - 0.022, 2.135, 0.045, deck_y - 2.135, fill=rail, line=None, radius=0.0)

    # 6) 桥面上 1—6 六个圆角胶囊（不是方块）
    n = len(rows)
    gap = 0.20
    pad = 0.22
    pw = (bw - 2 * pad - gap * (n - 1)) / n
    for i, row in enumerate(rows):
        px = x0 + pad + i * (pw + gap)
        chip = rect(slide, px, deck_y + 0.12, pw, deck_h - 0.24,
                    fill=CARD, line=None, radius=0.5)
        tf = chip.text_frame
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        tf.margin_top = tf.margin_bottom = Emu(0)
        tf.margin_left = tf.margin_right = Inches(0.07)
        put(tf, "%d  %s" % (i + 1, row[1]), 12, True, BRAND, PP_ALIGN.CENTER,
            line=1.12, first=True)
        if len(row) > 2 and row[2]:
            put(tf, row[2], 8, False, SUB, PP_ALIGN.CENTER, line=1.05)


def photo_strip(slide, top, height, labels, x0=0.55, x1=None):
    """下方真实照片占位框（虚线，后期替换）"""
    if x1 is None:
        x1 = W - 0.55
    n = len(labels)
    gap = 0.22
    fw = (x1 - x0 - gap * (n - 1)) / n
    for i, lb in enumerate(labels):
        x = x0 + i * (fw + gap)
        fr = rect(slide, x, top, fw, height, fill=SOFT, line=BRAND, lw=1.0, radius=0.06)
        fr.line.dash_style = MSO_LINE_DASH_STYLE.DASH
        tf = fr.text_frame
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        put(tf, "%d  %s（待补实景照片）" % (i + 1, lb), 10.5, False,
            RGBColor(0x6E, 0x8A, 0x85), PP_ALIGN.CENTER, first=True)


# ---------- 内容数据 ----------
S = []


def add(**kw):
    S.append(kw)


# ===== 开场 =====
add(type="cover",
    title="语桥无界",
    eyebrow="人工智能赛道 · 四人展示 · 第三版",
    sub="公共服务窗口双向援助系统",
    tag="让紧急的求助被看见，让法律的答复被听懂",
    speaker="all",
    notes=[("all", "尊敬的各位评委老师，大家好。"),
           (1, "我们带来的项目是语桥无界。它面向公共服务窗口的紧急求助与法律援助场景：让使用手语的人能把来意说出来，让工作人员的答复能被看懂、听懂。"),
           (1, "今年我们遇到的真实情况是，很多聋哑朋友不是没有诉求，而是在最着急的时候说不出来。我们要解决的，正是这一段。"),
           ("narr", "现场操作：四人并排站定，一号向前半步。此页不打开摄像头。")])

add(type="team", chapter_idx=0, title="四个岗位，一次共同交付",
    sub="四岗协作，把一次紧急求助拆成四段可核验的任务",
    speaker="all",
    roles=[
        (1, "一号  项目负责人兼全栈开发", ["需求分析与架构设计", "前端页面与后端服务开发", "接口联调与最终验收"],
         "交付：全栈可运行系统与验收记录"),
        (2, "二号  数据与算法工程师", ["采集登记、质检与真实拍摄分组", "骨骼特征、模型训练与运动判断", "实时识别与误识别改进"],
         "交付：样本集、识别模型与现场实测记录"),
        (3, "三号  智能体与知识库工程师", ["法律与政策知识库构建", "检索问答智能体与引用核对", "拒答与转人工策略"],
         "交付：知识库、问答接口与引用记录"),
        (4, "四号  智能交互开发工程师", ["文字到动作规划与数字人播放", "候选播报与语音输出", "Web 与安卓终端适配"],
         "交付：动作表达、播报链路与终端试用结论"),
    ],
    foot="岗位交接：二号交付数据与模型给三号做知识对齐，三号交付问答与引用给四号做呈现，四号交付表达与播报给一号做联调，最终由四人共同核对同一个场景任务。",
    notes=[(1, "我是项目负责人，同时承担前端与后端开发，负责需求分析、架构设计、接口联调和最终验收。"),
           (2, "我是数据与算法工程师，负责采集与登记、样本质检、真实拍摄分组，以及骨骼特征、模型训练和实时识别。"),
           (3, "我是智能体与知识库工程师，负责法律与政策知识库构建、检索问答智能体，以及引用核对与拒答策略。"),
           (4, "我是智能交互开发工程师，负责文字到动作规划、数字人播放、语音输出，以及 Web 与安卓终端适配。"),
           (1, "请各位回到工位准备，下面先说明我们要解决的问题。"),
           ("narr", "现场操作：每人介绍时向前半步，讲完归位；二至四号随后回到工位，一号保留主讲位置。")])

add(type="toc", chapter_idx=0, title="汇报安排",
    sub="六个部分，从真实求助场景走到系统联调",
    speaker=1,
    rows=[("01", "项目背景", "紧急求助与法律援助的真实场景"),
          ("02", "项目设计", "验收指标、系统架构与工作包"),
          ("03", "工作流程", "双向流程、质量门与操作准备"),
          ("04", "技能要点", "四个岗位依次展示本岗技能"),
          ("05", "创新成果", "技术改进、阶段成果与过程证据"),
          ("06", "价值展望", "应用价值与下一阶段计划")],
    notes=[(1, "本次汇报按六个部分展开：先看真实场景，再看系统设计与流程，然后由三位工程师依次展示本岗位技能，最后回到一次完整的场景联调与验收。"),
           (1, "每个岗位都会说明自己的输入、处理方法和输出结果，最后回到同一个紧急求助与法律援助任务，检查系统是否真正帮助双方交换信息。"),
           ("narr", "现场操作：一号按目录指示讲解。各工位提前打开对应页面，不在后台启动摄像头。")])

# ===== 第一章 项目背景 =====
add(type="chapter", chapter_idx=0, num="第一章", name="项目背景",
    sub="真实求助场景、法律依据与输入输出", band="真实求助场景 · 法律依据 · 输入输出",
    speaker=1,
    notes=[(1, "第一章只看一件事：在最着急的那一刻，他们到底卡在哪里。这一章全部使用已公开的真实案例与法律政策依据。"),
           ("narr", "现场操作：一号侧身面向大屏示意章节标题，再转回面向评委。")])

add(type="content", chapter_idx=0, title="本次任务：一次紧急求助与法律援助",
    sub="来自公共服务窗口的真实场景，按可观测的结果逐项验收",
    speaker=1,
    body=("cards", [{"n": "01", "t": "场景", "d": "政务大厅、法援中心、残联工作站、急救与报警窗口"},
                    {"n": "02", "t": "手语识别", "d": "谢谢、帮助、需要、我；直接做动作，不先选择类别"},
                    {"n": "03", "t": "法律问答", "d": "知识库内的问题给出途径与依据，超出范围转人工"},
                    {"n": "04", "t": "数字人表达", "d": "目录内可覆盖的答复，例如“好，请等候”"},
                    {"n": "05", "t": "演示边界", "d": "词表有限、动作之间需停顿，不宣称连续句翻译"}], 3, 1.9),
    foot="按现场实际结果记录，不按预设台词宣布成功；实时识别、网络和播放失败时说明实际结果。",
    notes=[(1, "本轮识别范围是谢谢、帮助、需要和我，演示时直接做动作，不先选择答案。"),
           (1, "法律问答只回答知识库能支撑的问题，答不了就明确转人工或 12348，不编造法条。"),
           (1, "我们展示的是高频紧急场景下的辅助沟通，不是任意句子的连续手语翻译。"),
           ("narr", "现场操作：把四个识别词逐个读清；说明“我”结束后先先双手出画，再进行下一动作。")])

add(type="content", chapter_idx=0, title="真实场景：他们不是没有诉求，而是说不出来",
    sub="突发情况里，语音是唯一入口，而他们用不了这个入口",
    speaker=1,
    body=("compare",
          {"h": "突发情况：报不了警、说不清位置", "c": RGBColor(0xB0, 0x3A, 0x3A),
           "items": ["湖北荆州：119、120 接警系统只认声音，听障人士遇到突发状况“报不了警，说不清位置”",
                     "荆州检察院 2026 年 2 月立案，推动消防与急救开通一键报警，5 月 12 日听障人士首次独立报出火警",
                     "陕西城固：全县 4000 余名听力言语障碍者，120 仅支持语音呼叫；“城固急救”小程序上线后已有 20 余人通过文字呼救获救",
                     "安徽马鞍山：推出全省首个听障人士“文字 120”"]},
          {"h": "法律场景：急事遇上说不清，时效不等人", "c": RGBColor(0x8A, 0x5A, 0x00),
           "items": ["长春：聋哑夫妇 96 平方米房屋被 5 万元“转让”，来访当天距撤销权除斥期间届满只剩 7 个工作日",
                     "杭州西湖：聋哑骑手 4 万余元借款，借款人失联，靠手语翻译与多方联动才完成调解",
                     "贵州晴隆：8 名听障人士被骗 9 万余元，检察院聘请手语翻译全程参与讯问与庭审",
                     "山西中阳：聋哑当事人无力聘请手语翻译，援助律师只能逐字打字沟通"]}, 3.0),
    foot="以上均来自已公开报道；引用只用于说明场景真实存在，不代表本项目参与或已完成这些服务。",
    notes=[(1, "先看突发情况。湖北荆州的 119、120 接警系统过去只认声音，听障人士遇到突发状况报不了警、说不清位置。"),
           (1, "荆州检察院 2026 年 2 月立案推动改造，当年 5 月 12 日，听障人士第一次用自己的手独立报出了火警。"),
           (1, "陕西城固全县有四千多名听力言语障碍者，120 只支持语音呼叫；“城固急救”小程序上线后，已有二十多人通过文字呼救得到及时救助。"),
           (1, "再看法律场景。长春那对聋哑夫妇，房子被五万元“转让”，来访当天距离撤销权除斥期间届满只剩七个工作日。"),
           (1, "这些场景有一个共同点：时间很紧，但第一句话最难说出口。"),
           ("narr", "现场操作：讲到案例时只讲事实与来源，不做情绪化渲染。")])

add(type="content", chapter_idx=0, title="真实案例：五起已公开的法律援助事件",
    sub="每一条都能查到出处，不是编出来的场景",
    speaker=1,
    body=("cards", [{"n": "长春 · 房屋", "t": "撤销权仅剩 7 个工作日", "d": "律师协调手语翻译、两天完成取证立案", "to": "法治网 2025-07-18"},
                    {"n": "杭州西湖 · 借款", "t": "聋哑骑手 4 万余元", "d": "手语翻译全程参与，支持起诉后达成分期还款", "to": "法治网 2026-09-29"},
                    {"n": "贵州晴隆 · 诈骗", "t": "8 名听障人士被骗 9 万余元", "d": "手语翻译参与讯问与庭审，启动司法救助", "to": "检察日报 2026-09-27"},
                    {"n": "山西中阳 · 离婚", "t": "无力聘请手语翻译", "d": "律师逐字打字沟通，最终调解获经济帮助金", "to": "山西法治网"},
                    {"n": "长春九台 · 人身损害", "t": "当事人听语双重障碍", "d": "法院请特教学校手语教师翻译保障表达", "to": "九台区法院 2026-08"},
                    {"n": "共同点", "t": "沟通成本压在时效上", "d": "手语翻译稀缺，第一句话最耽误时间", "to": "→ 项目切入点"}], 3, 1.85),
    foot="案例用于说明需求真实存在；本项目不宣称已替代专业手语翻译或法律援助服务。",
    notes=[(1, "这五起都是已公开报道的真实事件：长春的房屋转让、杭州的借款、贵州的诈骗、山西的离婚、长春九台的人身损害。"),
           (1, "它们有一个共同点：沟通成本直接压在法律时效上，而专业手语翻译是稀缺资源。"),
           (1, "所以我们把项目价值落在一个很小的切口上：让第一句话说得出来，让答复看得懂。"),
           ("narr", "现场操作：只报案例名称、结果与出处，不展开案情细节。")])

add(type="content", chapter_idx=0, title="政策与法律依据",
    sub="法律政策说明需求方向，不证明本项目性能",
    speaker=1,
    body=("cards", [{"n": "01", "t": "法律援助法", "d": "2022 年 1 月 1 日施行，明确残疾人法律援助与通知辩护情形"},
                    {"n": "02", "t": "无障碍环境建设法", "d": "2023 年 9 月 1 日施行，推动公共服务信息无障碍"},
                    {"n": "03", "t": "司法部与残联意见", "d": "降低门槛、重度残疾人探索免予核查经济困难、12348 与 12385 互联互通"},
                    {"n": "04", "t": "地方实践", "d": "青海 2026 年 8 月 20 日起施行：一二级残疾人免于核查经济困难、绿色通道、手语翻译"}], 4, 2.3),
    foot="政策是需求依据；本项目是否真的帮上忙，要用现场实测结果回答。",
    notes=[(1, "《法律援助法》2022 年施行，《无障碍环境建设法》2023 年施行，为公共服务信息无障碍提供了明确依据。"),
           (1, "司法部与中国残联的意见要求降低残疾人法律援助门槛，推动 12348 与 12385 互联互通、法律服务网无障碍改造。"),
           (1, "青海今年 8 月起施行的意见进一步提出：一二级残疾人免于核查经济困难状况，设立绿色通道并配套手语翻译。"),
           (1, "政策说明需求方向，项目效果仍要通过实际测试来回答。"),
           ("narr", "现场操作：停留在法规名称与项目回应，不逐条朗读法条。")])

add(type="content", chapter_idx=0, title="输入与输出：现场信息进入系统，答复回到现场",
    sub="三个方向共享一个服务场景，分别使用识别模型、知识库与动作资源",
    speaker=1,
    body=("columns", [{"h": "输入", "c": ROLE[2], "items": ["摄像头前的手语动作", "工作人员的文字或语音转写", "来访者提出的法律与政策问题"]},
                      {"h": "处理", "c": ROLE[3], "items": ["骨骼关键点提取与运动判断", "知识库检索与智能体组织回答", "目录约束的动作规划与播报调度"]},
                      {"h": "交付", "c": ROLE[4], "items": ["候选文字与语音播报", "带引用的法律途径答复", "数字人动作与双方核对记录"]}], 3.2),
    foot="某个模块出错时显示对应问题，不让另一个模块编造结果。",
    notes=[(1, "三个方向进入同一套系统：手语经过识别变成文字，问题经过知识库变成带引用的答复，答复经过规划变成数字人动作。"),
           (1, "它们共享一个服务场景，但分别使用识别模型、知识库和动作资源，互不替代。"),
           ("narr", "现场操作：指向输入区域、问答区域和数字人区域说明三个方向；此页只做介绍，实际操作在后面的技能环节。")])

# ===== 第二章 项目设计 =====
add(type="chapter", chapter_idx=1, num="第二章", name="项目设计",
    sub="验收指标、系统架构与工作包划分", band="四条验收线 · 五层架构 · 四个工作包",
    speaker=1,
    notes=[(1, "这一章说明四件事：我们怎么验收、系统分几层、四个岗位各自负责哪一段。"),
           ("narr", "现场操作：一号按架构顺序讲解，不展开未实现的模块。")])

add(type="content", chapter_idx=1, title="验收指标：四条验收线，逐项可观测",
    sub="每条验收线都能在现场给出通过、未通过或待复测",
    speaker=1,
    body=("cards", [{"n": "识别", "t": "目标动作可核对", "d": "四词目标动作与反例的现场表现", "to": "现场演示"},
                    {"n": "拒识", "t": "相似手形不误报", "d": "静止手势、相似手形不输出错误词", "to": "现场对照"},
                    {"n": "问答", "t": "答复带引用可核对", "d": "知识库内问题给出依据，超出范围明确转人工", "to": "检索核验"},
                    {"n": "表达", "t": "目录内容可播放", "d": "目录内文字能生成并完整播放", "to": "播放核验"}], 4, 2.3),
    foot="每项记录通过、未通过或待复测，依据现场实际结果填写，不预先写“全部通过”。",
    notes=[(1, "我们把验收拆成四条线：识别能核对、拒识能观察、问答带引用、表达能播放。"),
           (1, "每条线都有对应的观测方式，不靠一句“效果很好”下结论。"),
           ("narr", "现场操作：一号念完四条线后交给各岗位，说明后面会按这四条线逐项核对。")])

add(type="content", chapter_idx=1, title="系统架构：交互、服务、算法、智能体、资源五层协同",
    sub="展示现有架构与本期建设目标，不把规划说成已完成",
    speaker=1,
    body=("cards", [{"n": "交互层", "t": "React 页面", "d": "摄像头采集、结果呈现、问答入口、账号设置"},
                    {"n": "服务层", "t": "Node 服务", "d": "接口、权限与任务调度；全栈由一号维护"},
                    {"n": "算法层", "t": "骨骼跟踪 · 动作识别", "d": "两个环节分开处理，互不编造结果"},
                    {"n": "智能体层", "t": "知识库检索 · 问答组织", "d": "本地模型与向量库，答案附引用与边界提示"},
                    {"n": "资源层", "t": "模型权重 · 动作资源 · 知识库", "d": "版本、协议与知识来源一一对应"}], 3, 2.0),
    foot="某个模块出错时，应显示对应问题，而不是让另一模块编造结果；智能体层为本期建设重点。",
    notes=[(1, "系统分五层。React 页面承接采集与呈现，Node 服务负责接口、权限和调度，这两层由我本人维护。"),
           (1, "算法层把骨骼跟踪和动作识别分开处理；智能体层负责知识库检索与问答组织，是本期建设重点。"),
           (1, "资源层管理模型权重、动作资源和知识库，版本与来源都要对得上。"),
           ("narr", "现场操作：按交互、服务、算法、智能体、资源的顺序讲解，不添加未实现的模块。")])

add(type="content", chapter_idx=1, title="技术链与工作包：四个岗位任务，衔接一次沟通",
    sub="工作包：各岗位负责完成并交付的一段任务",
    speaker=1,
    body=("cards", [{"n": "A", "t": "二号  数据与算法", "d": "交付：样本集、识别模型与现场实测记录", "c": ROLE[2]},
                    {"n": "B", "t": "三号  智能体与知识库", "d": "交付：知识库、问答接口与引用记录", "c": ROLE[3]},
                    {"n": "C", "t": "四号  交互与呈现", "d": "交付：动作表达、播报链路与终端结论", "c": ROLE[4]},
                    {"n": "D", "t": "一号  全栈联调与验收", "d": "交付：联调结论与验收记录", "c": ROLE[1]}], 4, 1.9),
    foot="接口确认后启动下游工作包；岗位交接不只是把文件传给下一个人。",
    notes=[(1, "四个岗位各领一段任务：数据与算法、智能体与知识库、交互与呈现、全栈联调与验收。"),
           (1, "二号交付的模型需要三号在知识对齐时确认版本，三号交付的问答与引用需要四号确认展示方式，四号交付的界面需要回到场景任务验证。"),
           ("narr", "现场操作：各岗位简短接话，不进行没有实际依据的自动验收表演。")])

# ===== 第三章 工作流程 =====
add(type="chapter", chapter_idx=2, num="第三章", name="工作流程",
    sub="双向流程、质量门与操作准备", band="双向流程 · 三道质量门 · 上台前检查",
    speaker=1,
    notes=[(1, "这一章讲流程：一条完整链路怎么走，中间设了哪几道质量门，上台前要检查什么。"),
           ("narr", "现场操作：一号指向流程条，说明中间步骤在后台进行。")])

add(type="content", chapter_idx=2, title="双向流程与三道质量门",
    sub="手语方向、问答方向和表达方向分开处理，共用同一套服务场景",
    speaker=1,
    body=("steps", [{"n": "01", "t": "登记采集"}, {"n": "02", "t": "质量检查"}, {"n": "03", "t": "分组交付"},
                    {"n": "04", "t": "特征与模型"}, {"n": "05", "t": "实时识别"}, {"n": "06", "t": "知识检索"},
                    {"n": "07", "t": "答复与引用"}, {"n": "08", "t": "动作与播报"}, {"n": "09", "t": "联调验收"}], 1.35),
    gates=[("质量门一", "标签与分组可追溯", "来源不清或分组不合理，退回数据岗位", ROLE[2]),
           ("质量门二", "运动证据成立才输出", "证据不足保留不确定，不强行挑一个词", ROLE[2]),
           ("质量门三", "答复必须有引用", "知识库没有依据就转人工，不编造法条", ROLE[3])],
    foot="流程走完不等于通过：每一道质量门都要留下可核对的证据。",
    notes=[(1, "手语方向先提取关键点，再结合时间变化判断动作，给出候选后按规则播报。"),
           (1, "问答方向先检索知识库，再组织答复并附上引用；检索不到依据时明确转人工。"),
           (1, "表达方向先保留原话，由本地模型根据可用动作目录规划，资源完整才开始播放。"),
           ("narr", "现场操作：指向三个方向的不同输入和输出，强调中间步骤在后台进行。")])

add(type="content", chapter_idx=2, title="岗位接口：交付、接收与验收条件",
    sub="接口确认后，下游工作包才启动",
    speaker="all",
    body=("cards", [{"n": "二号 → 三号", "t": "样本集与识别结果", "d": "核对来源、标签与真实拍摄分组", "c": ROLE[2]},
                    {"n": "三号 → 四号", "t": "问答接口与引用格式", "d": "核对知识来源、引用字段与展示方式", "c": ROLE[3]},
                    {"n": "四号 → 一号", "t": "表达与播报链路", "d": "回到场景任务验证是否收到信息", "c": ROLE[4]},
                    {"n": "一号 → 验收", "t": "全栈联调结论", "d": "前后端一致、双方沟通与停止行为正确", "c": ROLE[1]}], 4, 1.9),
    foot="接口确认后启动下游工作包；未确认前不把上游的假设当成下游的输入。",
    notes=[(1, "岗位交接不仅是把文件传给下一个人，还要明确接收方凭什么确认。"),
           (2, "数据来源清楚以后才进入后续处理。"),
           (3, "知识来源清楚以后才允许出现在答复里。"),
           (4, "页面显示成功以后还要确认使用者能收到信息。")])

add(type="content", chapter_idx=2, title="操作前检查：设备、模型、知识与账号",
    sub="上台前逐项确认，避免把准备不足当成现场故障",
    speaker=1,
    body=("cards", [{"n": "01", "t": "设备在线", "d": "摄像头、前后端服务与页面可用"},
                    {"n": "02", "t": "模型版本", "d": "权重与特征协议一致"},
                    {"n": "03", "t": "知识库可用", "d": "条目来源清晰，检索与引用正常"},
                    {"n": "04", "t": "账号与密钥", "d": "使用自己的百炼 Key，不投屏真实密钥"}], 4, 1.9),
    foot="操作前检查记录以现场实际为准；某项不可用就在记录中标明，再选择文字或回放等说明方式。",
    notes=[(1, "上台前我会确认演示任务、服务和账号，再请二号确认模型与摄像头，三号确认知识库与检索，四号确认动作资源和音频。"),
           (1, "接口连接成功以后，还要检查停止、清空和退出是否真正取消旧任务。"),
           ("narr", "现场操作：各岗位只报告自己检查到的状态，不为追求“全部正常”而省略检查。")])

# ===== 第四章 技能要点 =====
add(type="chapter", chapter_idx=3, num="第四章", name="技能要点",
    sub="四岗协同操作，逐段验证交付", band="二号、三号、四号依次展示，一号组织场景联调",
    speaker=1,
    notes=[(1, "这一章是展示主体，由二号、三号、四号依次展示各自岗位的技能，最后由我组织一次完整场景联调。"),
           (1, "每个岗位都会说明输入、处理方法和输出结果，并由接收方当场确认。"),
           ("narr", "现场操作：一号讲完本章安排后退到侧位，二号上前。")])

# --- 工作包 A：二号 ---
add(type="wp", chapter_idx=3, wp="工作包 A：二号负责数据与模型交付，核验来源、标签、分组与现场实测",
    role=2, title="工作包 A：二号  数据与算法工程师",
    sub="从一段录像，到一次可以核对的实时识别",
    steps_in="目标动作定义与真实拍摄条件",
    deliver=[{"n": "01", "t": "采集与登记"}, {"n": "02", "t": "质检与分组"}, {"n": "03", "t": "特征与模型"}, {"n": "04", "t": "实时识别"}],
    duty="样本集、识别模型与现场实测记录",
    speaker=2,
    notes=[(2, "我的输入是一段明确的目标动作和它的拍摄条件，输出是能在实时画面里核对的识别结果。"),
           (2, "这一段会展示四件事：怎么采集与登记、怎么判断质量、怎么按真实拍摄组划分、以及识别是怎么做出来的。"),
           ("narr", "交接语（一号）：首先由二号展示数据如何进入系统。")])

add(type="content", chapter_idx=3, title="数据采集与人工标注",
    sub="工作包 A · 01 采集与登记 —— 保存只保存录像和登记，不自动识别、不自动训练",
    speaker=2,
    body=("cards", [{"n": "01", "t": "明确目标", "d": "录制前确定动作类别、说明与完整动作范围"},
                    {"n": "02", "t": "回看登记", "d": "录完回看，登记类别、说明和真实拍摄轮次"},
                    {"n": "03", "t": "保存即登记", "d": "保存只保存录像与登记，不自动识别、更不自动训练"}], 3, 1.9),
    gates=[("为什么要这样做", "保留人工标签与模型预测的区别", "避免错误预测变成下一轮训练的答案", ROLE[2])],
    foot="拍摄轮次必须对应真实的位置、光线或时段变化，不能只按文件时间猜测。",
    notes=[(2, "录制前先明确目标动作，录完回看并登记类别、说明和完整范围。"),
           (2, "拍摄轮次必须对应真实的位置、光线或时段变化，不能只按文件时间猜测。"),
           (2, "保存只保存录像和登记，不自动识别、更不自动训练。这样可以保留人工标签与模型预测的区别，避免错误预测变成下一轮训练答案。"),
           ("narr", "现场操作：打开学习页，演示录制前的类别和说明入口；使用事先授权的演示样本回看，未准备样本时只演示流程。")])

add(type="content", chapter_idx=3, title="样本质量检查与真实拍摄分组",
    sub="工作包 A · 02 质检与分组 —— 看不清、拿不准、说不清来源的样本都不算通过",
    speaker=2,
    body=("cards", [{"n": "动作看得完整", "t": "完整动作能否看清", "d": "手指、双手关系与动作方向清楚"},
                    {"n": "标签能够核实", "t": "人工标签是否可靠", "d": "含义由人工确认，有疑问的样本先排除"},
                    {"n": "按组划分", "t": "训练集 / 验证集 / 独立测试集", "d": "按完整来源划分，已调试的录像不再算盲测"}], 3, 2.2),
    foot="低质量资料不通过补造关键点或放松门槛制造“通过”；不按同一段录像切片随机分组。",
    notes=[(2, "质量检查看三件事：动作是否看得完整、人工标签是否可靠、失败原因能否留下记录。"),
           (2, "分组则按完整来源和真实拍摄组组织，训练集负责学习，验证集负责调试，真正未见过的测试集负责评价。"),
           (2, "已经参与规则改进的录像，只能称开发回归资料，不能继续拿来证明独立准确率。"),
           ("narr", "现场操作：展示事先准备的质量报告或分组依据，指出通过或未通过的原因，不展示账号隐私。")])

add(type="content", chapter_idx=3, title="从关键点到动作特征",
    sub="工作包 A · 03 特征与模型 —— 模型接收的是一段时间的特征，不是一张静态手形图",
    speaker=2,
    body=("cards", [{"n": "手部关键点", "t": "每只手 21 个关键点", "d": "描述手形及各点之间的相对位置"},
                    {"n": "时间变化", "t": "看连续变化", "d": "观察弯曲、移动方向、速度与持续过程"},
                    {"n": "身体参照", "t": "部分动作还要看身体", "d": "参考身体位置判断方向和范围"}], 3, 2.2),
    foot="单目深度与二维投影是估计值，不是精确空间测量；特征维度与身体参照证据按版本核对。",
    notes=[(2, "画面上的小点确实参与识别。MediaPipe 提供每只手二十一个关键点，我们再从位置和连续变化中提取特征。"),
           (2, "区别“谢谢”和静止点赞，需要看拇指是否发生局部弯曲；区别向自己滑回和向外推，需要看方向。"),
           (2, "“我”这个动作还使用身体参照信息。所以模型接收的是一段时间内的特征，不是一张静态手形图。"),
           ("narr", "现场操作：在实时页开启骨架叠加后，指向手指末端、关节和手腕。")])

add(type="content", chapter_idx=3, title="误识别改进与实时识别展示",
    sub="工作包 A · 04 实时识别 —— 冲突时保留不确定，不强行挑一个词",
    speaker=2,
    body=("compare", {"h": "开发问题：静止点赞被识别成“谢谢”", "c": RGBColor(0xB0, 0x3A, 0x3A),
                      "items": ["相似手形可得高分，但没有完成目标动作", "加入拇指关节与末端的局部变化检查", "不规定弯曲次数，看运动证据是否成立"]},
          {"h": "现场展示：四词识别与反例对照", "c": ROLE[2],
           "items": ["开启实时页与骨架叠加", "依次完成谢谢、帮助、需要、我", "再做静止与相似动作反例"], }, 2.5),
    foot="只读现场结果；没有识别时报告“本次未出候选”，不可用回放冒充现场识别。",
    notes=[(2, "开发中遇到过一个明显问题：静止点赞被识别成“谢谢”。我们把拇指关节和末端的局部变化加入检查，区分整只手移动与拇指自身弯曲。"),
           (2, "现在开始现场识别。请评委同时观察骨架、候选文字和语音三个部分。"),
           (2, "我依次完成谢谢、帮助、需要和我，再用静止手势进行对照，每次只记录实际出现的结果。"),
           (2, "报告组长，数据与算法环节已展示采集、质检、分组、模型与实时识别，现场结果请按实际表现记录。"),
           (1, "收到，接下来由三号把这些结果接入法律问答链路。"),
           ("narr", "现场操作：“我”结束后先双手出画再做下一词；摄像头不可用时说明原因。")])

# --- 工作包 B：三号 ---
add(type="wp", chapter_idx=3, wp="工作包 B：三号负责知识库与问答交付，核验来源、引用与拒答表现",
    role=3, title="工作包 B：三号  智能体与知识库工程师",
    sub="让法律问题有出处，让答不了的问题明确转人工",
    steps_in="识别结果与法律政策资料",
    deliver=[{"n": "01", "t": "知识库构建"}, {"n": "02", "t": "检索与问答"}, {"n": "03", "t": "引用与拒答"}, {"n": "04", "t": "接口交付"}],
    duty="知识库、问答接口与引用记录",
    speaker=3,
    notes=[(3, "我的输入是二号给出的识别结果，以及公开的法律政策资料；输出是带引用的答复，以及答不了时明确的转人工提示。"),
           (3, "这一段会说明：知识库怎么建、问答怎么组织、引用怎么核对、答不了怎么办。"),
           ("narr", "交接语（三号）：下面展示法律问题如何变成有出处的答复。")])

add(type="content", chapter_idx=3, title="法律与政策知识库构建",
    sub="工作包 B · 01 知识库 —— 每一条资料都登记来源与生效时间",
    speaker=3,
    body=("steps", [{"n": "收录", "t": "法律与政策原文", "d": "法律援助法、无障碍环境建设法、民法典相关条款"},
                    {"n": "补充", "t": "办事指南", "d": "12348 与 12385 热线、法援中心与残联工作站"},
                    {"n": "切片", "t": "分条与标注", "d": "按条款与办事步骤切片，标注来源与生效时间"},
                    {"n": "入库", "t": "向量检索", "d": "本地向量库存储，检索返回原文片段"}], 1.7),
    foot="知识库只收录公开法律政策与办事信息；不收录个案隐私，当事人案情不进入检索。",
    notes=[(3, "知识库先收录法律与政策原文，例如法律援助法、无障碍环境建设法，以及民法典里的相关条款。"),
           (3, "再补充办事指南：12348 与 12385 热线、法律援助中心、残联法律援助工作站这些真实渠道。"),
           (3, "每一条都按条款或办事步骤切片，标注来源和生效时间，检索时返回原文片段而不是让模型自己编。"),
           ("narr", "现场操作：展示知识库条目与来源字段，不展示任何个人案情数据。")])

add(type="content", chapter_idx=3, title="法律问答智能体",
    sub="工作包 B · 02 检索与问答 —— 先检索，再组织，不凭印象作答",
    speaker=3,
    body=("cards", [{"n": "01", "t": "理解问题", "d": "识别来访者问的是哪一类法律问题"},
                    {"n": "02", "t": "检索依据", "d": "在本地知识库中检索相关条款与办事步骤"},
                    {"n": "03", "t": "组织答复", "d": "给出途径、材料清单与时效提醒"},
                    {"n": "04", "t": "标注边界", "d": "说明不构成法律意见，紧急情况直接转人工"}], 4, 2.2),
    foot="答复只做途径指引与信息说明，不代替律师、法援中心和专业手语翻译的判断。",
    notes=[(3, "智能体先判断来访者问的是哪一类问题，再在本地知识库里检索相关条款与办事步骤。"),
           (3, "答复的组织方式是：先说可以走哪条途径，再说需要准备哪些材料，最后提醒时效。"),
           (3, "结尾一定会标注：这是信息说明，不构成法律意见；遇到紧急情况请直接联系 12348 或现场工作人员。"),
           ("narr", "现场操作：在问答区输入一个示范问题，展示检索到的片段与答复，不现场修改知识库。")])

add(type="content", chapter_idx=3, title="回答可核对：引用与拒答",
    sub="工作包 B · 03 引用与拒答 —— 没有依据就不回答，这是设计的一部分",
    speaker=3,
    body=("compare", {"h": "能回答：附来源", "c": ROLE[3],
                      "items": ["答复下方列出引用的条款或指南", "标注来源名称与生效时间", "可点开查看原文片段"]},
          {"h": "不能回答：转人工", "c": RGBColor(0xB0, 0x6A, 0x00),
           "items": ["知识库没有依据时明确说明“暂无依据”", "给出 12348、12385 与法援中心的真实渠道", "不猜测、不编造法条与结论"]}, 2.5),
    foot="宁可少答一句，也不能答错一条；出处可以核对，是这套问答的第一要求。",
    notes=[(3, "能回答的问题，答复下方会列出引用的条款或办事指南，并标注来源名称和生效时间。"),
           (3, "检索不到依据时，我们明确说明暂无依据，并给出 12348、12385 和法律援助中心这些真实渠道。"),
           (3, "宁可少答一句，也不能答错一条。出处能不能核对，是这套问答的第一要求。"),
           ("narr", "现场操作：示范一个有依据的问题和一个超出知识库的问题，只读实际输出。")])

add(type="content", chapter_idx=3, title="场景示例：一次法律援助问答",
    sub="工作包 B · 演示 —— 从一句话诉求，到一份可执行的途径清单",
    speaker=3,
    body=("steps", [{"n": "来访者", "t": "我的房子被低价转走了", "d": "手语识别得到“需要”“帮助”"},
                    {"n": "检索", "t": "民法典与法援条款", "d": "显失公平、撤销权与时效规定"},
                    {"n": "答复", "t": "途径 + 材料 + 时效", "d": "12348、法援中心、残联工作站"},
                    {"n": "提醒", "t": "时效优先", "d": "提示尽快申请，附引用来源"},
                    {"n": "转人工", "t": "需要代理时", "d": "告知可申请法律援助与手语翻译"}], 1.7),
    foot="示例用于说明链路；真实案件请以法援机构和律师的意见为准。",
    notes=[(3, "以长春那类房屋转让问题为例：来访者用手语表达“需要帮助”，系统识别后进入问答。"),
           (3, "知识库检索到民法典关于显失公平和撤销权的规定，答复给出途径、材料清单和时效提醒。"),
           (3, "如果需要代理人，就告知可以申请法律援助，并说明可以要求提供手语翻译。"),
           ("narr", "现场操作：只读系统实际输出；不展示任何真实当事人的信息。")])

add(type="content", chapter_idx=3, title="知识库交付与接口",
    sub="工作包 B · 04 交付 —— 三号交给四号，四号当场核对",
    speaker=3,
    body=("cards", [{"n": "交付项", "t": "知识库与问答接口", "d": "条目来源表、检索接口、引用字段定义"},
                    {"n": "接收方", "t": "四号核对展示", "d": "引用是否在界面上完整可见"},
                    {"n": "边界", "t": "本地部署", "d": "案情不上传云端，问答在本地完成"},
                    {"n": "本期状态", "t": "原型与建设目标", "d": "已完成的与建设中的分别标注，不混为一谈"}], 4, 2.2),
    foot="已完成的与建设中的分别标注；不把规划中的能力说成现场已验证。",
    notes=[(3, "我交付的是知识库条目来源表、检索接口和引用字段定义。"),
           (4, "我这边会核对引用是否在界面上完整可见。"),
           (3, "边界也说清楚：检索与问答在本地完成，当事人案情不上传云端。"),
           (3, "本期已完成的和仍在建设的，我会在记录里分别标注，不把规划说成已验证。"),
           ("narr", "现场操作：三号展示接口与来源表，四号确认展示方式。")])

# --- 工作包 C：四号 ---
add(type="wp", chapter_idx=3, wp="工作包 C：四号负责交互交付，核验规划、播放与播报",
    role=4, title="工作包 C：四号  智能交互开发工程师",
    sub="把文字变成动作，把候选变成可听见的信息",
    steps_in="识别候选、问答答复与工作人员文字",
    deliver=[{"n": "01", "t": "目录约束规划"}, {"n": "02", "t": "数字人呈现"}, {"n": "03", "t": "播报与终端适配"}],
    duty="动作表达、语音播报链路与终端试用结论",
    speaker=4,
    notes=[(4, "我的输入是二号给出的识别候选、三号给出的问答答复，以及工作人员输入的文字。"),
           (4, "输出是来访者能看到的动作、能读懂的答复和能听到的声音。"),
           ("narr", "交接语（四号）：接下来展示这些内容如何呈现给来访者。")])

add(type="content", chapter_idx=3, title="文字到动作与数字人呈现",
    sub="工作包 C · 01 规划与呈现 —— 原话保留在前端，匹配与编排在后台",
    speaker=4,
    body=("steps", [{"n": "输入", "t": "我需要帮助", "d": "使用者原话不改写"},
                    {"n": "规划", "t": "目录约束", "d": "本地模型依据可用动作目录"},
                    {"n": "检查", "t": "资源与语义", "d": "动作标识存在、语义覆盖、资源完整"},
                    {"n": "播放", "t": "我 → 需要 → 帮助", "d": "按序连续播放并观察手形方向"}], 1.7),
    foot="关键语义缺失时不跳过、不猜补；能流畅播放不等于专业语义已验收。",
    notes=[(4, "使用者输入的是自然语言，播放器需要的是明确的动作资源。我们让本地模型结合可用动作目录规划，再检查标识、语义和资源。"),
           (4, "前端保留用户原话，后台处理匹配和编排，准备完整后再连续播放。"),
           (4, "“需要”只向自己滑回，不额外加点胸片段；画面流畅只能证明渲染链路工作，表达是否易懂还需专业人员审核。"),
           ("narr", "现场操作：播放“我需要帮助”与“好，请等候”；必要时暂停回看，不临场编辑动作定义。")])

add(type="content", chapter_idx=3, title="候选播报、引用展示与个人 API Key",
    sub="工作包 C · 02 播报与展示 —— 候选出现即播报，引用必须看得见",
    speaker=4,
    body=("cards", [{"n": "01", "t": "候选出现即播报", "d": "无需点击确认整句；保持手势不反复念"},
                    {"n": "02", "t": "引用随答复展示", "d": "来源名称与原文片段可点开核对"},
                    {"n": "03", "t": "各账号填自己的 Key", "d": "百炼 Key 后端加密保存且不回显"},
                    {"n": "04", "t": "取消与隐私", "d": "停止或切后台取消队列；云端仅接收播报文字"}], 4, 2.2),
    foot="当前音色为千问 Cherry；网络异常时文字结果仍保留，不投屏真实密钥。",
    notes=[(4, "候选首次出现就进入播报队列，停止识别或切到后台时取消队列和迟到结果。"),
           (4, "法律答复的引用必须在界面上完整可见，来源名称和原文片段可以点开核对。"),
           (4, "交付给其他使用者时不携带原作者密钥，各账号在设置中填写自己的百炼 Key，后端加密保存且不回显。"),
           ("narr", "现场操作：展示引用展示区域与 Key 入口，输入框保持为空。")])

add(type="content", chapter_idx=3, title="Web 与安卓本地试用",
    sub="工作包 C · 03 终端适配 —— 浏览器结果不能替代原生验收",
    speaker=4,
    body=("cards", [{"n": "01", "t": "Web", "d": "现有开发与演示主入口，实时页与问答入口在此演示"},
                    {"n": "02", "t": "安卓", "d": "HBuilderX 工程与浏览器本地试用四词识别相关能力"},
                    {"n": "03", "t": "交付", "d": "携带推理权重与动作资源，不携带训练原片与密钥"}], 3, 2.2),
    foot="摄像头权限、性能与安装包云语音，都还要在原生环境继续测试。",
    notes=[(4, "Web 是本轮主要演示入口。安卓方向已准备 HBuilderX 工程，并在浏览器本地试用四词识别相关能力。"),
           (4, "迁移时携带推理权重和动作资源，不把训练录像和服务密钥放进安装包。"),
           (4, "浏览器运行结果不能直接替代原生安卓验收，摄像头权限、性能和安装包云语音都还要继续测试。"),
           (4, "报告组长，交互环节展示完成。"),
           ("narr", "现场操作：展示安卓浏览器预览，明确“电脑浏览器试用”字样。")])

# --- 工作包 D：一号 ---
add(type="content", chapter_idx=3, title="全栈联调准备",
    sub="工作包 D · 联调 01 —— 上台前逐项确认，接口连通不是联调完成",
    speaker=1, tag="场景联调",
    body=("cards", [{"n": "一号", "t": "前后端与账号", "d": "页面、服务、接口与演示账号一致", "c": ROLE[1]},
                    {"n": "二号", "t": "模型与摄像头", "d": "权重、特征协议与摄像头状态", "c": ROLE[2]},
                    {"n": "三号", "t": "知识库与检索", "d": "条目来源清晰，检索与引用正常", "c": ROLE[3]},
                    {"n": "四号", "t": "动作资源与音频", "d": "目录资源完整，播报链路可用", "c": ROLE[4]}], 4, 2.2),
    foot="接口连通后还要检查停止、清空与退出是否真正取消旧任务。",
    notes=[(1, "联调由我组织。我先确认前后端服务与账号，再请二号确认模型与摄像头，三号确认知识库与检索，四号确认动作资源和音频。"),
           (1, "接口连接成功以后，还要检查停止、清空和退出是否真正取消旧任务。"),
           ("narr", "现场操作：各岗位只报告自己检查到的状态；若某项不可用，在现场记录中标明。")])

add(type="content", chapter_idx=3, title="紧急求助与法律援助场景演示",
    sub="工作包 D · 联调 02 —— 一次分步骤的完整沟通演练",
    speaker="all", tag="场景联调",
    body=("steps", [{"n": "01", "t": "来访者表达", "d": "二号做“我 / 需要 / 帮助”"},
                    {"n": "02", "t": "系统给出候选", "d": "候选文字并播报"},
                    {"n": "03", "t": "提出法律问题", "d": "检索知识库并给出带引用的答复"},
                    {"n": "04", "t": "工作人员回应", "d": "四号输入“好，请等候”，数字人播放"},
                    {"n": "05", "t": "双方核对", "d": "确认是否理解一致"}], 1.7),
    foot="界面不会自动把几个识别词拼成完整句子；若实际词语不对，先纠正，不沿预设台词宣布成功。",
    notes=[(1, "现在模拟一次窗口接待。二号扮演使用手语的来访者，四号扮演工作人员。"),
           (2, "我将用已支持的动作表达求助。"),
           (3, "系统给出候选后，我把问题接入知识库，给出带引用的途径答复。"),
           (4, "我根据实际识别到的信息回应，输入“好，请等候”。"),
           (1, "请观察文字、引用和数字人动作。最后双方核对是否理解一致。"),
           ("narr", "现场操作：“我”结束后先双手出画，再做“需要”和“帮助”。三号观察引用是否正确，一号口头记录。")])

add(type="content", chapter_idx=3, title="异常情况的处理与统一验收",
    sub="工作包 D · 联调 03 —— 出错以后怎么办，同样要验收",
    speaker="all", tag="场景联调",
    body=("cards", [{"n": "识别侧", "t": "优先避免输出错误词", "d": "动作不清楚或证据冲突时保留不确定", "c": ROLE[2]},
                    {"n": "问答侧", "t": "无依据即转人工", "d": "给出 12348 与法援中心渠道，不编造法条", "c": ROLE[3]},
                    {"n": "播报侧", "t": "语音异常时文字仍可见", "d": "目录不能覆盖关键语义时不跳过继续播放", "c": ROLE[4]},
                    {"n": "验收", "t": "四类结果逐项核对", "d": "数据、识别、引用、沟通，各记通过与未通过", "c": ROLE[1]}], 4, 2.2),
    foot="每项记录通过、未通过或待复测；合成测试与开发回放用于回归检查，不能替代独立测试。",
    notes=[(2, "动作不清楚或证据冲突时，我们优先避免输出错误词。"),
           (3, "知识库没有依据时明确转人工，给出真实渠道，不编造法条。"),
           (4, "语音服务异常时，文字结果仍然可见。"),
           (1, "统一验收核对四类结果：数据可追溯、识别表现、引用可核对、双方沟通与停止行为。"),
           ("narr", "现场操作：四人按岗位逐项报结论，一号汇总真实结果，不预先写“全部通过”。")])

# ===== 第五章 创新成果 =====
add(type="chapter", chapter_idx=4, num="第五章", name="创新成果",
    sub="技术改进、阶段成果与过程证据", band="技术改进 · 阶段成果 · 过程证据",
    speaker=1,
    notes=[(1, "这一章只说已经做过的事：解决了什么问题、现在做到哪一步、留下了哪些可核对的记录。"),
           ("narr", "现场操作：全员各说自己岗位的成果，一号明确当前边界。")])

add(type="content", chapter_idx=4, title="技术难题与创新",
    sub="难题、解法与验证证据一一对应",
    speaker=1,
    body=("cards", [{"n": "相似手形误报", "t": "运动证据与分动作协议", "d": "静止点赞对照与现场记录"},
                    {"n": "紧急场景说不出话", "t": "四词识别 + 目录内表达", "d": "先让第一句话说得出来"},
                    {"n": "法律问题无处可问", "t": "本地知识库与引用核对", "d": "答复附来源，无依据转人工"},
                    {"n": "数据混用导致分数虚高", "t": "按真实拍摄组划分", "d": "来源哈希与分组记录"}], 4, 2.4),
    foot="以上为开发过程中的改进与记录，不代表已通过独立测试评价。",
    notes=[(1, "第一个难题是相似手形误报，解法是运动证据与分动作协议。"),
           (1, "第二个难题是紧急场景下说不出话，解法是先做四词识别与目录内表达，让第一句话说得出来。"),
           (1, "第三个难题是法律问题无处可问，解法是本地知识库加引用核对，没有依据就转人工。"),
           (1, "第四个难题是数据混用导致分数虚高，解法是按真实拍摄组划分。"),
           ("narr", "现场操作：按难题类型讲，不使用“全国首创”“完全替代”等表述。")])

add(type="content", chapter_idx=4, title="阶段成果与当前边界",
    sub="说清已经有的，也说清还没有验证的",
    speaker="all",
    body=("compare", {"h": "当前已有", "c": ROLE[2],
                      "items": ["数据侧形成保存、登记、质检与复核流程", "算法侧接入谢谢、帮助、需要、我，并做过误报改进", "交互侧已有数字人表达与千问播报"]},
          {"h": "继续建设与验证", "c": RGBColor(0xB0, 0x6A, 0x00),
           "items": ["法律政策知识库仍在扩充，问答为原型阶段", "新使用者与新环境下的识别表现", "数字人的专业可理解性", "原生安卓与真实窗口任务"]}, 2.7),
    foot="当前成果是有限词汇下的可运行链路；不引用其他案例的准确率、收益或专利成果。",
    notes=[(2, "数据侧已经形成保存、登记、质检和复核的流程。"),
           (2, "算法侧已经接入谢谢、帮助、需要、我，并针对静止误报做过开发改进。"),
           (3, "知识库与问答仍在建设，本期按原型展示，不宣称已经覆盖全部法律问题。"),
           (4, "应用侧已有数字人表达和千问播报，安卓仍处于本地试用推进阶段。"),
           (1, "当前阶段的成果是有限词汇下的可运行链路，真实窗口任务完成率仍需继续评价。"),
           ("narr", "现场操作：一号明确当前边界，不引用案例中的百分比或商业收益数据。")])

add(type="content", chapter_idx=4, title="过程证据与依据材料",
    sub="说过的话可以核对，引用的材料说明来源",
    speaker=1,
    body=("cards", [{"n": "过程证据", "t": "样本登记与质检结论", "d": "分组依据、模型版本与现场记录相互关联"},
                    {"n": "案例来源", "t": "已公开报道", "d": "法治网、检察日报、山西法治网、地方残联与法院公开信息"},
                    {"n": "法律依据", "t": "法律与部门意见", "d": "法律援助法、无障碍环境建设法、司法部与残联意见"}], 3, 2.2),
    foot="引用材料只用于说明需求真实存在，不把其他案例的数据与成果当作语桥事实。",
    notes=[(1, "我们把过程证据、案例来源和法律依据分开列出，每一项都能查到出处。"),
           (1, "参考材料只用于组织讲解和说明需求，不把其他案例的数据与成果当作语桥事实。"),
           ("narr", "现场操作：仅在评委要求时展开来源清单，不逐条朗读。")])

# ===== 第六章 价值展望 =====
add(type="chapter", chapter_idx=5, num="第六章", name="价值展望",
    sub="应用价值与下一阶段计划", band="应用价值 · 下一阶段计划",
    speaker=1,
    notes=[(1, "最后说明两件事：这套系统对紧急求助与法律咨询有什么用，以及下一步按什么顺序继续做。"),
           ("narr", "现场操作：一号按优先级讲，不承诺未确定的上线日期。")])

add(type="content", chapter_idx=5, title="应用价值与下一阶段计划",
    sub="按缺口排优先级，不承诺未验证的成果",
    speaker=1,
    body=("cards", [{"n": "应用价值", "t": "让第一句话说得出来", "d": "降低窗口沟通成本，减少反复解释"},
                    {"n": "知识库", "t": "继续扩充法律政策条目", "d": "补充地方办事指南与热线渠道"},
                    {"n": "独立评估", "t": "冻结版本再评价", "d": "用没有参与调试的数据建立独立评估"},
                    {"n": "终端推进", "t": "原生设备联调", "d": "HBuilder 原生设备、性能与云服务联调"}], 4, 2.3),
    foot="交互侧重点检查用户怎样纠错、怎样复看；最终希望由实际使用者参与测试。",
    notes=[(1, "下一步先扩充法律政策知识库，补充地方办事指南与热线渠道。"),
           (1, "然后冻结版本，使用没有参与调试的数据建立独立评估。"),
           (1, "交互侧重点检查用户怎样纠错、怎样复看，动作是否容易理解；终端侧继续做原生设备和云服务联调。"),
           (1, "最终希望由实际使用者参与测试，让系统的改进对应真实沟通需求。"),
           ("narr", "现场操作：按优先级讲，不承诺未确定的上线日期。")])

add(type="end", title="让紧急的求助被看见，让法律的答复被听懂",
    sub="一座语桥，让沟通更简单",
    meta="感谢各位评委老师的聆听",
    speaker="all",
    notes=[(1, "语桥从公共服务窗口的紧急求助与法律援助出发，把数据处理、动作识别、知识问答和数字人连接到一次具体沟通中。"),
           (2, "让样本来源清楚，让每次改进有依据。"),
           (3, "让每个答复都有出处，让答不了的问题明确转人工。"),
           (4, "让表达能够传递，让回应便于理解。"),
           ("all", "一座语桥，让沟通更简单。感谢各位评委老师的聆听。"),
           ("narr", "现场操作：四人回到台前并排站定，结束后统一鞠躬；答辩按问题所属模块由对应岗位回答。")])

# ---------- 渲染 ----------
def build(out_path):
    prs = Presentation()
    prs.slide_width = Inches(W)
    prs.slide_height = Inches(H)
    total = len(S)

    for idx, d in enumerate(S, start=1):
        t = d["type"]
        sl = blank(prs)
        solid_bg(sl, BG)

        if t == "cover":
            solid_bg(sl, NAVY)
            logo(sl, dark=True)
            # 顶部小字
            tf = textbox(sl, 0.9, 0.92, W - 1.8, 0.5)
            put(tf, d["eyebrow"], 15, False, RGBColor(0xA8, 0xC6, 0xC1), PP_ALIGN.CENTER, first=True)
            # 中间大字
            tf = textbox(sl, 0.9, 2.30, W - 1.8, 1.5)
            put(tf, d["title"], 66, True, RGBColor(0xFF, 0xFF, 0xFF), PP_ALIGN.CENTER, first=True)
            # 一道横
            lw = 5.0
            rect(sl, (W - lw) / 2, 4.00, lw, 0.05, fill=RGBColor(0x8F, 0xC4, 0xBC), radius=0.0)
            # 副标题
            tf = textbox(sl, 0.9, 4.28, W - 1.8, 0.8)
            put(tf, d["sub"], 26, False, RGBColor(0xE2, 0xF0, 0xED), PP_ALIGN.CENTER, first=True)
            tf = textbox(sl, 0.9, 5.30, W - 1.8, 0.7)
            put(tf, d["tag"], 20, True, RGBColor(0x8F, 0xC4, 0xBC), PP_ALIGN.CENTER, first=True)
            set_notes(sl, d["notes"], {"title": d["title"], "speaker_txt": "全员"})
            continue

        if t == "end":
            solid_bg(sl, NAVY)
            logo(sl, dark=True)
            tf = textbox(sl, 0.9, 2.35, 11.5, 1.2)
            put(tf, d["title"], 40, True, RGBColor(0xFF, 0xFF, 0xFF), PP_ALIGN.CENTER, first=True)
            tf = textbox(sl, 0.9, 3.65, 11.5, 0.8)
            put(tf, d["sub"], 24, True, RGBColor(0x8F, 0xC4, 0xBC), PP_ALIGN.CENTER, first=True)
            tf = textbox(sl, 0.9, 5.6, 11.5, 0.6)
            put(tf, d["meta"], 18, False, RGBColor(0xE2, 0xF0, 0xED), PP_ALIGN.CENTER, first=True)
            set_notes(sl, d["notes"], {"title": d["title"], "speaker_txt": "全员"})
            continue

        if t == "chapter":
            solid_bg(sl, NAVY)
            logo(sl, dark=True)
            ci = d["chapter_idx"]
            num, name = CHAPTERS[ci]
            sh = rect(sl, 0.9, 1.5, 3.4, 0.9, fill=None, line=RGBColor(0x8F, 0xC4, 0xBC), lw=1.5, radius=0.3)
            tf = sh.text_frame
            tf.vertical_anchor = MSO_ANCHOR.MIDDLE
            put(tf, d["num"], 20, True, RGBColor(0x8F, 0xC4, 0xBC), PP_ALIGN.CENTER, first=True)
            tf = textbox(sl, 0.9, 2.7, 11.5, 1.4)
            put(tf, name, 46, True, RGBColor(0xFF, 0xFF, 0xFF), first=True)
            tf = textbox(sl, 0.9, 4.15, 11.5, 0.6)
            put(tf, d["sub"], 17, False, RGBColor(0xC3, 0xDB, 0xD7), first=True)
            sh = rect(sl, 0.9, 5.15, 7.4, 0.56, fill=RGBColor(0x11, 0x53, 0x4E), radius=0.12)
            tf = sh.text_frame
            tf.vertical_anchor = MSO_ANCHOR.MIDDLE
            put(tf, d.get("band", ""), 12.5, True, RGBColor(0xE2, 0xF0, 0xED), first=True)
            nav_bar(sl, ci, dark=True)
            set_notes(sl, d["notes"], {"title": name, "speaker_txt": ROLE_NAME[d["speaker"]]})
            continue

        ci = d["chapter_idx"]
        spk = d.get("speaker")
        spk_txt = "全员" if spk == "all" else ROLE_NAME.get(spk, "—")
        logo(sl)

        if t == "team":
            top = page_head(sl, ci, d["title"], d["sub"], idx, total, speaker="all")
            n = len(d["roles"])
            gap = 0.22
            cw = (W - 1.1 - gap * (n - 1)) / n
            for i, (rid, name, duties, deliver) in enumerate(d["roles"]):
                x = 0.55 + i * (cw + gap)
                col = ROLE[rid]
                card = rect(sl, x, top, cw, 3.05, fill=CARD, line=LINE, radius=0.05)
                bar = rect(sl, x, top, cw, 0.09, fill=col, radius=0.0)
                tf = card.text_frame
                tf.vertical_anchor = MSO_ANCHOR.TOP
                put(tf, name, 15, True, col, space_after=8, first=True)
                for du in duties:
                    put(tf, "· " + du, 11, False, SUB, space_after=3, line=1.25)
                put(tf, deliver, 11, True, col, space_after=0)
            foot_note(sl, d["foot"], 5.72)
            nav_bar(sl, ci)
            set_notes(sl, d["notes"], {"title": d["title"], "speaker_txt": spk_txt})
            continue

        if t == "toc":
            top = page_head(sl, ci, d["title"], d["sub"], idx, total, speaker=spk)
            arch_bridge(sl, d["rows"])
            photo_strip(sl, 5.98, 0.60,
                        ["窗口实景", "法援中心", "急救报警", "现场演示"])
            nav_bar(sl, ci)
            set_notes(sl, d["notes"], {"title": d["title"], "speaker_txt": spk_txt})
            continue

        if t == "wp":
            wp_page(sl, ci, d["wp"], d["role"], d["title"], d["sub"], d["steps_in"],
                    d["deliver"], d["duty"], idx, total)
            set_notes(sl, d["notes"], {"title": d["title"], "speaker_txt": spk_txt})
            continue

        if t == "content":
            col = ROLE.get(spk, ACCENT) if isinstance(spk, int) else ACCENT
            title = d["title"]
            if d.get("tag"):
                title = title + "　【" + d["tag"] + "】"
            top = page_head(sl, ci, title, d["sub"], idx, total, speaker=spk)
            kind = d["body"][0]
            if kind == "cards":
                _, items, cols, h = d["body"]
                cards(sl, items, top, cols=cols, height=h, accent=col)
                after = top + h + 0.24
            elif kind == "steps":
                _, items, h = d["body"]
                steps(sl, items, top, height=h, accent=col)
                after = top + h + 0.24
            elif kind == "columns":
                _, secs, h = d["body"]
                columns(sl, secs, top, height=h, accent=col)
                after = top + h + 0.24
            elif kind == "compare":
                _, left, right, h = d["body"]
                compare(sl, left, right, top, height=h)
                after = top + h + 0.24
            else:
                after = top
            if d.get("gates"):
                gy = after
                for (gn, gt, gd, gc) in d["gates"]:
                    gr = rect(sl, 0.55, gy, W - 1.1, 0.52, fill=SOFT, radius=0.28)
                    tf = gr.text_frame
                    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
                    p = tf.paragraphs[0]
                    r = p.add_run(); r.text = gn + "  "
                    set_font(r, 12, True, gc)
                    r = p.add_run(); r.text = gt + "  ·  "
                    set_font(r, 12, True, INK)
                    r = p.add_run(); r.text = gd
                    set_font(r, 11.5, False, SUB)
                    gy += 0.6
                after = gy
            foot_note(sl, d.get("foot", ""), 6.42 if after < 6.4 else 6.42)
            nav_bar(sl, ci)
            set_notes(sl, d["notes"], {"title": d["title"], "speaker_txt": spk_txt})
            continue

    prs.save(out_path)
    return total


if __name__ == "__main__":
    out = r"E:\Desktop\项目\逐字稿与ppt\语桥无界_四人汇报_第三版.pptx"
    n = build(out)
    print("saved:", out, "slides:", n)
