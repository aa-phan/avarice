#!/usr/bin/env python3
"""Mechanical citation check for docs/system/findings.md (plan 03-33, round 3).

Run from the repository root:

    python3 -I .planning/phases/03-decisions-independent-work-and-amendments/03-33-reviews/round-3-citation-check.py dump   > dump.txt
    python3 -I .planning/phases/03-decisions-independent-work-and-amendments/03-33-reviews/round-3-citation-check.py verify

`dump` prints, for every citation in findings.md, the cited line (or lines) of the target file next to the claim around it.
`verify` prints the counts and the mechanical failures and exits 1 on any failure.

Citation forms extracted from every line of findings.md:
  path:N and path:N to :M           full path (src, test, scripts, docs, bin, .planning, package.json)
  name.ext:N                        short name; it must be unambiguous across the repository, else it is a failure
  `:N`                              bare colon number, bound to the nearest file named earlier in the same line
  line N, lines N to M, lines N, M  bound to the nearest file named earlier in the same line
  (N) and (N, M)                    bound to the nearest file named earlier in the same line
Every path-like token without a line number is checked for existence.

A citation is OLD when the text right after it opens "(now at" (the lead is the superseded position and the "now at" citation
is the one that must land), or when it follows the words "old line" (a reference to an earlier line of findings.md itself).
HIST lists the other citations that name a past position on purpose; each has a reason. Everything else is CUR and must land.
"""
import os
import re
import sys

ROOT = os.getcwd()
FINDINGS = 'docs/system/findings.md'

# Citations that name a past position on purpose: (findings line, raw token) -> reason.
HIST = {
    (141, 'src/app/run-stages/item.ts:70'): 'the line says the cited text no longer exists',
}

# Citations whose cited line has no word in common with the claim, read by hand:
# (findings line, target file, first cited line) -> what the cited line is and why it supports the claim.
READ_OK = {
    (10, 'src/cli/commands/onboard.ts', 13): 'EXIT_NOT_ACTIVE = 3, the exit code the line names',
    (10, 'src/cli/commands/repo.ts', 13): 'EXIT_REFUSED = 3',
    (10, 'src/cli/commands/resume.ts', 22): 'EXIT_NOT_ACTIVE = 3',
    (10, 'src/cli/commands/context.ts', 11): 'EXIT_NO_ANSWER = 3',
    (19, 'src/cli/main.ts', 1): 'header comment that cites a threat ID, the delivery narrative the line reports',
    (84, 'src/adapters/host-claude/settings.ts', 85): 'start of the allow list: Read, Glob, Grep, Edit and the Bash rule',
    (84, 'src/adapters/host-claude/settings.ts', 119): 'the denied command prefixes become Bash deny rules',
    (88, 'src/adapters/host-claude/env.ts', 36): 'buildInvocationEnv, which builds the environment from fixed names',
    (98, 'src/adapters/host-claude/settings.ts', 133): 'the extra GSD hook entry, written without an onFailure block',
    (115, 'src/app/resume.ts', 29): 'the reap is skipped when the host has no reap capability',
    (127, 'src/app/run-stages/blocked.ts', 226): "case 'undeliverable': the branch that moves the run to failed",
    (142, 'src/adapters/host-claude/claude-host.ts', 249): 'the return of the outcome the host builds',
    (149, 'src/app/checks.ts', 221): 'allowReadPaths, the read re-allowance the check run passes',
    (168, 'docs/extensions.md', 35): 'the Outputs row that lists the exit codes',
    (168, 'src/cli/main.ts', 18): 'the exit code constants of the dispatcher',
    (169, 'src/cli/commands/resume.ts', 28): "booleanFlags = ['wait']",
    (174, 'src/domain/policy-narrowing.ts', 109): "reject(key, value, 'unknown'), the refusal of an unknown key",
    (190, 'src/domain/hook-decision.ts', 668): 'checkGitOutput, the hook check of log and show output',
    (191, 'src/adapters/host-claude/settings.ts', 125): 'denyRead, the sandbox read denial by root',
    (193, 'src/adapters/host-claude/settings.ts', 109): 'the Read(<path>/**) deny rule built from each denied root',
    (252, 'src/domain/decision-policy.ts', 280): 'return null in the default case of amendCommandFor',
    (258, 'src/cli/commands/contract.ts', 174): 'run of contract: no ownsProfile check',
    (258, 'src/cli/commands/decide.ts', 197): 'the ownsProfile check of decide',
    (260, 'src/cli/commands/schedule.ts', 33): 'the refusal of every flag',
    (260, 'src/cli/args.ts', 48): 'the parser branch that stores any --name as a flag',
    (268, 'docs/extensions.md', 43): 'a line of the edited proposal section, cited only as a position in the file',
    (274, 'test/mutation/fail-closed.test.ts', 260): "describe('FC-10: ...')",
    (293, 'src/domain/run-contract.ts', 711): 'delete: [], the empty delete list of the compiled contract',
}

