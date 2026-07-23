from collections import Counter
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile
import os
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pptx import Presentation

from pptx_report.common.capacity import split_preserving_order
from pptx_report.common.narrative import build_slide_briefs
from pptx_report.facts import build_funnel_facts, extract_data_facts, infer_data_kind
from pptx_report.model import (
    ChartPageContent, ChartSpec, ChartType, CoverContent, DataKind,
    ExecutiveFinding, ExecutiveSummaryContent, FindingsOverviewContent,
    FunnelAnalysisContent, FunnelStage, KeyFindingContent, OpportunityItem,
    OpportunityMatrixContent, RecommendationContent, RecommendationItem,
    ReportSpec, ResearchOverviewContent, SectionDividerContent, Series,
    TocContent,
)
from pptx_report.renderer import ReportRenderer
from pptx_report.report_templates import select_report_template


def check_facts():
    percentage = {
        "code": "Q1", "title": "满意度", "data_kind": "percentage",
        "categories": ["非常满意", "比较满意", "不太满意", "很不满意"],
        "segments": ["Total", "年轻用户"],
        "data": {"Total": [.30, .35, .20, .15], "年轻用户": [.50, .35, .10, .05]},
        "base": {"Total": 400, "年轻用户": 25}, "ordered_scale": True,
    }
    mean = {
        "code": "Q2", "title": "平均评分", "data_kind": "mean",
        "categories": ["均值"], "segments": ["Total", "老用户"],
        "data": {"Total": [7.2], "老用户": [8.0]}, "base": {"Total": 400, "老用户": 80},
    }
    related = {**percentage, "code": "Q3", "title": "推荐意愿", "data": {"Total": [.30, .35, .20, .15], "年轻用户": [.45, .35, .10, .10]}}
    trend = {"code": "Q4", "title": "年度趋势", "data_kind": "percentage", "categories": ["2024", "2025", "2026"], "segments": ["Total"], "data": {"Total": [.40, .50, .55]}, "base": {"Total": 400}, "trend_ordered": True}
    facts = extract_data_facts([percentage, mean, related, trend])
    gap = next(f for f in facts if f.fact_type == "segment_gap" and f.category == "非常满意")
    assert round(gap.gap_pp, 1) == 20.0 and gap.significant is None
    assert any(f.fact_type == "low_base_warning" and f.segment == "年轻用户" for f in facts)
    assert any(f.fact_type == "top2box" and round(f.value, 1) == 65.0 for f in facts)
    assert any(f.fact_type == "bottom2box" and round(f.value, 1) == 35.0 for f in facts)
    mean_gap = next(f for f in facts if f.fact_type == "mean_difference" and f.question_id == "Q2")
    assert mean_gap.gap_pp is None and mean_gap.value == 8.0
    assert infer_data_kind(mean) == "mean"
    assert any(f.fact_type == "outlier" for f in facts)
    assert any(f.fact_type == "cross_question_consistency" for f in facts)
    assert any(f.fact_type == "trend_change" and round(f.gap_pp, 1) == 15.0 for f in facts)
    funnel = build_funnel_facts([("知晓", 80), ("考虑", 50), ("购买", 20)])
    assert [round(abs(f.gap_pp), 1) for f in funnel] == [30.0, 30.0]
    return facts


def check_capacity_and_briefs(facts):
    pages, audit = split_preserving_order(list(range(23)), max_items=12, source_slide_id="s1")
    assert [len(page) for page in pages] == [12, 11]
    assert [item for page in pages for item in page] == list(range(23))
    assert audit.input_blocks == audit.rendered_blocks == 23
    assert audit.truncated_blocks == 0 and not audit.removed_content
    page_plan = [
        {"slide_id": "a", "title": "用户是谁", "chapter": "用户画像", "questions": [{"code": "Q1"}]},
        {"slide_id": "b", "title": "差异在哪里", "chapter": "消费行为", "questions": [{"code": "Q2"}]},
    ]
    briefs = build_slide_briefs(page_plan, [f.to_dict() for f in facts])
    assert len(briefs) == 2
    assert all(brief.question_answered and brief.claim for brief in briefs)
    assert briefs[0].relationship_to_next and briefs[1].relationship_to_previous
    assert briefs[0].claim != briefs[1].claim


