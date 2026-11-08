"""Smooth only selected Slick shading frames in an import-only GLB derivative.

Positions, indices, UVs, weights and all original binary bytes are retained.
New normal/tangent accessors are appended, leaving every other primitive intact.
"""
import copy
import hashlib
import json
import math
import struct


def require(condition, message):
    if not condition:
        raise ValueError(message)


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def unit(value):
    length = math.sqrt(dot(value, value))
    require(length > 1e-12 and math.isfinite(length), "Invalid hair shading vector")
    return tuple(x / length for x in value)


def cross(a, b):
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])


def smooth_frames(positions, normals, tangents, uvs, joints, weights, indices):
    """Average connected side fans only; preserve cap and >=80-degree corners."""
    count = len(positions)
    require(all(len(a) == count for a in (normals, tangents, uvs, joints, weights)), "Hair attribute counts differ")
    require(len(indices) % 3 == 0 and all(0 <= i < count for i in indices), "Invalid hair triangles")
    # Equal positions alone are insufficient: crossing locks may touch. Fans
    # below connect only through complete mesh edges, with identical skinning.
    keys = [(positions[i], joints[i], weights[i]) for i in range(count)]
    faces, face_normals, angles, caps, edges = [], [], [], set(), {}
    corners = {}
    for offset in range(0, len(indices), 3):
        face = tuple(indices[offset:offset+3]); f = len(faces)
        require(len({keys[i] for i in face}) == 3, "Degenerate hair triangle")
        a, b, c = (positions[i] for i in face)
        normal = unit(cross(tuple(y-x for x,y in zip(a,b)), tuple(y-x for x,y in zip(a,c))))
        faces.append(face); face_normals.append(normal)
        # The authored closed-wedge caps have separate little UV discs at
        # v=.025/.975; side strips reach v=0/1. Preserve those caps exactly.
        uv = [uvs[i] for i in face]
        if all(.35 <= u <= .65 for u,v in uv) and (all(0 < v < .05 for u,v in uv) or all(.95 < v < 1 for u,v in uv)):
            caps.add(f)
        corner_angles = []
        for j, i in enumerate(face):
            p = positions[i]
            x = unit(tuple(q-r for q,r in zip(positions[face[(j+1)%3]],p)))
            y = unit(tuple(q-r for q,r in zip(positions[face[(j+2)%3]],p)))
            corner_angles.append(math.acos(max(-1., min(1., dot(x,y)))))
            corners.setdefault(keys[i], []).append((f, j, i))
            edge = frozenset((keys[i], keys[face[(j+1)%3]]))
            edges.setdefault(edge, []).append(f)
        angles.append(corner_angles)
    links = {}
    hard_vertices = set()
    limit = math.cos(math.radians(80.))
    for edge, incident in edges.items():
        if len(incident) != 2:
            continue  # Non-manifold/open seams are not a smoothing bridge.
        a,b = incident
        if dot(face_normals[a], face_normals[b]) <= limit:
            hard_vertices.update(edge)
            continue
        if a in caps or b in caps:
            continue
        for key in edge:
            links.setdefault(key, []).append((a,b))
    output = list(normals)
    protected = {i for f in caps for i in faces[f]}
    for key, entries in corners.items():
        if len(entries) < 2 or key in hard_vertices:
            continue
        parent = {f:f for f,j,i in entries}
        def find(f):
            while parent[f] != f:
                parent[f] = parent[parent[f]]; f = parent[f]
            return f
        for a,b in links.get(key, []):
            parent[find(a)] = find(b)
        fans = {}
        uses = {}
        for f,j,i in entries:
            fan = find(f)
            fans.setdefault(fan, []).append((f,j,i))
            uses.setdefault(i, set()).add(fan)
        for fan_entries in fans.values():
            if len(fan_entries) < 2:
                continue
            affected = {i for f,j,i in fan_entries}
            # An exported index spanning separate hard fans cannot receive two
            # normals without changing topology. Keep its original shading.
            if any(i in protected or len(uses[i]) != 1 for i in affected):
                continue
            average = unit(tuple(sum(face_normals[f][axis] * angles[f][j] for f,j,i in fan_entries) for axis in range(3)))
            for i in affected:
                output[i] = average
    result_tangents = list(tangents)
    changed = []
    for i, normal in enumerate(output):
        if sum((x-y)**2 for x,y in zip(normal,normals[i])) <= 1e-12:
            output[i] = normals[i]
            normal = normals[i]
        else:
            changed.append(i)
        old = tangents[i][:3]
        require(abs(abs(tangents[i][3])-1.) < 1e-6, "Invalid hair tangent handedness")
        axis_normal = unit(normal)
        # Some original cap tangents are not perpendicular to their normals.
        # Repair the entire selected shading frame, keeping cap normals and w.
        projected = tuple(old[k]-axis_normal[k]*dot(old,axis_normal) for k in range(3))
        if dot(projected, projected) < 1e-12:
            axis = min(((1.,0.,0.),(0.,1.,0.),(0.,0.,1.)), key=lambda a:abs(dot(a,axis_normal)))
            projected = cross(axis,axis_normal)
        result_tangents[i] = unit(projected) + (tangents[i][3],)
    require(all(output[i] == normals[i] for i in protected), "Hair cap normals changed")
    return output, result_tangents, {
        "vertices":count, "triangles":len(faces), "capTrianglesPreserved":len(caps),
        "changedNormalVertices":len(changed), "hardCreaseDegrees":80,
        "maxNormalRotationDegrees":max((math.degrees(math.acos(max(-1., min(1., dot(unit(normals[i]),output[i]))))) for i in changed), default=0.),
        "maximumTangentNormalDot":max((abs(dot(output[i],result_tangents[i][:3])) for i in range(count)), default=0.)}


