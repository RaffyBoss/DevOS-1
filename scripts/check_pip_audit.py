#!/usr/bin/env python3
"""Check pip-audit report for HIGH/CRITICAL vulnerabilities."""

import json
import sys

with open('pip-audit-report.json') as f:
    data = json.load(f)

has_high_critical = False
for vuln in data.get('vulnerabilities', []):
    if vuln.get('severity') in ('HIGH', 'CRITICAL'):
        print(f"HIGH/CRITICAL: {vuln['package']} {vuln['installed_version']} - {vuln['vulnerability_id']}")
        has_high_critical = True

if has_high_critical:
    sys.exit(1)