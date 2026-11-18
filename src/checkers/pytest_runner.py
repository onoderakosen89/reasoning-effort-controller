"""Record pytest outcomes without inferring failures from console text."""

import json
from pathlib import Path
import sys

import pytest


class Check:
    def __init__(self):
        self.failures = []
        self.uncertain = False
        self.passed = 0

    def pytest_collectreport(self, report):
        if report.failed or report.skipped:
            self.uncertain = True

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
                self.uncertain = True
        elif report.skipped:
            self.uncertain = True
        elif call.when == "call" and report.passed:
            if getattr(report, "wasxfail", None):
                self.uncertain = True
            else:
                self.passed += 1
        return report


if __name__ == "__main__":
    output, *files = sys.argv[1:]
    check = Check()
    status = pytest.main(files, plugins=[check])
    if status == pytest.ExitCode.TESTS_FAILED and check.failures and not check.uncertain:
        outcome = "failure"
    elif status == pytest.ExitCode.OK and check.passed and not check.uncertain:
        outcome = "success"
    else:
        outcome = "unknown"
    Path(output).write_text(json.dumps({"outcome": outcome, "failures": check.failures}), encoding="utf-8")
    sys.exit(status)
