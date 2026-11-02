import json, sys
S, name, mode = sys.argv[1], sys.argv[2], sys.argv[3]
import os
PFX=os.environ.get("PFX","/")
FILEDENY=os.environ.get("FILEDENY","1")=="1"
repo = os.environ.get('REPO', f'{S}/repo')
hook = lambda ev, m: {"type": "command", "command": f"node {S}/bin/hook.js {S}/out/{name}.hook.log {ev} {m}", "timeout": 5, "onFailure": "block"}
cfg = {
  "permissions": {
    "defaultMode": "dontAsk",
    "disableBypassPermissionsMode": "disable",
    "allow": [f"Read(/{repo}/**)", f"Edit(/{repo}/src/**)", "Bash"],
    "deny": [f"Edit(/{repo}/.avarice/**)", "Read(~/.ssh/**)", "WebSearch"],
  },
  "sandbox": {
    "enabled": True, "failIfUnavailable": True, "allowUnsandboxedCommands": False,
    "autoAllowBashIfSandboxed": False, "excludedCommands": [],
    "filesystem": {"allowWrite": [PFX+f"{repo}/src"], "denyWrite": ([PFX+f"{repo}/src/protected.txt"] if FILEDENY else []) + [PFX+f"{repo}/.avarice"] + [PFX+x.format(repo=repo) for x in os.environ.get("EXTRADENY","").split(",") if x], "denyRead": ["~/.ssh"]},
    "network": {"allowedDomains": [], "strictAllowlist": True},
  },
  "hooks": {"PreToolUse": [{"matcher": ".*", "hooks": [hook("pre", mode)]}]},
}
json.dump(cfg, open(f"{S}/out/{name}.settings.json", "w"), indent=2)