def refine_hair(raw):
    require(len(raw) >= 28 and struct.unpack_from('<III',raw) == (0x46546c67,2,len(raw)), "Invalid GLB")
    length,kind = struct.unpack_from('<II',raw,12)
    require(kind == 0x4e4f534a and length % 4 == 0 and 28+length <= len(raw), "Invalid GLB JSON")
    original = json.loads(raw[20:20+length]); doc = copy.deepcopy(original)
    size,kind = struct.unpack_from('<II',raw,20+length)
    require(kind == 0x004e4942 and 28+length+size == len(raw), "Expected one embedded binary chunk")
    binary = raw[28+length:]; output = bytearray(binary)
    require(len(doc['buffers']) == 1 and 'uri' not in doc['buffers'][0] and doc['buffers'][0]['byteLength'] <= len(binary), "Unexpected GLB buffer")
    def accessor(index):
        a = doc['accessors'][index]; v = doc['bufferViews'][a['bufferView']]
        require('sparse' not in a and not a.get('normalized',False) and v.get('buffer',0) == 0, "Unsupported hair accessor")
        width = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
        code = {5121:'B',5123:'H',5125:'I',5126:'f'}[a['componentType']]
        element = struct.calcsize('<'+code*width); stride = v.get('byteStride',element)
        start = a.get('byteOffset',0); require(stride >= element and start + max(0,a['count']-1)*stride + element <= v['byteLength'], "Hair accessor exceeds view")
        offset = v.get('byteOffset',0)+start
        require(v.get('byteOffset',0)+v['byteLength'] <= len(binary), "Hair view exceeds binary")
        values = [struct.unpack_from('<'+code*width,binary,offset+i*stride) for i in range(a['count'])]
        require(all(math.isfinite(x) for row in values for x in row), "Nonfinite hair data")
        return values
    appended = {}
    def append(values, width):
        payload = b''.join(struct.pack('<'+'f'*width,*row) for row in values)
        key = (width,payload)
        if key in appended:
            return appended[key]
        output.extend(b'\0' * ((-len(output)) % 4)); offset = len(output); output.extend(payload)
        view = len(doc['bufferViews']); doc['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(payload),'target':34962})
        index = len(doc['accessors']); doc['accessors'].append({'bufferView':view,'componentType':5126,'count':len(values),'type':'VEC'+str(width)})
        appended[key] = index
        return index
    rows = []; seen = set()
    for role in ('Attacker','Defender'):
        nodes = [n for n in doc['nodes'] if n.get('name') == 'JQ_'+role+'_HairSlick' and 'mesh' in n and 'skin' in n]
        require(len(nodes) == 1, "Expected one selected Slick attachment per role")
        mesh_index = nodes[0]['mesh']
        require(not any(n.get('mesh') == mesh_index and n.get('name') not in ('JQ_Attacker_HairSlick','JQ_Defender_HairSlick') for n in doc['nodes']), "Selected hair mesh is shared with another attachment")
        for primitive_index,p in enumerate(doc['meshes'][mesh_index]['primitives']):
            if (mesh_index,primitive_index) in seen:
                continue
            seen.add((mesh_index,primitive_index))
            require(p.get('mode',4) == 4 and not p.get('targets'), "Unsupported hair topology")
            require('normalTexture' not in doc['materials'][p['material']], "Hair normal map requires a separate tangent review")
            a = p['attributes']; require(set(a) == {'POSITION','NORMAL','TANGENT','TEXCOORD_0','JOINTS_0','WEIGHTS_0'}, "Unexpected hair attributes")
            values = {key:accessor(index) for key,index in a.items()}
            normals,tangents,proof = smooth_frames(values['POSITION'],values['NORMAL'],values['TANGENT'],values['TEXCOORD_0'],values['JOINTS_0'],values['WEIGHTS_0'],[x[0] for x in accessor(p['indices'])])
            a['NORMAL'] = append(normals,3); a['TANGENT'] = append(tangents,4)
            rows.append({'mesh':mesh_index,'primitive':primitive_index,**proof})
    require(rows and all(r['changedNormalVertices'] > 0 and r['capTrianglesPreserved'] > 0 for r in rows), "No bounded Slick shading change found")
    require(all(r['maxNormalRotationDegrees'] <= 45. for r in rows), "Hair normal change exceeds the 45-degree pilot limit")
    doc['buffers'][0]['byteLength'] = len(output)
    expected = copy.deepcopy(original)
    for row in rows:
        target = expected['meshes'][row['mesh']]['primitives'][row['primitive']]['attributes']
        source = doc['meshes'][row['mesh']]['primitives'][row['primitive']]['attributes']
        for key in ('NORMAL','TANGENT'):
            target[key] = source[key]
    expected['accessors'] += doc['accessors'][len(original['accessors']):]
    expected['bufferViews'] += doc['bufferViews'][len(original['bufferViews']):]
    expected['buffers'][0]['byteLength'] = doc['buffers'][0]['byteLength']
    require(doc == expected, "Unexpected non-shading glTF change")
    encoded = json.dumps(doc,separators=(',',':')).encode(); encoded += b' ' *((-len(encoded))%4)
    output.extend(b'\0' *((-len(output))%4))
    result = struct.pack('<III',0x46546c67,2,28+len(encoded)+len(output)) + struct.pack('<II',len(encoded),0x4e4f534a) + encoded + struct.pack('<II',len(output),0x004e4942) + output
    require(output[:len(binary)] == binary, "Original binary bytes changed")
    return bytes(result), {'sourceSha256':hashlib.sha256(raw).hexdigest(),'importSha256':hashlib.sha256(result).hexdigest(),
        'originalBinaryPrefixUnchanged':True,'originalBinaryBytes':len(binary),'positionsUVsWeightsIndicesUnchanged':True,
        'skeletonAnimationAndOtherPrimitivesUnchanged':True,'newAccessorCount':len(appended),'primitives':rows,
        'scope':'Selected Slick side shading only; caps and hard fans retained; silhouette unchanged'}
