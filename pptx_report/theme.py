"""主题与配色模块。

定义报告整体的视觉规范：中文字体、主色板（页面框架，≤4 色）、人群对比色板
（图表系列，可 >4 色，不计入「页面 ≤4 色」限制）、数据标签规范。

对齐尼尔森 / 益普索 / 凯度等专业调研公司交付标准：
  - 标题栏深蓝 ``#002960``；
  - 人群对比采用固定 6 色标准色板（Total 灰 → 橙 → 红褐 → 绿 → 紫 → 青）；
  - 数据标签统一百分比格式 ``49.0%``，9pt，深灰 ``#404040``，微软雅黑。

所有页面与图表均从 :class:`Theme` 实例读取样式，保证风格统一、易于换肤。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List

from pptx.dml.color import RGBColor


# 主色板（≤4 色，用于页面框架 / 标题栏 / KPI 卡片）：
#   深蓝(标题) → 中蓝(次) → 橙(强调) → 深灰(文本辅助)
DEFAULT_PALETTE = ["002960", "0065BD", "E66C37", "404040"]

# 人群对比色板（调研公司标准固定色，可 >4 色，仅用于图表系列着色）
DEFAULT_SEGMENT_PALETTE = [
    "2563EB", "3B82F6", "60A5FA", "1D4ED8", "0EA5E9",
    "06B6D4", "14B8A6", "6366F1", "8B5CF6", "93C5FD",
]

THEME_PRESETS = {
    "blue": {
        "name": "蓝色商务",
        "palette": ["123B73", "2563EB", "60A5FA", "F59E0B"],
        "segment_palette": DEFAULT_SEGMENT_PALETTE,
    },
    "teal": {
        "name": "青绿色",
        "palette": ["075985", "0891B2", "14B8A6", "F59E0B"],
        "segment_palette": ["0F766E", "14B8A6", "2DD4BF", "0E7490", "06B6D4", "67E8F9", "115E59", "5EEAD4"],
    },
    "green": {
        "name": "自然绿",
        "palette": ["14532D", "16A34A", "86EFAC", "D97706"],
        "segment_palette": ["15803D", "22C55E", "4ADE80", "65A30D", "84CC16", "A3E635", "047857", "34D399"],
    },
    "orange": {
        "name": "活力橙",
        "palette": ["7C2D12", "EA580C", "FB923C", "1D4ED8"],
        "segment_palette": ["EA580C", "F97316", "FB923C", "C2410C", "F59E0B", "FBBF24", "DC2626", "F87171"],
    },
    "purple": {
        "name": "雅致紫",
        "palette": ["4C1D95", "7C3AED", "A78BFA", "0EA5E9"],
        "segment_palette": ["7C3AED", "8B5CF6", "A78BFA", "6D28D9", "C084FC", "D8B4FE", "4F46E5", "818CF8"],
    },
}

DEFAULT_FONT = "微软雅黑"
DEFAULT_DATA_LABEL_COLOR = "404040"
# 本模块数据在组装阶段已 ×100（49.0 表示 49%），故标签直接显示数值 + 字面 %
DEFAULT_PCT_FORMAT = '0.0"%"'


@dataclass
class Theme:
    """报告视觉主题。

    Attributes:
        name: 主题名称，仅用于调试 / 日志。
        font_name: 全局中文字体（拉丁与东亚字形均会设置，确保中文正常显示）。
        palette: 主色板，长度 1~4，索引 0 为主色（标题栏 / 标题）。
        segment_palette: 人群对比色板，长度不限，用于给图表系列（各人群 / 维度）着色。
        background: 幻灯片背景色（十六进制）。
        text_dark: 深色文本（用于浅色背景）。
        text_light: 浅色文本（用于深色色块 / 色带）。
        data_label_color: 数据标签颜色。
        data_label_size: 数据标签字号（pt）。
        pct_format: 数据标签数字格式（Excel 格式串），默认 ``0.0"%"``。
    """

    name: str = "default"
    font_name: str = DEFAULT_FONT
    palette: List[str] = field(default_factory=lambda: list(DEFAULT_PALETTE))
    segment_palette: List[str] = field(
        default_factory=lambda: list(DEFAULT_SEGMENT_PALETTE)
    )
    background: str = "FFFFFF"
    text_dark: str = "222222"
    text_light: str = "FFFFFF"
    data_label_color: str = DEFAULT_DATA_LABEL_COLOR
    data_label_size: int = 9
    pct_format: str = DEFAULT_PCT_FORMAT

    def __post_init__(self) -> None:
        if not (1 <= len(self.palette) <= 4):
            raise ValueError("palette 长度必须为 1~4（页面配色不超过 4 种）")
        self.palette = [c.lstrip("#") for c in self.palette]
        self.segment_palette = [c.lstrip("#") for c in self.segment_palette]
        self.background = self.background.lstrip("#")
        self.text_dark = self.text_dark.lstrip("#")
        self.text_light = self.text_light.lstrip("#")
        self.data_label_color = self.data_label_color.lstrip("#")

    # ---- 页面框架主色板（≤4 色） ----
    def color(self, index: int) -> RGBColor:
        """按索引返回主色板颜色（自动取模，越界不报错）。"""
        hex_value = self.palette[index % len(self.palette)]
        return RGBColor.from_string(hex_value)

    # ---- 图表系列 / 人群对比色板（可 >4 色） ----
    def seg_color(self, index: int) -> RGBColor:
        """按索引返回人群对比色板颜色（自动取模）。"""
        hex_value = self.segment_palette[index % len(self.segment_palette)]
        return RGBColor.from_string(hex_value)

    @property
    def primary(self) -> RGBColor:
        """主色（索引 0，标题栏 / 标题）。"""
        return self.color(0)

    @property
    def secondary(self) -> RGBColor:
        """次色（索引 1）。"""
        return self.color(1)

    @property
    def accent(self) -> RGBColor:
        """强调色（索引末位）。"""
        return self.color(-1)

    def rgb(self, hex_value) -> RGBColor:
        """将十六进制 / RGBColor / 整数统一转为 RGBColor。"""
        if isinstance(hex_value, RGBColor):
            return hex_value
        if isinstance(hex_value, int):
            return RGBColor(hex_value)
        return RGBColor.from_string(str(hex_value).lstrip("#"))


def theme_from_key(key: str | None) -> Theme:
    """按前端主题键生成主题；未知值安全回退为默认蓝色。"""
    preset = THEME_PRESETS.get((key or "blue").lower(), THEME_PRESETS["blue"])
    return Theme(
        name=preset["name"],
        palette=list(preset["palette"]),
        segment_palette=list(preset["segment_palette"]),
    )
