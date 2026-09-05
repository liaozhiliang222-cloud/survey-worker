"""Renderer routing and quality policy for qualitative PowerPoint exports."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import Protocol

from .officecli_runner import OfficeCliExecutionError, OfficeCliRunner
from .officecli_qualitative_renderer import (
    build_officecli_commands,
    render_officecli_qualitative_report,
)
from .qualitative_layouts import layout_candidates, resolve_layout_variant
from .qualitative_renderer import (
    layout_adaptations,
    prepare_pages,
    render_qualitative_report,
    validate_script,
)


class QualitativePptServiceError(RuntimeError):
    code = "QUALITATIVE_PPT_RENDER_FAILED"


class OfficeCliUnavailableError(QualitativePptServiceError):
    code = "OFFICECLI_UNAVAILABLE"


class OfficeCliQualityError(QualitativePptServiceError):
    code = "OFFICECLI_VALIDATION_FAILED"


class QualitativePptEngine(Protocol):
    engine_id: str

    def render(self, script: dict) -> dict: ...


class PythonPptxQualitativeEngine:
    """Compatibility renderer used when OfficeCLI is unavailable or disabled."""

    engine_id = "python-pptx"

    def render(self, script: dict) -> dict:
        return render_qualitative_report(script)


class OfficeCliQualitativeEngine:
    """Primary enterprise renderer using native OfficeCLI objects."""

    engine_id = "officecli"

    def __init__(self, officecli: OfficeCliRunner):
        self.officecli = officecli

    def render(self, script: dict) -> dict:
        return render_officecli_qualitative_report(script, self.officecli)


class QualitativePptRenderService:
    """Route deterministic rendering while keeping the PPT Script unchanged."""

    VALID_QA_MODES = {"off", "prefer", "required"}
    VALID_ENGINE_MODES = {"auto", "officecli", "python-pptx"}

    def __init__(
        self,
        engine: QualitativePptEngine | None = None,
        officecli: OfficeCliRunner | None = None,
        quality_mode: str | None = None,
        engine_mode: str | None = None,
    ):
        self.officecli = officecli or OfficeCliRunner()
        self._explicit_engine = engine
        configured_mode = (quality_mode or os.getenv("QUALITATIVE_PPT_OFFICECLI_QA", "prefer")).strip().lower()
        if configured_mode not in self.VALID_QA_MODES:
            raise ValueError(
                "QUALITATIVE_PPT_OFFICECLI_QA must be off, prefer or required"
            )
        self.quality_mode = configured_mode
        configured_engine = (
            engine_mode or os.getenv("QUALITATIVE_PPT_RENDER_ENGINE", "auto")
        ).strip().lower()
        if configured_engine not in self.VALID_ENGINE_MODES:
            raise ValueError(
                "QUALITATIVE_PPT_RENDER_ENGINE must be auto, officecli or python-pptx"
            )
        self.engine_mode = configured_engine

    def _select_engine(self) -> tuple[QualitativePptEngine, dict | None]:
        if self._explicit_engine is not None:
            return self._explicit_engine, None
        if self.engine_mode == "python-pptx":
            return PythonPptxQualitativeEngine(), None
        if self.officecli.is_installed():
            return OfficeCliQualitativeEngine(self.officecli), None
        if self.engine_mode == "officecli" or self.quality_mode == "required":
            raise OfficeCliUnavailableError("OfficeCLI 是首选渲染器，但服务器未安装。")
        return PythonPptxQualitativeEngine(), {
            "from": "officecli",
            "reason": "unavailable",
        }

    def capabilities(self) -> dict:
        probe = self.officecli.probe()
        if self._explicit_engine is not None:
            active_engine = self._explicit_engine.engine_id
        elif self.engine_mode == "python-pptx":
            active_engine = "python-pptx"
        else:
            active_engine = "officecli" if probe.get("installed") else "python-pptx"
        return {
            "generation_engine": active_engine,
            "preferred_generation_engine": "officecli",
            "fallback_generation_engine": "python-pptx",
            "generation_engine_mode": self.engine_mode,
            "officecli_role": "primary_enterprise_renderer_and_quality_gate",
            "officecli_qa_mode": self.quality_mode,
            "officecli_installed": bool(probe.get("installed")),
            "officecli_version": probe.get("version") or "",
        }

    def _run_quality_gate(self, content: bytes) -> dict:
        if self.quality_mode == "off":
            return {
                "engine": "officecli",
                "mode": "off",
                "status": "skipped",
                "passed": None,
            }
        if not self.officecli.is_installed():
            if self.quality_mode == "required":
                raise OfficeCliUnavailableError("OfficeCLI 是必需质量门禁，但服务器未安装。")
            return {
                "engine": "officecli",
                "mode": self.quality_mode,
                "status": "unavailable",
                "passed": None,
            }

        temp_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".pptx") as handle:
                handle.write(content)
                temp_path = Path(handle.name)
            result = self.officecli.quality_gate(temp_path)
            result["mode"] = self.quality_mode
            if not result.get("passed"):
                raise OfficeCliQualityError("生成文件未通过 OfficeCLI 校验或问题扫描。")
            return result
        except (OfficeCliExecutionError, TimeoutError, OSError) as error:
            if self.quality_mode == "required":
                raise OfficeCliUnavailableError(f"OfficeCLI 质量门禁执行失败：{error}") from error
            return {
                "engine": "officecli",
                "mode": self.quality_mode,
                "status": "error",
                "passed": None,
                "message": str(error)[:500],
            }
        finally:
            if temp_path is not None:
                temp_path.unlink(missing_ok=True)

    def render_required_officecli(self, script: dict) -> dict:
        """Render the production deck without entering the Python fallback path."""
        if not self.officecli.is_installed():
            raise OfficeCliUnavailableError("OfficeCLI 是正式定性报告的必需渲染器。")
        try:
            rendered = render_officecli_qualitative_report(script, self.officecli)
        except (OfficeCliExecutionError, FileNotFoundError, TimeoutError, OSError) as error:
            raise OfficeCliUnavailableError(
                f"OfficeCLI 原生渲染执行失败：{error}"
            ) from error
        quality_gate = dict(rendered.pop("generation_quality_gate"))
        quality_gate["mode"] = "required"
        if not rendered.get("validation", {}).get("passed"):
            raise OfficeCliQualityError("PPT Script 仍有阻断性 Evidence 或页面校验错误。")
        if not quality_gate.get("passed"):
            raise OfficeCliQualityError("OfficeCLI 原生渲染未通过校验或问题扫描。")
        return {
            **rendered,
            "renderer": {
                "engine": "officecli",
                "preferred_engine": "officecli",
                "mode": "officecli_native",
                "editable_native": True,
            },
            "quality_gate": quality_gate,
        }

    @staticmethod
    def _script_fingerprint(script: dict) -> str:
        canonical = json.dumps(
            script, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
        return hashlib.sha256(canonical).hexdigest()

    @staticmethod
    def _source_page_id(page: dict) -> str:
        return str(page.get("split_from_page_id") or page.get("id") or "").strip()

    @staticmethod
    def _density(page: dict) -> dict:
        raw = page.get("density") if isinstance(page.get("density"), dict) else {}
        status = str(raw.get("status") or page.get("density_hint") or "medium").strip()
        return {
            **raw,
            "status": status,
            "hint": str(page.get("density_hint") or status).strip(),
        }

    def preview(self, script: dict, source_page_id: str = "") -> dict:
        """Temporarily render real OfficeCLI thumbnails without persisting an artifact."""
        if not isinstance(script, dict):
            raise ValueError("qualitative PPT script 必须是 JSON 对象")
        if not self.officecli.is_installed():
            raise OfficeCliUnavailableError("OfficeCLI 是定性报告真实预览的必需渲染器。")
        pages, split_issues = prepare_pages(script)
        if not pages:
            raise ValueError("qualitative PPT script 至少需要一页")
        validation = validate_script(script, pages, split_issues)
        selected_pages = pages
        source_page_id = str(source_page_id or "").strip()
        if source_page_id:
            selected_pages = [
                page for page in pages if self._source_page_id(page) == source_page_id
            ]
            if not selected_pages:
                raise ValueError(f"找不到需要重新预览的源页面：{source_page_id}")
        commands = build_officecli_commands(script, selected_pages)
        try:
            thumbnails, quality_gate = self.officecli.create_preview_from_batch(
                commands, len(selected_pages)
            )
        except (OfficeCliExecutionError, FileNotFoundError, TimeoutError, OSError) as error:
            raise OfficeCliUnavailableError(
                f"OfficeCLI 真实预览执行失败：{error}"
            ) from error

        validation_issues = validation.get("issues", [])
        slide_previews = []
        for page, thumbnail in zip(selected_pages, thumbnails, strict=True):
            page_id = str(page.get("id") or "").strip()
            source_id = self._source_page_id(page)
            variant = resolve_layout_variant(
                page,
                str((script.get("style_profile") or {}).get("id") or ""),
            )
            page_issues = [
                issue
                for issue in validation_issues
                if str(issue.get("page_id") or "") in {page_id, source_id}
            ]
            evidence_ids = [
                str(value)
                for value in page.get("evidence_ids", [])
                if str(value).strip()
            ]
            slide_previews.append(
                {
                    "page_id": page_id,
                    "source_page_id": source_id,
                    "page_number": int(page.get("page_number") or 0),
                    "title": str(page.get("title") or "").strip(),
                    "page_type": str(page.get("page_type") or "qualitative_insight"),
                    "layout_variant": variant,
                    "layout_candidates": layout_candidates(
                        str(page.get("page_type") or "qualitative_insight"), variant
                    ),
                    "density": self._density(page),
                    "continuation": {
                        "is_continuation": bool(page.get("split_from_page_id")),
                        "part": int(page.get("split_part") or 1),
                        "total": int(page.get("split_total") or 1),
                    },
                    "evidence": {
                        "status": str(page.get("evidence_status") or "limited"),
                        "label": str(page.get("evidence_label") or ""),
                        "count": len(evidence_ids),
                        "ids": evidence_ids,
                        "quote_count": len(page.get("quotes") or []),
                    },
                    "validation_issues": page_issues,
                    "thumbnail_mime_type": "image/png",
                    "thumbnail_base64": base64.b64encode(thumbnail).decode("ascii"),
                }
            )

        quality_gate = {**quality_gate, "mode": "preview"}
        return {
            "schema_version": "surveykit.qualitative_preview.v1",
            "script_fingerprint": self._script_fingerprint(script),
            "render_scope": "source_page" if source_page_id else "all",
            "source_page_id": source_page_id,
            "slide_count": len(pages),
            "rendered_slide_count": len(slide_previews),
            "slides": slide_previews,
            "validation": validation,
            "quality_gate": quality_gate,
            "layout_adaptations": layout_adaptations(script, pages, split_issues),
            "renderer": {
                "engine": "officecli",
                "mode": "temporary_preview",
                "temporary": True,
                "artifact_created": False,
            },
            "render_llm_tokens": 0,
        }

    def render(self, script: dict) -> dict:
        engine, fallback = self._select_engine()
        try:
            rendered = engine.render(script)
        except (OfficeCliExecutionError, TimeoutError, OSError) as error:
            if engine.engine_id != "officecli":
                raise
            if self.engine_mode == "officecli" or self.quality_mode == "required":
                raise OfficeCliUnavailableError(
                    f"OfficeCLI 原生渲染执行失败：{error}"
                ) from error
            engine = PythonPptxQualitativeEngine()
            rendered = engine.render(script)
            fallback = {"from": "officecli", "reason": "render_error", "message": str(error)[:500]}

        if engine.engine_id == "officecli":
            quality_gate = dict(rendered.pop("generation_quality_gate"))
            quality_gate["mode"] = self.quality_mode
            if not quality_gate.get("passed"):
                if self.engine_mode == "officecli" or self.quality_mode == "required":
                    raise OfficeCliQualityError("OfficeCLI 原生渲染未通过校验或问题扫描。")
                engine = PythonPptxQualitativeEngine()
                rendered = engine.render(script)
                fallback = {"from": "officecli", "reason": "validation_failed"}
                quality_gate = self._run_quality_gate(rendered["content"])
        else:
            quality_gate = self._run_quality_gate(rendered["content"])

        renderer = {
            "engine": engine.engine_id,
            "preferred_engine": "officecli",
            "mode": "officecli_native" if engine.engine_id == "officecli" else "compatibility_fallback",
            "editable_native": True,
        }
        if fallback:
            renderer["fallback"] = fallback
        return {
            **rendered,
            "renderer": renderer,
            "quality_gate": quality_gate,
        }
