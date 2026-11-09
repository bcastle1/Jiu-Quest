"""Bounded style-specific Slick and Spikes sub-clumps in import derivatives.

Scalp, side/rear locks, lower hairline, terminal tips, skinning and motion stay
exact. Crown profiles are authored before detail; the accepted fringe is retained.
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
    if isinstance(triangles, ScalpSurface):
        return triangles.query(point)
    nearest = min(((dot(sub(point,q),sub(point,q)),q,n) for a,b,c,n in triangles
                   for q in (closest(point,a,b,c),)), key=lambda x:x[0])
    return dot(sub(point,nearest[1]),nearest[2]),nearest[2]


class ScalpSurface:
    """Exact triangle queries with bounding-box pruning; no external dependency."""
    def __init__(self, triangles):
        def build(items):
            low = tuple(min(p[k] for t in items for p in t[:3]) for k in range(3))
            high = tuple(max(p[k] for t in items for p in t[:3]) for k in range(3))
            if len(items) <= 8: return (low, high, items, None)
            axis = max(range(3),key=lambda k:high[k]-low[k])
            items = sorted(items,key=lambda t:sum(p[axis] for p in t[:3]))
            middle = len(items)//2
            return (low,high,None,(build(items[:middle]),build(items[middle:])))
        self.root = build(triangles)

    def query(self, point):
        best = [float('inf'),None,None]
        def box_distance(node):
            return sum(max(node[0][k]-point[k],0.,point[k]-node[1][k])**2 for k in range(3))
        def visit(node):
            if box_distance(node) > best[0]: return
            if node[2] is not None:
                for a,b,c,n in node[2]:
                    q = closest(point,a,b,c); squared = dot(sub(point,q),sub(point,q))
                    if squared < best[0]: best[:] = squared,q,n
            else:
                for child in sorted(node[3],key=box_distance): visit(child)
        visit(self.root)
        return dot(sub(point,best[1]),best[2]),best[2]


def clump_relief(u, longitudinal, layer):
    """Two unequal swept lobes and a shallow channel, in meters, on upper sides."""
    def smooth(a,b,x):
        x = max(0.,min(1.,(x-a)/(b-a))); return x*x*(3.-2.*x)
    support = smooth(.025,.13,longitudinal)*(1.-smooth(.81,.95,longitudinal))
    support *= smooth(.015,.065,u)*(1.-smooth(.435,.495,u))
    drift = .018*math.sin(longitudinal*math.pi+layer*.77)
    first = .135 + drift + .008*math.sin(layer*1.8)
    second = .350 + drift*.55 - .012*math.cos(layer*1.3)
    width = .054+.008*(.5+.5*math.sin(layer*1.4))
    lobes = .0019*math.exp(-((u-first)/width)**2)
    lobes += .00115*math.exp(-((u-second)/.080)**2)
    channel = .00055*math.exp(-((u-(.247+drift))/.027)**2)
    value = (lobes-channel-.00115)*support*(.91+.09*math.sin(layer*1.7+.5))
    return max(-.0018,min(.0012,value))


def root_bevel(longitudinal, upper, layer, inward, sweep):
    """Roll the upper front cap into the sweep; retain its lower perimeter."""
    fade = max(0., min(1., (longitudinal-.06)/.42))
    fade = 1.-fade*fade*(3.-2.*fade)
    crown = math.sin(math.pi*.5*max(0.,min(1.,upper)))**1.4
    strength = fade*crown*(.93+.07*math.sin(layer*1.37+.4))
    return mul(add(mul(inward,.0030),mul(sweep,.0020)),strength)


def finer_clumps(output, selected_faces, reference, layers, scalp, bevel_parameters, bevel_frames, exposed_only=False):
    """Second linear subdivision, followed by a continuous bounded side field."""
    midpoint_cache = {}; refined = []; original_count = len(output['POSITION'])
    def midpoint(a,b):
        key = tuple(sorted((a,b)))
        if key in midpoint_cache: return midpoint_cache[key]
        i = len(output['POSITION']); midpoint_cache[key] = i
        for name in ('POSITION','TEXCOORD_0','NORMAL'):
            output[name].append(mul(add(output[name][a],output[name][b]),.5))
        for name in ('JOINTS_0','WEIGHTS_0'):
            require(output[name][a] == output[name][b],'Sub-clump edge changes skinning')
            output[name].append(output[name][a])
        output['TANGENT'].append(output['TANGENT'][a])
        reference.append(mul(add(reference[a],reference[b]),.5))
        bevel_parameters.append(mul(add(bevel_parameters[a],bevel_parameters[b]),.5))
        require(layers[a] == layers[b],'Sub-clump edge crosses lock islands')
        layers.append(layers[a])
        return i
    for (a,b,c),side in selected_faces:
        ab,bc,ca = midpoint(a,b),midpoint(b,c),midpoint(c,a)
        refined.extend((face,side) for face in ((a,ab,ca),(ab,b,bc),(ca,bc,c),(ab,bc,ca)))
    before = list(output['POSITION']); surface_normals = {}; parameters = {}; detail_limits = {}
    for face,side in refined:
        if not side: continue
        a,b,c = (before[i] for i in face); normal = cross(sub(b,a),sub(c,a))
        if exposed_only:
            area2 = math.sqrt(dot(normal,normal))
            for corner,i in enumerate(face):
                height = area2/math.dist(before[face[(corner+1)%3]],before[face[(corner+2)%3]])
                key = before[i]
                detail_limits[key] = min(detail_limits.get(key,float('inf')),.12*height)
        for i in face:
            key = before[i]; surface_normals[key] = add(surface_normals.get(key,(0.,0.,0.)),normal)
            u,v = output['TEXCOORD_0'][i]
            if u >= 1.-1e-6: u = 0.
            parameter = (u,1.-v,layers[i])
            if key in parameters:
                require(max(abs(x-y) for x,y in zip(parameters[key],parameter))<1e-5,'Sub-clump UV seam drift')
            parameters[key] = parameter
    moved = {}; checked = []; maximum_detail = 0.
    for key,parameter in parameters.items():
        amount = clump_relief(*parameter)
        if exposed_only:
            base,_ = clearance(key,scalp)
            reserve = max(0.,min(1.,(base-.006)/.006))
            amount *= reserve*reserve*(3.-2.*reserve)
            amount = max(-detail_limits[key],min(detail_limits[key],amount))
        if abs(amount)<1e-12: moved[key]=key; continue
        direction = unit(surface_normals[key]); delta = mul(direction,amount)
        base,_ = clearance(key,scalp)
        # An exposed crown can settle closer while retaining a 3 mm shell gap.
        # Existing near/buried anchors may never move farther into the scalp.
        minimum = min(base,.003)
        candidate = add(key,delta); observed,_ = clearance(candidate,scalp)
        if observed < minimum:
            low,high = 0.,1.
            for _ in range(10):
                middle = (low+high)*.5
                if clearance(add(key,mul(delta,middle)),scalp)[0] >= minimum: low=middle
                else: high=middle
            candidate = add(key,mul(delta,low)); observed,_ = clearance(candidate,scalp)
        require(observed>=minimum-1e-10,'Sub-clump scalp clearance failed')
        moved[key] = candidate; maximum_detail=max(maximum_detail,math.dist(key,candidate))
        checked.append(observed-minimum)
    for i,position in enumerate(before):
        if position in moved: output['POSITION'][i] = moved[position]
    # Cap UVs are a separate disc, so carry geometric cross-section coordinates
    # through both subdivisions. Coincident cap/side copies receive one result.
    before_bevel=list(output['POSITION'])
    bevel_positions = {}; bevel_checks = []; maximum_bevel = 0.
    for i in {i for face,_ in refined for i in face}:
        key = before[i]
        if key in bevel_positions:
            output['POSITION'][i] = bevel_positions[key]; continue
        longitudinal,upper = bevel_parameters[i]
        delta = root_bevel(longitudinal,upper,layers[i],*bevel_frames[layers[i]])
        current = output['POSITION'][i]
        if dot(delta,delta)<1e-24:
            bevel_positions[key] = current; continue
        base,_ = clearance(reference[i],scalp); minimum = min(base,.003)
        # Fade the roll before the tight transition into the covered scalp.
        # Vertex-only clipping can leave an interpolated triangle below the
        # clearance floor even when all three corners pass independently.
        reserve=max(0.,min(1.,(base-.006)/.006))
        delta=mul(delta,reserve*reserve*(3.-2.*reserve))
        candidate = add(current,delta)
        total = sub(candidate,reference[i]); length = math.sqrt(dot(total,total))
        if length>.005: candidate=add(reference[i],mul(total,.005/length))
        delta = sub(candidate,current)
        if clearance(candidate,scalp)[0]<minimum:
            low,high = 0.,1.
            for _ in range(12):
                middle = (low+high)*.5
                if clearance(add(current,mul(delta,middle)),scalp)[0]>=minimum: low=middle
                else: high=middle
            candidate=add(current,mul(delta,low))
        margin=clearance(candidate,scalp)[0]-minimum
        require(margin>=-1e-7,'Root bevel crossed scalp clearance floor')
        bevel_checks.append(margin); maximum_bevel=max(maximum_bevel,math.dist(candidate,current))
        output['POSITION'][i]=candidate; bevel_positions[key]=candidate
    max_total = 0.; centroid_count = 0; minimum_centroid_margin = float('inf')
    minimum_area_ratio=1.; minimum_normal_dot=1.
    for face,_ in refined:
        a,b,c = (output['POSITION'][i] for i in face)
        ra,rb,rc = (reference[i] for i in face)
        old_cross=cross(sub(rb,ra),sub(rc,ra)); new_cross=cross(sub(b,a),sub(c,a))
        require(dot(old_cross,new_cross)>0.,'Sub-clump inverted a triangle')
        ba,bb,bc=(before_bevel[i] for i in face)
        bevel_cross=cross(sub(bb,ba),sub(bc,ba))
        area_ratio=math.sqrt(dot(new_cross,new_cross)/dot(bevel_cross,bevel_cross))
        normal_dot=dot(unit(bevel_cross),unit(new_cross))
        minimum_area_ratio=min(minimum_area_ratio,area_ratio); minimum_normal_dot=min(minimum_normal_dot,normal_dot)
        require(area_ratio>=.50 and normal_dot>=.50,
                f'Root bevel excessively compressed or tilted child {face}: area={area_ratio:.6f}, normal={normal_dot:.6f}, t={[bevel_parameters[i][0] for i in face]}')
        for i in face: max_total=max(max_total,math.dist(output['POSITION'][i],reference[i]))
        # Sample triangle interiors as well as the displaced vertices. Original
        # buried overlaps are permitted, but no deeper/new penetration is added.
        centroid = mul(add(add(a,b),c),1./3.); original = mul(add(add(ra,rb),rc),1./3.)
        base,_ = clearance(original,scalp); actual,_ = clearance(centroid,scalp)
        minimum = .003 if base>=.003 else min(base,0.)
        require(actual>=minimum-2e-6,
                f'Sub-clump triangle crosses scalp clearance floor: actual={actual}, minimum={minimum}, original={base}, beforeBevel={clearance(mul(add(add(ba,bb),bc),1./3.),scalp)[0]}, t={[bevel_parameters[i][0] for i in face]}')
        minimum_centroid_margin=min(minimum_centroid_margin,actual-minimum); centroid_count+=1
    require(max_total<=.005000001,'Hair shape exceeds 5 mm source surface envelope')
    return refined,{'subClumpsPerPrimaryLock':2,'detailSubdivisionAddedVertices':len(output['POSITION'])-original_count,
        'maximumClumpReliefMeters':maximum_detail,'maximumTotalSourceDeviationMeters':max_total,
        'checkedDisplacedPositions':len(checked),'minimumVertexClearanceMarginMeters':min(checked,default=0.),
        'checkedTriangleCentroids':centroid_count,'minimumCentroidClearanceMarginMeters':minimum_centroid_margin,
        'checkedRootBevelPositions':len(bevel_checks),'maximumRootBevelMeters':maximum_bevel,
        'minimumRootBevelClearanceMarginMeters':min(bevel_checks,default=0.),
        'minimumBevelChildTriangleAreaRatio':minimum_area_ratio,'minimumBevelChildTriangleNormalDot':minimum_normal_dot}


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
    root_centers = {}
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
        root_centers[component] = center
        for i in ids:
            row = (1.-uv[i][1])*3.; column = uv[i][0]*6.
            if abs(row-round(row)) < 1e-5 and abs(column-round(column)) < 1e-5:
                label = (round(row),round(column)%6)
                require(weld[i] not in rings or rings[weld[i]] == label,'Ambiguous primary lock UV grid')
                rings[weld[i]] = label
        require(len({weld[i] for i in ids if weld[i] in rings}) == 24,'Incomplete four-by-six primary lock grid')
    require(len(scalp) == 1 and len(selected) == 6,'Expected exactly six primary front/crown locks')
    layer_numbers = {component:i for i,component in enumerate(sorted(selected,key=lambda c:root_centers[c][0]))}
    bevel_frames = {}
    for component,layer in layer_numbers.items():
        grid = {label:keys[w] for w,label in rings.items() if find(w)==component}
        center = lambda row: tuple(sum(grid[(row,c)][axis] for c in range(6))/6. for axis in range(3))
        sweep=unit(sub(center(1),center(0)))
        inward=sub(mul(add(grid[(0,4)],grid[(0,5)]),.5),mul(add(grid[(0,1)],grid[(0,2)]),.5))
        inward=unit(sub(inward,mul(sweep,dot(inward,sweep))))
        bevel_frames[layer]=(inward,sweep)
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
    scalp_triangles = ScalpSurface(scalp_triangles)
    output = {k:list(v) for k,v in values.items()}; output_indices = []
    reference = list(p); layers = [layer_numbers.get(find(weld[i]),-1) for i in range(len(p))]
    bevel_parameters = [(rings[w][0]/3.,1. if rings[w][1] in (1,2) else 0.) if w in rings else (1.,0.) for w in weld]
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
        reference.append(linear); layers.append(layers[a])
        bevel_parameters.append(mul(add(bevel_parameters[a],bevel_parameters[b]),.5))
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
    output_selected,detail_proof = finer_clumps(output,output_selected,reference,layers,scalp_triangles,bevel_parameters,bevel_frames)
    output_indices = [i for f,face in enumerate(faces) if f not in chosen_faces for i in face]
    output_indices.extend(i for face,side in output_selected for i in face)
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
    protected = [i for i in range(len(p)) if find(weld[i]) not in selected or rings[weld[i]][0]==3
                 or (rings[weld[i]][0]==0 and rings[weld[i]][1] not in (1,2))]
    require(all(output['POSITION'][i] == p[i] for i in protected),'Protected scalp/hairline/tip vertex moved')
    require(max(row['deviationMeters']-row['limitMeters'] for row in bounds)<1e-10,'Hair shape exceeded local bound')
    return output,output_indices,{'primaryLockCount':6,'originalVertices':len(p),'newVertices':len(output['POSITION'])-len(p),
        'originalTriangles':len(faces),'resultTriangles':len(output_indices)//3,
        'protectedOriginalVertices':len(protected),'protectedOriginalVerticesExact':True,
        'movedOriginalPrimaryVertices':sum(output['POSITION'][i]!=p[i] for i in range(len(p))),
        'maximumDeviationMeters':max(r['deviationMeters'] for r in bounds),
        'maximumUpperRootDeviationMeters':max((r['deviationMeters'] for r in bounds if r['upperRoot']),default=0.),
        'minimumScalpClearanceChangeMeters':min(r['clearanceChangeMeters'] for r in bounds),
        'lowerRootAndTerminalEdgesExact':True,'unchangedTriangleCount':len(faces)-len(chosen_faces),**detail_proof}


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
        'scope':'Six primary Slick locks with unequal swept sub-clumps; scalp/other locks/hairline/tips retained; render pending'}


def author_spikes_crowns(positions, normals, faces, components, crowns, root_centers, scalp_component, weld, rings, find, canonical_rotation):
    """Re-author exposed source rings before detail; preserve root/tip anchors."""
    scalp_triangles=[]
    for face in faces:
        if find(weld[face[0]])!=scalp_component:continue
        a,b,c=(positions[i] for i in face); normal=unit(cross(sub(b,a),sub(c,a)))
        if dot(normal,tuple(sum(normals[i][k] for i in face) for k in range(3)))<0:normal=mul(normal,-1.)
        scalp_triangles.append((a,b,c,normal))
    scalp=ScalpSurface(scalp_triangles);output=list(positions);widths=[];displacements=[];vertex_margins=[]
    for order,component in enumerate(sorted(crowns,key=lambda c:root_centers[c][0])):
        ids=components[component];grid={rings[weld[i]]:positions[i] for i in ids};moves={}
        for row in (1,2):
            center=mul(add(grid[(row,0)],grid[(row,3)]),.5)
            across=unit(sub(grid[(row,0)],grid[(row,3)]))
            raised=sub(grid[(row,1)],center);outward=unit(sub(raised,mul(across,dot(raised,across))))
            width=((.78,.72,.76,.74,.82) if row==1 else (.82,.78,.80,.76,.84))[order]
            depth=.92 if row==1 else .94
            for column in range(6):
                original=grid[(row,column)];relative=sub(original,center)
                delta=add(mul(across,dot(relative,across)*(width-1.)),
                          mul(outward,dot(relative,outward)*(depth-1.)+(.003 if row==1 else 0.)))
                candidate=add(original,delta)
                # Lower the second raised ring; the terminal ring stays exact.
                # A level ridge beside that tip reads as a square upright cap.
                if row==2:
                    drop=(.0042,.0050,.0046,.0048,.0040)[order]
                    candidate=add(candidate,tuple(-canonical_rotation[2][axis]*drop for axis in range(3)))
                base,_=clearance(original,scalp)
                margin=clearance(candidate,scalp)[0]-min(base,.003)
                require(margin>=-1e-7,'Authored crown vertex crossed original scalp floor')
                moves[original]=candidate;displacements.append(math.dist(candidate,original));vertex_margins.append(margin)
        widths.append(math.dist(grid[(1,0)],grid[(1,3)])-math.dist(moves[grid[(1,0)]],moves[grid[(1,3)]]))
        for i in ids:
            if positions[i] in moves:output[i]=moves[positions[i]]
    minimum_area=minimum_normal=1.;margins=[]
    for face in faces:
        if find(weld[face[0]]) not in crowns:continue
        a,b,c=(positions[i] for i in face);x,y,z=(output[i] for i in face)
        before=cross(sub(b,a),sub(c,a));after=cross(sub(y,x),sub(z,x))
        area=math.sqrt(dot(after,after)/dot(before,before));normal=dot(unit(before),unit(after))
        require(area>=.65 and normal>=.75,'Authored crown compressed or tilted a source triangle')
        minimum_area=min(minimum_area,area);minimum_normal=min(minimum_normal,normal)
        for ia in range(9):
            for ib in range(9-ia):
                weights=(ia/8.,ib/8.,(8-ia-ib)/8.)
                original=tuple(sum(positions[i][axis]*w for i,w in zip(face,weights)) for axis in range(3))
                candidate=tuple(sum(output[i][axis]*w for i,w in zip(face,weights)) for axis in range(3))
                base,_=clearance(original,scalp);minimum=.003 if base>=.003 else min(base,0.)
                margin=clearance(candidate,scalp)[0]-minimum
                require(margin>=-2e-6,'Authored crown transition crossed original scalp floor')
                margins.append(margin)
    require(max(displacements)<=.0081,'Authored crown source-ring movement exceeds 8.1 mm')
    return output,{'taperedCrownLocks':5,'profileAuthoredBeforeSubdivision':True,
        'maximumAuthoredCrownDisplacementMeters':max(displacements),
        'upperShoulderDropMeters':[.0042,.0050,.0046,.0048,.0040],
        'crownShoulderWidthReductionsMeters':widths,'minimumAuthoredCrownVertexMarginMeters':min(vertex_margins),
        'authoredSourceTriangleAreaMinimum':minimum_area,'authoredSourceTriangleNormalDotMinimum':minimum_normal,
        'checkedAuthoredTrianglePoints':len(margins),'minimumAuthoredTrianglePointMarginMeters':min(margins)}


def linear_subdivision_reference(reference, faces):
    """Mirror index creation only, retaining the original barycentric source."""
    result=list(reference);seen=set()
    for (a,b,c),_ in faces:
        for i,j in ((a,b),(b,c),(c,a)):
            key=tuple(sorted((i,j)))
            if key in seen:continue
            seen.add(key);result.append(mul(add(reference[i],reference[j]),.5))
    return result


def crown_source_audit(output, faces, reference, layers, crown_layers, scalp):
    maximum=0.;margins=[];vertices={i for f,_ in faces if layers[f[0]] in crown_layers for i in f}
    for i in vertices:
        original=reference[i];candidate=output['POSITION'][i]
        maximum=max(maximum,math.dist(original,candidate))
        base,_=clearance(original,scalp);minimum=min(base,.003)
        margin=clearance(candidate,scalp)[0]-minimum
        require(margin>=-2e-6,'Refined crown vertex crossed original source clearance floor')
        margins.append(margin)
    centroid_margins=[]
    for face,_ in faces:
        if layers[face[0]] not in crown_layers:continue
        original=tuple(sum(reference[i][axis] for i in face)/3. for axis in range(3))
        candidate=tuple(sum(output['POSITION'][i][axis] for i in face)/3. for axis in range(3))
        base,_=clearance(original,scalp);minimum=.003 if base>=.003 else min(base,0.)
        margin=clearance(candidate,scalp)[0]-minimum
        require(margin>=-2e-6,'Refined crown interior crossed original source clearance floor')
        centroid_margins.append(margin)
    require(maximum<=.009000001,'Crown profile exceeds separate 9 mm source envelope')
    return {'maximumCrownTotalSourceDeviationMeters':maximum,'crownSourceEnvelopeMeters':.009,
        'checkedCrownPositions':len(vertices),'minimumCrownVertexClearanceMarginMeters':min(margins),
        'checkedCrownTriangleCentroids':len(centroid_margins),'minimumCrownCentroidClearanceMarginMeters':min(centroid_margins)}


def author_pointed_crown_taper(output, faces, reference, layers, target, rotation, scalp):
    """Thin one crown toward its existing tip, preserving all original anchors.

    Only three inserted upper rings move: their across width contracts, their
    sweep advances slightly, and their upper contour settles toward the tip.
    The contour must rise continuously to the unchanged terminal ring. Actual
    closeup and gameplay captures remain the visual acceptance gate.
    """
    positions=output['POSITION'];uv=output['TEXCOORD_0'];before=list(positions)
    vertices={i for face,side in faces if side and layers[face[0]]==target for i in face}
    centers={}
    for row in range(5):
        ring={before[i] for i in vertices if abs(uv[i][1]-row/12.)<1e-6}
        require(bool(ring),'Missing upper crown ring for pointed taper')
        centers[row]=tuple(sum(point[k] for point in ring)/len(ring) for k in range(3))
    sweep=unit(sub(centers[0],centers[4]))
    across=unit(sub(rotation[0],mul(sweep,dot(rotation[0],sweep))))
    settle_by_ring=(0.,1.,.8,.4,0.);moved={}
    for i in vertices:
        v=uv[i][1]
        # Float32 UV rounding must not displace either original shoulder.
        if i<1775 or not 0.<v<1./3.-1e-6:continue
        row=round(v*12.);support=math.sin(math.pi*row/4.)
        radius=sub(before[i],centers[row]);width_component=mul(across,dot(radius,across))
        delta=add(mul(width_component,-.15*support),mul(sweep,.0005*support))
        narrowed=add(before[i],delta)
        moved[before[i]]=add(narrowed,mul(rotation[2],-.00275*settle_by_ring[row]))
    for i in vertices:
        if before[i] in moved:positions[i]=moved[before[i]]
    changed={i for i in range(len(positions)) if positions[i]!=before[i]}
    require(len(changed)==84,'Expected 84 inserted vertices on one upper crown')
    require(all(i>=1775 and layers[i]==target and 0.<uv[i][1]<1./3.-1e-6 for i in changed),
            'Pointed taper changed a source anchor or another lock')
    maximum=max(math.dist(before[i],positions[i]) for i in changed)
    require(maximum<=.003,'Pointed crown taper exceeds its separate 3 mm local limit')
    # Audit the eventual stored float32 surface against the unchanged affine
    # ORIGINAL source correspondence, including edge/interior scalp samples.
    stored={i:struct.unpack('<3f',struct.pack('<3f',*positions[i])) for i in vertices}
    profile=[max(dot(rotation[2],stored[i]) for i in vertices if abs(uv[i][1]-row/12.)<1e-6)
             for row in range(5)]
    minimum_rise=min(a-b for a,b in zip(profile,profile[1:]))
    require(minimum_rise>0.,'Pointed crown contour must rise continuously toward its original tip')
    margins=[];minimum_area=minimum_normal=1.;checked_faces=0;source_maximum=0.
    for face,side in faces:
        if not changed.intersection(face):continue
        require(side and all(i in vertices for i in face),'Pointed taper crossed a cap or lock boundary')
        checked_faces+=1
        a,b,c=(reference[i] for i in face);old_cross=cross(sub(b,a),sub(c,a))
        a,b,c=(stored[i] for i in face);new_cross=cross(sub(b,a),sub(c,a))
        area=math.sqrt(dot(new_cross,new_cross)/dot(old_cross,old_cross))
        normal=dot(unit(old_cross),unit(new_cross))
        minimum_area=min(minimum_area,area);minimum_normal=min(minimum_normal,normal)
        require(area>=.65 and normal>=.75,'Pointed taper compressed or tilted a source child')
        source_maximum=max(source_maximum,max(math.dist(reference[i],stored[i]) for i in face))
        for wa in range(5):
            for wb in range(5-wa):
                weights=(wa/4.,wb/4.,(4-wa-wb)/4.)
                original=tuple(sum(reference[i][k]*w for i,w in zip(face,weights)) for k in range(3))
                candidate=tuple(sum(stored[i][k]*w for i,w in zip(face,weights)) for k in range(3))
                base,_=clearance(original,scalp);floor=.003 if base>=.003 else min(base,0.)
                margin=clearance(candidate,scalp)[0]-floor;margins.append(margin)
                require(margin>=-2e-6,'Pointed taper crossed original scalp clearance floor')
    require(checked_faces==192,'Expected 192 existing triangles around the pointed taper')
    require(source_maximum<=.009,'Stored pointed taper exceeds original 9 mm source envelope')
    return {'pointedTaperCrownLayers':1,'pointedTaperInsertedVertices':len(changed),
            'pointedTaperOriginalPositionsExact':positions[:1775]==before[:1775],
            'pointedTaperUpperContourMonotonic':True,'minimumPointedTaperRingRiseMeters':minimum_rise,
            'maximumPointedTaperLocalDeltaMeters':maximum,'maximumPointedTaperStoredSourceDeviationMeters':source_maximum,
            'minimumPointedTaperStoredSourceAreaRatio':minimum_area,'minimumPointedTaperStoredSourceNormalDot':minimum_normal,
            'checkedPointedTaperStoredTriangles':checked_faces,'checkedPointedTaperStoredScalpPoints':len(margins),
            'minimumPointedTaperStoredScalpMarginMeters':min(margins)}


def author_swept_crown_plane(output, faces, reference, original, layers, target, scalp):
    """Author a directional plane split on the existing coarse midpoint grid."""
    def smooth(a,b,x):
        x=max(0.,min(1.,(x-a)/(b-a)));return x*x*(3.-2.*x)
    positions=output['POSITION'];uv=output['TEXCOORD_0'];normals={};across={}
    target_faces=[]
    for face,side in faces:
        if not side or layers[face[0]]!=target:continue
        if not all(1./3.-1e-6 <= uv[i][0] <= .5+1e-6 for i in face):continue
        target_faces.append(face)
        a,b,c=(reference[i] for i in face);normal=cross(sub(b,a),sub(c,a))
        # Recover local increasing-u direction from the affine source UVs.
        du1,dv1=sub(uv[face[1]],uv[face[0]]);du2,dv2=sub(uv[face[2]],uv[face[0]])
        det=du1*dv2-du2*dv1
        direction=unit(mul(sub(mul(sub(b,a),dv2),mul(sub(c,a),dv1)),1./det))
        for i in face:
            key=reference[i];normals[key]=add(normals.get(key,(0.,0.,0.)),normal)
            across[key]=add(across.get(key,(0.,0.,0.)),direction)
    require(len(target_faces)==24,'Expected one original broad crown wall on the coarse grid')
    before=list(positions);moves={};margins=[]
    for i in {i for face in target_faces for i in face}:
        u,v=uv[i];longitudinal=1.-v
        if u<=1./3.+1e-6 or u>=.5-1e-6:continue
        cross_support=max(0.,1.-abs((u-5./12.)/(1./12.)))
        support=smooth(.10,.27,longitudinal)*(1.-smooth(.60,.86,longitudinal))*cross_support
        if support<1e-8:continue
        key=reference[i]
        # The lateral bias varies along the sweep so the two planes differ.
        bias=.0010*(.35+.65*smooth(.2,.7,longitudinal))
        delta=add(mul(unit(normals[key]),-.0030*support),mul(unit(across[key]),bias*support))
        moves[key]=delta
    for i in {i for face in target_faces for i in face}:
        delta=moves.get(reference[i])
        if delta is None:continue
        reference[i]=add(reference[i],delta);positions[i]=add(positions[i],delta)
    minimum_area=minimum_normal=1.;maximum=0.
    for face in target_faces:
        a,b,c=(original[i] for i in face);old_cross=cross(sub(b,a),sub(c,a))
        a,b,c=(reference[i] for i in face);new_cross=cross(sub(b,a),sub(c,a))
        area=math.sqrt(dot(new_cross,new_cross)/dot(old_cross,old_cross));normal=dot(unit(new_cross),unit(old_cross))
        minimum_area=min(minimum_area,area);minimum_normal=min(minimum_normal,normal)
        require(area>=.65 and normal>=.75,f'Swept coarse plane triangle failed {area} {normal}')
        for ia in range(5):
            for ib in range(5-ia):
                ws=(ia/4.,ib/4.,(4-ia-ib)/4.)
                a=tuple(sum(original[i][k]*w for i,w in zip(face,ws)) for k in range(3))
                b=tuple(sum(reference[i][k]*w for i,w in zip(face,ws)) for k in range(3))
                base,_=clearance(a,scalp);floor=.003 if base>=.003 else min(base,0.)
                margin=clearance(b,scalp)[0]-floor;margins.append(margin)
                require(margin>=-2e-6,'Swept coarse plane crossed original scalp floor')
        maximum=max(maximum,max(math.dist(original[i],reference[i]) for i in face))
    require(maximum<=.0081,'Swept authored plane exceeds 8.1 mm source cap')
    moved=[i for i in range(len(positions)) if positions[i]!=before[i]]
    require(all(i>=1775 for i in moved),'Swept split changed original anchors')
    maximum_delta=max((math.dist(positions[i],before[i]) for i in moved),default=0.)
    require(maximum_delta<=.0032,'Swept plane exceeds its 3.2 mm local authoring limit')
    return {'sweptCrownLayers':1,'sweptCoarseVertices':len(moved),'maximumSweptPlaneDeltaMeters':maximum_delta,
            'maximumSweptAuthoredSourceDeviationMeters':maximum,'minimumSweptCoarseAreaRatio':minimum_area,'minimumSweptCoarseNormalDot':minimum_normal,
            'checkedSweptCoarsePoints':len(margins),'minimumSweptCoarseClearanceMarginMeters':min(margins)}


def shape_spikes(values, indices, canonical, head_joint, canonical_rotation):
    require(len(values['POSITION']) == 1775 and len(indices) == 1408*3, 'Expected original Spikes topology; repeat shaping is unsupported')
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
    require(len(components) == 23, 'Expected scalp plus twenty-two original Spikes lock islands')
    selected, rings = set(),{}
    root_centers = {}
    scalp = []
    for component,ids in components.items():
        count = len({weld[i] for i in ids})
        if count == 288:
            scalp.append(component); continue
        roots = [i for i in ids if abs(uv[i][1]-1.) < 1e-6]
        if count != 24 or not roots: continue
        center = tuple(sum(canonical[i][axis] for i in roots)/len(roots) for axis in range(3))
        if not (-.032 < center[1] < -.017 and 1.745 < center[2] < 1.775): continue
        selected.add(component)
        root_centers[component] = center
        for i in ids:
            row = (1.-uv[i][1])*3.; column = uv[i][0]*6.
            if abs(row-round(row)) < 1e-5 and abs(column-round(column)) < 1e-5:
                label = (round(row),round(column)%6)
                require(weld[i] not in rings or rings[weld[i]] == label,'Ambiguous primary lock UV grid')
                rings[weld[i]] = label
        require(len({weld[i] for i in ids if weld[i] in rings}) == 24,'Incomplete four-by-six primary lock grid')
    require(len(scalp) == 1 and len(selected) == 9,'Expected exactly nine Spikes crown/fringe locks')
    crown_count = fringe_count = 0; crowns=set()
    for component in selected:
        ids = components[component]
        tips = [i for i in ids if abs(uv[i][1]) < 1e-6]
        center = tuple(sum(canonical[i][axis] for i in tips)/len(tips) for axis in range(3))
        if center[1] > .03 and center[2] > 1.79:
            crown_count += 1; crowns.add(component)
        elif center[1] < -.10 and center[2] < 1.70: fringe_count += 1
    require((crown_count,fringe_count) == (5,4),'Spikes crown/fringe layout changed')
    def closed_lock_edges(triangles, positions):
        edges = {}
        for face in triangles:
            for i,j in zip(face,face[1:]+face[:1]):
                edge = tuple(sorted((positions[i],positions[j])))
                edges[edge] = edges.get(edge,0)+1
        require(all(count == 2 for count in edges.values()),'Spikes closed lock acquired an open or nonmanifold edge')
        return len(edges)
    original_closed_edges = closed_lock_edges([f for f in faces if find(weld[f[0]]) in selected],p)
    layer_numbers = {component:i for i,component in enumerate(sorted(selected,key=lambda c:root_centers[c][0]))}
    source_positions=list(p)
    p,profile_proof=author_spikes_crowns(p,n,faces,components,crowns,root_centers,scalp[0],weld,rings,find,canonical_rotation)
    remap=dict(zip(source_positions,p));keys=[remap[q] for q in keys]
    bevel_frames = {}; crown_layers={layer_numbers[c] for c in crowns}
    for component,layer in layer_numbers.items():
        grid = {label:keys[w] for w,label in rings.items() if find(w)==component}
        center = lambda row: tuple(sum(grid[(row,c)][axis] for c in range(6))/6. for axis in range(3))
        sweep=unit(sub(center(1),center(0)))
        inward=sub(mul(add(grid[(0,4)],grid[(0,5)]),.5),mul(add(grid[(0,1)],grid[(0,2)]),.5))
        inward=unit(sub(inward,mul(sweep,dot(inward,sweep))))
        bevel_frames[layer]=(inward,sweep)
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
    scalp_triangles = ScalpSurface(scalp_triangles)
    output = {k:list(v) for k,v in values.items()}; output_indices = []
    output["POSITION"]=list(p)
    source_reference=list(source_positions)
    reference = list(p); layers = [layer_numbers.get(find(weld[i]),-1) for i in range(len(p))]
    bevel_parameters = [(rings[w][0]/3.,0.) if w in rings else (1.,0.) for w in weld]
    midpoint_position = {}; midpoint_export = {}; bounds = []; output_selected = []
    def midpoint(a,b):
        wa,wb = weld[a],weld[b]; edge = tuple(sorted((wa,wb)))
        export_edge = tuple(sorted((a,b)))
        if export_edge in midpoint_export: return midpoint_export[export_edge]
        linear = mul(add(p[a],p[b]),.5)
        if edge not in midpoint_position:
            ra,ca = rings[wa]; rb,cb = rings[wb]
            limit = .0006 if find(wa) in crowns else .002
            if ra == rb == 3: limit = 0.
            if ra == rb == 0: limit = 0.
            upper_root = ra == rb == 0 and limit > 0.
            # Tiny taper/cap triangles cannot safely accept a full 2 mm bend.
            limit = min(limit,.15*edge_heights[edge])
            delta = mul(add(mul(smooth[wa],dot(sub(p[b],p[a]),smooth[wa])),
                            mul(smooth[wb],dot(sub(p[a],p[b]),smooth[wb]))),-.125)
            length = math.sqrt(dot(delta,delta))
            if length > limit: delta = mul(delta,limit/length)
            candidate = add(linear,delta)
            base,_ = clearance(linear,scalp_triangles)
            reserve = max(0.,min(1.,(base-.006)/.006))
            delta = mul(delta,reserve*reserve*(3.-2.*reserve))
            candidate = add(linear,delta)
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
        reference.append(linear); source_reference.append(mul(add(source_positions[a],source_positions[b]),.5)); layers.append(layers[a])
        bevel_parameters.append(mul(add(bevel_parameters[a],bevel_parameters[b]),.5))
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
    swept_proof=author_swept_crown_plane(output,output_selected,reference,source_reference,layers,layer_numbers[sorted(crowns,key=lambda c:root_centers[c][0])[2]],scalp_triangles)
    source_reference=linear_subdivision_reference(source_reference,output_selected)
    output_selected,detail_proof = finer_clumps(output,output_selected,reference,layers,scalp_triangles,bevel_parameters,bevel_frames,exposed_only=True)
    require(len(source_reference)==len(output['POSITION']),'Original-source reference indexing changed')
    # Keep the silhouette authoring dominant over earlier rounded micro-relief.
    for i in {i for face,_ in output_selected if layers[face[0]] in crown_layers for i in face}:
        output['POSITION'][i]=add(reference[i],mul(sub(output['POSITION'][i],reference[i]),.5))
    detail_proof['crownDetailRetention']=.5
    pointed_proof=author_pointed_crown_taper(output,output_selected,source_reference,layers,
        layer_numbers[sorted(crowns,key=lambda c:root_centers[c][0])[2]],canonical_rotation,scalp_triangles)
    taper_proof=crown_source_audit(output,output_selected,source_reference,layers,crown_layers,scalp_triangles)
    detail_proof['maximumRefinementFromAuthoredMeters']=detail_proof['maximumTotalSourceDeviationMeters']
    detail_proof['maximumTotalSourceDeviationMeters']=max(detail_proof['maximumTotalSourceDeviationMeters'],taper_proof['maximumCrownTotalSourceDeviationMeters'])
    reference=source_reference
    output_indices = [i for f,face in enumerate(faces) if f not in chosen_faces for i in face]
    output_indices.extend(i for face,side in output_selected for i in face)
    final_closed_edges = closed_lock_edges([f for f,_ in output_selected],output['POSITION'])
    minimum_area = minimum_normal = 1.
    for face,_ in output_selected:
        a,b,c = (reference[i] for i in face)
        old_cross = cross(sub(b,a),sub(c,a))
        a,b,c = (output['POSITION'][i] for i in face)
        new_cross = cross(sub(b,a),sub(c,a))
        area = math.sqrt(dot(new_cross,new_cross)/dot(old_cross,old_cross))
        normal = dot(unit(old_cross),unit(new_cross))
        minimum_area = min(minimum_area,area); minimum_normal = min(minimum_normal,normal)
        require(area >= .65 and normal >= .75,f'Spikes subdivision compressed or tilted a source child triangle: area={area:.6f}, normal={normal:.6f}, layer={layers[face[0]]}, t={[bevel_parameters[i][0] for i in face]}')
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
    protected = [i for i in range(len(p)) if find(weld[i]) not in selected or rings[weld[i]][0]==3
                 or rings[weld[i]][0]==0]
    require(all(p[i] == source_positions[i] for i in protected),'Authored crown changed a protected source anchor')
    require(all(output['POSITION'][i] == source_positions[i] for i in protected),'Protected scalp/hairline/tip vertex moved')
    require(max(row['deviationMeters']-row['limitMeters'] for row in bounds)<1e-10,'Hair shape exceeded local bound')
    return output,output_indices,{'primaryLockCount':9,'crownLocks':5,'fringeLocks':4,'originalClosedEdges':original_closed_edges,'finalClosedEdges':final_closed_edges,'minimumSourceChildAreaRatio':minimum_area,'minimumSourceChildNormalDot':minimum_normal,'originalVertices':len(p),'newVertices':len(output['POSITION'])-len(p),
        'originalTriangles':len(faces),'resultTriangles':len(output_indices)//3,
        'protectedOriginalVertices':len(protected),'protectedOriginalVerticesExact':True,
        'movedOriginalPrimaryVertices':sum(output['POSITION'][i]!=source_positions[i] for i in range(len(p))),
        'maximumDeviationMeters':max(r['deviationMeters'] for r in bounds),
        'maximumUpperRootDeviationMeters':max((r['deviationMeters'] for r in bounds if r['upperRoot']),default=0.),
        'minimumScalpClearanceChangeMeters':min(r['clearanceChangeMeters'] for r in bounds),
        'allRootAndTerminalEdgesExact':True,'unchangedTriangleCount':len(faces)-len(chosen_faces),**detail_proof,**profile_proof,**taper_proof,**swept_proof,**pointed_proof}


def refine_spikes_shape(raw):
    source = MeshFile(raw); doc = copy.deepcopy(source.doc); binary = bytearray(raw[source.start:])
    rows = []; handled = set()
    def append(values,width,code,component):
        binary.extend(b'\0' *((-len(binary))%4)); start = len(binary)
        for value in values: binary.extend(struct.pack('<'+code*width,*value))
        view = len(doc['bufferViews']); doc['bufferViews'].append({'buffer':0,'byteOffset':start,'byteLength':len(binary)-start})
        a = {'bufferView':view,'componentType':component,'count':len(values),'type':'SCALAR' if width==1 else 'VEC'+str(width)}
        index = len(doc['accessors']); doc['accessors'].append(a); return index
    for role in ('Attacker','Defender'):
        nodes = [n for n in doc['nodes'] if n.get('name') == 'JQ_'+role+'_HairSpikes' and 'mesh' in n]
        require(len(nodes)==1,'Missing unique Spikes attachment'); node = nodes[0]
        require(node['mesh'] not in handled,'Shared role meshes require separate shape review'); handled.add(node['mesh'])
        skin = doc['skins'][node['skin']]
        root = [i for i,j in enumerate(skin['joints']) if doc['nodes'][j]['name']=='root']
        head = [i for i,j in enumerate(skin['joints']) if doc['nodes'][j]['name']=='Head']
        require(len(root)==len(head)==1,'Missing root/Head binding')
        rotation,translation = rigid_frame(source.read(skin['inverseBindMatrices'])[root[0]])
        primitives = doc['meshes'][node['mesh']]['primitives']; require(len(primitives)==1,'Unexpected Spikes primitives')
        primitive = primitives[0]; require(primitive.get('mode',4)==4 and not primitive.get('targets'),'Unexpected hair topology')
        attributes = primitive['attributes']; values = {k:source.read(v) for k,v in attributes.items()}
        require(set(values)=={'POSITION','NORMAL','TANGENT','TEXCOORD_0','JOINTS_0','WEIGHTS_0'},'Unexpected Spikes attributes')
        canonical = [tuple(dot(row,p)+translation[k] for k,row in enumerate(rotation)) for p in values['POSITION']]
        shaped,indices,proof = shape_spikes(values,[i[0] for i in source.read(primitive['indices'])],canonical,head[0],rotation)
        for key,values in shaped.items():
            if key=='POSITION':
                values = [struct.unpack('<3f',struct.pack('<3f',*p)) for p in values]
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
        'scope':'Five narrowed crown profiles retain uneven 4-5 mm upper-ring drops; one central sidewall receives a coarse swept plane split before final detail, within the existing 9 mm source envelope; scalp/fringe/other locks/roots/tips retained; render pending'}