def check_templates_and_chart_semantics():
    request = {"slide_type": "key_finding", "chart_count": 1, "category_count": 4,
               "segment_count": 2, "density": "medium", "importance": "high"}
    first, _ = select_report_template(request)
    usage = Counter({first.template_id: 3})
    second, _ = select_report_template(request, previous_template_id=first.template_id, usage=usage)
    assert first.template_id != second.template_id
    for kind, unit in (("percentage", "%"), ("mean", "分"), ("currency", "元"),
                       ("count", "人"), ("score", "分"), ("nps", "")):
        spec = ChartSpec("指标", ChartType.BAR, ["A", "B"], [Series("Total", [1, 2])],
                         data_kind=DataKind(kind), unit=unit)
        restored = ChartSpec.from_dict(spec.to_dict())
        assert restored.data_kind == DataKind(kind) and restored.unit == unit


def check_rendered_page_families():
    finding = ExecutiveFinding("核心用户更关注体验", "年轻用户评价更集中。", ["Q1__top_rank__001"],
                               "优先优化关键触点", "high", ["Q1"], ["Q1.满意度"])
    chart = ChartSpec("满意度", ChartType.BAR, ["满意", "不满意"],
                      [Series("Total", [65, 35])], data_kind=DataKind.PERCENTAGE,
                      evidence_question_ids=["Q1"], evidence_fact_ids=["Q1__top_rank__001"],
                      source_references=["Q1.满意度"])
    pages = [
        ResearchOverviewContent(sample_size=400, question_count=2, segment_count=2,
                                source_references=["交叉表"]),
        SectionDividerContent("用户与行为", "主要研究发现", "从画像进入行为诊断"),
        FindingsOverviewContent(findings=[finding]),
        KeyFindingContent("核心发现", finding, [chart], "数据来源：Q1.满意度"),
        FunnelAnalysisContent("转化漏斗", [FunnelStage("知晓", 80), FunnelStage("考虑", 50), FunnelStage("购买", 20)], ["考虑到购买流失最大"], "数据来源：Q3"),
        OpportunityMatrixContent("机会优先级", [OpportunityItem("产品体验", 85, 45, "优先改善"), OpportunityItem("品牌认知", 70, 75, "持续保持")], "数据来源：Q4"),
        RecommendationContent(recommendations=[RecommendationItem("改善核心体验", "对应产品体验短板", "high", ["Q1__top_rank__001"])])
    ]
    spec = ReportSpec(CoverContent("定量研究报告", "测试客户", "2026-07-23"), TocContent([]),
                      ExecutiveSummaryContent(findings=[finding]), pages)
    with TemporaryDirectory() as temp:
        output = Path(temp) / "semantic-report.pptx"
        renderer = ReportRenderer()
        renderer.render(spec, str(output))
        assert renderer.last_qa and renderer.last_qa["ok"], renderer.last_qa
        prs = Presentation(str(output))
        assert len(prs.slides) == 10
        texts = "\n".join(shape.text for slide in prs.slides for shape in slide.shapes if getattr(shape, "has_text_frame", False))
        assert "核心发现" in texts and "行动建议" in texts and "数据来源：Q4" in texts
        with ZipFile(output) as archive:
            xml = "".join(archive.read(name).decode("utf-8", "ignore") for name in archive.namelist() if name.startswith("ppt/slides/slide") and name.endswith(".xml"))
        assert "NaN" not in xml
        if os.environ.get("REPORT_SEMANTICS_OUTPUT"):
            target = Path(os.environ["REPORT_SEMANTICS_OUTPUT"])
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(output, target)


def main():
    facts = check_facts()
    check_capacity_and_briefs(facts)
    check_templates_and_chart_semantics()
    check_rendered_page_families()
    print("report semantics smoke: ok")


if __name__ == "__main__":
    main()