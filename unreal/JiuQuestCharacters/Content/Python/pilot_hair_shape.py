"""One bounded subdivision of six primary Slick locks in an import derivative.

Original vertices, scalp, side/rear locks, skinning and motion remain exact.
New edge samples curve at most 2 mm from the original linear triangle surface.
"""
import copy
import hashlib
import json
import math
import struct
from pilot_hair import require, dot, cross, unit
from pilot_look import MeshFile, rigid_frame


def add(a,b): return tuple(x+y for x,y in zip(a,b))
def sub(a,b): return tuple(x-y for x,y in zip(a,b))
def mul(a,s): return tuple(x*s for x in a)


def closest(p,a,b,c):
    """Closest point on a triangle, including its boundary regions."""
    ab,ac,ap = sub(b,a),sub(c,a),sub(p,a)
    d1,d2 = dot(ab,ap),dot(ac,ap)
    if d1 <= 0 and d2 <= 0: return a
    bp = sub(p,b); d3,d4 = dot(ab,bp),dot(ac,bp)
    if d3 >= 0 and d4 <= d3: return b
    vc = d1*d4-d3*d2
    if vc <= 0 and d1 >= 0 and d3 <= 0: return add(a,mul(ab,d1/(d1-d3)))
    cp = sub(p,c); d5,d6 = dot(ab,cp),dot(ac,cp)
    if d6 >= 0 and d5 <= d6: return c
    vb = d5*d2-d1*d6
    if vb <= 0 and d2 >= 0 and d6 <= 0: return add(a,mul(ac,d2/(d2-d6)))
    va = d3*d6-d5*d4
    if va <= 0 and d4-d3 >= 0 and d5-d6 >= 0:
        return add(b,mul(sub(c,b),(d4-d3)/((d4-d3)+(d5-d6))))
    inverse = 1./(va+vb+vc)
    return add(a,add(mul(ab,vb*inverse),mul(ac,vc*inverse)))


def clearance(point, triangles):
    nearest = min(((dot(sub(point,q),sub(point,q)),q,n) for a,b,c,n in triangles
                   for q in (closest(point,a,b,c),)), key=lambda x:x[0])
    return dot(sub(point,nearest[1]),nearest[2]),nearest[2]


