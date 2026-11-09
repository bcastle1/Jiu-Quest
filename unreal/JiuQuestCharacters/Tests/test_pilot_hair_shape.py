"""Actual-source topology, interpolation and preservation checks; no renderer."""
import copy
import hashlib
import json
import math
import struct
from pathlib import Path
import sys
import unittest

PROJECT = Path(__file__).resolve().parents[1]
ROOT = PROJECT.parents[1]
sys.path.insert(0,str(PROJECT/'Content/Python'))
from pilot_source import select_hair
from pilot_hair import refine_hair, dot
from pilot_hair_shape import refine_hair_shape, refine_spikes_shape, closest, clump_relief, root_bevel, ScalpSurface
from pilot_look import MeshFile, rigid_frame


def fringe_attributes_digest(mesh, primitive, rotation, translation):
    """Find four refined front locks by connectivity and unchanged tip location."""
    values={k:mesh.read(v) for k,v in primitive['attributes'].items()}
    positions=values['POSITION'];indices=[v[0] for v in mesh.read(primitive['indices'])]
    neighbors={p:set() for p in positions}
    for k in range(0,len(indices),3):
        face=[positions[i] for i in indices[k:k+3]]
        for p in face:neighbors[p].update(face)
    unseen=set(neighbors);selected=set();count=0
    while unseen:
        pending=[unseen.pop()];island=set(pending)
        while pending:
            for p in neighbors[pending.pop()]:
                if p in unseen:unseen.remove(p);island.add(p);pending.append(p)
        ids=[i for i,p in enumerate(positions) if p in island]
        tips=[i for i in ids if values['TEXCOORD_0'][i][1]==0.]
        if len(island)<100 or not tips:continue
        y=sum(dot(rotation[1],positions[i])+translation[1] for i in tips)/len(tips)
        z=sum(dot(rotation[2],positions[i])+translation[2] for i in tips)/len(tips)
        if y<-.10 and z<1.70:selected.update(ids);count+=1
    assert count==4
    payload={key:[values[key][i] for i in sorted(selected)] for key in sorted(values)}
    return hashlib.sha256(json.dumps(payload,separators=(',',':')).encode()).hexdigest()


