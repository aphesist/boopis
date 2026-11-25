import json,sys
U="file:///tmp/claude-0/-home-user/b86134f0-5066-55eb-9eed-e7bff27da970/scratchpad/onboarding/src/ob.html"; D="/tmp/claude-0/-home-user/b86134f0-5066-55eb-9eed-e7bff27da970/scratchpad/onboarding/screens"
S=[("obIntro","step=1","O01-meet-boopis"),("obIntro","step=2","O02-two-ways-to-work"),("obIntro","step=3","O03-you-stay-in-charge"),("obIntro","step=3&engine=busy","O03b-engine-getting-ready"),("obIntro","step=3&engine=blocked","O23a-error-no-engine"),
("obConsent","","O04-settings-boopis-needs"),("obModels","","O05-model-found"),("obModelsSt","st=none","O05b-model-nothing-found"),("obModelsSt","st=waiting","O05c-model-signing-in"),
("obTry","phase=shown","O06a-try-it-marks"),("obTry","phase=open","O06b-try-it-mark-open"),("obTry","phase=ask","O06c-try-it-keep-it-on"),("obTry","phase=open&rec=1","O06d-try-it-recorded"),
("obWhere","","O07-where-to-start"),("obFolder","","O08-add-a-folder"),("obCareful","","O09-how-careful"),("obFirst","","O10-first-task"),
("obBots","step=1","O11-meet-the-boopis-bot"),("obBots","step=2","O12-give-each-bot-a-job"),("obBWhere","","O13-where-bots-work"),("obBName","","O14-your-name"),("obBGoal","","O15-pick-a-goal"),
("obBTeam","","O16-team-and-connectors"),("obBRules","","O17-approval-rules"),("obBBuild","","O18-build"),("obBReach","","O19-reach"),("obBFirst","","O20-first-job"),
("obResume","","O21-resume"),("obSettings","","O22-settings-getting-started"),("obModelsSt","st=failed","O23b-error-sign-in-failed"),("obModelsSt","st=offline","O23c-error-offline"),("obReturning","","O24-returning-user")]
out=[]
for s,q,n in S:
  for t in ["dark","light"]:
    out.append({"url":f"{U}?s={s}&{q}&theme={t}".replace("&&","&"),"out":f"{D}/{n}-{t}.jpg","w":1440,"h":900,"wait":1500,"full":False})
json.dump(out,open("/tmp/claude-0/-home-user/b86134f0-5066-55eb-9eed-e7bff27da970/scratchpad/onboarding/src/jobs-screens.json","w"))
B=[("o01","O01-structure",1640),("o02","O02-approvals-placement",1940),("o03","O03-goal-picker",1940),("o04","O04-setup-speaker",1940),("c01","C01-components-new",1940),("c02","C02-kit-reuse",1940)]
json.dump([{"url":f"{U}?b={b}","out":f"/tmp/claude-0/-home-user/b86134f0-5066-55eb-9eed-e7bff27da970/scratchpad/onboarding/boards/{n}.jpg","w":w,"h":900,"wait":2500} for b,q,w in [(x[0],0,x[2]) for x in B] for n in [dict((y[0],y[1]) for y in B)[b]]],open("/tmp/claude-0/-home-user/b86134f0-5066-55eb-9eed-e7bff27da970/scratchpad/onboarding/src/jobs-boards.json","w"))
