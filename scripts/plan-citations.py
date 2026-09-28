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
# A label may run on into its text: `**§436.1 — old host retired.**`.
targets |= set(re.findall(r'\*\*§(\d+(?:\.\d+)?)(?=\*\*|\s)', plan))

# `git grep` rather than `grep -r`, so .gitignore does the excluding: both
# `apps/*/data/` (app state, SQL dumps) and `apps/*/node_modules/` (vendored
# JS — ip-address, fast-uri, json-pack all contain a `§` followed by digits)
# drop out for free. Hand-rolled --exclude-dir did the first but not the
# second, and once the Wintouch rebuilds vendored their dependencies that was
# 13 of the 14 "dangling" targets printed here, none of them real — which
# made the compaction rule's "adds no new lines" check unreadable. 0.03s
# against 2.9s, too. --untracked so a file written but not yet committed
# still counts; --exclude-standard keeps .gitignore applying to it; -I skips
# binaries, which git grep otherwise reports as an unparseable
# "Binary file ... matches" line (a PNG in price-compare hits this).
grep = subprocess.run(
    ['git', 'grep', '--untracked', '--exclude-standard', '-I', '-noE',
     '§[0-9]+(\\.[0-9]+)?', '--', *SOURCES.split()],
    capture_output=True, text=True)
# git grep exits 1 for "no matches" and 128 for "not a git repository" (a
# tarball copy with no .git). The latter leaves stdout empty, which would
# print a cheerful "0 dangling targets" and pass the compaction check for
# the wrong reason, so fail loudly instead.
if grep.returncode > 1:
    sys.exit(f"git grep failed: {grep.stderr.strip()}")
hits = grep.stdout.splitlines()

# A compacted section's own heading names the sections it replaced,
# "(former §X–§Y, compacted <date>)"; those are a record, not citations.
former_lines = {f'plan.md:{n}' for n, line in enumerate(plan.split('\n'), 1)
                if line.startswith('## ') and '(former ' in line}

# A document with its own numbered headings (setup_test/README.md's
# "### 2.1 …") cites those by the same numbers; resolve a citation against the
# citing file's own headings before calling it dangling.
own_headings = {}


def resolves_in_own_file(location, target):
    path = location.split(':', 1)[0]
    if path == 'plan.md':
        return False
    if path not in own_headings:
        try:
            text = open(path, encoding='utf-8', errors='ignore').read()
        except OSError:
            text = ''
        own_headings[path] = set(re.findall(r'^#+\s+(\d+(?:\.\d+)?)[.\s]', text, re.M))
    return target in own_headings[path]


dangling = {}
for hit in hits:
    location, cite = hit.rsplit(':', 1)
    if location in former_lines:
        continue
    if resolves_in_own_file(location, cite[1:]):
        continue
    if cite[1:] not in targets:
        dangling.setdefault(cite[1:], []).append(location)

for target in sorted(dangling, key=lambda t: [int(p) for p in t.split('.')]):
    locations = dangling[target]
    print(f"§{target}\t{len(locations)}\t{', '.join(locations[:3])}")
print(f"{len(dangling)} dangling targets", file=sys.stderr)