class HairShapeTests(unittest.TestCase):
    def test_spikes_three_clips_keep_caps_scalp_uv_weights_and_nonhair_exact(self):
        fringe_digests=[]
        for clip in ('standing_stance','rear_naked_choke','armbar'):
            with self.subTest(clip=clip):
                original=(ROOT/'public/animations/bjj'/f'{clip}.glb').read_bytes()
                raw,_=select_hair(original,'Spikes');raw,_=refine_hair(raw,'Spikes')
                result,proof=refine_spikes_shape(raw)
                old,new=MeshFile(raw),MeshFile(result)
                self.assertEqual(result[new.start:new.start+len(raw)-old.start],raw[old.start:])
                expected=copy.deepcopy(old.doc)
                for row in proof['roles']:
                    a=old.doc['meshes'][row['mesh']]['primitives'][0]
                    b=new.doc['meshes'][row['mesh']]['primitives'][0]
                    expected['meshes'][row['mesh']]['primitives'][0]=b
                    before={k:old.read(v) for k,v in a['attributes'].items()}
                    after={k:new.read(v) for k,v in b['attributes'].items()}
                    count=len(before['POSITION'])
                    self.assertEqual(count,1775)
                    self.assertEqual(row['primaryLockCount'],9)
                    self.assertEqual((row['crownLocks'],row['fringeLocks']),(5,4))
                    self.assertEqual(row['unchangedTriangleCount'],1012)
                    self.assertEqual(row['originalClosedEdges'],594)
                    self.assertEqual(row['finalClosedEdges'],9504)
                    self.assertLessEqual(row['maximumTotalSourceDeviationMeters'],.009)
                    self.assertEqual(row['crownSourceEnvelopeMeters'],.009)
                    self.assertTrue(row['profileAuthoredBeforeSubdivision'])
                    self.assertLessEqual(row['maximumAuthoredCrownDisplacementMeters'],.0081)
                    self.assertLessEqual(row['maximumRefinementFromAuthoredMeters'],.005000001)
                    self.assertGreaterEqual(row['authoredSourceTriangleAreaMinimum'],.65)
                    self.assertGreaterEqual(row['authoredSourceTriangleNormalDotMinimum'],.75)
                    self.assertEqual(row['checkedAuthoredTrianglePoints'],9900)
                    self.assertGreaterEqual(row['minimumAuthoredTrianglePointMarginMeters'],-2e-6)
                    self.assertGreater(row['maximumTotalSourceDeviationMeters'],.007)
                    actual_source_movement=max(math.dist(a,b) for a,b in zip(before['POSITION'],after['POSITION'][:count]))
                    self.assertGreater(actual_source_movement,.007)
                    self.assertLessEqual(actual_source_movement,.0090002)
                    self.assertAlmostEqual(actual_source_movement,row['maximumAuthoredCrownDisplacementMeters'],places=6)
                    self.assertGreaterEqual(row['minimumSourceChildAreaRatio'],.65)
                    self.assertGreaterEqual(row['minimumSourceChildNormalDot'],.75)
                    self.assertGreaterEqual(row['minimumCentroidClearanceMarginMeters'],-2e-6)
                    self.assertEqual(row['checkedTriangleCentroids'],6336)
                    self.assertEqual(row['taperedCrownLocks'],5)
                    self.assertEqual(row['checkedCrownTriangleCentroids'],3520)
                    self.assertGreaterEqual(row['minimumCrownCentroidClearanceMarginMeters'],-2e-6)
                    self.assertGreaterEqual(row['minimumCrownVertexClearanceMarginMeters'],0.)
                    for key in ('TEXCOORD_0','JOINTS_0','WEIGHTS_0'):
                        self.assertEqual(after[key][:count],before[key])
                    # Independently find islands and cap copies by source geometry.
                    idx=[v[0] for v in old.read(a['indices'])]
                    neighbors={p:set() for p in before['POSITION']}
                    for k in range(0,len(idx),3):
                        face=[before['POSITION'][i] for i in idx[k:k+3]]
                        for p in face:neighbors[p].update(face)
                    unseen=set(neighbors);islands=[]
                    while unseen:
                        pending=[unseen.pop()];island=set(pending)
                        while pending:
                            for p in neighbors[pending.pop()]:
                                if p in unseen:unseen.remove(p);island.add(p);pending.append(p)
                        islands.append(island)
                    self.assertEqual(len(islands),23)
                    node=next(n for n in old.doc['nodes'] if n.get('name')=='JQ_'+row['role']+'_HairSpikes')
                    skin=old.doc['skins'][node['skin']]
                    root=next(i for i,j in enumerate(skin['joints']) if old.doc['nodes'][j]['name']=='root')
                    rotation,translation=rigid_frame(old.read(skin['inverseBindMatrices'])[root])
                    fringe_digests.append(fringe_attributes_digest(new,b,rotation,translation))
                    protected_islands=0;shoulder_reductions=[]
                    for island in islands:
                        ids=[i for i,p in enumerate(before['POSITION']) if p in island]
                        roots=[i for i in ids if before['TEXCOORD_0'][i][1]==1.]
                        primary=len(island)==24 and roots and sum(dot(rotation[1],before['POSITION'][i])+translation[1] for i in roots)/len(roots)<0.
                        if not primary:
                            protected_islands+=1
                            for key in before:
                                self.assertEqual([after[key][i] for i in ids],[before[key][i] for i in ids])
                        else:
                            tips=[i for i in ids if before['TEXCOORD_0'][i][1]==0.]
                            if sum(dot(rotation[1],before['POSITION'][i])+translation[1] for i in tips)/len(tips)>.03:
                                # Independently measure the actual first raised
                                # ring: this must taper visibly, not just report
                                # a nonzero field somewhere inside the lock.
                                corners=[]
                                for u in (0.,.5):
                                    corners.append(next(i for i in ids if abs(before['TEXCOORD_0'][i][1]-2./3.)<1e-6 and before['TEXCOORD_0'][i][0]==u))
                                a0,b0=corners
                                reduction=math.dist(before['POSITION'][a0],before['POSITION'][b0])-math.dist(after['POSITION'][a0],after['POSITION'][b0])
                                self.assertGreater(reduction,.009)
                                self.assertLess(reduction,.016)
                                shoulder_reductions.append(reduction)
                            endpoints={before['POSITION'][i] for i in ids if before['TEXCOORD_0'][i][1] in (0.,1.)}
                            for i in ids:
                                if before['POSITION'][i] in endpoints:
                                    self.assertEqual(after['POSITION'][i],before['POSITION'][i])
                    self.assertEqual(protected_islands,14)
                    self.assertEqual(len(shoulder_reductions),5)
                    self.assertGreater(max(shoulder_reductions)-min(shoulder_reductions),.004)
                    # Cap/side duplicates still share positions after shaping.
                    seen={}
                    for p,q in zip(before['POSITION'],after['POSITION'][:count]):
                        if p in seen:self.assertEqual(seen[p],q)
                        seen[p]=q
                    uv_samples=set()
                    for k in range(0,len(idx),3):
                        triangle=[before['TEXCOORD_0'][i] for i in idx[k:k+3]]
                        for wa in range(5):
                            for wb in range(5-wa):
                                value=tuple((wa*triangle[0][axis]+wb*triangle[1][axis]+(4-wa-wb)*triangle[2][axis])/4. for axis in range(2))
                                uv_samples.add(struct.unpack('<2f',struct.pack('<2f',*value)))
                    for uv in after['TEXCOORD_0'][count:]:self.assertIn(uv,uv_samples)
                    for normal,tangent in zip(after['NORMAL'][count:],after['TANGENT'][count:]):
                        self.assertAlmostEqual(dot(normal,normal),1.,places=6)
                        self.assertLess(abs(dot(normal,tangent[:3])),2e-6)
                    for js,ws in zip(after['JOINTS_0'],after['WEIGHTS_0']):
                        self.assertEqual(sum(ws),1.)
                        self.assertEqual(sum(w>0 for w in ws),1)
                    for key,operation in (('min',min),('max',max)):
                        self.assertEqual(new.doc['accessors'][b['attributes']['POSITION']][key],
                            [operation(p[axis] for p in after['POSITION']) for axis in range(3)])
                expected['accessors']+=new.doc['accessors'][len(old.doc['accessors']):]
                expected['bufferViews']+=new.doc['bufferViews'][len(old.doc['bufferViews']):]
                expected['buffers'][0]['byteLength']=new.doc['buffers'][0]['byteLength']
                self.assertEqual(new.doc,expected)
        # Golden attributes for all four accepted fringe locks, including their
        # new subdivided vertices and shading, from approved 7c15a18.
        self.assertEqual(hashlib.sha256(''.join(fringe_digests).encode()).hexdigest(),
                         'e56cd767a559ec829c42644c5467f9ad5c233e3fcc17c4122c768ea9d311aa9b')

    def test_spikes_rejects_repeat_and_cannot_use_slick_contract(self):
        raw,_=select_hair((ROOT/'public/animations/bjj/standing_stance.glb').read_bytes(),'Spikes')
        raw,_=refine_hair(raw,'Spikes')
        with self.assertRaisesRegex(ValueError,'Slick attachment'):refine_hair_shape(raw)
        shaped,_=refine_spikes_shape(raw)
        with self.assertRaisesRegex(ValueError,'original Spikes topology'):refine_spikes_shape(shaped)

    def test_all_three_clips_preserve_protected_hair_motion_and_other_meshes(self):
        for clip in ('standing_stance','rear_naked_choke','armbar'):
            with self.subTest(clip=clip):
                original = (ROOT/'public/animations/bjj'/f'{clip}.glb').read_bytes()
                selected,_ = select_hair(original); raw,_ = refine_hair(selected)
                derived,proof = refine_hair_shape(raw)
                old,new = MeshFile(raw),MeshFile(derived)
                self.assertEqual(derived[new.start:new.start+len(raw)-old.start],raw[old.start:])
                expected = copy.deepcopy(old.doc)
                for row in proof['roles']:
                    a = old.doc['meshes'][row['mesh']]['primitives'][0]
                    b = new.doc['meshes'][row['mesh']]['primitives'][0]
                    expected['meshes'][row['mesh']]['primitives'][0]['attributes'] = b['attributes']
                    expected['meshes'][row['mesh']]['primitives'][0]['indices'] = b['indices']
                    old_values = {k:old.read(v) for k,v in a['attributes'].items()}
                    new_values = {k:new.read(v) for k,v in b['attributes'].items()}
                    count = row['originalVertices']
                    for key in ('TEXCOORD_0','JOINTS_0','WEIGHTS_0'):
                        self.assertEqual(new_values[key][:count],old_values[key])
                    seam_positions={}
                    for before,after in zip(old_values['POSITION'],new_values['POSITION'][:count]):
                        if before in seam_positions:
                            self.assertEqual(after,seam_positions[before],'Cap/side UV copies must remain welded')
                        seam_positions[before]=after
                    self.assertLessEqual(max(math.dist(a,b) for a,b in zip(old_values['POSITION'],new_values['POSITION'][:count])),.0050001)
                    self.assertGreater(row['movedOriginalPrimaryVertices'],0)
                    self.assertEqual(row['primaryLockCount'],6)
                    self.assertEqual(row['unchangedTriangleCount'],1012)
                    self.assertLessEqual(row['maximumDeviationMeters'],.002000001)
                    self.assertLessEqual(row['maximumUpperRootDeviationMeters'],.001500001)
                    self.assertGreaterEqual(row['minimumScalpClearanceChangeMeters'],-1e-7)
                    self.assertTrue(row['lowerRootAndTerminalEdgesExact'])
                    self.assertEqual(row['subClumpsPerPrimaryLock'],2)
                    self.assertLessEqual(row['maximumClumpReliefMeters'],.0018)
                    self.assertLessEqual(row['maximumTotalSourceDeviationMeters'],.005000001)
                    self.assertGreater(row['maximumRootBevelMeters'],.0035)
                    self.assertGreater(row['checkedRootBevelPositions'],100)
                    self.assertGreaterEqual(row['minimumRootBevelClearanceMarginMeters'],-1e-7)
                    self.assertGreaterEqual(row['minimumBevelChildTriangleAreaRatio'],.50)
                    self.assertGreaterEqual(row['minimumBevelChildTriangleNormalDot'],.50)
                    self.assertGreater(row['checkedTriangleCentroids'],4000)
                    self.assertGreaterEqual(row['minimumCentroidClearanceMarginMeters'],-2e-6)
                    self.assertGreaterEqual(row['minimumVertexClearanceMarginMeters'],-1e-10)
                    for js,ws in zip(new_values['JOINTS_0'],new_values['WEIGHTS_0']):
                        self.assertEqual(sum(ws),1.)
                        self.assertEqual(sum(w>0 for w in ws),1)
                    # Find the scalp as the largest connected geometric island,
                    # independently of source vertex order or derivative labels.
                    indices = [x[0] for x in old.read(a['indices'])]
                    positions = old_values['POSITION']; neighbors = {p:set() for p in positions}
                    for k in range(0,len(indices),3):
                        triangle = [positions[i] for i in indices[k:k+3]]
                        for p in triangle: neighbors[p].update(triangle)
                    unseen = set(neighbors); islands = []
                    while unseen:
                        pending = [unseen.pop()]; island = set(pending)
                        while pending:
                            for q in neighbors[pending.pop()]:
                                if q in unseen: unseen.remove(q); island.add(q); pending.append(q)
                        islands.append(island)
                    scalp_positions = max(islands,key=len)
                    self.assertEqual(len(scalp_positions),288)
                    scalp = [i for i,p in enumerate(positions) if p in scalp_positions]
                    self.assertEqual(len(scalp),297)
                    for key in old_values:
                        self.assertEqual([new_values[key][i] for i in scalp],[old_values[key][i] for i in scalp])
                    node = next(n for n in old.doc['nodes'] if n.get('name')=='JQ_'+row['role']+'_HairSlick')
                    skin = old.doc['skins'][node['skin']]
                    root = next(i for i,j in enumerate(skin['joints']) if old.doc['nodes'][j]['name']=='root')
                    rotation,translation = rigid_frame(old.read(skin['inverseBindMatrices'])[root])
                    protected_islands = 0
                    for island in islands:
                        ids = [i for i,p in enumerate(positions) if p in island]
                        roots = [i for i in ids if abs(old_values['TEXCOORD_0'][i][1]-1.)<1e-6]
                        primary = len(island)==24 and roots and sum(dot(rotation[1],positions[i])+translation[1] for i in roots)/len(roots)<-.075
                        if not primary:
                            protected_islands+=1
                            for key in old_values:
                                self.assertEqual([new_values[key][i] for i in ids],[old_values[key][i] for i in ids])
                        else:
                            for i in ids:
                                # Cap copies share position with side endpoints.
                                # The upper root pair may bevel; its lower four
                                # corners and every tip corner remain exact.
                                endpoints=[old_values['TEXCOORD_0'][j] for j in ids if positions[i]==positions[j]
                                           and old_values['TEXCOORD_0'][j][1] in (0.,1.)]
                                if any(v==0. or (v==1. and round(u*6)%6 not in (1,2)) for u,v in endpoints):
                                    self.assertEqual(new_values['POSITION'][i],positions[i])
                                elif endpoints:
                                    self.assertGreater(math.dist(new_values['POSITION'][i],positions[i]),.0015)
                    self.assertEqual(protected_islands,14)
                    # New vertices must retain exact affine UV sampling across
                    # source triangle edges, including separate UV seam copies.
                    uv_samples = set()
                    for k in range(0,len(indices),3):
                        triangle = [old_values['TEXCOORD_0'][i] for i in indices[k:k+3]]
                        for wa in range(5):
                            for wb in range(5-wa):
                                wc=4-wa-wb
                                value=tuple((wa*triangle[0][axis]+wb*triangle[1][axis]+wc*triangle[2][axis])/4. for axis in range(2))
                                uv_samples.add(struct.unpack('<2f',struct.pack('<2f',*value)))
                    for uv in new_values['TEXCOORD_0'][count:]:
                        self.assertIn(uv,uv_samples)
                expected['accessors'] += new.doc['accessors'][len(old.doc['accessors']):]
                expected['bufferViews'] += new.doc['bufferViews'][len(old.doc['bufferViews']):]
                expected['buffers'][0]['byteLength'] = new.doc['buffers'][0]['byteLength']
                self.assertEqual(new.doc,expected)

    def test_triangle_clearance_projection_handles_face_edge_and_corner(self):
        a,b,c = (0.,0.,0.),(1.,0.,0.),(0.,1.,0.)
        self.assertLess(math.dist(closest((.2,.3,2.),a,b,c),(.2,.3,0.)),1e-12)
        self.assertEqual(closest((.5,-2.,1.),a,b,c),(.5,0.,0.))
        self.assertEqual(closest((-1.,-1.,1.),a,b,c),a)
        surface=ScalpSurface([(a,b,c,(0.,0.,1.))])
        self.assertAlmostEqual(surface.query((.2,.3,.004))[0],.004)
        self.assertAlmostEqual(surface.query((.2,.3,-.002))[0],-.002)

    def test_swept_channels_are_unequal_and_fade_before_protected_boundaries(self):
        for layer in range(6):
            for u,v in ((0.,.4),(1.,.4),(.2,0.),(.2,1.),(.7,.5)):
                self.assertEqual(clump_relief(u,v,layer),0.)
            self.assertGreater(clump_relief(.135,.4,layer),clump_relief(.247,.4,layer))
            self.assertGreater(clump_relief(.350,.4,layer),clump_relief(.247,.4,layer))
        samples=[clump_relief(.18,.45,i) for i in range(6)]
        self.assertGreater(max(samples)-min(samples),.0001)

    def test_repeat_subdivision_rejected_by_structural_inventory(self):
        raw,_ = select_hair((ROOT/'public/animations/bjj/standing_stance.glb').read_bytes())
        raw,_ = refine_hair(raw); result,_ = refine_hair_shape(raw)
        with self.assertRaisesRegex(ValueError,'six primary'):
            refine_hair_shape(result)

    def test_root_bevel_slopes_upper_front_and_preserves_lower_perimeter(self):
        inward,sweep=(0.,0.,-1.),(0.,1.,0.)
        for layer in range(6):
            self.assertEqual(root_bevel(0.,0.,layer,inward,sweep),(0.,0.,0.))
            self.assertEqual(root_bevel(.5,1.,layer,inward,sweep),(0.,0.,0.))
            root=root_bevel(0.,1.,layer,inward,sweep)
            shoulder=root_bevel(1./3.,1.,layer,inward,sweep)
            self.assertGreater(root[1],.0017)
            self.assertLess(root[2],-.0025)
            self.assertGreater(math.dist(root,(0.,0.,0.)),math.dist(shoulder,(0.,0.,0.)))
            # Nonlinear cross-section falloff curves the cap interior instead
            # of translating its entire original planar triangle rigidly.
            middle=root_bevel(0.,.5,layer,inward,sweep)
            self.assertGreater(middle[1],root[1]*.5)


if __name__=='__main__': unittest.main()
