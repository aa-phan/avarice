import json,sys
for l in open(sys.argv[1]):
    e=json.loads(l)
    if e.get("type")=="system" and e.get("subtype")=="init":
        sk=[str(s) for s in e.get("skills") or []]; sc=[str(s) for s in e.get("slash_commands") or []]
        g=[s for s in sk if s.startswith('gsd') or 'graphify' in s]
        print(f"skills={len(sk)} gsd/graphify={len(g)} e.g. {g[:4]} | slash={len(sc)} hooks-from-user? permissionMode={e.get('permissionMode')}")
        if len(sys.argv)>2: print(sk)
    if e.get("type")=="result": print("result:",e.get("subtype"),repr(e.get("result"))[:80],"cost",e.get("total_cost_usd"),"denials",e.get("permission_denials"))
