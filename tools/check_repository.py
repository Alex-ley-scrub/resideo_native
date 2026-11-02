#!/usr/bin/env python3
"""Standalone metadata checks for a Resideo Native HACS release."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOMAIN = "resideo_native"


def inspect_repository(root: Path = ROOT) -> list[str]:
    errors: list[str] = []

    def require(path: str) -> Path:
        target = root / path
        if not target.is_file():
            errors.append(f"Missing file: {path}")
        return target

    component = root / "custom_components" / DOMAIN
    manifest_path = require(f"custom_components/{DOMAIN}/manifest.json")
    hacs_path = require("hacs.json")
    for path in (
        "README.md", "LICENSE", ".github/workflows/validate.yml",
        "custom_components/resideo_native/__init__.py",
        "custom_components/resideo_native/brand/icon.png",
        "VALIDATION.md", "HACS_PUBLISHING.md",
    ):
        require(path)

    if manifest_path.is_file():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            required = {"domain", "name", "version", "codeowners",
                        "documentation", "issue_tracker"}
            absent = required - set(manifest)
            if absent:
                errors.append(f"Manifest fields missing: {', '.join(sorted(absent))}")
            if manifest.get("domain") != DOMAIN:
                errors.append("Manifest domain mismatch")
            if manifest.get("version") != "0.3.2":
                errors.append("Expected release version 0.3.2")
            if not manifest.get("codeowners"):
                errors.append("Missing codeowner")
            expected_order = ["domain", "name"] + sorted(
                field for field in manifest if field not in ("domain", "name")
            )
            if list(manifest) != expected_order:
                errors.append("Manifest order must be domain, name, alphabetical")
            if "climate" not in manifest.get("dependencies", []):
                errors.append("Missing dependency: climate")
            if not re.fullmatch(r"\d+\.\d+\.\d+", str(manifest.get("version", ""))):
                errors.append("Manifest version must be semantic major.minor.patch")
        except (UnicodeError, ValueError) as exc:
            errors.append(f"Manifest is not valid JSON: {exc}")

    if hacs_path.is_file():
        try:
            hacs = json.loads(hacs_path.read_text(encoding="utf-8"))
            if hacs.get("name") != "Resideo Native":
                errors.append("HACS display name must be Resideo Native")
            if hacs.get("zip_release"):
                errors.append("Unexpected HACS zip_release setting")
        except (UnicodeError, ValueError) as exc:
            errors.append(f"HACS config is not valid JSON: {exc}")

    parent = root / "custom_components"
    if parent.is_dir():
        children = sorted(p.name for p in parent.iterdir() if p.is_dir())
        if children != [DOMAIN]:
            errors.append(f"Expected only {DOMAIN} component, found {children}")
    return errors


if __name__ == "__main__":
    failures = inspect_repository()
    for failure in failures:
        print("FAIL:", failure, file=sys.stderr)
    if failures:
        raise SystemExit(1)
    print("PASS: Resideo Native HACS packaging checks")
