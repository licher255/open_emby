"""Adapter for the pinned MPL-2.0 author implementation. No upstream algorithm source is copied here."""
from pathlib import Path
import sys, json, os, traceback
os.environ['MPLBACKEND']='Agg'
request_path, result_path, repo_path = map(Path, sys.argv[1:4])
sys.path[:0]=[str(repo_path),str(repo_path/'examples')]
import numpy as np
from scipy.ndimage import map_coordinates
from skimage.measure import find_contours, approximate_polygon
import matplotlib
matplotlib.use('Agg')
from embroidery.pipeline import main_pipeline

p=json.loads(request_path.read_text(encoding='utf-8'))
labels=np.asarray(p['labels'],dtype=np.uint32).reshape(p['mapHeight'],p['mapWidth'])
sx,sy=p['widthMm']/p['mapWidth'],p['heightMm']/p['mapHeight']
field=p.get('directionField')
if not field:raise ValueError('Direction field missing; analyze this artwork again')
cos2=np.asarray(field['cos2']).reshape(field['height'],field['width'])
sin2=np.asarray(field['sin2']).reshape(field['height'],field['width'])
components=[];fallback=[];records=[]

def directions(x,y):
    coords=np.array([y/p['heightMm']*(field['height']-1),x/p['widthMm']*(field['width']-1)])
    cx=map_coordinates(cos2,coords,order=1,mode='nearest');cy=map_coordinates(sin2,coords,order=1,mode='nearest')
    gx=np.zeros_like(x);gy=np.zeros_like(x);ws=np.zeros_like(x)
    for g in p.get('directionGuides',[]):
        if g.get('kind')=='radial':continue
        w=np.exp(-((x-g['xMm'])**2+(y-g['yMm'])**2)/(2*g['radiusMm']**2))
        a=np.deg2rad(2*g['angleDeg']);gx+=np.cos(a)*w;gy+=np.sin(a)*w;ws+=w
    mix=np.minimum(1,ws*1.4);den=np.maximum(ws,1e-8)
    cx=cx*(1-mix)+gx/den*mix;cy=cy*(1-mix)+gy/den*mix
    for g in p.get('directionGuides',[]):
        if g.get('kind')!='radial':continue
        dx=x-g['xMm'];dy=y-g['yMm'];w=np.clip((1.15-np.hypot(dx,dy)/g['radiusMm'])/0.25,0,1)
        a=2*np.arctan2(dy,dx);cx=cx*(1-w)+np.cos(a)*w;cy=cy*(1-w)+np.sin(a)*w
    angle=np.arctan2(cy,cx)/2
    return np.unwrap(np.unwrap(angle,axis=0),axis=1)

for r in p['regions']:
    if not r['enabled']:continue
    # Small details use the native engine; the paper requires a meaningful 2D domain.
    if r['areaMm2']<6 or min(r['widthMm'],r['heightMm'])<1.5 or r['stitchType'] not in ('flow','curved','tatami'):
        fallback.append(r['label']);continue
    try:
        yy,xx=np.where(labels==r['label'])
        xmin=max(0,int(xx.min())-2);ymin=max(0,int(yy.min())-2)
        xmax=min(p['mapWidth'],int(xx.max())+3);ymax=min(p['mapHeight'],int(yy.max())+3)
        ox,oy=xmin*sx,ymin*sy;scale=max((xmax-xmin)*sx,(ymax-ymin)*sy)
        mask=(labels[ymin:ymax,xmin:xmax]==r['label']).astype(float)
        contours=find_contours(np.pad(mask,1),.5)
        boundaries=[]
        for contour in contours:
            contour=approximate_polygon(contour,tolerance=.6)
            boundary=np.column_stack(((contour[:,1]-.5)*sx,(contour[:,0]-.5)*sy))/scale
            if len(boundary)>=4:boundaries.append(boundary)
        boundaries.sort(key=lambda b:abs(np.sum(b[:-1,0]*b[1:,1]-b[1:,0]*b[:-1,1])),reverse=True)
        if not boundaries:raise ValueError('No closed boundary')
        axis=np.linspace(0,1,128);u,v=np.meshgrid(axis,axis);wx=ox+u*scale;wy=oy+v*scale
        ix=np.clip((wx/sx).astype(int),0,p['mapWidth']-1);iy=np.clip((wy/sy).astype(int),0,p['mapHeight']-1)
        inside=(labels[iy,ix]==r['label']).astype(float)
        angle=directions(wx,wy)+np.deg2rad(r['angleDeg'])
        if r['stitchType']=='tatami':angle=np.full_like(u,np.deg2rad(r['angleDeg']))
        # Uniform regional density; report defaults remain available in the reproduction harness.
        line=main_pipeline(xaxis=axis,yaxis=axis,boundary=boundaries[0],holes=boundaries[1:],density_grid=np.full_like(u,.75),direction_grid=angle,inside_indicator_grid=inside,relative_line_width=r['density']/scale,streamline_step=2000,streamline_step_size=.002,plot_figure=False)
        if not np.isfinite(line).all() or len(line)<2:raise ValueError('Invalid optimized path')
        line=line*scale+np.array([ox,oy]);points=[];jumps=0
        points.append(dict(x=float(line[0,0]),y=float(line[0,1]),flag=1,color=r['colorIndex']))
        for a,b in zip(line[:-1],line[1:]):
            length=np.linalg.norm(b-a)
            if length<.02:continue
            samples=np.linspace(a,b,max(2,int(np.ceil(length/min(sx,sy)*4))))
            xs=np.floor(samples[:,0]/sx).astype(int);ys=np.floor(samples[:,1]/sy).astype(int)
            valid=(xs>=0)&(xs<p['mapWidth'])&(ys>=0)&(ys<p['mapHeight'])
            if not valid.all() or not (labels[np.clip(ys,0,p['mapHeight']-1),np.clip(xs,0,p['mapWidth']-1)]==r['label']).all():
                points.append(dict(x=float(b[0]),y=float(b[1]),flag=1,color=r['colorIndex']));jumps+=1;continue
            n=max(1,int(np.ceil(length/p.get('maxStitchMm',3))))
            for j in range(1,n+1):
                at=a+(b-a)*j/n;points.append(dict(x=float(at[0]),y=float(at[1]),flag=0,color=r['colorIndex']))
        if any(q['x']<0 or q['y']<0 or q['x']>p['widthMm'] or q['y']>p['heightMm'] for q in points):raise ValueError('Optimized boundary outside canvas')
        if not any(q['flag']==0 for q in points):raise ValueError('No valid stitches')
        components.append(dict(label=r['label'],color=r['colorIndex'],points=points,areaMm2=r['areaMm2']))
        records.append(dict(label=r['label'],status='paper',points=len(points),boundaryJumps=jumps))
    except Exception as error:
        fallback.append(r['label']);records.append(dict(label=r['label'],status='native-detail',reason=str(error)))
    print('PAPER_PROGRESS '+str(len(records)),flush=True)
result_path.write_text(json.dumps(dict(components=components,fallback=fallback,records=records),ensure_ascii=False),encoding='utf-8')