PATH = r'(?:(?:src|test|scripts|docs|bin|\.planning)/[\w./-]*\w\.\w+|package\.json)'
TOKEN = re.compile(
    r'(?P<full>(?P<fpath>' + PATH + r'):(?P<fn>\d+)(?:`?\s+to\s+`?:(?P<fm>\d+))?)'
    r'|(?P<short>(?<![\w/.-])(?P<sbase>[\w-]+\.(?:ts|md|json|cjs|jsonl|puml)):(?P<sn>\d+))'
    r'|(?P<colon>(?<![\w/.])(?P<cn>:\d+))'
    r'|(?P<lines>\b(?P<old>old\s+)?lines?\s+(?P<ln>\d+(?:\s*(?:to|,|and)\s*\d+)*))'
    r'|(?P<paren>\((?P<pn>\d+(?:,\s*\d+)*)\))'
)
PATH_ONLY = re.compile(PATH)
WORD = re.compile(r'[A-Za-z_][A-Za-z_0-9]{4,}')
STOP = {'which', 'there', 'their', 'where', 'those', 'these', 'other', 'every', 'being', 'after', 'before', 'about', 'again',
        'until', 'while', 'would', 'could', 'should', 'intent', 'unknown', 'holds', 'later', 'first', 'only', 'never', 'always',
        'because', 'so', 'now', 'moved', 'spec', 'contradiction', 'cited', 'line', 'lines', 'stands', 'written', 'proposal',
        'verified', 'owner', 'decide', 'decides', 'whether', 'longer', 'still', 'code', 'comment', 'names', 'holds'}


def build_index():
    index = {}
    for top in ('src', 'test', 'scripts', 'bin', 'docs', '.planning'):
        for base, dirs, files in os.walk(os.path.join(ROOT, top)):
            dirs[:] = [d for d in dirs if d not in ('node_modules', '.git')]
            for name in files:
                index.setdefault(name, []).append(os.path.relpath(os.path.join(base, name), ROOT))
    return index


_cache = {}


def lines_of(path):
    if path not in _cache:
        full = os.path.join(ROOT, path)
        _cache[path] = open(full, encoding='utf-8', errors='replace').read().split('\n') if os.path.isfile(full) else None
    return _cache[path]


def numbers(text):
    return [int(x) for x in re.findall(r'\d+', text)]


def keywords(claim):
    words = set(w.lower() for w in WORD.findall(claim))
    return {w for w in words if w not in STOP}


def extract():
    index = build_index()
    found = []      # citation dicts
    problems = []   # (findings line, message)
    pathonly = []   # (findings line, path)
    for number, text in enumerate(open(os.path.join(ROOT, FINDINGS), encoding='utf-8').read().split('\n'), start=1):
        ctx_file = None
        for m in TOKEN.finditer(text):
            raw = m.group(0)
            role = 'CUR'
            tail = text[m.end():m.end() + 16]
            if re.match(r'[`)]*\s*(?:\(|,\s*)now at', tail):
                role = 'OLD'
            target, nums, kind = None, [], None
            if m.group('full'):
                kind, target = 'full', m.group('fpath')
                nums = [int(m.group('fn'))] + ([int(m.group('fm'))] if m.group('fm') else [])
                ctx_file = target
                raw = m.group('fpath') + ':' + m.group('fn')
            elif m.group('short'):
                kind = 'short'
                base = m.group('sbase')
                where = index.get(base, [])
                nums = [int(m.group('sn'))]
                raw = base + ':' + m.group('sn')
                if len(where) == 1:
                    target = where[0]
                else:
                    problems.append((number, f'short name {raw} is {"ambiguous: " + ", ".join(where) if where else "unknown"}'))
                    target = None
                ctx_file = target
            elif m.group('colon'):
                kind, target, nums = 'colon', ctx_file, [int(m.group('cn')[1:])]
                raw = m.group('cn')
            elif m.group('lines'):
                kind, target, nums = 'lines', ctx_file, numbers(m.group('ln'))
                raw = m.group('lines')
                if m.group('old'):
                    role = 'OLD'
            elif m.group('paren'):
                kind, target, nums = 'paren', ctx_file, numbers(m.group('pn'))
                raw = m.group('paren')
            if kind in ('colon', 'lines', 'paren') and target is None:
                problems.append((number, f'bare number {raw} has no file named earlier in the line'))
            key = (number, raw if kind in ('full', 'short') else raw)
            if role == 'CUR' and (number, raw) in HIST:
                role = 'HIST'
            found.append({'line': number, 'kind': kind, 'raw': raw, 'target': target, 'nums': nums, 'role': role,
                          'pos': m.start(), 'end': m.end(), 'text': text})
        for m in PATH_ONLY.finditer(text):
            if not re.match(r':\d', text[m.end():m.end() + 2]):
                pathonly.append((number, m.group(0)))
    return found, problems, pathonly


