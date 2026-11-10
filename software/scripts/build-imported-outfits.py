"""Fit attributed MakeHuman clothes to the existing Anny GLB without installing Blender.
Uses the asset author's hm08 barycentric references and per-axis offset scales.
"""
from pathlib import Path
import json, struct, hashlib, re
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
source=ROOT/'assets/source-outfits'
out=ROOT/'web/public/avatar-wardrobe'
out.mkdir(parents=True,exist_ok=True)
b=(ROOT/'web/public/avatar-candidates/anny-makehuman.glb').read_bytes()
length=struct.unpack_from('<I',b,12)[0]; gltf=json.loads(b[20:20+length]); binary=28+length
attrs=gltf['meshes'][0]['primitives'][0]['attributes']
def attribute(name):
    a=gltf['accessors'][attrs[name]];v=gltf['bufferViews'][a['bufferView']]
    return np.frombuffer(b,dtype={5126:'<f4',5123:'<u2'}[a['componentType']],count=a['count']*{'VEC3':3,'VEC4':4}[a['type']],offset=binary+v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(a['count'],-1)
base=attribute('POSITION');joints=np.concatenate([attribute(f'JOINTS_{i}') for i in range(3)],axis=1);weights=np.concatenate([attribute(f'WEIGHTS_{i}') for i in range(3)],axis=1)
assets=[('tee','T-shirt_Basic_Tucked','t_shirt_basic_tucked','MRT','CC0-1.0'),('vintage','Retro_top','vintagetop','punkduck','CC-BY-3.0'),('trousers','M_Trousers_02','m_trousers_02','Mindfront (Sweden)','CC-BY-4.0')]
report=[]
for key,folder,stem,author,license in assets:
    path=source/folder;lines=(path/f'{stem}.mhclo').read_text().splitlines();scale=np.ones(3)*.1;refs=[];offsets=[];bary=[];deleted=set();mode=None
    for line in lines:
        parts=line.split()
        if not parts or line.startswith('#'):continue
        if parts[0] in ('x_scale','y_scale','z_scale'):
            axis='xyz'.index(parts[0][0]);i,j=int(parts[1]),int(parts[2]);scale[axis]=abs(float(base[i,axis]-base[j,axis]))/float(parts[3])
        elif parts[0]=='verts':mode='verts'
        elif parts[0]=='delete_verts':mode='delete'
        elif mode=='verts' and re.fullmatch(r'-?\d+',parts[0]):
            if len(parts)==1:refs.append([int(parts[0])]*3);bary.append([1,0,0]);offsets.append([0,0,0])
            elif len(parts)==9:refs.append(list(map(int,parts[:3])));bary.append(list(map(float,parts[3:6])));offsets.append(list(map(float,parts[6:9])))
            else:raise ValueError(f'Unsupported proxy vertex {line}')
        elif mode=='delete':
            for match in re.finditer(r'(\d+)\s*-\s*(\d+)|(\d+)',line):
                if match[3]:deleted.add(int(match[3]))
                else:deleted.update(range(int(match[1]),int(match[2])+1))
    refs=np.array(refs);bary=np.array(bary);offsets=np.array(offsets)
    fitted=(base[refs]*bary[:,:,None]).sum(1)+offsets*scale
    objVertices=[];uvs=[];faces=[]
    for line in (path/f'{stem}.obj').read_text().splitlines():
        p=line.split()
        if not p:continue
        if p[0]=='v':objVertices.append(list(map(float,p[1:4])))
        if p[0]=='vt':uvs.append(list(map(float,p[1:3])))
        if p[0]=='f':
            polygon=[(int(x.split('/')[0])-1,int(x.split('/')[1])-1) for x in p[1:]]
            for k in range(1,len(polygon)-1):faces.append([polygon[0],polygon[k],polygon[k+1]])
    assert len(fitted)==len(objVertices) and np.isfinite(fitted).all()
    boneIds=[];boneWeights=[]
    for indices,blend in zip(refs,bary):
        merged={}
        for bodyIndex,ratio in zip(indices,np.maximum(blend,0)):
            for joint,w in zip(joints[bodyIndex],weights[bodyIndex]):merged[int(joint)]=merged.get(int(joint),0)+float(ratio*w)
        values=sorted(merged.items(),key=lambda x:-x[1])[:12];total=sum(w for _,w in values)
        assert total>0
        values += [(0,0)]*(12-len(values));boneIds.append([j for j,_ in values]);boneWeights.append([w/total for _,w in values])
    # Smooth normals per original vertex, retaining seams only in UV space.
    normals=np.zeros_like(fitted)
    for tri in faces:
        i=[p[0] for p in tri];a,c,d=fitted[i];n=np.cross(c-a,d-a)
        for index in i:normals[index]+=n
    normals/=np.maximum(np.linalg.norm(normals,axis=1,keepdims=True),1e-12)
    if key in ('tee','vintage'):
        # Allow small fitting clearance and tuck the hem into this separate trouser asset.
        fitted+=normals*.0025
        fitted[:,1]-=.035*np.clip((.23-fitted[:,1])/.08,0,1)
        tuck=1-.16*np.clip((.185-fitted[:,1])/.04,0,1)
        fitted[:,0]*=tuck
        fitted[:,2]=.02+(fitted[:,2]-.02)*tuck
    elif key=='trousers':
        fitted[:,1]+=.015*np.clip((fitted[:,1]-.11)/.04,0,1)
    positions=[];normal=[];uv=[];indices=[];skin=[];weight=[];remap={}
    for tri in faces:
        for pair in tri:
            if pair not in remap:
                vi,ti=pair;remap[pair]=len(positions)//3;positions.extend(fitted[vi]);normal.extend(normals[vi]);uv.extend(uvs[ti]);skin.extend(boneIds[vi]);weight.extend(boneWeights[vi])
            indices.append(remap[pair])
    texture=None;detail=None;detailType=None
    for line in (path/f'{stem}.mhmat').read_text().splitlines():
        p=line.split()
        if not p:continue
        if p[0]=='diffuseTexture':texture=p[1]
        if p[0] in ('bumpTexture','normalmapTexture'):detail=p[1];detailType='bump' if p[0]=='bumpTexture' else 'normal'
    assert texture
    image=Image.open(path/texture).convert('RGB');image.thumbnail((1024,1024));image.save(out/f'{key}-color.jpg',quality=92)
    if detail:
        image=Image.open(path/detail).convert('RGB');image.thumbnail((1024,1024));image.save(out/f'{key}-detail.png')
    data={'id':key,'author':author,'license':license,'source':f'https://github.com/k3yg4n/glamcam-makehuman-clothing-assets/tree/main/finalized_clothes/{folder}','position':np.round(positions,7).tolist(),'normal':np.round(normal,6).tolist(),'uv':np.round(uv,6).tolist(),'indices':indices,'joints':skin,'weights':np.round(weight,8).tolist(),'deleteVertices':sorted(deleted),'color':f'{key}-color.jpg','detail':f'{key}-detail.png' if detail else None,'detailType':detailType}
    (out/f'{key}.json').write_text(json.dumps(data,separators=(',',':')),encoding='utf8')
    report.append({'id':key,'author':author,'license':license,'vertices':len(positions)//3,'triangles':len(indices)//3,'scale':scale.tolist(),'bounds':[fitted.min(0).tolist(),fitted.max(0).tolist()],'bodySha256':hashlib.sha256(b).hexdigest(),'adaptation':'hm08 fit, merged 12-bone weights, opaque RGB textures <=1024 px; tops: 2.5 mm clearance and up to 35 mm hem extension','source':data['source']})
(ROOT/'docs/assets/imported-outfits.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps(report,ensure_ascii=False,indent=2))
