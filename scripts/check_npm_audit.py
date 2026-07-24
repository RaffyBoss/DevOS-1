#!/usr/bin/env python3
"""Check npm audit report for HIGH/CRITICAL vulnerabilities."""

import json
import sys

with open('frontend-src/npm-audit-report.json') as f:
    data = json.load(f)

high = data.get('metadata', {}).get('vulnerabilities', {}).get('high', 0)
critical = data.get('metadata', {}).get('vulnerabilities', {}).get('critical', 0)
total = high + critical

if total > 0:
    print(f"Found {total} HIGH/CRITICAL vulnerabilities in Node dependencies")
    sys.exit(1)