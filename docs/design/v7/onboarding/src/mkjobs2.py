# Revision 2's render list: every screen (dark and light, 1440 x 900 at 2x) and every board. python3 -I mkjobs2.py [batch]
import json, sys, os
B = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.dirname(B)
U = f"file://{B}/ob2.html"
S = [("obS01", "", "O-S01-hello"), ("obS01", "v=second", "O-S01-second-welcome-to-sessions"),
     ("obB03", "", "O-B03-meet-your-team"), ("obB04", "", "O-B04-goals-tiles")]
S += json.load(open(f"{B}/screens2.json")) if os.path.exists(f"{B}/screens2.json") else []
jobs = [{"url": f"{U}?s={s}&{q}&theme={t}".replace("&&", "&"), "out": f"{OUT}/screens/{n}-{t}.jpg", "w": 1440, "h": 900, "wait": 1400, "full": False} for s, q, n in S for t in ["dark", "light"]]
json.dump(jobs, open(f"{B}/jobs-screens.json", "w"), indent=0)
BD = [("o01", "O01-structure-per-tab"), ("o02", "O02-approvals-placement"), ("o03", "O03-goal-tiles"), ("o04", "O04-speaker-logomark")]
BD += [tuple(x) for x in json.load(open(f"{B}/boards2.json"))] if os.path.exists(f"{B}/boards2.json") else []
json.dump([{"url": f"{U}?b={b}", "out": f"{OUT}/boards/{n}.jpg", "w": 1940, "h": 900, "wait": 2200} for b, n in BD], open(f"{B}/jobs-boards.json", "w"), indent=0)
print(len(jobs), "screens,", len(BD), "boards")
