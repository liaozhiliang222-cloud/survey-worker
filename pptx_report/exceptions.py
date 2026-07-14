"""自定义异常模块。

集中定义报告生成过程中可能抛出的异常，便于调用方做精细化的错误处理。
所有异常均继承自 :class:`ReportError`，可用单一 except 捕获全部报告相关错误。
"""


class ReportError(Exception):
    """报告生成相关异常的基类。"""


class ReportDataError(ReportError):
    """内容数据结构不合法时抛出（如字段缺失、类型错误）。"""


class UnsupportedChartTypeError(ReportError):
    """指定的图表类型不被支持时抛出。"""

    def __init__(self, chart_type):
        super().__init__(f"不支持的图表类型: {chart_type!r}")
        self.chart_type = chart_type


class TemplateNotFoundError(ReportError):
    """指定的模板文件不存在或无法读取时抛出。"""

    def __init__(self, path):
        super().__init__(f"模板文件不存在或无法读取: {path!r}")
        self.path = path


class RenderingError(ReportError):
    """渲染某一页或某个图表时发生未知错误时抛出。"""

    def __init__(self, message, page="", chart=""):
        super().__init__(message)
        self.page = page
        self.chart = chart
