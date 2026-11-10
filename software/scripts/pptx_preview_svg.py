# -*- coding: utf-8 -*-
"""把 pptx 指定页渲染成 SVG 预览（矩形/圆角矩形/椭圆/文本框 + 旋转 + 简易折行），用于快速视觉校验。"""
import sys
import unicodedata
from pptx import Presentation
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR

EMU = 914400
PT = 72.0


def hexc(color):
    try:
        return "#%s" % str(color)
    except Exception:
        return "#cccccc"


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def chw(c):
    return 1.0 if unicodedata.east_asian_width(c) in ("W", "F") else 0.53


def wrap(text, size, maxw):
    """简易折行：按字符宽度切分"""
    if not text:
        return []
    unit = size / 72.0
    lines, cur, curw = [], "", 0.0
    for c in text:
        w = chw(c) * unit
        if curw + w > maxw and cur:
            lines.append(cur)
            cur, curw = c, w
        else:
            cur += c
            curw += w
    if cur:
        lines.append(cur)
    return lines


def shape_svg(sh):
    if sh.left is None:
        return ""
    x, y = sh.left / EMU, sh.top / EMU
    w, h = sh.width / EMU, sh.height / EMU
    rot = sh.rotation or 0
    cx, cy = x + w / 2, y + h / 2
    tf = ' transform="rotate(%.2f %.2f %.2f)"' % (rot, cx * PT, cy * PT) if rot else ""
    fill = "none"
    try:
        if sh.fill.type == 1:
            fill = hexc(sh.fill.fore_color.rgb)
    except Exception:
        pass
    stroke, sw = "none", 1
    try:
        if sh.line.fill.type == 1:
            stroke = hexc(sh.line.color.rgb)
            sw = (sh.line.width.pt if sh.line.width else 1)
    except Exception:
        pass
    name = str(sh.shape_type)
    out = []
    if "OVAL" in name or "ELLIPSE" in name:
        out.append('<ellipse cx="%.2f" cy="%.2f" rx="%.2f" ry="%.2f" fill="%s" stroke="%s" stroke-width="%.1f"%s/>'
                   % (cx * PT, cy * PT, w / 2 * PT, h / 2 * PT, fill, stroke, sw, tf))
    else:
        rx = min(w, h) * PT * 0.08
        try:
            if sh.adjustments and len(sh.adjustments):
                rx = min(w, h) / 2 * PT * float(sh.adjustments[0])
        except Exception:
            pass
        out.append('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="%.2f" fill="%s" stroke="%s" stroke-width="%.1f"%s/>'
                   % (x * PT, y * PT, w * PT, h * PT, rx, fill, stroke, sw, tf))
    if sh.has_text_frame:
        tfm = sh.text_frame
        ml = (tfm.margin_left or 0) / EMU * PT
        mr = (tfm.margin_right or 0) / EMU * PT
        mt = (tfm.margin_top or 0) / EMU * PT
        maxw = w * PT - ml - mr
        blocks = []
        total = 0.0
        for p in tfm.paragraphs:
            t = "".join(r.text for r in p.runs)
            if not t:
                continue
            sz = max([(r.font.size.pt if r.font.size else 14) for r in p.runs] or [14])
            col, bold = "#222", False
            for r in p.runs:
                try:
                    if r.font.color and r.font.color.type is not None:
                        col = hexc(r.font.color.rgb)
                except Exception:
                    pass
                bold = bool(r.font.bold)
                break
            ls = p.line_spacing if isinstance(p.line_spacing, float) else 1.2
            sa = (p.space_after.pt if p.space_after else 0)
            al = p.alignment
            lines = wrap(t, sz, maxw)
            blocks.append((lines, sz, col, bold, ls, sa, al))
            total += len(lines) * sz * ls + sa
        if blocks:
            anchor_val = tfm.vertical_anchor
            ty = y * PT + mt
            if anchor_val == MSO_ANCHOR.MIDDLE:
                ty += (h * PT - mt * 2 - total) / 2
            elif anchor_val == MSO_ANCHOR.BOTTOM:
                ty += (h * PT - mt * 2 - total)
            out.append("<g%s>" % tf)
            for (lines, sz, col, bold, ls, sa, al) in blocks:
                for ln in lines:
                    ty += sz * ls
                    if al == PP_ALIGN.CENTER:
                        tx, anc = (x + w / 2) * PT, "middle"
                    elif al == PP_ALIGN.RIGHT:
                        tx, anc = (x + w) * PT - mr, "end"
                    else:
                        tx, anc = x * PT + ml, "start"
                    out.append('<text x="%.1f" y="%.1f" font-size="%.1f" fill="%s" font-weight="%s" '
                               'text-anchor="%s" font-family="Microsoft YaHei,sans-serif">%s</text>'
                               % (tx, ty, sz, col, 700 if bold else 400, anc, esc(ln)))
                ty += sa
            out.append("</g>")
    return "".join(out)


def render(path, pages, out_svg, cols=2):
    prs = Presentation(path)
    W, H = prs.slide_width / EMU, prs.slide_height / EMU
    per_w = W * PT + 24
    per_h = H * PT + 34
    parts = []
    for k, idx in enumerate(pages):
        sl = prs.slides[idx - 1]
        ox, oy = (k % cols) * per_w, (k // cols) * per_h
        parts.append('<g transform="translate(%.1f,%.1f)">' % (ox, oy))
        parts.append('<text x="0" y="-10" font-size="13" fill="#888" font-family="sans-serif">P%02d</text>' % idx)
        parts.append('<rect x="0" y="0" width="%.1f" height="%.1f" fill="#fff" stroke="#c9c9c9"/>' % (W * PT, H * PT))
        for sh in sl.shapes:
            parts.append(shape_svg(sh))
        parts.append("</g>")
    rows = (len(pages) + cols - 1) // cols
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %.1f %.1f" width="100%%">'
           % (cols * per_w, rows * per_h))
    svg += "".join(parts) + "</svg>"
    open(out_svg, "w", encoding="utf-8").write(svg)
    print("saved", out_svg)


if __name__ == "__main__":
    render(sys.argv[1], [int(x) for x in sys.argv[2].split(",")], sys.argv[3],
           int(sys.argv[4]) if len(sys.argv) > 4 else 2)
