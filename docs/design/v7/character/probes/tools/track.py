# per-frame body bbox, eye centroid/area of a single avatar in a video (body = saturated/bright, eyes = dark holes inside)
import sys, subprocess, numpy as np
f, crop = sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None
probe = subprocess.run(['ffprobe','-v','error','-select_streams','v','-show_entries','stream=width,height','-of','csv=p=0',f],capture_output=True,text=True).stdout.strip().split(',')
W,H = int(probe[0]), int(probe[1])
vf = ['-vf', 'crop='+crop] if crop else []
if crop: cw,ch,_,_ = map(int, crop.split(':')); W,H = cw,ch
raw = subprocess.run(['ffmpeg','-v','error','-i',f]+vf+['-f','rawvideo','-pix_fmt','rgb24','-'],capture_output=True).stdout
n = len(raw)//(W*H*3); fr = np.frombuffer(raw,np.uint8)[:n*W*H*3].reshape(n,H,W,3).astype(int)
bg = fr[0,2,2]
print('frames',n,'bg',bg)
for i in range(n):
  im = fr[i]; d = np.abs(im-bg).sum(2) > 90
  ys,xs = np.where(d)
  if len(xs)==0: print(i,'-'); continue
  x0,x1,y0,y1 = xs.min(),xs.max(),ys.min(),ys.max()
  sub = im[y0:y1+1,x0:x1+1]; body = d[y0:y1+1,x0:x1+1]
  # eyes: background-like pixels inside the body's row/col span (holes): use fill by rows
  hole = np.zeros_like(body)
  for r in range(body.shape[0]):
    c = np.where(body[r])[0]
    if len(c): hole[r,c.min():c.max()+1] = ~body[r,c.min():c.max()+1]
  ey,ex = np.where(hole)
  cx,cy=(x0+x1)/2,(y0+y1)/2; bw,bh=x1-x0+1,y1-y0+1
  if len(ex): print(i, f't={i/30:.2f}', 'body',bw,bh, 'eye dx %.3f dy %.3f area %.4f h %d' % (((ex+x0).mean()-cx)/bw, ((ey+y0).mean()-cy)/bh, len(ex)/(bw*bh), ey.max()-ey.min()+1))
  else: print(i, f't={i/30:.2f}', 'body',bw,bh,'no eyes')
