from __future__ import annotations

import math
import textwrap
from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(r"D:\Selling-program\shopping-assistant")
OUT_DIR = ROOT / "docs" / "deliverables"
FIG_DIR = ROOT / ".tmp" / "course_doc_figures"
OUT_DIR.mkdir(parents=True, exist_ok=True)
FIG_DIR.mkdir(parents=True, exist_ok=True)

DATE_TEXT = "2026年6月10日"
AUTHOR_TEXT = "姓名学号：待补充"


def font_path() -> str:
    candidates = [
        r"C:\Windows\Fonts\simsun.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\arial.ttf",
    ]
    for item in candidates:
        if Path(item).exists():
            return item
    return ""


FONT_PATH = font_path()


def pil_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    if bold:
        for item in [r"C:\Windows\Fonts\simhei.ttf", r"C:\Windows\Fonts\msyhbd.ttc"]:
            if Path(item).exists():
                return ImageFont.truetype(item, size=size)
    if FONT_PATH:
        return ImageFont.truetype(FONT_PATH, size=size)
    return ImageFont.load_default()


def set_run_font(run, size: float | None = None, bold: bool | None = None, italic: bool | None = None):
    run.font.name = "Times New Roman"
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if italic is not None:
        run.italic = italic
    run.font.color.rgb = RGBColor(0, 0, 0)
    r_pr = run._element.get_or_add_rPr()
    r_fonts = r_pr.rFonts
    if r_fonts is None:
        r_fonts = OxmlElement("w:rFonts")
        r_pr.append(r_fonts)
    r_fonts.set(qn("w:ascii"), "Times New Roman")
    r_fonts.set(qn("w:hAnsi"), "Times New Roman")
    r_fonts.set(qn("w:eastAsia"), "SimSun")


def set_paragraph_format(paragraph, before=0, after=6, line=1.15, align=None, first_line=False):
    fmt = paragraph.paragraph_format
    fmt.space_before = Pt(before)
    fmt.space_after = Pt(after)
    fmt.line_spacing = line
    if first_line:
        fmt.first_line_indent = Inches(0.28)
    if align is not None:
        paragraph.alignment = align


def add_text(paragraph, text: str, size=11, bold=False, italic=False):
    run = paragraph.add_run(text)
    set_run_font(run, size=size, bold=bold, italic=italic)
    return run


def configure_doc(doc: Document, running_title: str):
    section = doc.sections[0]
    section.page_width = Inches(8.5)
    section.page_height = Inches(11)
    section.top_margin = Inches(1)
    section.bottom_margin = Inches(1)
    section.left_margin = Inches(1)
    section.right_margin = Inches(1)
    section.header_distance = Inches(0.49)
    section.footer_distance = Inches(0.49)

    styles = doc.styles
    normal = styles["Normal"]
    normal.font.name = "Times New Roman"
    normal.font.size = Pt(11)
    normal.font.color.rgb = RGBColor(0, 0, 0)
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), "SimSun")
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.15

    for name, size, before, after in [
        ("Heading 1", 14, 12, 6),
        ("Heading 2", 12, 8, 4),
        ("Heading 3", 11, 6, 3),
    ]:
        style = styles[name]
        style.font.name = "Times New Roman"
        style.font.size = Pt(size)
        style.font.bold = True
        style.font.color.rgb = RGBColor(0, 0, 0)
        style._element.rPr.rFonts.set(qn("w:eastAsia"), "SimSun")
        style.paragraph_format.space_before = Pt(before)
        style.paragraph_format.space_after = Pt(after)
        style.paragraph_format.line_spacing = 1.15

    footer = section.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = footer.add_run()
    fld_begin = OxmlElement("w:fldChar")
    fld_begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = "PAGE"
    fld_sep = OxmlElement("w:fldChar")
    fld_sep.set(qn("w:fldCharType"), "separate")
    fld_text = OxmlElement("w:t")
    fld_text.text = "1"
    fld_end = OxmlElement("w:fldChar")
    fld_end.set(qn("w:fldCharType"), "end")
    run._r.extend([fld_begin, instr, fld_sep, fld_text, fld_end])
    set_run_font(run, size=10)


def add_title_block(doc: Document, title_lines: list[str], subtitle: str | None = None):
    for idx, line in enumerate(title_lines):
        p = doc.add_paragraph()
        set_paragraph_format(p, before=0 if idx else 6, after=2, line=1.1, align=WD_ALIGN_PARAGRAPH.CENTER)
        add_text(p, line, size=18 if idx == 0 else 16, bold=True)
    if subtitle:
        p = doc.add_paragraph()
        set_paragraph_format(p, after=10, align=WD_ALIGN_PARAGRAPH.CENTER)
        add_text(p, subtitle, size=12)
    p = doc.add_paragraph()
    set_paragraph_format(p, after=2, align=WD_ALIGN_PARAGRAPH.CENTER)
    add_text(p, AUTHOR_TEXT, size=11)
    p = doc.add_paragraph()
    set_paragraph_format(p, after=18, align=WD_ALIGN_PARAGRAPH.CENTER)
    add_text(p, DATE_TEXT, size=11)


def add_abstract(doc: Document, text: str):
    p = doc.add_paragraph()
    set_paragraph_format(p, after=4)
    add_text(p, "摘要", size=12, bold=True)
    p = doc.add_paragraph()
    set_paragraph_format(p, after=10, line=1.2, first_line=True)
    add_text(p, text, size=11)


def add_h1(doc: Document, number: int, title: str):
    p = doc.add_paragraph(style="Heading 1")
    add_text(p, f"{number} {title}", size=14, bold=True)


def add_h2(doc: Document, title: str):
    p = doc.add_paragraph(style="Heading 2")
    add_text(p, title, size=12, bold=True)


def add_para(doc: Document, text: str, first_line=True, after=6):
    p = doc.add_paragraph()
    set_paragraph_format(p, after=after, line=1.2, first_line=first_line)
    add_text(p, text, size=11)
    return p


def add_note(doc: Document, label: str, text: str):
    p = doc.add_paragraph()
    set_paragraph_format(p, before=2, after=8, line=1.2, first_line=True)
    add_text(p, f"{label}：", size=11, bold=True)
    add_text(p, text, size=11)


def add_code_block(doc: Document, text: str):
    for line in textwrap.dedent(text).strip().splitlines():
        p = doc.add_paragraph()
        set_paragraph_format(p, before=0, after=0, line=1.0)
        run = p.add_run(line)
        run.font.name = "Consolas"
        run.font.size = Pt(9)
        run.font.color.rgb = RGBColor(0, 0, 0)
        r_pr = run._element.get_or_add_rPr()
        r_fonts = r_pr.rFonts
        if r_fonts is None:
            r_fonts = OxmlElement("w:rFonts")
            r_pr.append(r_fonts)
        r_fonts.set(qn("w:ascii"), "Consolas")
        r_fonts.set(qn("w:hAnsi"), "Consolas")
        r_fonts.set(qn("w:eastAsia"), "SimSun")
    spacer = doc.add_paragraph()
    set_paragraph_format(spacer, before=0, after=6, line=1.0)


def cell_text(cell, text: str, bold=False, size=10):
    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
    cell.text = ""
    p = cell.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    set_paragraph_format(p, before=0, after=0, line=1.1)
    add_text(p, text, size=size, bold=bold)


def set_cell_borders(cell, top=None, bottom=None, left=None, right=None):
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_borders = tc_pr.first_child_found_in("w:tcBorders")
    if tc_borders is None:
        tc_borders = OxmlElement("w:tcBorders")
        tc_pr.append(tc_borders)
    for edge_name, edge_data in {
        "top": top,
        "bottom": bottom,
        "left": left,
        "right": right,
    }.items():
        tag = "w:" + edge_name
        edge = tc_borders.find(qn(tag))
        if edge is None:
            edge = OxmlElement(tag)
            tc_borders.append(edge)
        if edge_data is None:
            edge.set(qn("w:val"), "nil")
            edge.set(qn("w:sz"), "0")
            edge.set(qn("w:space"), "0")
            edge.set(qn("w:color"), "auto")
        else:
            edge.set(qn("w:val"), edge_data.get("val", "single"))
            edge.set(qn("w:sz"), str(edge_data.get("sz", 4)))
            edge.set(qn("w:space"), "0")
            edge.set(qn("w:color"), edge_data.get("color", "000000"))


