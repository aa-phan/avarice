#!/usr/bin/env python3
"""Sentence length check for prose in a docs/system document (plan 03-33, round 3).

    python3 -I .planning/phases/03-decisions-independent-work-and-amendments/03-33-reviews/round-3-sentence-check.py docs/system/findings.md [cap]

A sentence ends at a full stop, a question mark or an exclamation mark followed by a space or the end of the line. A semicolon
or a colon does not end it. Words are whitespace-separated tokens with every inline code span counted by its inner tokens (the
strict count). Table rows, headings and code fences are skipped. The default cap is 35. Prints each sentence over the cap with
its line number and word count, then the totals.
"""
import re
import sys

path = sys.argv[1]
cap = int(sys.argv[2]) if len(sys.argv) > 2 else 35
over = 0
total = 0
fence = False
for number, text in enumerate(open(path, encoding='utf-8').read().split('\n'), start=1):
    if text.startswith('```'):
        fence = not fence
        continue
    if fence or text.startswith('#') or text.startswith('|') or text.strip() == '':
        continue
    body = re.sub(r'^\s*(?:[-*]|\d+\.)\s+', '', text)
    # protect full stops inside code spans and file names, then split at a sentence end
    protected = re.sub(r'`[^`]*`', lambda m: m.group(0).replace('.', '\x00'), body)
    protected = re.sub(r'(?<=\w)\.(?=\w)', '\x00', protected)
    for sentence in re.split(r'(?<=[.?!])\s+(?=[A-Z`(\"])|(?<=[.?!])$', protected):
        words = [w for w in sentence.replace('`', ' ').split() if w.strip('()[]:;,.') != '']
        total += 1
        if len(words) > cap:
            over += 1
            print(f'L{number}: {len(words)} words: {sentence.replace(chr(0), ".")[:110]}...')
print(f'{path}: {total} sentences, {over} over {cap} words')
