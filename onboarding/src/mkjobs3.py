# Revision 3's render list: every screen (dark and light, 1440 x 900 at 2x) and every board. python3 -I mkjobs3.py
import json, os
B = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.dirname(B)
U = f"file://{B}/ob3.html"
S = json.load(open(f"{B}/screens3.json"))
jobs = [{"url": f"{U}?s={s}&{q}&theme={t}".replace("&&", "&"), "out": f"{OUT}/screens/{n}-{t}.jpg", "w": 1440, "h": 900, "wait": 1400, "full": False} for s, q, n in S for t in ["dark", "light"]]
json.dump(jobs, open(f"{B}/jobs3-screens.json", "w"), indent=0)
BD = [("o01", "O01-structure-one-first-run"), ("o02", "O02-approvals-placement"), ("o03", "O03-goal-tiles"), ("o04", "O04-speaker-logomark"), ("c01", "C01-own-parts-and-motion"), ("c02", "C02-kit-and-orb2-map")]
json.dump([{"url": f"{U}?b={b}", "out": f"{OUT}/boards/{n}.jpg", "w": 1940, "h": 900, "wait": 2200} for b, n in BD], open(f"{B}/jobs3-boards.json", "w"), indent=0)
print(len(jobs), "screens,", len(BD), "boards")