def set_cell_margin(cell, top=80, start=120, bottom=80, end=120):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for m, v in [("top", top), ("start", start), ("bottom", bottom), ("end", end)]:
        node = tc_mar.find(qn(f"w:{m}"))
        if node is None:
            node = OxmlElement(f"w:{m}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(v))
        node.set(qn("w:type"), "dxa")


def set_table_geometry(table, widths_in: list[float]):
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    tbl = table._tbl
    tbl_pr = tbl.tblPr
    tbl_w = tbl_pr.first_child_found_in("w:tblW")
    if tbl_w is None:
        tbl_w = OxmlElement("w:tblW")
        tbl_pr.append(tbl_w)
    tbl_w.set(qn("w:w"), "9360")
    tbl_w.set(qn("w:type"), "dxa")
    layout = tbl_pr.first_child_found_in("w:tblLayout")
    if layout is None:
        layout = OxmlElement("w:tblLayout")
        tbl_pr.append(layout)
    layout.set(qn("w:type"), "fixed")
    for row in table.rows:
        for idx, cell in enumerate(row.cells):
            width = Inches(widths_in[idx])
            cell.width = width
            tc_w = cell._tc.get_or_add_tcPr().tcW
            if tc_w is not None:
                tc_w.set(qn("w:w"), str(int(widths_in[idx] * 1440)))
                tc_w.set(qn("w:type"), "dxa")
            set_cell_margin(cell)


def add_table(doc: Document, caption: str, headers: list[str], rows: list[list[str]], widths: list[float]):
    table = doc.add_table(rows=1, cols=len(headers))
    set_table_geometry(table, widths)
    for idx, h in enumerate(headers):
        cell_text(table.rows[0].cells[idx], h, bold=True, size=10.5)
    for row in rows:
        cells = table.add_row().cells
        for idx, text in enumerate(row):
            cell_text(cells[idx], text, size=10)
    black_top = {"val": "single", "sz": 8, "color": "000000"}
    black_mid = {"val": "single", "sz": 4, "color": "000000"}
    for r_idx, row in enumerate(table.rows):
        for cell in row.cells:
            set_cell_borders(cell, top=black_top if r_idx == 0 else None, bottom=black_mid, left=None, right=None)
    p = doc.add_paragraph()
    set_paragraph_format(p, before=2, after=8, align=WD_ALIGN_PARAGRAPH.CENTER)
    add_text(p, caption, size=10, italic=True)
    return table


def add_figure(doc: Document, image_path: Path, caption: str, width=5.8):
    image_path = make_safe_picture(image_path)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_paragraph_format(p, before=4, after=2, align=WD_ALIGN_PARAGRAPH.CENTER)
    run = p.add_run()
    run.add_picture(str(image_path), width=Inches(width))
    p = doc.add_paragraph()
    set_paragraph_format(p, before=0, after=8, align=WD_ALIGN_PARAGRAPH.CENTER)
    add_text(p, caption, size=10, italic=True)


def make_safe_picture(image_path: Path) -> Path:
    safe_name = "safe_" + str(abs(hash(str(image_path)))) + "_" + image_path.stem + ".jpg"
    safe_path = FIG_DIR / safe_name
    image = Image.open(image_path)
    if image.mode not in ("RGB", "L"):
        background = Image.new("RGB", image.size, "white")
        if "A" in image.getbands():
            background.paste(image, mask=image.getchannel("A"))
        else:
            background.paste(image)
        image = background
    else:
        image = image.convert("RGB")
    image.save(safe_path, "JPEG", quality=90, optimize=True)
    return safe_path


def wrap_lines(draw, text, font, max_width):
    lines = []
    for raw in text.split("\n"):
        current = ""
        for ch in raw:
            probe = current + ch
            if draw.textbbox((0, 0), probe, font=font)[2] <= max_width or not current:
                current = probe
            else:
                lines.append(current)
                current = ch
        if current:
            lines.append(current)
    return lines


def draw_box(draw, xy, title, body="", fill=(255, 255, 255), outline=(0, 0, 0)):
    x1, y1, x2, y2 = xy
    draw.rounded_rectangle(xy, radius=10, fill=fill, outline=outline, width=2)
    title_font = pil_font(26, bold=True)
    body_font = pil_font(20)
    tw = draw.textbbox((0, 0), title, font=title_font)[2]
    draw.text((x1 + (x2 - x1 - tw) / 2, y1 + 18), title, fill=(0, 0, 0), font=title_font)
    if body:
        lines = wrap_lines(draw, body, body_font, x2 - x1 - 34)
        start_y = y1 + 58
        for i, line in enumerate(lines[:4]):
            lw = draw.textbbox((0, 0), line, font=body_font)[2]
            draw.text((x1 + (x2 - x1 - lw) / 2, start_y + i * 28), line, fill=(0, 0, 0), font=body_font)


def arrow(draw, start, end):
    draw.line([start, end], fill=(0, 0, 0), width=3)
    angle = math.atan2(end[1] - start[1], end[0] - start[0])
    size = 14
    pts = [
        end,
        (end[0] - size * math.cos(angle - 0.45), end[1] - size * math.sin(angle - 0.45)),
        (end[0] - size * math.cos(angle + 0.45), end[1] - size * math.sin(angle + 0.45)),
    ]
    draw.polygon(pts, fill=(0, 0, 0))


def diagram_architecture(path: Path):
    img = Image.new("RGB", (1500, 900), "white")
    d = ImageDraw.Draw(img)
    title_font = pil_font(32, bold=True)
    d.text((40, 30), "系统总体架构", fill=(0, 0, 0), font=title_font)
    boxes = {
        "frontend": (70, 120, 390, 270, "Flutter / Web", "拍照上传\n候选展示\n自然语言筛选"),
        "api": (570, 120, 930, 270, "NestJS API", "统一接口\n会话编排\n候选快照"),
        "adapter": (1090, 120, 1430, 270, "Adapter Layer", "数据源、模型\n存储、ANN 解耦"),
        "pool": (570, 390, 930, 560, "Product Pool", "Prisma + SQLite\n真实商品\n批次审计"),
        "storage": (80, 390, 390, 560, "Tencent COS", "商品图\n用户图\n演示素材"),
        "ai": (1090, 390, 1430, 560, "AI Providers", "豆包视觉/Embedding\nDeepSeek 对话"),
        "ops": (570, 660, 930, 810, "Ops Scripts / Web", "清洗拆批\n导入回滚\n覆盖率检查"),
    }
    for key, (x1, y1, x2, y2, title, body) in boxes.items():
        draw_box(d, (x1, y1, x2, y2), title, body)
    arrow(d, (390, 195), (570, 195))
    arrow(d, (930, 195), (1090, 195))
    arrow(d, (750, 270), (750, 390))
    arrow(d, (1090, 470), (930, 470))
    arrow(d, (570, 470), (390, 470))
    arrow(d, (750, 660), (750, 560))
    arrow(d, (1090, 270), (1240, 390))
    img.save(path)


def diagram_data_flow(path: Path):
    img = Image.new("RGB", (1500, 900), "white")
    d = ImageDraw.Draw(img)
    d.text((40, 30), "主链路数据流", fill=(0, 0, 0), font=pil_font(32, bold=True))
    nodes = [
        (60, 150, 270, 275, "1 用户输入", "拍照/上传\n文本需求"),
        (340, 150, 550, 275, "2 图片资产", "COS 保存\nassetId"),
        (620, 150, 830, 275, "3 商品理解", "主体裁剪\n结构化标签"),
        (900, 150, 1110, 275, "4 查询向量", "Query Embedding\n检索输入"),
        (900, 430, 1110, 555, "5 ANN 召回", "标签过滤\n向量相似"),
        (620, 430, 830, 555, "商品池", "真实商品\n360 标准图"),
        (1180, 430, 1390, 555, "候选池", "价格/平台\n排序快照"),
        (1180, 640, 1390, 765, "前端展示", "结果列表\n继续筛选"),
    ]
    for x1, y1, x2, y2, title, body in nodes:
        draw_box(d, (x1, y1, x2, y2), title, body)
    for i in range(3):
        arrow(d, (nodes[i][2], 220), (nodes[i + 1][0], 220))
    arrow(d, (1005, 275), (1005, 430))
    arrow(d, (830, 492), (900, 492))
    arrow(d, (1110, 492), (1180, 492))
    arrow(d, (1285, 555), (1285, 640))
    d.text((55, 825), "说明：用户实时链路在云端完成；商品池可从外部高自由度导入真实数据，离线完成标准化、去重、图片预处理和 embedding 生成。", fill=(0, 0, 0), font=pil_font(22))
    img.save(path)


def diagram_api(path: Path):
    img = Image.new("RGB", (1500, 820), "white")
    d = ImageDraw.Draw(img)
    d.text((40, 30), "API 调用关系", fill=(0, 0, 0), font=pil_font(32, bold=True))
    boxes = [
        (70, 130, 420, 260, "App / Web Client", "上传图片、发起会话、读取候选"),
        (575, 120, 925, 270, "Public API", "assets / sessions / candidates\nturns / suggestions"),
        (1080, 130, 1430, 260, "Maintenance API", "product-pool import\nbatch / rollback / rebuild"),
        (340, 420, 660, 570, "Session Service", "状态、候选快照、SSE"),
        (820, 420, 1140, 570, "Product Pool Service", "商品入库、ANN、质量报告"),
        (570, 650, 930, 770, "Storage and AI", "SQLite + COS + Embedding Provider"),
    ]
    for box in boxes:
        draw_box(d, box[:4], box[4], box[5])
    arrow(d, (420, 195), (575, 195))
    arrow(d, (925, 195), (1080, 195))
    arrow(d, (750, 270), (500, 420))
    arrow(d, (750, 270), (980, 420))
    arrow(d, (500, 570), (650, 650))
    arrow(d, (980, 570), (850, 650))
    img.save(path)


def diagram_ai(path: Path):
    img = Image.new("RGB", (1500, 860), "white")
    d = ImageDraw.Draw(img)
    d.text((40, 30), "AI 与真实数据处理链路", fill=(0, 0, 0), font=pil_font(32, bold=True))
    nodes = [
        (60, 140, 330, 280, "聚合 API", "获取真实商品\n价格、平台、图片"),
        (430, 140, 700, 280, "清洗与 Adapter", "平台识别\n品类标签\n去重"),
        (800, 140, 1070, 280, "图片标准化", "主体裁剪\n360p JPEG"),
        (1170, 140, 1440, 280, "Embedding", "visual 为主\n少量双 embedding"),
        (430, 480, 700, 620, "商品池", "SQLite 记录\nCOS 图片对象"),
        (800, 480, 1070, 620, "ANN 检索", "向量相似\n标签约束"),
        (1170, 480, 1440, 620, "结果解释", "候选排序\n自然语言收敛"),
    ]
    for box in nodes:
        draw_box(d, box[:4], box[4], box[5])
    for i in range(3):
        arrow(d, (nodes[i][2], 210), (nodes[i + 1][0], 210))
    arrow(d, (1305, 280), (565, 480))
    arrow(d, (700, 550), (800, 550))
    arrow(d, (1070, 550), (1170, 550))
    d.text((70, 740), "成本控制：大规模真实数据默认生成 visual embedding；双 embedding 用于少量演示与效果对比。", fill=(0, 0, 0), font=pil_font(23))
    img.save(path)


def create_figures():
    paths = {
        "architecture": FIG_DIR / "architecture.png",
        "data_flow": FIG_DIR / "data_flow.png",
        "api_flow": FIG_DIR / "api_flow.png",
        "ai_flow": FIG_DIR / "ai_flow.png",
    }
    diagram_architecture(paths["architecture"])
    diagram_data_flow(paths["data_flow"])
    diagram_api(paths["api_flow"])
    diagram_ai(paths["ai_flow"])
    return paths


def build_architecture(figs):
    doc = Document()
    configure_doc(doc, "Architecture Design")
    add_title_block(doc, ["AI 拍照识物与智能比价购物助手", "架构设计文档"])
    add_abstract(
        doc,
        "本文档面向课程答辩和项目交付，说明智能比价助手的总体架构、模块边界、核心数据流、真实商品池建设方式和云端部署方案。项目采用聚合 API 获取真实商品数据，并通过统一 Adapter 层转换为商品池标准结构；检索链路以真实商品池、图片 embedding 和 ANN 相似召回为核心。由于双 embedding 会显著提高模型调用成本，当前仅选择部分商品生成 visual 与 multimodal 双 embedding 用于演示和对比，大批量商品默认生成 visual embedding。尽管受成本限制真实数据规模没有无限扩大，但数据来源是真实商品，具备更高实用价值，也已经证明系统链路具有可行性。"
    )

    add_h1(doc, 1, "背景与建设目标")
    add_para(doc, "本项目的目标是把用户从“看到商品、跨平台搜索、重复筛选、比较价格”的割裂流程中解放出来，形成“拍照识别 - 多平台候选召回 - 自然语言收敛 - 结果跳转”的连续体验。当前项目名称为“智能比价助手”，核心口号是 Just say the word。")
    add_para(doc, "项目采用真实商品数据而非纯模拟数据。真实数据通过聚合 API 获取，并在清洗阶段统一为后端可入库的标准 JSON。真实数据的价值在于它保留了平台、价格、商品图、店铺和跳转链接等现实字段，使答辩演示更接近真实购物场景。")
    add_note(doc, "范围说明", "当前工程仍处于演示级完善阶段，优先保证主链路可运行、可扩展和可运维。受 embedding 与模型调用成本限制，商品池不会追求无上限数据规模，而是用真实样本证明方案可行。")

    add_h1(doc, 2, "总体架构")
    add_para(doc, "系统按“前端入口、云端 API、Adapter 层、商品池与存储、AI 能力、运维脚本”分层。前端不直接访问外部商品平台，也不直接生成 embedding；云端 API 负责统一编排，会话状态和候选快照进入数据库，图片文件进入对象存储，商品候选由本地 Product Pool 召回。")
    add_figure(doc, figs["architecture"], "Figure 1. 系统总体架构图", width=6.2)
    add_table(
        doc,
        "Table 1. 主要模块职责",
        ["模块", "技术/位置", "职责"],
        [
            ["移动端与 Web", "Flutter / judge-entry-web", "上传图片、展示候选商品、提交自然语言筛选和维护商品池页面。"],
            ["API Server", "NestJS", "对外暴露统一接口，编排会话、搜索、商品池、用户画像和维护操作。"],
            ["Adapter Layer", "后端 application adapters", "隔离聚合 API、模型、COS、ANN、数据库和前端字段差异。"],
            ["Product Pool", "Prisma + SQLite", "保存真实商品、导入批次、标签审计和 embedding 元数据。"],
            ["对象存储", "Tencent COS", "保存用户图、商品图、标准化图和演示素材；数据库只保存引用。"],
            ["AI Provider", "豆包视觉/Embedding、DeepSeek", "完成视觉理解、图片向量化和对话筛选意图提取。"],
        ],
        [1.35, 1.55, 3.6],
    )

    add_h1(doc, 3, "核心数据流")
    add_para(doc, "用户上传图片后，后端先创建图片资产，再进行主体定位和标准化裁剪。裁剪后的图片生成 query embedding，并与商品池中的商品图 embedding 进行 ANN 相似召回。候选结果会保存为会话快照，用户继续输入自然语言时，只在已有候选池和筛选条件上收敛，避免重复识图和重复向量化。")
    add_figure(doc, figs["data_flow"], "Figure 2. 主链路数据流图", width=6.2)
    add_para(doc, "商品导入链路与用户实时链路分离。聚合 API 获得的真实商品数据先清洗、去重、按平台识别，再通过 ProductImportItemV1 标准契约进入商品池。图片会在入库时统一切割和标准化，当前标准分辨率为 360p，随后生成 visual embedding。")

    add_h1(doc, 4, "商品池与真实数据管线")
    add_para(doc, "商品池是当前系统的核心数据资产。相比直接把实时平台搜索作为主链路，商品池可以把真实商品提前标准化、打标签、生成 embedding，并保留导入批次审计。这样即使不同平台字段不一致，前端和搜索模块也只面对统一的候选商品结构。")
    add_table(
        doc,
        "Table 2. 商品导入流水线",
        ["阶段", "输入", "输出/校验"],
        [
            ["数据获取", "聚合 API 返回的真实平台商品", "保留平台、价格、商品图、店铺、详情页等真实字段。"],
            ["标准化", "原始 JSON / Excel", "转换为 platform、externalId、title、price、imageUrl、categoryHint 等字段。"],
            ["去重", "platform + externalId", "避免已上传商品重复入库；保留批次来源和 rawPayload。"],
            ["图片处理", "商品主图或款式图", "裁剪为统一 360p JPEG，保证后续 embedding 输入一致。"],
            ["向量化", "标准化商品图", "默认生成 visual embedding；部分商品生成双 embedding 用于演示。"],
            ["入库审计", "导入结果", "记录成功、失败、回滚快照、标签审核和 embedding 覆盖率。"],
        ],
        [1.15, 2.0, 3.35],
    )
    add_note(doc, "真实数据价值", "项目不依赖虚构商品列表。受成本约束，真实数据量不会无限扩大，但真实商品能直接暴露图片质量、详情链接、平台差异和价格字段等实际问题，因此比模拟数据更有答辩和后续优化价值。")

    add_h1(doc, 5, "数据库与对象存储")
    add_para(doc, "项目采用 SQLite + Prisma 作为首版主存储，部署时通过 Zeabur Volume 固定数据库文件。图片本体不写入 SQLite，而是上传到腾讯云 COS；数据库只保存 bucket、objectKey、publicUrl、来源 URL 和预处理元数据。这种分工可以避免数据库体积膨胀，并使图片访问与商品数据审计互相解耦。")
    add_table(
        doc,
        "Table 3. 存储分工",
        ["数据类型", "SQLite/Prisma", "COS", "说明"],
        [
            ["会话与候选", "保存", "不保存", "用于刷新恢复、候选详情和多轮筛选。"],
            ["商品基础信息", "保存", "不保存", "平台、价格、店铺、标签、批次来源等。"],
            ["商品图片", "保存引用", "保存文件", "统一图片内容进入对象存储，数据库保存 objectKey。"],
            ["Embedding", "保存向量与元数据", "可保存输入图", "记录 provider、model、dimension、kind 和 preprocessJson。"],
            ["导入批次", "保存", "不保存", "记录进度、失败、回滚快照和质量报告。"],
        ],
        [1.35, 1.45, 1.2, 2.5],
    )

    add_h1(doc, 6, "部署与运维设计")
    add_para(doc, "云端部署基线为 Zeabur + 腾讯云 COS。Zeabur 承载 NestJS API、静态评委入口和 SQLite Volume；COS 承载图片与 APK 等文件。维护接口通过 MAINTENANCE_API_TOKEN 保护，普通用户链路不需要维护 token。")
    ops_image = ROOT / "docs" / "image" / "25-商品池运维界面" / "product-pool-ops-concept.png"
    if ops_image.exists():
        add_figure(doc, ops_image, "Figure 3. 商品池运维中心界面示意", width=6.3)
    add_para(doc, "运维页面用于查看商品池总量、可检索商品、visual/multimodal embedding 覆盖率、批次质量报告和回滚入口。批量上传脚本按组和批次拆分数据，适合在成本可控的情况下逐步扩大真实商品池。")

    add_h1(doc, 7, "模块详细设计")
    add_para(doc, "从交付角度看，系统可以被拆分为用户入口层、应用编排层、领域服务层、外部适配层、持久化层和运维层。分层目标不是增加复杂度，而是把变化频繁的部分放在边界上：平台数据来源、模型供应商、对象存储、向量检索实现都可以替换；会话、候选、商品池和批次审计则保持稳定。")
    add_table(
        doc,
        "Table 4. 详细模块边界",
        ["层级", "代表模块", "输入", "输出/责任"],
        [
            ["用户入口层", "Flutter App、评委 Web、商品池运维 Web", "用户图片、文字筛选、维护操作", "展示候选、发起会话、触发导入、读取批次质量。"],
            ["应用编排层", "SessionsService、TurnsService、CandidatesService", "assetId、sessionId、turn message、cursor", "维护会话状态，组织识图、召回、候选快照和多轮筛选。"],
            ["商品池领域层", "ProductPoolService", "标准导入商品、查询向量、维护请求", "商品 upsert、图片处理、标签审核、embedding 生成、ANN 诊断和回滚。"],
            ["Adapter 层", "ProductImportAdapter、ImageEmbeddingAdapter、ViewAdapter", "外部原始字段、模型返回、数据库记录", "统一契约、边界校验、字段归一化、输出 DTO 组装。"],
            ["持久化层", "Prisma、SQLite、COS Adapter", "结构化实体、图片内容、向量数据", "保存事实数据、图片引用、批次快照、embedding 元数据。"],
            ["运维层", "PowerShell/Node 脚本、商品池中心", "JSON/Excel、平台数据、维护 token", "拆批、验链、上传、统计、失败跳过、回滚和质量监控。"],
        ],
        [1.15, 1.6, 1.55, 2.2],
    )
    add_para(doc, "核心服务之间采用“输入清晰、输出可审计”的方式协作。例如 ProductPoolService 不直接理解每个平台的原始字段，而是接收 ProductImportAdapter 产出的标准商品；SessionsService 不直接拼装前端响应，而是委托 SessionViewAdapter 生成稳定视图。这种设计能减少后续扩展京东、苏宁、淘宝、唯品会、闲鱼等平台时对核心逻辑的影响。")

    add_h1(doc, 8, "可复用性与可替换性设计")
    add_para(doc, "本项目架构的核心价值之一是可复用。前端、商品数据、模型服务、对象存储和数据库并不是互相写死的关系，而是通过标准契约和 Adapter 连接。当前项目虽然以智能比价为目标，但其中的商品池导入、图片标准化、embedding 生成、ANN 召回、批次质量报告和回滚机制，也可以复用于其他“真实商品数据 + 视觉检索”的场景。")
    add_table(
        doc,
        "Table 5. 可复用设计点",
        ["设计点", "复用方式", "价值"],
        [
            ["标准导入契约", "所有 JSON、Excel、聚合 API、人工整理数据都先转成 ProductImportItemV1。", "外部数据自由度高，但入库后仍是统一结构。"],
            ["Adapter 分层", "ProductImport、ImageContent、Embedding、View 等能力都通过接口隔离。", "更换平台来源或模型时，不破坏核心服务。"],
            ["商品池主链路", "搜索模块只面对标准 Product 和 ProductImageEmbedding。", "新增品类或平台不需要重写前端和搜索流程。"],
            ["批次审计", "每次导入保留 batchSource、rawJson、before/after 快照。", "便于回滚、质量分析和数据来源追踪。"],
            ["对象存储引用", "数据库保存 objectKey 和 publicUrl，不保存图片本体。", "后续可从 COS 切换到其他对象存储。"],
            ["Embedding kind 配置", "visual 与 multimodal 由环境变量控制。", "可按预算和效果选择不同向量策略。"],
        ],
        [1.6, 2.7, 2.2],
    )
    add_para(doc, "模型可替换性体现在两个层面。第一，视觉理解、聊天意图解析和图片 embedding 分别由独立 provider 配置，不要求使用同一个厂商。第二，核心业务保存的是 provider、modelName、dimension 和 embeddingKind 等元数据，因此即使后续从豆包视觉 embedding 切换到其他模型，也可以通过重建 embedding 和调整 ANN 配置完成迁移。")
    add_table(
        doc,
        "Table 6. 模型替换边界",
        ["能力", "当前实现", "替换时影响范围"],
        [
            ["视觉识别", "VisionProfileAdapter 调用视觉模型生成商品画像。", "只替换模型 provider 与输出归一化，不影响会话接口。"],
            ["图片 embedding", "ImageEmbeddingAdapter 调用 embedding provider。", "需重建 ProductImageEmbedding，但 Product 表结构保持稳定。"],
            ["自然语言筛选", "ConversationIntentAdapter 解析用户追加要求。", "只影响意图解析，不影响候选快照读取。"],
            ["ANN 检索", "当前以 SQLite/本地向量排序为基础。", "可替换为独立向量库，候选输出契约不变。"],
        ],
        [1.45, 2.25, 2.8],
    )

    add_h1(doc, 9, "关键数据模型")
    add_para(doc, "数据库模型围绕“会话可恢复”和“商品池可审计”两条主线设计。会话侧保存 QuerySession、ProductProfileSnapshot、CandidateSnapshot 和 CandidateItem；商品池侧保存 Product、ProductImportBatch、ProductImportChange、ProductTagAudit 和 ProductImageEmbedding。")
    add_table(
        doc,
        "Table 7. 核心数据实体",
        ["实体", "关键字段", "设计意图"],
        [
            ["Product", "platform、externalId、title、priceAmount、productUrl、tagStatus、category", "保存标准商品事实。platform + externalId 是主要去重依据，避免重复上传。"],
            ["ProductImageEmbedding", "productId、embeddingKind、provider、modelName、dimension、vectorJson、preprocessJson", "保存图片向量和预处理元数据，支持 visual 与 multimodal 并存。"],
            ["ProductImportBatch", "batchSource、status、totalCount、succeededCount、failedCount、rawJson", "保存导入批次状态，用于进度追踪和失败排查。"],
            ["ProductImportChange", "beforeJson、afterJson、rolledBackAt", "保存导入前后快照，支持批次回滚。"],
            ["CandidateSnapshot", "sessionId、rawPayloadJson、createdAt", "保存一次搜索或筛选后的候选快照，支持刷新恢复。"],
            ["CandidateItem", "title、platformName、amount、productUrl、productPoolKey、rank", "保存前端展示候选和商品池来源关系。"],
            ["UserProfileBlock", "blockType、scope、payloadJson、confidence、status", "保存用户长期偏好，如鞋码、预算、品牌和平台偏好。"],
        ],
        [1.55, 2.35, 2.6],
    )
    add_para(doc, "图片文件不作为 BLOB 写入 SQLite。商品图、用户上传图和演示素材由 COS 保存，数据库保存 imageObjectKey、imagePublicUrl、sourceImageUrl 等引用字段。这样可以让数据库保持轻量，也便于后续切换对象存储供应商。")
    add_para(doc, "数据库构建的价值不仅是保存查询结果，更重要的是把外部高自由度数据变成可治理的数据资产。聚合 API、Excel、JSON、平台采集文件的字段差异很大，如果前端或搜索模块直接消费这些原始数据，后续会难以扩展和排错。Product 表、ProductImageEmbedding 表和 ProductImportBatch 表把“商品事实、检索向量、导入过程”分开保存，使系统能够持续导入真实数据、复查来源、按批回滚，并逐步提高商品池质量。")

    add_h1(doc, 10, "搜索链路时序")
    add_para(doc, "一次完整图片搜索从前端上传图片开始，经过资产创建、会话创建、主体检测、query embedding、商品池 ANN 召回、候选快照写入和前端读取。SSE 事件用于让前端感知识别、embedding、候选返回等阶段，普通候选列表仍以 GET candidates 作为稳定读取入口。")
    add_table(
        doc,
        "Table 8. 图片搜索时序",
        ["顺序", "动作", "后端处理", "可恢复状态"],
        [
            ["1", "POST /assets/images", "保存图片到 COS 或本地兼容存储，生成 assetId。", "ImageAsset 引用。"],
            ["2", "POST /sessions", "读取 assetId，进行商品主体识别和初始候选召回。", "QuerySession 与 ProductProfileSnapshot。"],
            ["3", "生成 query embedding", "将裁剪后的查询图调用 embedding provider。", "embedding_ready 事件和预处理元数据。"],
            ["4", "ANN + 标签召回", "按品类、标签和 visual embedding 检索商品池。", "CandidateSnapshot 与 CandidateItem。"],
            ["5", "GET candidates", "前端读取当前候选列表，页面刷新后也可恢复。", "候选快照。"],
            ["6", "POST turns", "用户追加自然语言要求，转为筛选补丁并更新候选。", "SessionTurn 与新候选快照。"],
        ],
        [0.6, 1.55, 2.55, 1.8],
    )

    add_h1(doc, 11, "安全、配置与运维控制")
    add_para(doc, "系统的安全边界分为普通用户接口和维护接口。普通用户接口主要依赖业务限流和文件大小控制；用户画像接口使用 JWT；商品池导入、删除、回滚、embedding 重建等维护接口必须携带 x-maintenance-token。维护 token、COS 密钥、模型 API key 都通过环境变量配置，不进入仓库。")
    add_table(
        doc,
        "Table 9. 关键环境变量",
        ["配置项", "当前含义", "交付建议"],
        [
            ["SEARCH_PROVIDER / PRODUCT_DATA_PROVIDER", "选择 local_product_pool 作为主搜索来源。", "生产演示保持商品池模式，避免依赖实时平台页面。"],
            ["PRODUCT_IMPORT_IMAGE_TARGET_SIZE", "商品入库图片标准化尺寸，当前为 360。", "保持统一输入，便于 embedding 成本和质量控制。"],
            ["PRODUCT_EMBEDDING_KINDS", "控制商品生成 visual 或 multimodal embedding。", "大批量用 visual；演示少量双 embedding。"],
            ["EMBEDDING_PROVIDER", "图片向量化供应商，当前为 volcengine_doubao_vision。", "必须配置真实 key，禁止生产使用 hash mock。"],
            ["OBJECT_STORAGE_PROVIDER", "对象存储供应商，当前为 tencent_cos。", "图片本体存 COS，数据库只保引用。"],
            ["MAINTENANCE_API_TOKEN", "保护维护接口。", "只在本地 .env 和 Zeabur 环境变量中保存。"],
        ],
        [1.8, 2.2, 2.5],
    )
    add_para(doc, "运维侧要求所有导入批次可追踪、可重试、可回滚。批量导入脚本按 group 和 batch 分割数据，避免单次导入过大导致超时或成本失控。导入失败时，系统保留失败原因和批次进度；成功导入后，商品池统计页检查可检索率、embedding 覆盖率和平台分布。")
    add_note(doc, "环境变量安全", "`.env` 文件保存维护 token、模型 API key、COS 密钥和数据库连接信息，不能提交到 GitHub，也不能截图传播。线上 Zeabur 环境变量与本地 `.env` 应分开管理；示例文件只保留变量名和说明，不保存真实密钥。")
    add_table(
        doc,
        "Table 10. .env 安全控制",
        ["风险点", "控制方式", "原因"],
        [
            ["真实密钥泄露", "`.env` 加入 .gitignore，只提交 .env.example。", "避免维护接口、COS 和模型服务被外部滥用。"],
            ["本地与云端混用", "本地 token 与 Zeabur token 分开配置。", "降低某一环境泄露后影响全部环境的风险。"],
            ["日志打印密钥", "脚本只读取 token，不输出 token 明文。", "防止终端截图或日志暴露敏感信息。"],
            ["维护接口误用", "所有导入、删除、回滚接口校验 x-maintenance-token。", "防止普通用户路径触发高成本或破坏性操作。"],
            ["示例文件污染", ".env.example 只写占位符和说明。", "保证项目可配置，但不暴露真实服务凭证。"],
        ],
        [1.55, 2.55, 2.4],
    )

    add_h1(doc, 12, "限制与后续优化")
    add_para(doc, "第一，双 embedding 能提升语义和视觉混合召回能力，但会显著增加模型调用费用，因此当前只在一部分商品上生成 visual + multimodal 双 embedding 作为演示。第二，真实数据受平台接口、采集稳定性、图片可访问性和成本限制，目前规模有限，但已经足以验证完整链路。第三，后续需要继续增强详情页验链、平台字段质量、图片裁剪精度和大规模导入的失败恢复能力。")
    add_para(doc, "总体上，本架构把外部平台、模型服务和对象存储放在 Adapter 之后，核心业务只依赖统一契约。即使后续替换聚合 API、向量库或存储供应商，主链路也不需要推倒重写。")
    doc.save(OUT_DIR / "架构设计文档.docx")


def build_api(figs):
    doc = Document()
    configure_doc(doc, "API Specification")
    add_title_block(doc, ["AI 拍照识物与智能比价购物助手", "API 说明文档"])
    add_abstract(
        doc,
        "本文档整理当前后端 NestJS API 的主要接口、请求字段、响应约定和维护接口边界。API 采用统一响应包裹结构，面向 App 的接口包括图片上传、会话创建、候选读取、多轮对话和用户偏好；面向运维的接口包括商品池导入、批次查询、质量报告、回滚、商品编辑和 embedding 重建。商品数据通过聚合 API 获取真实商品后进入商品池，普通用户链路只查询标准化后的 Product Pool，不直接依赖外部平台实时搜索。"
    )

    add_h1(doc, 1, "接口约定")
    add_para(doc, "所有业务接口统一返回 ApiResponse。成功时 success 为 true，data 承载业务数据；失败时 success 为 false，error 承载错误码和错误说明。requestId 用于日志排查和前后端联调定位。")
    add_table(
        doc,
        "Table 1. 统一响应结构",
        ["字段", "类型", "说明"],
        [
            ["success", "boolean", "表示请求是否成功。"],
            ["requestId", "string", "后端生成的请求编号，用于排查。"],
            ["data", "object | null", "成功时返回业务数据。"],
            ["error", "object | null", "失败时返回 code、message 和可选 details。"],
        ],
        [1.4, 1.5, 3.6],
    )
    add_note(doc, "鉴权边界", "App 用户链路多数接口可以匿名体验；用户画像接口使用 JWT；商品池维护接口需要 x-maintenance-token，避免误导入、误删和不必要模型消耗。")
    add_table(
        doc,
        "Table 2. 环境与调用约定",
        ["项目", "约定", "说明"],
        [
            ["Base URL", "https://apiserver.zeabur.app", "云端演示环境；本地联调通常为 http://127.0.0.1:3000。"],
            ["API Version", "/api/v1", "所有当前接口均挂在 v1 路径下，便于后续兼容升级。"],
            ["Content-Type", "application/json 或 multipart/form-data", "图片上传使用 multipart；普通业务接口使用 JSON。"],
            ["维护鉴权", "x-maintenance-token", "商品池导入、删除、回滚和 embedding 重建必须携带。"],
            ["用户鉴权", "Authorization: Bearer <JWT>", "用户画像和账号信息接口使用 JWT。"],
        ],
        [1.35, 2.35, 2.8],
    )
    add_table(
        doc,
        "Table 3. HTTP 状态与错误表达",
        ["类别", "典型状态", "处理建议"],
        [
            ["参数错误", "400 Bad Request", "检查必填字段、字段类型、keywords 是否为空、图片输入是否缺失。"],
            ["鉴权错误", "401 / 403", "检查 JWT 或 x-maintenance-token；维护接口禁止无 token 操作。"],
            ["资源不存在", "404", "检查 sessionId、candidateItemId、productId 或 batchId 是否有效。"],
            ["模型/外部依赖错误", "500", "结合 requestId、后端日志和批次详情定位 provider、COS、embedding 错误。"],
            ["异步处理中", "200 + status=processing", "导入接口先接受批次，进度通过 batch 查询接口轮询。"],
        ],
        [1.35, 1.45, 3.7],
    )

    add_h1(doc, 2, "核心调用流程")
    add_para(doc, "图片搜索的最小调用顺序为：上传图片资产，创建会话，读取候选列表，必要时订阅搜索进度事件。如果用户修改主体框选范围，前端调用 subject-selection 接口，后端重新生成 query embedding 并刷新候选快照。")
    add_figure(doc, figs["api_flow"], "Figure 1. API 调用关系图", width=6.2)

    add_h1(doc, 3, "App 用户链路接口")
    add_table(
        doc,
        "Table 4. 用户链路主要接口",
        ["方法", "路径", "用途"],
        [
            ["GET", "/api/v1/health", "健康检查，返回 api-server 状态。"],
            ["POST", "/api/v1/assets/images", "上传用户图片，支持 multipart file，文件上限 8 MB。"],
            ["POST", "/api/v1/sessions", "根据 assetId 创建图片搜索会话。"],
            ["POST", "/api/v1/sessions/text", "创建文本搜索会话，适合纯文字关键词入口。"],
            ["GET", "/api/v1/sessions/:sessionId", "读取会话、识别结果、当前筛选和候选摘要。"],
            ["POST", "/api/v1/sessions/:sessionId/subject-selection", "提交用户调整后的主体框选范围。"],
            ["GET", "/api/v1/sessions/:sessionId/search-events", "SSE 回放搜索进度事件。"],
            ["GET", "/api/v1/sessions/:sessionId/candidates", "读取当前候选商品列表。"],
            ["POST", "/api/v1/sessions/:sessionId/candidates/more", "基于 cursor 获取更多候选。"],
            ["GET", "/api/v1/candidates/:candidateItemId", "读取单个候选商品详情。"],
            ["POST", "/api/v1/sessions/:sessionId/turns", "提交自然语言筛选，例如预算、品牌、平台偏好。"],
            ["GET", "/api/v1/sessions/:sessionId/suggestions", "读取后端生成的智能建议。"],
            ["POST", "/api/v1/search/shoes", "直接按关键词搜索商品池候选。"],
        ],
        [0.8, 2.7, 3.0],
    )

    add_h2(doc, "3.1 图片上传接口")
    add_para(doc, "图片上传是图片搜索链路的第一步。前端可以通过 multipart/form-data 上传 file，也可以在 DTO 中补充图片来源、资产用途和客户端上下文。后端限制单文件最大 8 MB，成功后返回 assetId，后续创建 session 时必须引用该 assetId。")
    add_table(
        doc,
        "Table 5. POST /api/v1/assets/images",
        ["字段", "位置", "说明"],
        [
            ["file", "multipart", "图片文件，字段名固定为 file。"],
            ["variantType", "body", "compressed_recognition、original_source 或 demo_asset。"],
            ["sourceType", "body", "camera、album 或 demo，用于区分图片来源。"],
            ["isPrimaryRecognitionAsset", "body", "标识是否作为本次识别主图。"],
            ["clientContext", "body", "前端设备、裁剪信息或其他调试上下文。"],
        ],
        [1.6, 1.0, 3.9],
    )

    add_h2(doc, "3.2 创建会话接口")
    add_para(doc, "创建图片会话时，后端会把 assetId 绑定为查询输入，并启动主体识别、query embedding 和候选召回。initialSubjectSelection 可用于用户在前端已经框选主体的情况；如果不提供，后端会尝试自动识别主体。")
    add_code_block(
        doc,
        '''
        POST /api/v1/sessions
        {
          "assetId": "asset_xxx",
          "entrySource": "android_app",
          "categoryHint": "shoe",
          "initialSubjectSelection": {
            "box": { "x": 0.12, "y": 0.18, "width": 0.70, "height": 0.66 },
            "selectionSource": "user_initial"
          }
        }
        ''',
    )
    add_para(doc, "创建文本会话时，message 是自然语言入口，keywords 和 filters 可作为结构化提示。文本会话不会上传用户图，但仍复用商品池搜索和候选快照能力。")

    add_h2(doc, "3.3 候选读取、分页与 SSE")
    add_para(doc, "候选结果采用“快照读取 + SSE 进度提示”的组合。SSE 用于展示后台搜索阶段，例如 subject_detected、embedding_ready、candidate_batch；页面真正渲染列表时，应调用 GET /sessions/:sessionId/candidates 读取稳定快照。这样即使 SSE 断线或页面刷新，也可以重新读取当前候选。")
    add_table(
        doc,
        "Table 6. 候选接口约束",
        ["接口", "关键参数", "返回重点"],
        [
            ["GET /sessions/:sessionId/candidates", "sessionId", "当前候选列表、候选数量、排序、商品池 key 和可展示字段。"],
            ["POST /sessions/:sessionId/candidates/more", "cursor、limit", "下一页候选和新 cursor，不重新识图。"],
            ["GET /candidates/:candidateItemId", "candidateItemId", "单个候选详情、商品链接、属性、推荐理由。"],
            ["GET /sessions/:sessionId/search-events", "sessionId", "SSE 进度事件回放，适合前端进度条和日志。"],
        ],
        [2.4, 1.35, 2.75],
    )

    add_h2(doc, "3.4 主体框选更新")
    add_para(doc, "如果自动裁剪不准确，前端可以调用 POST /sessions/:sessionId/subject-selection 提交新的归一化 bbox。后端会以新的主体区域重新预处理图片，并重新生成 query embedding 与候选结果。bbox 使用 0 到 1 之间的比例坐标，便于跨设备和不同图片尺寸复用。")
    add_table(
        doc,
        "Table 7. NormalizedSubjectBoxDto",
        ["字段", "类型", "说明"],
        [
            ["x / y", "number", "主体框左上角归一化坐标。"],
            ["width / height", "number", "主体框宽高，范围通常为 0 到 1。"],
            ["confidence", "number", "自动检测置信度；用户手动框选可设为 1。"],
            ["label", "string", "主体标签或调试来源。"],
        ],
        [1.4, 1.1, 4.0],
    )

    add_h1(doc, 4, "主要请求字段")
    add_table(
        doc,
        "Table 8. 关键 DTO 字段",
        ["接口/对象", "字段", "说明"],
        [
            ["CreateImageAssetDto", "variantType、sourceType、clientContext", "标识图片用途和来源，可配合 multipart file 上传。"],
            ["CreateSessionDto", "assetId、entrySource、categoryHint、initialSubjectSelection", "根据已上传图片创建搜索会话。"],
            ["CreateTextSessionDto", "message、keywords、filters、categoryHint", "文本入口，用于关键词和筛选条件搜索。"],
            ["NormalizedSubjectBoxDto", "x、y、width、height、confidence、label", "使用归一化坐标描述主体框选区域。"],
            ["MoreCandidatesDto", "cursor、limit", "读取更多候选时使用的分页参数。"],
            ["CreateTurnDto", "message", "用户追加的自然语言筛选文本。"],
            ["SearchShoesDto", "keywords、filters", "直接搜索商品池的关键词和过滤条件。"],
        ],
        [1.7, 2.1, 2.7],
    )

    add_h1(doc, 5, "商品池维护接口")
    add_para(doc, "商品池接口用于真实商品数据导入、批次追踪、失败重试、回滚和 embedding 管理。它们不应该暴露给普通 App 用户。所有会修改数据或消耗模型资源的接口均需要维护 token。")
    add_table(
        doc,
        "Table 9. 商品池维护接口",
        ["方法", "路径", "用途"],
        [
            ["POST", "/api/v1/product-pool/import", "异步导入标准商品 JSON。"],
            ["GET", "/api/v1/product-pool/stats", "查看商品池统计、可检索率和 embedding 覆盖。"],
            ["POST", "/api/v1/product-pool/debug/image-preprocess", "调试图片预处理和主体裁剪结果。"],
            ["POST", "/api/v1/product-pool/embeddings/rebuild", "按 limit 或 embeddingKind 重建商品图 embedding。"],
            ["GET", "/api/v1/product-pool/batches", "分页查询导入批次。"],
            ["GET", "/api/v1/product-pool/batches/:batchId", "查看批次详情和部分商品。"],
            ["GET", "/api/v1/product-pool/batches/:batchId/quality", "查看批次质量报告。"],
            ["POST", "/api/v1/product-pool/batches/:batchId/retry", "重试失败批次。"],
            ["POST", "/api/v1/product-pool/batches/:batchId/rollback", "预检或执行批次回滚。"],
            ["GET", "/api/v1/product-pool/products", "按平台、品类、品牌、批次等筛选商品。"],
            ["PATCH", "/api/v1/product-pool/products/:productId", "编辑单个商品字段。"],
            ["POST", "/api/v1/product-pool/products/delete", "批量删除商品，可 dryRun。"],
            ["POST", "/api/v1/product-pool/ann/diagnose", "诊断某张图的 ANN 召回效果。"],
        ],
        [0.8, 2.9, 2.8],
    )

    add_h2(doc, "5.1 商品池导入状态机")
    add_para(doc, "商品池导入是异步接口。POST /product-pool/import 接收批次后会立即返回 batchId，实际下载图片、标准化、打标签、生成 embedding 和写库在后台执行。前端或脚本应轮询 GET /product-pool/batches/:batchId 查看 status、succeededCount、failedCount、productCount 和 embeddingCount。")
    add_table(
        doc,
        "Table 10. 导入批次状态",
        ["状态", "含义", "处理方式"],
        [
            ["processing", "批次仍在处理，成功和失败计数会持续变化。", "继续轮询；不要重复提交同一批数据。"],
            ["completed", "批次全部处理完成且没有失败。", "检查 productCount 与 embeddingCoverage。"],
            ["completed_with_errors", "批次完成但存在失败商品。", "查看失败原因，必要时 retry 或修正数据后重传。"],
            ["failed", "批次整体失败或无法恢复。", "读取 raw.progress 和错误日志，必要时 rollback。"],
            ["rolled_back", "批次已回滚。", "商品和 embedding 已按快照恢复或删除。"],
        ],
        [1.5, 2.25, 2.75],
    )

    add_h2(doc, "5.2 导入幂等与去重规则")
    add_para(doc, "生产导入必须保证 productUrl、platform 和 externalId 尽可能真实稳定。后端支持从部分平台 URL 中解析 externalId，并以 platform + externalId 作为主要 upsert key。这样同一平台同一商品重复导入时会更新已有商品，而不是产生新记录。")
    add_note(doc, "去重风险", "如果某批苏宁商品先被错误写成 manual 平台，后续再改成 suning 重新导入，会因为 upsert key 改变而形成重复商品。因此平台识别应在入库前完成，不能把未知平台静默改成 manual。")
    add_table(
        doc,
        "Table 11. 平台与身份字段",
        ["平台", "示例身份字段", "说明"],
        [
            ["taobao / tmall", "item id", "来自 item.taobao.com 或 detail.tmall.com URL。"],
            ["jd", "skuId / product id", "来自京东商品页或聚合 API 字段。"],
            ["suning", "苏宁商品编码", "来自 product.suning.com URL 或原始字段。"],
            ["vipshop", "唯品会商品/品牌/货号组合", "需要保留 rawPayload，便于追踪。"],
            ["xianyu", "闲鱼 item id", "用于二手商品候选和平台回跳。"],
        ],
        [1.35, 2.05, 3.1],
    )

    add_h2(doc, "5.3 维护接口使用边界")
    add_para(doc, "商品池维护接口会真实修改云端数据库，部分接口还会触发模型调用和 COS 上传，因此必须限制在运维脚本、管理页面或开发者手动操作中使用。普通移动端前端不应直接调用 import、delete、rollback、rebuild 等接口。")

    add_h1(doc, 6, "商品导入契约")
    add_para(doc, "所有聚合 API 商品数据、Excel 商品表和 JSON 原始数据都应先转换为 ProductImportItemDto。标准化入口保证不同平台字段可以统一去重、裁剪、向量化和展示；商品主图最终按 360p 标准化后再入库和生成图片 embedding。")
    add_table(
        doc,
        "Table 12. ProductImportItemDto",
        ["字段", "要求", "说明"],
        [
            ["platform", "必填", "taobao、tmall、jd、vipshop、suning、dewu、pdd、douyin、xianyu、manual。"],
            ["externalId", "推荐", "平台商品 ID；导入时用于 platform + externalId 去重。"],
            ["title", "必填", "商品标题。"],
            ["price / currency", "必填", "价格与币种，当前主要为 CNY。"],
            ["stockStatus", "必填", "in_stock、out_of_stock、unknown。"],
            ["productUrl", "必填", "真实商品详情页链接，用于回跳和身份解析。"],
            ["imageUrl / localImagePath / imageDataBase64", "至少一种", "商品主图来源。"],
            ["brandHint / categoryHint", "推荐", "用于标签召回和品类子池过滤。"],
            ["rawPayload", "推荐", "保留聚合 API 原始字段，便于追踪。"],
        ],
        [1.65, 1.2, 3.65],
    )

    add_h2(doc, "6.1 导入请求示例")
    add_code_block(
        doc,
        '''
        POST /api/v1/product-pool/import
        Header: x-maintenance-token: <MAINTENANCE_API_TOKEN>
        {
          "batchSource": "mixed_group0001_batch0001",
          "items": [
            {
              "platform": "suning",
              "externalId": "0000000000",
              "title": "示例真实商品标题",
              "price": "199.00",
              "currency": "CNY",
              "stockStatus": "unknown",
              "productUrl": "https://product.suning.com/...",
              "imageUrl": "https://imgservice.suning.cn/...",
              "categoryHint": "clothing",
              "brandHint": "示例品牌",
              "rawPayload": { "source": "aggregation_api" }
            }
          ]
        }
        ''',
    )
    add_para(doc, "上例中的 rawPayload 用于保存聚合 API 原始字段。正式导入时 rawPayload 不参与前端展示，但在排查平台字段、图片链接和商品详情页失效时非常重要。")

    add_h2(doc, "6.2 入库前校验规则")
    add_table(
        doc,
        "Table 13. 数据质量校验",
        ["校验项", "通过标准", "失败处理"],
        [
            ["平台识别", "platform 属于允许枚举，且与 productUrl 一致。", "写入 reject 文件，不默认改成 manual。"],
            ["商品 URL", "详情页 URL 真实稳定，能定位到平台商品。", "正式导入前抽样验链。"],
            ["图片 URL", "返回图片内容，不是 HTML、验证码或 403 页面。", "剔除或替换图片。"],
            ["价格字段", "price 可解析为金额字符串，currency 默认为 CNY。", "记录格式错误并拒绝该条。"],
            ["品类字段", "categoryHint 尽量明确。", "缺失时可入库但会影响标签召回质量。"],
            ["重复商品", "platform + externalId 不重复。", "已存在则更新，不重复创建。"],
        ],
        [1.35, 2.45, 2.7],
    )

    add_h1(doc, 7, "账号与用户画像接口")
    add_table(
        doc,
        "Table 14. 用户与偏好接口",
        ["方法", "路径", "说明"],
        [
            ["POST", "/api/v1/auth/register", "注册账号，返回认证信息。"],
            ["POST", "/api/v1/auth/login", "登录账号，返回 JWT。"],
            ["GET", "/api/v1/users/me", "读取当前登录用户。"],
            ["GET", "/api/v1/users/me/profile", "读取用户画像块。"],
            ["GET", "/api/v1/users/me/profile/context", "按 category 读取可用于会话的画像上下文。"],
            ["POST/PATCH/DELETE", "/api/v1/users/me/profile/blocks", "新增、编辑或删除用户画像块。"],
            ["GET/POST", "/api/v1/users/me/memory-proposals", "读取、确认或拒绝记忆提案。"],
            ["GET/POST", "/api/v1/preferences/shoe-size", "保存本地设备鞋码偏好。"],
        ],
        [1.0, 2.8, 2.7],
    )

    add_h1(doc, 8, "接口复用性与安全约束")
    add_para(doc, "API 设计同样遵循可复用原则。前端只依赖稳定的 `/api/v1/assets`、`/api/v1/sessions`、`/api/v1/candidates` 和 `/api/v1/product-pool` 契约，不需要知道商品来自哪个聚合 API、图片最终存在哪个 bucket、embedding 由哪个模型生成。这样后端可以独立演进数据导入和模型能力，而前端接口保持稳定；模型可替换时，只要输出仍落到既有 DTO 和 embedding 元数据结构中，API 不需要重新设计。")
    add_table(
        doc,
        "Table 15. API 复用边界",
        ["接口组", "复用价值", "不暴露的内部细节"],
        [
            ["/assets", "统一承接相机、相册、演示图片和调试图片。", "COS bucket、objectKey 生成规则、压缩细节。"],
            ["/sessions", "统一承接图片搜索和文本搜索会话。", "视觉模型 prompt、query embedding provider。"],
            ["/candidates", "统一返回候选列表、分页和详情。", "ANN 实现、标签召回权重、视觉复核策略。"],
            ["/product-pool", "统一维护真实商品池和导入批次。", "平台原始字段差异、Excel/JSON 清洗逻辑。"],
            ["/users/me", "统一管理用户画像和记忆提案。", "画像索引构建和对话解析细节。"],
        ],
        [1.55, 2.45, 2.5],
    )
    add_para(doc, "环境变量属于部署层安全边界，不应通过 API 返回给前端。前端页面只输入维护 token 并保存在当前浏览器本地，用于调用维护接口；后端只比较请求头与服务端环境变量，不向外暴露 token 明文。")
    add_table(
        doc,
        "Table 16. 接口安全约束",
        ["安全对象", "约束", "说明"],
        [
            ["MAINTENANCE_API_TOKEN", "只在服务端 .env 或 Zeabur 环境变量中保存。", "保护导入、删除、回滚和 embedding 重建。"],
            ["模型 API Key", "不进入请求体、不返回给前端。", "由后端 provider 读取环境变量调用模型。"],
            ["COS 密钥", "只在对象存储 adapter 中使用。", "前端只拿到可访问图片 URL 或受控对象引用。"],
            ["JWT", "仅用户画像相关接口需要。", "普通演示搜索链路可匿名使用，降低体验门槛。"],
            ["批次删除/回滚", "支持 dryRun，正式执行前先预检。", "降低误删真实商品数据的风险。"],
        ],
        [1.7, 2.35, 2.45],
    )

    add_h1(doc, 9, "错误码与联调注意事项")
    add_para(doc, "常见错误包括 SEARCH_BODY_REQUIRED、SEARCH_KEYWORDS_REQUIRED、IMAGE_BASE64_OR_IMAGE_URL_REQUIRED、MAINTENANCE_API_TOKEN_REQUIRED、MAINTENANCE_TOKEN_INVALID、EMBEDDING_PROVIDER_NOT_CONFIGURED 等。模型或对象存储相关错误应结合 requestId、批次详情和后端日志定位。")
    add_table(
        doc,
        "Table 17. 常见错误码",
        ["错误码", "触发场景", "排查方式"],
        [
            ["SEARCH_BODY_REQUIRED", "POST /search/shoes 请求体为空。", "确认发送 JSON body。"],
            ["SEARCH_KEYWORDS_REQUIRED", "关键词数组为空或只有空字符串。", "至少传入一个有效关键词。"],
            ["IMAGE_BASE64_OR_IMAGE_URL_REQUIRED", "图片预处理调试接口未提供图片。", "提供 imageBase64 或 imageUrl。"],
            ["MAINTENANCE_API_TOKEN_REQUIRED", "云端未配置维护 token。", "在环境变量中配置 MAINTENANCE_API_TOKEN。"],
            ["MAINTENANCE_TOKEN_INVALID", "请求头 token 与云端配置不一致。", "检查 x-maintenance-token 来源。"],
            ["EMBEDDING_PROVIDER_NOT_CONFIGURED", "embedding provider 缺少 API key 或 base URL。", "检查 EMBEDDING_API_KEY 等变量。"],
            ["REAL_EMBEDDING_PROVIDER_REQUIRED", "生产环境尝试使用 mock/hash provider。", "切换到真实 embedding provider。"],
            ["UNSUPPORTED_PRODUCT_DATA_PROVIDER", "PRODUCT_DATA_PROVIDER 不在后端支持范围。", "当前演示建议使用 local_product_pool。"],
        ],
        [2.05, 2.15, 2.3],
    )
    add_h2(doc, "8.1 正式联调流程")
    add_para(doc, "正式联调时建议按健康检查、图片上传、创建会话、读取候选、提交多轮筛选、读取详情的顺序进行。商品池维护联调则按导入小批次、查询 batch、检查 stats、抽样搜索、必要时 rollback 的顺序进行。所有云端导入都应先小批量验证图片可访问性和 embedding 覆盖率，再扩大到更多真实数据。")
    add_para(doc, "云端环境中，PRODUCT_EMBEDDING_KINDS 当前建议保持 visual，以控制成本；如需演示双 embedding，可临时选择少量批次改为 visual,multimodal。商品导入不应绕过后端，因为后端负责图片标准化、embedding 生成、批次审计和去重。")
    doc.save(OUT_DIR / "API说明文档.docx")


def build_ai_summary(figs):
    doc = Document()
    configure_doc(doc, "AI Usage Summary")
    add_title_block(doc, ["AI 拍照识物与智能比价购物助手", "AI 使用总结文档"])
    add_abstract(
        doc,
        "本文档总结项目中 AI 能力的使用方式，包括图像理解、图片 embedding、ANN 检索、自然语言筛选、数据清洗辅助和工程开发辅助。项目使用聚合 API 获取真实商品数据，避免只用模拟数据带来的演示失真。受模型调用费用和双 embedding 成本限制，当前只为一部分商品生成 visual 与 multimodal 双 embedding 用于演示，大规模真实商品默认生成 visual embedding。真实数据规模虽然受到成本控制，但已覆盖完整链路，具备可行性和实际应用价值。"
    )

    add_h1(doc, 1, "AI 使用范围")
    add_para(doc, "AI 在本项目中不是单点功能，而是贯穿“商品理解、向量检索、对话筛选、数据整理和工程开发”的基础能力。系统把模型输出放在 Adapter 层后面，核心服务只消费标准化画像、embedding 向量和筛选意图，降低模型供应商变化对业务代码的影响。")
    add_table(
        doc,
        "Table 1. AI 能力分工",
        ["AI 能力", "项目用途", "输出"],
        [
            ["视觉理解", "识别用户上传图片中的商品主体、类别和关键标签。", "ProductProfile、subjectDetection、标签置信度。"],
            ["图片 embedding", "把用户图和商品图转换为可比较的向量。", "provider、model、dimension、vector、preprocessJson。"],
            ["ANN 相似召回", "基于图片向量和标签约束召回真实商品池候选。", "候选商品、相似分、排序依据。"],
            ["自然语言理解", "解析用户追加筛选，如预算、品牌、颜色、平台偏好。", "FilterPatch 和候选收敛结果。"],
            ["数据清洗辅助", "辅助识别平台字段、品类、品牌和异常链接。", "标准 JSON、reject 原因、批次统计。"],
            ["工程开发辅助", "辅助生成脚本、定位错误、整理文档和测试清单。", "代码改动、运行命令、交付文档。"],
        ],
        [1.45, 2.55, 2.5],
    )

    add_h1(doc, 2, "图像理解与主体标准化")
    add_para(doc, "用户上传图片后，后端会对主体进行定位和裁剪，生成更适合检索的输入图。商品入库时，商品主图也会被统一处理为相同规格。当前导入配置使用 PRODUCT_IMPORT_IMAGE_TARGET_SIZE=360 和 PRODUCT_IMPORT_IMAGE_JPEG_QUALITY=88，使后续 embedding 输入更稳定。")
    add_figure(doc, figs["ai_flow"], "Figure 1. AI 与真实数据处理链路", width=6.2)
    add_para(doc, "统一分辨率的意义不只是节省图片体积，也能减少不同平台图片尺寸、留白和压缩质量差异对 embedding 的影响。后续如果继续优化，可在 Adapter 层调节裁剪 padding、主体检测阈值和多图策略。")

    add_h1(doc, 3, "Embedding 策略")
    add_para(doc, "项目支持两类商品 embedding：visual 表示纯图片向量，适合以图片相似度为核心的检索；multimodal 表示图片加文本标签的混合向量，适合利用标题、品牌、品类和颜色信息增强召回。")
    add_table(
        doc,
        "Table 2. Embedding 类型比较",
        ["类型", "输入", "优点", "当前策略"],
        [
            ["visual", "标准化商品图或用户图", "成本较低，和拍照识物主场景一致。", "大规模商品默认生成。"],
            ["multimodal", "图片 + 标题/标签提示", "语义补充更强，适合标题明确的商品。", "仅选择部分商品生成，用于演示和对比。"],
        ],
        [1.0, 1.7, 2.0, 1.8],
    )
    add_note(doc, "成本说明", "双 embedding 会让每件商品至少多一次模型向量化调用。真实商品越多，费用越明显。因此项目没有为了形式上扩大指标而盲目生成全量双 embedding，而是保留少量双 embedding 商品验证可行性。")

    add_h1(doc, 4, "真实数据与商品池构建")
    add_para(doc, "数据获取采用聚合 API 获取真实商品数据，并在本地清洗阶段把不同平台字段转为统一标准。当前数据覆盖京东、苏宁、淘宝、唯品会、闲鱼等平台和多个品类。相比模拟数据，真实数据更能检验商品图可访问性、价格字段、详情页链接、平台识别和去重策略。")
    preview = ROOT / "docs" / "image" / "18-图像ANN检索与前端接口" / "1780295595345.png"
    if preview.exists():
        add_figure(doc, preview, "Figure 2. 真实采集数据预览截图", width=5.8)
    add_para(doc, "真实数据量受成本和平台接口稳定性限制，不追求无限扩大。课程项目的重点是证明端到端可行：真实商品可以被清洗为标准结构，真实图片可以被统一裁剪并生成 embedding，真实候选可以被召回并展示给用户。")

    add_h1(doc, 5, "Adapter 与提示词治理")
    add_para(doc, "项目把外部能力放入 Adapter 层。商品导入、图像预处理、模型打标、图片向量化、ANN 检索、商品视图输出等都有对应 Adapter。这样做的好处是模型提示词、数据源字段和第三方服务变化时，核心 ProductPoolService 和 SessionsService 不需要直接理解原始格式。")
    add_para(doc, "从 AI 使用角度看，Adapter 层让模型能力具备可复用和可替换的基础。可复用性体现在同一套图片标准化、embedding、ANN 诊断和候选输出能力可以服务不同品类、不同平台、不同数据来源；可替换性体现在视觉模型、对话模型、embedding 模型可以通过 provider 和环境变量替换，而不需要改变 App 接口和商品池主表结构。")
    add_table(
        doc,
        "Table 3. AI Adapter 治理方式",
        ["Adapter", "治理内容", "价值"],
        [
            ["VisionProfileAdapter", "把视觉模型输出归一化为 ProductProfile。", "避免模型自由文本直接进入业务逻辑。"],
            ["ProductImageEmbeddingAdapter", "统一预处理、调用 embedding provider、生成写库数据。", "保证商品向量带有完整来源和质量元数据。"],
            ["SearchQueryEmbeddingAdapter", "把用户图或文本查询转成检索向量。", "支持 visual 与 multimodal 查询切换。"],
            ["ProductImportAdapter", "将聚合 API 原始商品转为 ProductImportItemV1。", "统一多平台数据格式和校验规则。"],
            ["ConversationIntentAdapter", "解析用户自然语言筛选意图。", "让多轮对话变成可执行的过滤补丁。"],
        ],
        [1.65, 2.55, 2.3],
    )

    add_h1(doc, 6, "AI 辅助开发实践")
    add_para(doc, "开发过程中使用 AI 辅助阅读项目结构、生成导入脚本、排查云端导入失败、整理 PowerShell 命令、分析后端接口、设计调试页面和生成课程文档。AI 主要承担“快速归纳、脚本生成和错误定位”角色，关键配置、维护 token、云端环境变量和最终导入操作仍由开发者确认。")
    add_para(doc, "这种协作方式提高了项目迭代速度，尤其是在数据清洗、批次拆分、去重、embedding 成本控制和文档整理方面。但 AI 输出不能替代真实运行验证，因此项目保留了 smoke、批次质量报告、回滚和统计接口。")

    add_h1(doc, 7, "成本控制与当前不足")
    add_para(doc, "当前不足主要来自三方面：第一，真实商品规模受模型费用、图片存储和平台数据可获得性限制；第二，商品图片裁剪仍可能受留白、模特图、组合图影响，需要持续优化；第三，双 embedding 没有全量覆盖，只能在演示样本中体现视觉与语义混合检索的潜力。")
    add_para(doc, "这些限制不影响项目可行性结论。相反，真实数据下暴露的问题更接近实际上线会遇到的问题。项目已经证明真实商品可以通过聚合 API 进入标准商品池，并完成裁剪、embedding、ANN 召回、候选展示和多轮筛选。")

    add_h1(doc, 8, "评估指标与风险控制")
    add_para(doc, "AI 能力的评估不应只看单次模型返回是否“看起来正确”，而应看端到端结果是否可用。项目当前建议从图片预处理成功率、商品 embedding 覆盖率、ANN 召回可用率、候选点击可达率、批次失败率和人工抽检质量六个维度评估。")
    add_table(
        doc,
        "Table 4. AI 链路验收指标",
        ["指标", "含义", "验收方式"],
        [
            ["图片预处理成功率", "商品图能否裁剪为稳定的 360p embedding 输入。", "批量导入后抽样查看 preprocessJson 和裁剪图。"],
            ["Embedding 覆盖率", "可检索商品是否已有 visual embedding。", "商品池 stats 和 batch quality 页面检查。"],
            ["召回可用率", "用户图能否召回同类或近似真实商品。", "使用典型商品图进行 ANN 诊断。"],
            ["详情可达率", "候选 productUrl 是否能跳转真实平台页面。", "正式演示前抽样验链。"],
            ["成本可控性", "模型调用量是否符合预算。", "默认 visual，少量双 embedding 演示。"],
            ["数据真实性", "商品是否来自真实平台数据而非虚构列表。", "保留聚合 API 原始 rawPayload 和批次来源。"],
        ],
        [1.6, 2.2, 2.7],
    )
    add_para(doc, "风险控制方面，项目避免把模型自由文本直接写入业务核心，而是把模型输出转为结构化标签、bbox 或向量；避免把图片本体写入数据库，而是存储对象引用；避免全量双 embedding 造成成本失控，而是以可配置环境变量控制 embeddingKind。")

    add_h1(doc, 9, "总结")
    add_para(doc, "本项目的 AI 使用不是简单调用一次模型，而是围绕真实商品池构建一条可持续的数据与检索链路。项目选择用真实数据展示价值，并用 visual embedding 控制成本，用少量双 embedding 证明扩展能力。后续若预算允许，可以逐步扩大双 embedding 覆盖、增强裁剪精度、补充更多平台数据，并引入更强的向量库和质量评估机制。")
    doc.save(OUT_DIR / "AI使用总结文档.docx")


def main():
    figs = create_figures()
    build_architecture(figs)
    build_api(figs)
    build_ai_summary(figs)
    print("Generated:")
    for item in ["架构设计文档.docx", "API说明文档.docx", "AI使用总结文档.docx"]:
        print(OUT_DIR / item)


if __name__ == "__main__":
    main()
