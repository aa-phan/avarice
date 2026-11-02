import sys, json
from pathlib import Path
from graphify.detect import detect
r = detect(Path(sys.argv[1]))
print({k: (sorted(Path(p).name for p in v) if isinstance(v, list) else v) for k, v in r.items() if k in ('code','document','paper','image','total_files','total_words','skipped') or isinstance(v, list)})
