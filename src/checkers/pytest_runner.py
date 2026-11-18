"""Record pytest outcomes without inferring failures from console text."""

import json
from pathlib import Path
import sys

try:
    import pytest
except ModuleNotFoundError as exc:
    if exc.name != "pytest":
        raise
    Path(sys.argv[1]).write_text(json.dumps({"reason": "pytest_missing"}), encoding="utf-8")
    sys.exit(2)


class Check:
    def __init__(self):
        self.failures = []
        self.reason = None
        self.passed = 0

    def pytest_collectreport(self, report):
        if report.failed:
            self.reason = "collection_failed"
        elif report.skipped:
            self.reason = self.reason or "skipped_tests"

    @pytest.hookimpl(wrapper=True)
    def pytest_runtest_makereport(self, item, call):
        report = yield
        if report.failed:
            if call.when == "call" and call.excinfo and isinstance(call.excinfo.value, AssertionError):
                file, line, _ = item.location
                self.failures.append({
                    "name": item.nodeid, "file": file, "line": line + 1,
                    "message": call.excinfo.exconly(),
                })
            else:
                self.reason = self.reason or "test_error"
        elif report.skipped:
            self.reason = self.reason or "skipped_tests"
        elif call.when == "call" and report.passed:
            if getattr(report, "wasxfail", None):
                self.reason = self.reason or "skipped_tests"
            else:
                self.passed += 1
        return report


if __name__ == "__main__":
    output, *files = sys.argv[1:]
    sys.path.insert(0, str(Path.cwd()))
    check = Check()
    status = pytest.main(files, plugins=[check])
    if status == pytest.ExitCode.TESTS_FAILED and check.failures and not check.reason:
        outcome = "failure"
    elif status == pytest.ExitCode.OK and check.passed and not check.reason:
        outcome = "success"
    else:
        outcome = "unknown"
    result = {"outcome": outcome, "failures": check.failures}
    if outcome == "unknown":
        result["reason"] = check.reason or {
            pytest.ExitCode.NO_TESTS_COLLECTED: "no_tests",
            pytest.ExitCode.USAGE_ERROR: "invalid_test_selection",
        }.get(status, "incomplete_run")
    Path(output).write_text(json.dumps(result), encoding="utf-8")
    sys.exit(status)
