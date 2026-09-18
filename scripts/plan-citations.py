#!/usr/bin/env python3
"""List plan.md citations that no longer resolve.

Every `§N` / `§N.M` cited in plan.md, code, compose files, scripts or docs
should still lead somewhere in plan.md: a `## N.` / `### N.M` heading, or a
labelled anchor `**§N.M**` that a compacted section kept for it (CLAUDE.md,
"plan.md is the project's memory"). Prints one line per dangling target:
`§N.M <count> <first locations>`.

Run it before and after a compaction and diff the two outputs: the pass may
remove sections only if it adds no new lines here.
"""
import re
import subprocess
import sys

SOURCES = ('plan.md backend/src frontend/src apps docs scripts start.sh '
           'README.md CLAUDE.md e2e/tests database setup_test')

plan = open('plan.md', encoding='utf-8').read()
targets = set(re.findall(r'^##+\s+(\d+(?:\.\d+)?)[a-z]?[.\s]', plan, re.M))
targets |= set(re.findall(r'\*\*§(\d+(?:\.\d+)?)\*\*', plan))

hits = subprocess.run(
    f"grep -rnoE '§[0-9]+(\\.[0-9]+)?' {SOURCES} 2>/dev/null",
    shell=True, capture_output=True, text=True).stdout.splitlines()

dangling = {}
for hit in hits:
    location, cite = hit.rsplit(':', 1)
    if cite[1:] not in targets:
        dangling.setdefault(cite[1:], []).append(location)

for target in sorted(dangling, key=lambda t: [int(p) for p in t.split('.')]):
    locations = dangling[target]
    print(f"§{target}\t{len(locations)}\t{', '.join(locations[:3])}")
print(f"{len(dangling)} dangling targets", file=sys.stderr)
