"""Fail fast when the Python report test environment is incomplete."""

from importlib import import_module, metadata

DEPENDENCIES = {
    "fastapi": "fastapi",
    "httpx2": "httpx2",
    "pandas": "pandas",
    "openpyxl": "openpyxl",
    "lxml": "lxml",
    "Pillow": "PIL",
    "python-pptx": "pptx",
}

missing = []
versions = []
for distribution, module in DEPENDENCIES.items():
    try:
        import_module(module)
        versions.append(f"{distribution}={metadata.version(distribution)}")
    except (ImportError, metadata.PackageNotFoundError) as error:
        missing.append(f"{distribution} ({error})")

if missing:
    raise SystemExit("Missing Python test dependencies: " + "; ".join(missing))

print("Python report dependencies ready: " + ", ".join(versions))
