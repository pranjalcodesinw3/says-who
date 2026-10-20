#!/usr/bin/env bash
# Same bundle format as bee-computer/bee-skill: a zip whose single entry is exactly receipts/SKILL.md.
set -euo pipefail
cd "$(dirname "$0")/../skills"
rm -f receipts.skill
zip -X -q receipts.skill receipts/SKILL.md
unzip -l receipts.skill | tail -3