def context_of(c):
    text = c['text']
    left = text[max(0, c['pos'] - 70):c['pos']]
    right = text[c['end']:c['end'] + 40]
    return (left + '[[' + text[c['pos']:c['end']] + ']]' + right).replace('\n', ' ')


def window(c, n):
    lines = lines_of(c['target'])
    return ' '.join(lines[max(0, n - 3):n + 2]) if lines else ''


def check(c):
    """Return (mechanical failure or None, keyword hits)."""
    if c['target'] is None:
        return 'no target', []
    lines = lines_of(c['target'])
    if lines is None:
        return 'target file missing: ' + c['target'], []
    hits = set()
    claim = keywords(re.sub(r'\(now at[^)]*\)', ' ', c['text']))
    for n in c['nums']:
        if n < 1 or n > len(lines):
            return f'{c["target"]} has {len(lines)} lines, no line {n}', []
        shown = lines[n - 1].strip()
        if shown == '' or re.fullmatch(r'[})\];,]*', shown):
            return f'{c["target"]}:{n} is blank or punctuation only', []
        hits |= {w for w in claim if w in window(c, n).lower()}
    return None, sorted(hits)


def main(mode):
    found, problems, pathonly = extract()
    failures = list(problems)
    counts = {'CUR': 0, 'OLD': 0, 'HIST': 0}
    nokw = []
    for c in found:
        counts[c['role']] += 1
        if c['role'] == 'OLD':
            if mode == 'dump':
                print(f'L{c["line"]:<3} OLD  {c["raw"]}')
            continue
        fail, hits = check(c)
        if c['role'] == 'HIST':
            if mode == 'dump':
                print(f'L{c["line"]:<3} HIST {c["raw"]}  ({HIST[(c["line"], c["raw"])]})')
            continue
        if fail:
            failures.append((c['line'], f'{c["raw"]}: {fail}'))
        elif not hits and (c['line'], c['target'], c['nums'][0]) not in READ_OK:
            nokw.append(c)
        if mode == 'dump':
            lines = lines_of(c['target']) if c['target'] else None
            shown = ' | '.join(f'{n}: {lines[n - 1].strip()[:110]}' for n in c['nums'] if lines and 0 < n <= len(lines)) if lines else '-'
            flag = 'FAIL ' + fail if fail else ('kw=' + ','.join(hits[:4]) if hits else 'kw=NONE')
            print(f'L{c["line"]:<3} CUR  {c["target"]}:{",".join(map(str, c["nums"]))}  {flag}')
            print(f'       claim: {context_of(c)}')
            print(f'       code : {shown}')
    for number, path in pathonly:
        if not os.path.exists(os.path.join(ROOT, path)) and '*' not in path:
            failures.append((number, f'path does not exist: {path}'))
    if mode == 'dump':
        return 0
    print(f'findings.md citations extracted: {len(found)}')
    print(f'  current, checked at HEAD: {counts["CUR"]}')
    print(f'  superseded leads followed by "(now at": {counts["OLD"]} (not checked; the "now at" citation is)')
    print(f'  past positions named on purpose (HIST): {counts["HIST"]}')
    print(f'path-like tokens without a line number: {len(pathonly)}')
    print(f'mechanical failures (missing file, line out of range, blank or punctuation-only line, ambiguous short name,'
          f' unbound bare number, missing path): {len(failures)}')
    for number, message in failures:
        print(f'  L{number}: {message}')
    print(f'current citations with no keyword shared with the claim and not in READ_OK: {len(nokw)}')
    for c in nokw:
        print(f'  L{c["line"]}: {c["target"]}:{c["nums"]}')
    print(f'READ_OK entries (read by hand): {len(READ_OK)}')
    ok = not failures and not nokw
    print('RESULT: ' + ('every current citation resolves to an existing, non-blank line that shares a word with its claim, or was read by hand'
                        if ok else 'FAILED'))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else 'verify'))
