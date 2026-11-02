"""Resideo Native packaging tests: no network, accounts, or HA runtime."""

import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "resideo_packaging", ROOT / "tools/check_repository.py"
)
assert spec and spec.loader
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class PackagingTests(unittest.TestCase):
    def test_repository_structure(self):
        self.assertEqual(checker.inspect_repository(ROOT), [])

    def test_release_and_manifest(self):
        data = json.loads(
            (ROOT / "custom_components/resideo_native/manifest.json").read_text()
        )
        self.assertEqual(data["domain"], "resideo_native")
        self.assertEqual(data["version"], "0.3.2")
        self.assertEqual(data["dependencies"], ["climate", "sensor", "switch", "water_heater"])

    def test_hacs_metadata(self):
        data = json.loads((ROOT / "hacs.json").read_text())
        self.assertEqual(data["name"], "Resideo Native")
        self.assertTrue(data["render_readme"])


if __name__ == "__main__":
    unittest.main()
