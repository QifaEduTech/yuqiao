"""Export the locally installed CC0 MakeHuman data as a skinned GLB, no new packages.

All 12 skin influences and all 52 facial actions are preserved. Three.js needs
the extended skinning adapter in annyRig.ts because its stock material uses four.
"""
import os, sys, json, struct, hashlib, re
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
for name, sub in {'ANNY_CACHE_DIR':'anny-cache','HF_HOME':'huggingface','XDG_CACHE_HOME':'cache','TMP':'tmp','TEMP':'tmp'}.items():
    directory = ROOT / '.runtime-logs' / sub
    directory.mkdir(parents=True, exist_ok=True)
    os.environ[name] = str(directory)
sys.stdout.reconfigure(encoding='utf-8')
import numpy as np
import torch, anny
torch.set_num_threads(4)

def numpy(tensor):
    return tensor.detach().cpu().numpy()

def main():
    model = anny.Anny(rig='makehuman', topology='makehuman', facial_actions='all', skinning_method='lbs')
    with torch.no_grad():
        neutral = model(return_bone_ends=True)
    # Anny: Z up, -Y front. glTF: Y up, +Z front. Proper rotation (det +1).
    conversion = np.array([[1,0,0],[0,0,1],[0,-1,0]], dtype=np.float64)
    world_conversion = np.eye(4); world_conversion[:3,:3] = conversion
    vertices = numpy(neutral['rest_vertices'][0]) @ conversion.T
    faces = numpy(model.get_triangular_faces()).astype('<u4')
    poses = world_conversion @ numpy(neutral['rest_bone_poses'][0])
    parents = list(model.bone_parents)
    labels = list(model.bone_labels)
    weights = numpy(model.vertex_bone_weights).astype('<f4')
    indices = numpy(model.vertex_bone_indices).astype('<u2')
    assert weights.shape[1] == 12
    assert np.allclose(weights.sum(1), 1, atol=1e-5)
    assert np.isfinite(vertices).all() and faces.max() < len(vertices)
    def vertex_normals(points):
        values = np.zeros_like(points)
        face_normals = np.cross(points[faces[:,1]]-points[faces[:,0]], points[faces[:,2]]-points[faces[:,0]])
        for column in range(3): np.add.at(values, faces[:,column], face_normals)
        return values / np.maximum(np.linalg.norm(values,axis=1,keepdims=True),1e-12)
    normals = vertex_normals(vertices)
    binary = bytearray()
    gltf = {'asset':{'version':'2.0','generator':'Yuqiao Anny exporter','copyright':'MakeHuman/MPFB2 core data CC0-1.0; Anny code Apache-2.0'},
        'scene':0,'scenes':[{'nodes':[0]}], 'nodes':[{'name':'AnnyPreview','children':[1,164]}],
        'buffers':[], 'bufferViews':[], 'accessors':[], 'materials':[{'name':'Neutral clay preview',
        'pbrMetallicRoughness':{'baseColorFactor':[0.57,0.64,0.62,1],'metallicFactor':0,'roughnessFactor':0.85},'doubleSided':True}]}
    def accessor(data, kind, component=5126, bounds=False):
        arr=np.asarray(data,dtype={5126:'<f4',5125:'<u4',5123:'<u2'}[component])
        while len(binary)%4: binary.append(0)
        offset=len(binary); binary.extend(arr.tobytes())
        view=len(gltf['bufferViews']); gltf['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':arr.nbytes})
        entry={'bufferView':view,'componentType':component,'count':len(arr),'type':kind}
        if bounds: entry.update(min=arr.min(axis=0).tolist(),max=arr.max(axis=0).tolist())
        gltf['accessors'].append(entry)
        return len(gltf['accessors'])-1
    for i,label in enumerate(labels):
        local=poses[i] if parents[i]<0 else np.linalg.inv(poses[parents[i]]) @ poses[i]
        tail=conversion @ numpy(neutral['rest_bone_tails'][0,i])
        tail_local=np.linalg.inv(poses[i]) @ np.r_[tail,1]
        node={'name':label,'matrix':local.T.reshape(-1).tolist(),'extras':{'tail':tail_local[:3].tolist()}}
        children=[j+1 for j,p in enumerate(parents) if p==i]
        if children: node['children']=children
        gltf['nodes'].append(node)
    gltf['nodes'].append({'name':'AnnyBody','mesh':0,'skin':0})
    inverse=np.linalg.inv(poses).transpose(0,2,1).reshape(-1,16)
    gltf['skins']=[{'name':'MakeHuman163','joints':list(range(1,164)),'skeleton':1,'inverseBindMatrices':accessor(inverse,'MAT4')}]
    attrs={'POSITION':accessor(vertices,'VEC3',bounds=True),'NORMAL':accessor(normals,'VEC3')}
    for group in range(3):
        attrs[f'JOINTS_{group}']=accessor(indices[:,group*4:group*4+4],'VEC4',5123)
        attrs[f'WEIGHTS_{group}']=accessor(weights[:,group*4:group*4+4],'VEC4')
    targets=[]
    for action in model.facial_action_labels:
        with torch.no_grad(): expression=model(facial_actions={action:1.0})
        # Compare like spaces. `vertices` contains local-ref pose skinning and is
        # NOT the neutral rest mesh: subtracting rest from posed adds that offset
        # once per active expression. Morph targets must be rest-space deltas.
        expression_vertices=numpy(expression['rest_vertices'][0]) @ conversion.T
        delta=expression_vertices-vertices
        targets.append({'POSITION':accessor(delta,'VEC3',bounds=True),
                        'NORMAL':accessor(vertex_normals(expression_vertices)-normals,'VEC3')})
    gltf['meshes']=[{'name':'AnnyBody','primitives':[{'attributes':attrs,'indices':accessor(faces.reshape(-1),'SCALAR',5125),'material':0,'targets':targets}],
        'weights':[0]*len(targets),'extras':{'targetNames':list(model.facial_action_labels)}}]
    gltf['buffers']=[{'byteLength':len(binary)}]
    encoded=json.dumps(gltf,separators=(',',':')).encode('utf8')
    encoded+=b' '*((-len(encoded))%4); binary+=b'\0'*((-len(binary))%4)
    payload=struct.pack('<III',0x46546c67,2,12+8+len(encoded)+8+len(binary))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(binary),0x004e4942)+binary
    output=ROOT/'web/public/avatar-candidates/anny-makehuman.glb'; output.parent.mkdir(parents=True,exist_ok=True); output.write_bytes(payload)
    report={'id':'anny-makehuman','date':'2026-10-14','source':'https://github.com/naver/anny','codeLicense':'Apache-2.0','coreDataLicense':'CC0-1.0',
        'file':'web/public/avatar-candidates/anny-makehuman.glb','served_url':'/avatar-candidates/anny-makehuman.glb','bytes':len(payload),'sha256':hashlib.sha256(payload).hexdigest(),
        'bones':len(labels),'fingerJoints':sum(bool(re.match(r'finger\d-\d\.[LR]$',x)) for x in labels),
        'handChainBones':sum(bool(re.search('finger|metacarpal|wrist',x)) for x in labels),
        'facialBones':sum(bool(re.search(r'jaw|eye|brow|lip|mouth|tongue|cheek|nose|chin|oris|levator|oculi|temporalis|risorius|orbicularis|special',x,re.I)) for x in labels),
        'facialActions':len(targets),'vertices':len(vertices),'triangles':len(faces),'skinInfluences':12,
        'morphSpace':'rest-relative-with-normal-deltas',
        'limits':['Neutral clay material; no hair or clothing assets','Preview joint tests are not sign language','User appearance review pending'],
        'boneLabels':labels,'facialActionNames':list(model.facial_action_labels)}
    (ROOT/'docs/assets/anny-export.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(json.dumps({k:v for k,v in report.items() if k not in ['boneLabels','facialActionNames']},ensure_ascii=False))

if __name__=='__main__': main()
