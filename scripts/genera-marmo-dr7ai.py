# Genera public/marmo-dr7ai.webp: marmo NERO con venature bianche e turchesi
# del logo, sfondo del tema "DR7 AI" (solo modo scuro).
# Uso: python3 scripts/genera-marmo-dr7ai.py 3 public/marmo-dr7ai.webp
import numpy as np, sys
from scipy.ndimage import zoom, gaussian_filter, map_coordinates
from PIL import Image
W,H=1600,2400
rng=np.random.default_rng(int(sys.argv[1]) if len(sys.argv)>1 else 3)
yy,xx=np.mgrid[0:H,0:W].astype(float)
D=int(np.hypot(W,H))+8
def grid_noise(cell_y,cell_x,oct,pers,lac=2.0):
    out=np.zeros((D,D)); amp=1; tot=0; cy,cx=cell_y,cell_x
    for o in range(oct):
        gh=max(3,int(D/cy)); gw=max(3,int(D/cx))
        g=rng.standard_normal((gh+4,gw+4))
        z=zoom(g,(D/gh,D/gw),order=3)[:D,:D]
        if z.shape!=(D,D): z=np.pad(z,((0,D-z.shape[0]),(0,D-z.shape[1])),mode='reflect')
        out+=amp*z; tot+=amp; amp*=pers; cy/=lac; cx/=lac
    return out/tot
def sample(field,angle,warp=None):
    a=np.deg2rad(angle); cx,cy=W/2,H/2
    u=(xx-cx)*np.cos(a)-(yy-cy)*np.sin(a)+D/2
    v=(xx-cx)*np.sin(a)+(yy-cy)*np.cos(a)+D/2
    if warp is not None: u=u+warp[0]; v=v+warp[1]
    return map_coordinates(field,[np.clip(v,0,D-1),np.clip(u,0,D-1)],order=1)
def norm(a): return (a-a.min())/(a.max()-a.min())
def ridge(cell_y,cell_x,angle,power,wk,oct=5):
    n=grid_noise(cell_y,cell_x,oct,0.5)
    w=(sample(grid_noise(400,400,3,0.5),0)*wk, sample(grid_noise(400,400,3,0.5),0)*wk)
    s=sample(n,angle,w); s=s/s.std()
    return np.clip(1-np.abs(s)*0.9,0,1)**power
# stone body
b1=norm(sample(grid_noise(520,520,6,0.62),0))
b2=norm(sample(grid_noise(70,70,4,0.65),0))
b3=norm(gaussian_filter(rng.standard_normal((H,W)),1.0))
t=np.clip(0.55*b1+0.38*b2+0.07*b3,0,1)
t=np.clip((t-0.25)/0.6,0,1)**1.25
stops=[(0,(2,3,4)),(0.35,(8,10,11)),(0.65,(18,22,24)),(0.85,(34,40,42)),(1,(58,66,68))]
col=np.zeros((H,W,3))
for (a,ca),(bb,cb) in zip(stops,stops[1:]):
    m=(t>=a)&(t<=bb); f=((t-a)/(bb-a))[...,None]
    col=np.where(m[...,None],np.array(ca)+(np.array(cb)-np.array(ca))*f,col)
# speckle (crystal)
sp=gaussian_filter(rng.random((H,W))>0.997,0.6)*255*0.6
col+= (np.array([170,180,180])*np.clip(sp,0,1)[...,None])*0.5
v1=ridge(1400,420,-55,70,45)     # main long veins
v2=ridge(700,260,-20,90,30)
v3=ridge(260,140,-70,120,14)     # fine cracks
v4=ridge(180,180,30,150,10)
glow=np.clip(gaussian_filter(v1,7)*2.2+gaussian_filter(v2,4)*1.2,0,1)
teal=np.array([80,215,200]); white=np.array([238,250,247])
col=col+teal*glow[...,None]*0.18
for v,a,c in [(v4,0.5,teal),(v3,0.65,(150,235,225)),(v2,0.9,white),(v1,1.0,white)]:
    a=np.clip(v*a,0,1)[...,None]; col=col*(1-a)+np.array(c)*a
bloom=np.exp(-(((xx-W*0.9)/(W*0.55))**2+((yy-H*0.12)/(H*0.4))**2))
vign=1-0.35*(((xx/W-0.5)**2+(yy/H-0.5)**2)*2)
col=col*(0.7+0.5*bloom)[...,None]*vign[...,None]
col=np.clip(col,0,255).astype(np.uint8)
im=Image.fromarray(col)
im.save(sys.argv[2],quality=80,method=6)
