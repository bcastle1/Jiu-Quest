"""Actual-source protection, topology and retained-thickness contracts."""
import ast,collections,hashlib,math,sys,unittest
from pathlib import Path

HERE=Path(__file__).resolve().parent
ROOT=next(p for p in HERE.parents if (p/'public/animations/bjj').is_dir())
PYTHON=ROOT/'unreal/JiuQuestCharacters/Content/Python'
sys.path[:0]=[str(HERE),str(PYTHON)]
import pilot_gi_body as body
from pilot_source import select_hair
from ready_hands import refine_ready_hands,_Scene,_rotate
from pilot_look import MeshFile,refine_look,panel_at
from pilot_hair import refine_hair
from pilot_hair_shape import refine_spikes_shape

def sub(a,b):return tuple(x-y for x,y in zip(a,b))
def dot(a,b):return sum(x*y for x,y in zip(a,b))
def cross(a,b):return (a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])
def length(a):return math.sqrt(dot(a,a))
def normal(t):
    n=cross(sub(t[1],t[0]),sub(t[2],t[0]));size=length(n);assert size>1e-12;return tuple(x/size for x in n)
def part(mesh,name):
    node=next(n for n in mesh.doc['nodes'] if n.get('name')==name);pr=mesh.doc['meshes'][node['mesh']]['primitives'][0]
    values={k:mesh.read(v) for k,v in pr['attributes'].items()};ii=[x[0] for x in mesh.read(pr['indices'])]
    return node,pr,values,[tuple(ii[i:i+3]) for i in range(0,len(ii),3)]
def posed(mesh,node,values,world):
    skin=mesh.doc['skins'][node['skin']];binds=mesh.read(skin['inverseBindMatrices']);result=[]
    for p,joints,weights in zip(values['POSITION'],values['JOINTS_0'],values['WEIGHTS_0']):
        out=[0.,0.,0.]
        for j,w in zip(joints,weights):
            if not w:continue
            m=binds[j];local=tuple(sum(m[c*4+r]*p[c] for c in range(3))+m[12+r] for r in range(3));q,t=world[skin['joints'][j]];rot=_rotate(q,local)
            for k in range(3):out[k]+=w*(rot[k]+t[k])
        result.append(tuple(out))
    return result

class GiBodyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original=(ROOT/'public/animations/bjj/standing_stance.glb').read_bytes()
        accepted,_=select_hair(cls.original,'Spikes');accepted,_=refine_ready_hands(accepted,'standing_stance');accepted,_=refine_look(accepted);accepted,_=refine_hair(accepted,'Spikes');accepted,_=refine_spikes_shape(accepted)
        cls.accepted=accepted;cls.output,cls.proof=body.refine_gi_body(accepted,'standing_stance');cls.a=MeshFile(accepted);cls.b=MeshFile(cls.output);cls.source=MeshFile(cls.original)

    def test_exact_reviewed_output_from_full_actual_source_pipeline(self):
        self.assertEqual(body._pants_digest(self.a),'53d78ba025f85a21b88769344fc689285d5c173725a8d543dddbc9714124c30b')
        self.assertEqual(body._pants_digest(self.b),'a12ac9646dc2b6249547ee1fe8e1e1173f116d85a39e2d0588b4054a77a24744')
        self.assertEqual(body._document_digest(self.b),'f77f3353e2fc60711412d467af0afc4dfb207709b4de4c482d983b45e2a247c1')
        # UE Python3.11 reproduces the whole saved input. Python3.12's earlier
        # hair/jacket math differs outside this helper and must pass through.
        if hashlib.sha256(self.accepted).hexdigest()=='2e2da70678646a93dd6a6a9a1c2eaf59b2fa72ab6161f67761d690256f1262f8':
            self.assertEqual(hashlib.sha256(self.output).hexdigest(),'3c263e76986d1de15f72c9797a51007294bb1bade3dd388ba8e62864fea51078')

    def test_protected_body_hair_rig_motion_materials_and_uvs_are_exact(self):
        for key in ('nodes','skins','animations','materials','images','textures','samplers'):self.assertEqual(self.a.doc.get(key),self.b.doc.get(key),key)
        for node in self.a.doc['nodes']:
            if 'mesh' not in node:continue
            name=node.get('name','');aa=self.a.doc['meshes'][node['mesh']];bb=self.b.doc['meshes'][node['mesh']]
            if not name.endswith('_GiPantsMesh'):
                self.assertEqual(aa,bb,name)
                for pr in aa['primitives']:
                    for key in list(pr['attributes'].values())+[pr['indices']]:self.assertEqual(self.a.read(key),self.b.read(key),name)
            else:
                for semantic in ('TEXCOORD_0','TEXCOORD_1','JOINTS_0','WEIGHTS_0'):
                    self.assertEqual(self.a.read(aa['primitives'][0]['attributes'][semantic]),self.b.read(bb['primitives'][0]['attributes'][semantic]))

    def test_exact_outer_and_deep_lining_scope_and_three_internal_boundaries(self):
        for role in ('Attacker','Defender'):
            name='JQ_'+role+'_GiPantsMesh';_,_,source,faces=part(self.a,name);_,pr,new,retained=part(self.b,name)
            expected=[f for i,f in enumerate(faces) if not(2810<=i<5620 and all(.22<panel_at(source['TEXCOORD_1'][j])[2]<.84 for j in f))]
            self.assertEqual(retained,expected);self.assertEqual(retained[:2810],faces[:2810]);self.assertEqual(len(retained),3972)
            self.assertTrue(self.b.doc['materials'][pr['material']]['doubleSided'])
            weld={};ids=[weld.setdefault(p,len(weld)) for p in new['POSITION']];edges={}
            for f in retained:
                ff=[ids[i] for i in f]
                for i,j in zip(ff,ff[1:]+ff[:1]):edges.setdefault(tuple(sorted((i,j))),[]).append((i,j))
            boundary=[k for k,values in edges.items() if len(values)==1];self.assertEqual(len(boundary),84)
            for values in edges.values():
                self.assertIn(len(values),(1,2))
                if len(values)==2:self.assertEqual(values[0],values[1][::-1])
            adj={}
            for i,j in boundary:adj.setdefault(i,set()).add(j);adj.setdefault(j,set()).add(i)
            self.assertTrue(all(len(v)==2 for v in adj.values()));unseen=set(adj);loops=[]
            while unseen:
                stack=[unseen.pop()];seen=set(stack)
                while stack:
                    fresh=adj[stack.pop()]&unseen;unseen-=fresh;seen|=fresh;stack.extend(fresh)
                loops.append(len(seen))
            self.assertEqual(sorted(loops),[20,20,44])

    def test_original_envelope_opening_positions_and_measured_foot_patch(self):
        for role in ('Attacker','Defender'):
            name='JQ_'+role+'_GiPantsMesh';_,_,old,faces=part(self.a,name);_,_,new,_=part(self.b,name);_,_,original,_=part(self.source,name)
            self.assertLessEqual(max(length(sub(p,q)) for p,q in zip(original['POSITION'],new['POSITION'])),.0220001)
            for k in range(3):
                self.assertGreaterEqual(min(p[k] for p in new['POSITION']),min(p[k] for p in original['POSITION'])-.0030001)
                self.assertLessEqual(max(p[k] for p in new['POSITION']),max(p[k] for p in original['POSITION'])+.0030001)
            protected={i for i,q in enumerate(old['TEXCOORD_1']) if panel_at(q)[2]<=.15 or panel_at(q)[2]>=.82}
            protected|={i for f in body.FOOT_RISK_SEED_FACES for i in faces[f]}
            self.assertTrue(all(old['POSITION'][i]==new['POSITION'][i] for i in protected))

    def test_whole_retained_triangle_thickness_through_nine_standing_poses(self):
        scene=_Scene(self.accepted);minimum=float('inf')
        for role in ('Attacker','Defender'):
            name='JQ_'+role+'_GiPantsMesh';node,_,old,faces=part(self.a,name);_,_,new,retained=part(self.b,name);_,_,source,_=part(self.source,name)
            outer_vertices=set(i for f in faces[:2810] for i in f);byuv={}
            for i in outer_vertices:byuv.setdefault(source['TEXCOORD_1'][i],[]).append(i)
            outer_lookup={frozenset(f):f for f in faces[:2810]};mapping=[]
            for f in faces[2810:5620]:
                if f not in retained:continue
                pairs=[]
                for i in f:
                    choices=[j for j in byuv[source['TEXCOORD_1'][i]] if .002998<length(sub(source['POSITION'][i],source['POSITION'][j]))<.003002 and source['JOINTS_0'][i]==source['JOINTS_0'][j] and source['WEIGHTS_0'][i]==source['WEIGHTS_0'][j]]
                    self.assertTrue(choices);positions={source['POSITION'][j] for j in choices};self.assertEqual(len(positions),1);pairs.append(choices)
                matches=[g for g in faces[:2810] if all(any(j in g for j in ids) for ids in pairs)]
                self.assertEqual(len(matches),1);g=matches[0];ordered=tuple(next(j for j in g if j in ids) for ids in pairs);mapping.append((f,g,ordered))
            self.assertEqual(len(mapping),982)
            for step in range(9):
                world=scene.pose(step*1.8/8);a=posed(self.a,node,old,world);b=posed(self.b,node,new,world)
                for f,g,order in mapping:
                    for before,after in ((a,b),):
                        oldn=normal([before[j] for j in g]);newn=normal([after[j] for j in g]);oldi=normal([before[j] for j in f]);newi=normal([after[j] for j in f])
                        for i,j in zip(f,order):
                            delta=sub(before[i],before[j]);delta2=sub(after[i],after[j]);values=(-dot(delta,oldn),dot(delta,oldi));values2=(-dot(delta2,newn),dot(delta2,newi));minimum=min(minimum,*values2)
                            for x,y in zip(values,values2):
                                if x>=-1e-9:self.assertGreaterEqual(y,-1e-9)
                                else:self.assertGreaterEqual(y,x-1e-9)
        self.assertGreater(minimum,.0011)

    def test_ground_controls_are_exact_and_unknown_source_fails_closed(self):
        for clip in ('rear_naked_choke','armbar'):
            raw=(ROOT/'public/animations/bjj'/(clip+'.glb')).read_bytes();result,proof=body.refine_gi_body(raw,clip);self.assertIs(result,raw);self.assertFalse(proof['applied'])
        node,pr,_,_=part(self.a,'JQ_Attacker_GiPantsMesh');_,start,_,_=self.a.layout(pr['attributes']['POSITION']);changed=bytearray(self.accepted);changed[start]^=1
        with self.assertRaisesRegex(ValueError,'input pants differ'):body.refine_gi_body(bytes(changed),'standing_stance')
        skin=self.a.doc['skins'][node['skin']];_,start,_,_=self.a.layout(skin['inverseBindMatrices']);changed=bytearray(self.accepted);changed[start]^=1
        with self.assertRaisesRegex(ValueError,'rig, motion or embedded textures differ'):body.refine_gi_body(bytes(changed),'standing_stance')
        with self.assertRaisesRegex(ValueError,'input document differs'):body.refine_gi_body(self.output,'standing_stance')
        with self.assertRaisesRegex(ValueError,'Unknown'):body.refine_gi_body(self.accepted,'other_clip')

    def test_slick_and_ground_bypass_are_explicit(self):
        slick,_=select_hair(self.original,'Slick');result,proof=body.refine_gi_body(slick,'standing_stance','Slick')
        self.assertIs(result,slick);self.assertFalse(proof['applied']);self.assertEqual(proof['selectedHair'],'Slick')
        with self.assertRaisesRegex(ValueError,'Unreviewed hair style'):body.refine_gi_body(self.accepted,'standing_stance','Other')

    def test_runtime_has_no_engine_numpy_or_ignored_file_dependency(self):
        tree=ast.parse(Path(body.__file__).read_text());imports=[]
        for node in ast.walk(tree):
            if isinstance(node,ast.Import):imports.extend(x.name for x in node.names)
            elif isinstance(node,ast.ImportFrom):imports.append(node.module)
        self.assertTrue(set(imports)<= {'copy','hashlib','json','math','struct','pilot_look'})
        self.assertNotIn('numpy',sys.modules)

if __name__=='__main__':unittest.main()