def shape(values, indices, canonical, head_joint):
    p,n,t,uv,joints,weights = (values[k] for k in ('POSITION','NORMAL','TANGENT','TEXCOORD_0','JOINTS_0','WEIGHTS_0'))
    require(all(sum(w for j,w in zip(js,ws) if j == head_joint) == 1. and sum(ws) == 1.
                for js,ws in zip(joints,weights)), 'Primary hair must be fully Head weighted')
    keys = list(dict.fromkeys(p)); key_index = {q:i for i,q in enumerate(keys)}
    weld = [key_index[q] for q in p]; parent = list(range(len(keys)))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]; i = parent[i]
        return i
    faces = [tuple(indices[i:i+3]) for i in range(0,len(indices),3)]
    for face in faces:
        for i in face[1:]: parent[find(weld[i])] = find(weld[face[0]])
    components = {}
    for i,k in enumerate(weld): components.setdefault(find(k),[]).append(i)
    require(len(components) == 20, 'Expected scalp plus nineteen original Slick lock islands')
    selected, rings = set(),{}
    scalp = []
    for component,ids in components.items():
        count = len({weld[i] for i in ids})
        if count == 288:
            scalp.append(component); continue
        roots = [i for i in ids if abs(uv[i][1]-1.) < 1e-6]
        if count != 24 or not roots: continue
        center = tuple(sum(canonical[i][axis] for i in roots)/len(roots) for axis in range(3))
        if not (-.115 < center[1] < -.075 and 1.69 < center[2] < 1.75): continue
        selected.add(component)
        for i in ids:
            row = (1.-uv[i][1])*3.; column = uv[i][0]*6.
            if abs(row-round(row)) < 1e-5 and abs(column-round(column)) < 1e-5:
                label = (round(row),round(column)%6)
                require(weld[i] not in rings or rings[weld[i]] == label,'Ambiguous primary lock UV grid')
                rings[weld[i]] = label
        require(len({weld[i] for i in ids if weld[i] in rings}) == 24,'Incomplete four-by-six primary lock grid')
    require(len(scalp) == 1 and len(selected) == 6,'Expected exactly six primary front/crown locks')
    scalp_triangles = []
    chosen_faces = set(); side_faces = set(); sums = {}; edge_heights = {}
    for f,face in enumerate(faces):
        component = find(weld[face[0]])
        if component == scalp[0]:
            a,b,c = (p[i] for i in face); normal = unit(cross(sub(b,a),sub(c,a)))
            if dot(normal,tuple(sum(n[i][k] for i in face) for k in range(3))) < 0: normal = mul(normal,-1.)
            scalp_triangles.append((a,b,c,normal))
        if component not in selected: continue
        chosen_faces.add(f)
        a,b,c = (p[i] for i in face)
        area2 = math.sqrt(dot(cross(sub(b,a),sub(c,a)),cross(sub(b,a),sub(c,a))))
        for k,i in enumerate(face):
            j = face[(k+1)%3]; edge = tuple(sorted((weld[i],weld[j])))
            height = area2/math.dist(p[i],p[j])
            edge_heights[edge] = min(edge_heights.get(edge,float('inf')),height)
        rows = {rings[weld[i]][0] for i in face}
        if len(rows) == 1 and next(iter(rows)) in (0,3): continue
        side_faces.add(f)
        a,b,c = (p[i] for i in face); normal = unit(cross(sub(b,a),sub(c,a)))
        for k,i in enumerate(face):
            angle = math.acos(max(-1.,min(1.,dot(unit(sub(p[face[(k+1)%3]],p[i])),unit(sub(p[face[(k+2)%3]],p[i]))))))
            sums[weld[i]] = add(sums.get(weld[i],(0.,0.,0.)),mul(normal,angle))
    smooth = {i:unit(total) for i,total in sums.items()}
    output = {k:list(v) for k,v in values.items()}; output_indices = []
    midpoint_position = {}; midpoint_export = {}; bounds = []; output_selected = []
    def midpoint(a,b):
        wa,wb = weld[a],weld[b]; edge = tuple(sorted((wa,wb)))
        export_edge = tuple(sorted((a,b)))
        if export_edge in midpoint_export: return midpoint_export[export_edge]
        linear = mul(add(p[a],p[b]),.5)
        if edge not in midpoint_position:
            ra,ca = rings[wa]; rb,cb = rings[wb]
            limit = .002
            if ra == rb == 3: limit = 0.
            if ra == rb == 0:
                # Root lower perimeter and cap diagonals retain their original
                # line exactly. Only the three upper perimeter edges may bevel.
                upper = frozenset((ca,cb)) in (frozenset((0,1)),frozenset((1,2)),frozenset((2,3)))
                limit = .0015 if upper else 0.
            upper_root = ra == rb == 0 and limit > 0.
            # Tiny taper/cap triangles cannot safely accept a full 2 mm bend.
            limit = min(limit,.15*edge_heights[edge])
            delta = mul(add(mul(smooth[wa],dot(sub(p[b],p[a]),smooth[wa])),
                            mul(smooth[wb],dot(sub(p[a],p[b]),smooth[wb]))),-.125)
            length = math.sqrt(dot(delta,delta))
            if length > limit: delta = mul(delta,limit/length)
            candidate = add(linear,delta)
            base,_ = clearance(linear,scalp_triangles)
            # Do not push locks deeper through the unchanged scalp shell.
            # Existing buried roots are retained rather than lifted wholesale.
            actual,_ = clearance(candidate,scalp_triangles)
            if actual < base-1e-7:
                candidate = linear
            midpoint_position[edge] = candidate
            bounds.append({'deviationMeters':math.dist(candidate,linear),'limitMeters':limit,'upperRoot':upper_root,
                           'clearanceChangeMeters':clearance(candidate,scalp_triangles)[0]-base})
        index = len(output['POSITION']); midpoint_export[export_edge] = index
        output['POSITION'].append(midpoint_position[edge])
        output['TEXCOORD_0'].append(mul(add(uv[a],uv[b]),.5))
        require(joints[a] == joints[b] and weights[a] == weights[b],'Primary edge changes skinning')
        output['JOINTS_0'].append(joints[a]); output['WEIGHTS_0'].append(weights[a])
        average = add(n[a],n[b]); normal = unit(average) if dot(average,average)>1e-12 else n[a]
        output['NORMAL'].append(normal)
        output['TANGENT'].append(t[a])
        return index
    for f,(a,b,c) in enumerate(faces):
        if f not in chosen_faces:
            output_indices.extend((a,b,c)); continue
        ab,bc,ca = midpoint(a,b),midpoint(b,c),midpoint(c,a)
        for child in ((a,ab,ca),(ab,b,bc),(ca,bc,c),(ab,bc,ca)):
            old_normal = cross(sub(p[b],p[a]),sub(p[c],p[a]))
            q = output['POSITION']; new_normal = cross(sub(q[child[1]],q[child[0]]),sub(q[child[2]],q[child[0]]))
            require(dot(old_normal,new_normal)>0.,'Hair subdivision inverted a triangle')
            output_indices.extend(child); output_selected.append((child,f in side_faces))
    # Weld shading across UV copies on sides, but retain a distinct cap fan.
    sums = {}; selected_vertices = set(); domains = {}
    for face,side in output_selected:
        q = output['POSITION']; normal = cross(sub(q[face[1]],q[face[0]]),sub(q[face[2]],q[face[0]]))
        for i in face:
            key = (q[i],side); sums[key] = add(sums.get(key,(0.,0.,0.)),normal)
            domains.setdefault(i,set()).add(side); selected_vertices.add(i)
    for i in selected_vertices:
        require(len(domains[i]) == 1,'Cap/side UV split was unexpectedly merged')
        normal = unit(sums[(output['POSITION'][i],next(iter(domains[i])))])
        tangent = output['TANGENT'][i][:3]; tangent = sub(tangent,mul(normal,dot(normal,tangent)))
        if dot(tangent,tangent)<1e-12:
            axis = min(((1.,0.,0.),(0.,1.,0.),(0.,0.,1.)),key=lambda a:abs(dot(a,normal)))
            tangent = cross(axis,normal)
        output['NORMAL'][i] = normal
        output['TANGENT'][i] = unit(tangent)+(output['TANGENT'][i][3],)
    require(output['POSITION'][:len(p)] == p,'Original hair vertices moved')
    require(max(row['deviationMeters']-row['limitMeters'] for row in bounds)<1e-10,'Hair shape exceeded local bound')
    return output,output_indices,{'primaryLockCount':6,'originalVertices':len(p),'newVertices':len(output['POSITION'])-len(p),
        'originalTriangles':len(faces),'resultTriangles':len(output_indices)//3,'originalVerticesExact':True,
        'maximumDeviationMeters':max(r['deviationMeters'] for r in bounds),
        'maximumUpperRootDeviationMeters':max((r['deviationMeters'] for r in bounds if r['upperRoot']),default=0.),
        'minimumScalpClearanceChangeMeters':min(r['clearanceChangeMeters'] for r in bounds),
        'lowerRootAndTerminalEdgesExact':True,'unchangedTriangleCount':len(faces)-len(chosen_faces)}


