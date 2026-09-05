"""Small, auditable boundary around the OfficeCLI executable.

The report renderers never compose shell commands themselves.  Keeping the
binary invocation here makes timeouts, JSON parsing and deployment discovery
consistent across built-in and future template-native renderers.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class OfficeCliResult:
    args: tuple[str, ...]
    exit_code: int
    stdout: str
    stderr: str
    data: Any = None


class OfficeCliExecutionError(RuntimeError):
    def __init__(self, result: OfficeCliResult):
        self.result = result
        message = result.stderr.strip() or result.stdout.strip() or "OfficeCLI command failed"
        super().__init__(message[:1000])


class OfficeCliRunner:
    """The only qualitative-PPT module allowed to execute OfficeCLI."""

    def __init__(self, binary: str | None = None, timeout_seconds: int | None = None):
        self.binary = binary or self._find_binary()
        self.timeout_seconds = timeout_seconds or int(os.getenv("OFFICECLI_TIMEOUT_SECONDS", "180"))
        self._version: str | None = None

    @staticmethod
    def _find_binary() -> str:
        configured = os.getenv("OFFICECLI_PATH", "").strip()
        if configured:
            return configured
        located = shutil.which("officecli") or shutil.which("officecli.exe")
        if located:
            return located
        local_app_data = os.getenv("LOCALAPPDATA", "").strip()
        if local_app_data:
            return str(Path(local_app_data) / "OfficeCli" / "officecli.exe")
        return "/usr/local/bin/officecli"

    def is_installed(self) -> bool:
        path = Path(self.binary)
        return path.is_file() if path.is_absolute() else shutil.which(self.binary) is not None

    def execute(
        self,
        args: list[str],
        *,
        allow_failure: bool = False,
        timeout_seconds: int | None = None,
        expect_json: bool = True,
    ) -> OfficeCliResult:
        if not self.is_installed():
            raise FileNotFoundError(f"OfficeCLI binary not found: {self.binary}")
        env = os.environ.copy()
        env.setdefault("OFFICECLI_SKIP_UPDATE", "1")
        env.setdefault("OFFICECLI_NO_AUTO_RESIDENT", "1")
        try:
            completed = subprocess.run(
                [self.binary, *[str(value) for value in args]],
                capture_output=True,
                text=False,
                timeout=timeout_seconds or self.timeout_seconds,
                check=False,
                shell=False,
                env=env,
            )
        except subprocess.TimeoutExpired as error:
            raise TimeoutError(
                f"OfficeCLI timed out after {timeout_seconds or self.timeout_seconds}s"
            ) from error

        stdout = self._decode_output(completed.stdout)
        stderr = self._decode_output(completed.stderr)
        parsed: Any = None
        if expect_json and stdout.strip():
            try:
                parsed = json.loads(stdout)
            except json.JSONDecodeError:
                parsed = None
        result = OfficeCliResult(
            tuple(args), completed.returncode, stdout, stderr, parsed
        )
        reported_failure = isinstance(parsed, dict) and parsed.get("success") is False
        if not allow_failure and (completed.returncode != 0 or reported_failure):
            raise OfficeCliExecutionError(result)
        return result

    @staticmethod
    def _decode_output(value: bytes) -> str:
        """Decode Linux UTF-8 and Windows console-code-page output safely."""
        for encoding in ("utf-8", "gb18030" if os.name == "nt" else "utf-8"):
            try:
                return value.decode(encoding)
            except UnicodeDecodeError:
                continue
        return value.decode("utf-8", errors="replace")

    def version(self) -> str:
        if self._version is None:
            result = self.execute(["--version"], expect_json=False, timeout_seconds=15)
            self._version = result.stdout.strip() or result.stderr.strip()
        return self._version

    def probe(self) -> dict:
        if not self.is_installed():
            return {"installed": False, "version": "", "binary": self.binary}
        try:
            return {"installed": True, "version": self.version(), "binary": self.binary}
        except (OfficeCliExecutionError, TimeoutError, OSError) as error:
            return {
                "installed": True,
                "version": "",
                "binary": self.binary,
                "error": str(error),
            }

    def validate(self, file_path: Path) -> Any:
        return self.execute(["validate", str(file_path), "--json"], allow_failure=True).data

    def view_issues(self, file_path: Path) -> Any:
        return self.execute(["view", str(file_path), "issues", "--json"], allow_failure=True).data

    def view_stats(self, file_path: Path) -> Any:
        return self.execute(["view", str(file_path), "stats", "--json"], allow_failure=True).data

    def create_from_batch(self, commands: list[dict[str, Any]]) -> tuple[bytes, dict]:
        """Create a new PPTX from deterministic OfficeCLI batch operations.

        The caller owns content semantics; this boundary only serializes the
        already-decided native slide operations, invokes OfficeCLI without a
        shell, and returns bytes after the same validation gate used in
        production exports.
        """
        if not commands:
            raise ValueError("OfficeCLI batch must contain at least one command")
        with tempfile.TemporaryDirectory(prefix="surveykit-officecli-") as temp_dir:
            workspace = Path(temp_dir)
            output_path = workspace / "report.pptx"
            batch_path = workspace / "commands.json"
            batch_path.write_text(
                json.dumps(commands, ensure_ascii=False, separators=(",", ":")),
                encoding="utf-8",
            )
            self.execute(["create", str(output_path)], expect_json=False)
            self.execute(
                ["batch", str(output_path), "--input", str(batch_path), "--json"]
            )
            if not output_path.is_file():
                raise OSError("OfficeCLI completed without producing a PPTX")
            gate = self.quality_gate(output_path)
            return output_path.read_bytes(), gate

    def create_preview_from_batch(
        self,
        commands: list[dict[str, Any]],
        slide_count: int,
        *,
        width: int = 960,
        height: int = 540,
    ) -> tuple[list[bytes], dict]:
        """Build a temporary OfficeCLI deck and return one real PNG per slide."""
        if not commands:
            raise ValueError("OfficeCLI preview batch must contain at least one command")
        if slide_count < 1:
            raise ValueError("OfficeCLI preview must contain at least one slide")
        with tempfile.TemporaryDirectory(prefix="surveykit-officecli-preview-") as temp_dir:
            workspace = Path(temp_dir)
            output_path = workspace / "preview.pptx"
            batch_path = workspace / "commands.json"
            batch_path.write_text(
                json.dumps(commands, ensure_ascii=False, separators=(",", ":")),
                encoding="utf-8",
            )
            self.execute(["create", str(output_path)], expect_json=False)
            self.execute(
                ["batch", str(output_path), "--input", str(batch_path), "--json"]
            )
            if not output_path.is_file():
                raise OSError("OfficeCLI completed without producing a preview PPTX")
            gate = self.quality_gate(output_path)
            thumbnails: list[bytes] = []
            for page_number in range(1, slide_count + 1):
                image_path = workspace / f"slide-{page_number:03d}.png"
                self.execute(
                    [
                        "view",
                        str(output_path),
                        "screenshot",
                        "--page",
                        str(page_number),
                        "-o",
                        str(image_path),
                        "--screenshot-width",
                        str(width),
                        "--screenshot-height",
                        str(height),
                        "--render",
                        "html",
                    ],
                    expect_json=False,
                )
                if not image_path.is_file():
                    raise OSError(
                        f"OfficeCLI did not produce preview slide {page_number}"
                    )
                thumbnails.append(image_path.read_bytes())
            return thumbnails, gate

    def quality_gate(self, file_path: Path) -> dict:
        validation = self.validate(file_path)
        issues = self.view_issues(file_path)
        stats = self.view_stats(file_path)
        validation_ok = isinstance(validation, dict) and validation.get("success") is True
        issue_data = issues.get("data") if isinstance(issues, dict) else None
        issue_count = int(issue_data.get("count") or 0) if isinstance(issue_data, dict) else -1
        issues_ok = (
            isinstance(issues, dict)
            and issues.get("success") is True
            and isinstance(issue_data, dict)
            and "count" in issue_data
            and issue_count == 0
        )
        return {
            "engine": "officecli",
            "version": self.version(),
            "status": "passed" if validation_ok and issues_ok else "failed",
            "passed": validation_ok and issues_ok,
            "validation": validation,
            "issues": issues,
            "stats": stats,
        }
