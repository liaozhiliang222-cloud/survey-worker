"""Editable SlideBrief blueprint rules and lightweight persistence."""

from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import re
import tempfile
import threading
import time
import uuid
from typing import Any

from .model import LayoutType, PageType


class BlueprintNotFoundError(KeyError):
    """The requested report or slide blueprint does not exist."""


class BlueprintConflictError(ValueError):
    """A blueprint mutation violates lock, identity, or ordering rules."""


EDITABLE_FIELDS = {
    "title",
    "claim",
    "slide_type",
    "layout_family",
    "question_answered",
    "business_implication",
    "locked",
    "chapter_id",
    "chapter",
    "user_modified",
}
VALID_SLIDE_TYPES = {value.value for value in PageType}
VALID_LAYOUT_FAMILIES = {value.value for value in LayoutType}
LOCK_PROTECTED_FIELDS = {"title", "claim", "slide_type", "layout_family"}


def _slide_id(slide: dict[str, Any]) -> str:
    return str(
        slide.get("slide_brief", {}).get("slide_id")
        or slide.get("slide_id")
        or ""
    )


def _validate_slide_ids(slides: list[dict[str, Any]]) -> None:
    slide_ids = [_slide_id(slide) for slide in slides]
    if any(not slide_id for slide_id in slide_ids):
        raise BlueprintConflictError("every slide must have a stable slide_id")
    if len(slide_ids) != len(set(slide_ids)):
        raise BlueprintConflictError("slide_id values must be unique")


def apply_slide_brief_patch(
    slide: dict[str, Any],
    patch: dict[str, Any],
) -> dict[str, Any]:
    """Apply a user edit while enforcing locked-slide protection."""
    updated = deepcopy(slide)
    brief = updated.setdefault("slide_brief", {})
    requested = {key: value for key, value in patch.items() if key in EDITABLE_FIELDS}
    if brief.get("locked") and any(
        key in LOCK_PROTECTED_FIELDS and value != brief.get(key)
        for key, value in requested.items()
    ):
        raise BlueprintConflictError(
            "locked slide cannot change title, claim, slide_type, or layout_family"
        )
    if (
        "slide_type" in requested
        and str(requested["slide_type"] or "") not in VALID_SLIDE_TYPES
    ):
        raise BlueprintConflictError("unsupported slide_type")
    if (
        "layout_family" in requested
        and str(requested["layout_family"] or "") not in VALID_LAYOUT_FAMILIES
    ):
        raise BlueprintConflictError("unsupported layout_family")
    changed = False
    for key, value in requested.items():
        normalized = bool(value) if key in {"locked", "user_modified"} else str(value or "").strip()
        if brief.get(key) != normalized:
            brief[key] = normalized
            changed = True
    if changed:
        brief["user_modified"] = True
    if "title" in requested:
        updated["title"] = brief.get("title", "")
        updated["insight_override"] = brief.get("title", "")
    if "slide_type" in requested:
        updated["slide_type"] = brief.get("slide_type", "")
    if "layout_family" in requested:
        updated["layout_family"] = brief.get("layout_family", "")
    return updated


def reorder_slides(
    slides: list[dict[str, Any]],
    order: list[str],
) -> list[dict[str, Any]]:
    """Return slides in user order; identities must match exactly."""
    _validate_slide_ids(slides)
    slide_ids = [_slide_id(slide) for slide in slides]
    normalized_order = [str(slide_id) for slide_id in order]
    if (
        len(normalized_order) != len(set(normalized_order))
        or set(normalized_order) != set(slide_ids)
    ):
        raise BlueprintConflictError("order must contain every slide_id exactly once")
    by_id = {_slide_id(slide): slide for slide in slides}
    return [deepcopy(by_id[slide_id]) for slide_id in normalized_order]


class ReportBlueprintStore:
    """Small JSON-backed store used by the blueprint editing API."""

    def __init__(self, directory: str | Path | None = None):
        self.directory = Path(
            directory
            or (Path(tempfile.gettempdir()) / "surveykit-report-blueprints")
        )
        self.directory.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()

    def _path(self, report_id: str) -> Path:
        if not re.fullmatch(r"[A-Za-z0-9_.-]{8,128}", str(report_id or "")):
            raise ValueError("invalid report_id")
        return self.directory / f"{report_id}.json"

    def _write_payload(self, report_id: str, payload: dict) -> dict:
        payload["updated_at"] = time.time()
        path = self._path(report_id)
        temporary = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        temporary.replace(path)
        return deepcopy(payload)

    def save(
        self,
        report_id: str,
        narrative: dict | None,
        slides: list[dict],
        deleted_slide_ids: list[str] | None = None,
    ) -> dict:
        _validate_slide_ids(slides)
        payload = {
            "report_id": report_id,
            "narrative": deepcopy(narrative) if isinstance(narrative, dict) else None,
            "slides": deepcopy(slides),
            "deleted_slide_ids": list(dict.fromkeys(
                str(slide_id) for slide_id in (deleted_slide_ids or []) if slide_id
            )),
            "updated_at": time.time(),
        }
        with self._lock:
            return self._write_payload(report_id, payload)

    def get(self, report_id: str) -> dict:
        with self._lock:
            path = self._path(report_id)
            if not path.exists():
                raise BlueprintNotFoundError(report_id)
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                raise BlueprintNotFoundError(report_id) from exc

    def patch_slide(self, report_id: str, slide_id: str, patch: dict) -> dict:
        with self._lock:
            payload = self.get(report_id)
            index = next(
                (
                    index
                    for index, slide in enumerate(payload["slides"])
                    if _slide_id(slide) == slide_id
                ),
                -1,
            )
            if index < 0:
                raise BlueprintNotFoundError(slide_id)
            payload["slides"][index] = apply_slide_brief_patch(
                payload["slides"][index], patch
            )
            return self._write_payload(report_id, payload)

    def reorder(self, report_id: str, order: list[str]) -> dict:
        with self._lock:
            payload = self.get(report_id)
            payload["slides"] = reorder_slides(payload["slides"], order)
            return self._write_payload(report_id, payload)

    def delete_slide(self, report_id: str, slide_id: str) -> dict:
        with self._lock:
            payload = self.get(report_id)
            before = len(payload["slides"])
            payload["slides"] = [
                slide for slide in payload["slides"] if _slide_id(slide) != slide_id
            ]
            if len(payload["slides"]) == before:
                raise BlueprintNotFoundError(slide_id)
            payload.setdefault("deleted_slide_ids", []).append(slide_id)
            payload["deleted_slide_ids"] = list(
                dict.fromkeys(payload["deleted_slide_ids"])
            )
            return self._write_payload(report_id, payload)