def refine_hair_shape(raw):
    source = MeshFile(raw); doc = copy.deepcopy(source.doc); binary = bytearray(raw[source.start:])
    rows = []; handled = set()
    def append(values,width,code,component):
        binary.extend(b'\0' *((-len(binary))%4)); start = len(binary)
        for value in values: binary.extend(struct.pack('<'+code*width,*value))
        view = len(doc['bufferViews']); doc['bufferViews'].append({'buffer':0,'byteOffset':start,'byteLength':len(binary)-start})
        a = {'bufferView':view,'componentType':component,'count':len(values),'type':'SCALAR' if width==1 else 'VEC'+str(width)}
        index = len(doc['accessors']); doc['accessors'].append(a); return index
    for role in ('Attacker','Defender'):
        nodes = [n for n in doc['nodes'] if n.get('name') == 'JQ_'+role+'_HairSlick' and 'mesh' in n]
        require(len(nodes)==1,'Missing unique Slick attachment'); node = nodes[0]
        require(node['mesh'] not in handled,'Shared role meshes require separate shape review'); handled.add(node['mesh'])
        skin = doc['skins'][node['skin']]
        root = [i for i,j in enumerate(skin['joints']) if doc['nodes'][j]['name']=='root']
        head = [i for i,j in enumerate(skin['joints']) if doc['nodes'][j]['name']=='Head']
        require(len(root)==len(head)==1,'Missing root/Head binding')
        rotation,translation = rigid_frame(source.read(skin['inverseBindMatrices'])[root[0]])
        primitives = doc['meshes'][node['mesh']]['primitives']; require(len(primitives)==1,'Unexpected Slick primitives')
        primitive = primitives[0]; require(primitive.get('mode',4)==4 and not primitive.get('targets'),'Unexpected hair topology')
        attributes = primitive['attributes']; values = {k:source.read(v) for k,v in attributes.items()}
        require(set(values)=={'POSITION','NORMAL','TANGENT','TEXCOORD_0','JOINTS_0','WEIGHTS_0'},'Unexpected Slick attributes')
        canonical = [tuple(dot(row,p)+translation[k] for k,row in enumerate(rotation)) for p in values['POSITION']]
        shaped,indices,proof = shape(values,[i[0] for i in source.read(primitive['indices'])],canonical,head[0])
        for key,values in shaped.items():
            if key=='JOINTS_0': index = append(values,4,'H',5123)
            else: index = append(values,len(values[0]),'f',5126)
            attributes[key] = index
            if key=='POSITION':
                doc['accessors'][index].update(min=[min(p[i] for p in values) for i in range(3)],max=[max(p[i] for p in values) for i in range(3)])
        primitive['indices'] = append([(i,) for i in indices],1,'I',5125)
        rows.append({'role':role,'mesh':node['mesh'],**proof})
    doc['buffers'][0]['byteLength'] = len(binary)
    expected = copy.deepcopy(source.doc)
    for row in rows:
        expected['meshes'][row['mesh']]['primitives'][0] = doc['meshes'][row['mesh']]['primitives'][0]
    expected['accessors'] += doc['accessors'][len(source.doc['accessors']):]
    expected['bufferViews'] += doc['bufferViews'][len(source.doc['bufferViews']):]
    expected['buffers'][0]['byteLength'] = len(binary)
    require(doc==expected,'Non-hair JSON changed'); require(binary[:len(raw)-source.start]==raw[source.start:],'Original binary changed')
    encoded = json.dumps(doc,separators=(',',':')).encode(); encoded += b' '*((-len(encoded))%4)
    binary.extend(b'\0' *((-len(binary))%4))
    result = struct.pack('<III',0x46546c67,2,28+len(encoded)+len(binary))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(binary),0x004e4942)+binary
    return bytes(result),{'sourceSha256':hashlib.sha256(raw).hexdigest(),'importSha256':hashlib.sha256(result).hexdigest(),
        'originalBinaryPrefixUnchanged':True,'otherMeshesRigAndMotionExact':True,'roles':rows,
        'scope':'Six primary Slick lock edge samples only; original vertices/scalp/other locks retained; render pending'}
