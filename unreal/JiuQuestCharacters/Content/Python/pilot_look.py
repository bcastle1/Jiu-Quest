"""Bounded original face and cotton sculpt for an import-only GLB derivative.

Changes existing POSITION/NORMAL/TANGENT values only. Source files, topology,
UVs, weights, rest rig, embedded images and animation bytes remain untouched.
"""
import hashlib
import json
import math
import struct


def smooth(a, b, x):
    t = min(1., max(0., (x - a) / (b - a)))
    return t * t * (3. - 2. * t)


def window(a, b, c, d, x):
    return smooth(a, b, x) * (1. - smooth(c, d, x))


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def cross(a, b):
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])


def sub(a, b):
    return tuple(x-y for x, y in zip(a, b))


def unit(v):
    length = math.sqrt(dot(v, v))
    if length < 1e-12:
        raise ValueError('Degenerate direction')
    return tuple(x / length for x in v)


def face_offset(p):
    """Lower facial planes; eyes, brows, mouth edge, scalp and neck fixed."""
    x, y, z = p
    support = window(-.145, -.120, -.055, -.035, y)
    support *= window(1.532, 1.544, 1.620, 1.631, z)
    support *= 1. - smooth(.060, .075, abs(x))
    lip_guard = (1.-smooth(.028, .040, abs(x))) * window(1.564, 1.570, 1.584, 1.589, z)
    support *= 1.-lip_guard
    if support == 0.:
        return (0., 0., 0.)
    # Preserve the actual lip contour; the groove beneath it and the chin
    # plane separate the lower face without introducing a new expression.
    chin = math.exp(-(x/.030)**4 - ((z-1.547)/.012)**2)
    under_lip = math.exp(-(x/.023)**4 - ((z-1.563)/.0038)**2)
    cheek = math.exp(-((abs(x)-.041)/.022)**4 - ((z-1.608)/.012)**2)
    cheek_base = math.exp(-((abs(x)-.042)/.021)**4 - ((z-1.594)/.012)**2)
    crease_x = .018 + .32 * (1.611-z)
    crease = math.exp(-((abs(x)-crease_x)/.0048)**2)
    crease *= window(1.583, 1.590, 1.606, 1.614, z)
    # Two shallow philtrum columns flank an unpainted central groove.
    philtrum = window(1.585, 1.589, 1.596, 1.600, z)
    center = math.exp(-(x/.0026)**2)
    columns = math.exp(-((abs(x)-.0045)/.0022)**2)
    dy = -.0018*chin + .0008*under_lip - .0010*cheek
    dy += .00065*cheek_base + .00065*crease + philtrum*(.00045*center-.00035*columns)
    return (0., max(-.0025, min(.0025, dy * support)), 0.)


def crease(distance, width, amount):
    r = distance / width
    return amount * (math.exp(-r*r) - .48 * math.exp(-((r+1.25)/.62)**2))


def cloth_relief(panel, u, v):
    """Unequal compression creases, zero at seams/openings and lapels."""
    edge = window(.035, .085, .915, .965, u)
    angle = math.tau * u
    if panel == 'sleeve':
        support = edge * window(.36, .43, .78, .86, v)
        inside = max(0., math.sin(angle)) ** 4
        result = crease(v-.525-.070*math.cos(angle), .021, .00125)
        result += crease(v-.635+.048*math.cos(angle), .028, .00085)
        result += crease(v-.705-.024*math.cos(2*angle), .019, .00055)
        return max(-.0015, min(.0015, result * support * inside))
    if panel == 'pants':
        support = edge * window(.26, .32, .53, .60, v)
        front = max(0., -math.cos(angle)) ** 4
        result = crease(v-.365-.045*math.sin(angle), .019, .0011)
        result += crease(v-.455+.065*math.sin(angle), .025, .00135)
        return max(-.0015, min(.0015, result * support * front))
    if panel == 'torso':
        side = min(u, 1.-u)
        support = window(.025, .055, .21, .27, side) * window(.19, .28, .54, .64, v)
        origin = .29 if u < .5 else .33
        result = crease(v-origin-.70*side, .024+.035*side, .0013)
        return max(-.0015, min(.0015, result * support))
    return 0.


def panel_at(uv):
    # glTF flips the Blender UV vertical axis on export.
    x, y = uv[0], 1.-uv[1]
    cell = (int(x * 2), int(y * 2))
    panel = {(0, 0): 'torso', (1, 0): 'sleeve', (0, 1): 'pants', (1, 1): 'trim'}.get(cell)
    return panel, (x-cell[0]*.5-.008)/.484, (y-cell[1]*.5-.008)/.484


class MeshFile:
    def __init__(self, raw):
        if struct.unpack_from('<III', raw) != (0x46546c67, 2, len(raw)):
            raise ValueError('Invalid GLB')
        size, kind = struct.unpack_from('<II', raw, 12)
        if kind != 0x4e4f534a:
            raise ValueError('Expected GLB JSON')
        self.doc = json.loads(raw[20:20+size])
        bin_size, bin_kind = struct.unpack_from('<II', raw, 20+size)
        self.start = 28+size
        if bin_kind != 0x004e4942 or self.start+bin_size != len(raw):
            raise ValueError('Expected one final binary chunk')
        self.data = bytearray(raw)
        self.allowed = set()

    def layout(self, index):
        a = self.doc['accessors'][index]
        if 'sparse' in a:
            raise ValueError('Sparse sculpt attributes unsupported')
        v = self.doc['bufferViews'][a['bufferView']]
        if v.get('buffer', 0) != 0:
            raise ValueError('External sculpt buffer unsupported')
        count = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
        code = {5121: 'B', 5123: 'H', 5125: 'I', 5126: 'f'}[a['componentType']]
        fmt = '<'+code*count
        start = self.start+v.get('byteOffset', 0)+a.get('byteOffset', 0)
        return a, start, v.get('byteStride', struct.calcsize(fmt)), fmt

    def read(self, index):
        a, start, stride, fmt = self.layout(index)
        return [struct.unpack_from(fmt, self.data, start+i*stride) for i in range(a['count'])]

    def write(self, index, values):
        a, start, stride, fmt = self.layout(index)
        if a['componentType'] != 5126 or len(values) != a['count']:
            raise ValueError('Sculpt requires matching float attributes')
        for i, value in enumerate(values):
            if not all(math.isfinite(x) for x in value):
                raise ValueError('Non-finite sculpt value')
            offset = start+i*stride
            self.allowed.update(range(offset, offset+struct.calcsize(fmt)))
            struct.pack_into(fmt, self.data, offset, *value)


def rigid_frame(matrix):
    rows = [matrix[r::4][:3] for r in range(3)]
    if any(abs(dot(a, b)-(1. if i == j else 0.)) > 1e-5
           for i, a in enumerate(rows) for j, b in enumerate(rows)):
        raise ValueError('Expected rigid root inverse bind')
    return rows, tuple(matrix[12+r] for r in range(3))


def rotate_between(vector, before, after):
    a, b = unit(before), unit(after)
    axis = cross(a, b)
    sine = math.sqrt(dot(axis, axis)); cosine = max(-1., min(1., dot(a, b)))
    if sine < 1e-10:
        if cosine < 0.:
            raise ValueError('Sculpt inverted a vertex frame')
        return vector
    axis = tuple(x/sine for x in axis)
    across = cross(axis, vector)
    return tuple(vector[i]*cosine+across[i]*sine+axis[i]*dot(axis, vector)*(1.-cosine) for i in range(3))


def adjust_frames(old, new, normals, tangents, indices, joints, weights):
    old_sum = [[0., 0., 0.] for _ in old]
    new_sum = [[0., 0., 0.] for _ in old]
    changed = set()
    for k in range(0, len(indices), 3):
        ids = indices[k:k+3]
        a = cross(sub(old[ids[1]], old[ids[0]]), sub(old[ids[2]], old[ids[0]]))
        b = cross(sub(new[ids[1]], new[ids[0]]), sub(new[ids[2]], new[ids[0]]))
        if dot(a, a) > 1e-20 and dot(a, b) <= 0.:
            raise ValueError('Sculpt inverted a triangle')
        if any(old[i] != new[i] for i in ids):
            changed.update(ids)
        for i in ids:
            for axis in range(3):
                old_sum[i][axis] += a[axis]
                new_sum[i][axis] += b[axis]
    # glTF splits vertices at UV seams. Pool the deformation frame of copies
    # sharing the same smooth surface/skin data, while retaining each UV tangent.
    # Otherwise the central facial seam receives two different normal rotations.
    keys = [(p, tuple(round(v, 6) for v in normals[i]), joints[i], weights[i]) for i, p in enumerate(old)]
    pooled_old, pooled_new = {}, {}
    changed_keys = {keys[i] for i in changed}
    for i, key in enumerate(keys):
        if key not in changed_keys:
            continue
        a = pooled_old.setdefault(key, [0., 0., 0.]); b = pooled_new.setdefault(key, [0., 0., 0.])
        for axis in range(3):
            a[axis] += old_sum[i][axis]; b[axis] += new_sum[i][axis]
    out_n, out_t = list(normals), list(tangents)
    for i, key in enumerate(keys):
        if key not in changed_keys or dot(pooled_old[key], pooled_old[key]) < 1e-20:
            continue
        out_n[i] = unit(rotate_between(normals[i], pooled_old[key], pooled_new[key]))
        tangent = rotate_between(tangents[i][:3], pooled_old[key], pooled_new[key])
        tangent = unit(sub(tangent, tuple(dot(tangent, out_n[i])*v for v in out_n[i])))
        out_t[i] = (*tangent, tangents[i][3])
    return out_n, out_t


def refine_look(raw):
    mesh_file = MeshFile(raw)
    doc = mesh_file.doc
    proof = {'version': 1, 'changes': [], 'maximumFaceOffsetMeters': 0., 'maximumClothOffsetMeters': 0.}
    handled = set()
    for role in ('Attacker', 'Defender'):
        for part in ('Body', 'GiJacket', 'GiPantsMesh'):
            matches = [n for n in doc['nodes'] if n.get('name') == f'JQ_{role}_{part}']
            if len(matches) != 1:
                raise ValueError('Missing unique sculpt part')
            node = matches[0]
            if any(key in node for key in ('matrix', 'translation', 'rotation', 'scale')):
                raise ValueError('Sculpt mesh must retain identity node transform')
            skin = doc['skins'][node['skin']]
            root_index = [i for i, j in enumerate(skin['joints']) if doc['nodes'][j]['name'] == 'root']
            if len(root_index) != 1:
                raise ValueError('Missing unique root inverse bind')
            rows, translation = rigid_frame(mesh_file.read(skin['inverseBindMatrices'])[root_index[0]])
            for primitive in doc['meshes'][node['mesh']]['primitives']:
                if primitive.get('mode', 4) != 4 or 'targets' in primitive:
                    raise ValueError('Sculpt requires triangle mesh without morph targets')
                attributes = primitive['attributes']; key = attributes['POSITION']
                if key in handled:
                    raise ValueError('Unexpected shared sculpt POSITION accessor')
                handled.add(key)
                positions = mesh_file.read(key); normals = mesh_file.read(attributes['NORMAL'])
                tangents = mesh_file.read(attributes['TANGENT'])
                uvs = mesh_file.read(attributes['TEXCOORD_1']) if part != 'Body' else None
                result = []; moved = 0; maximum = 0.
                for i, p in enumerate(positions):
                    canonical = tuple(dot(row, p)+translation[j] for j, row in enumerate(rows))
                    if part == 'Body':
                        delta = face_offset(canonical)
                    else:
                        panel, u, v = panel_at(uvs[i]); relief = cloth_relief(panel, u, v)
                        # Follow the current surface, including inner lining;
                        # all trim/openings stay exactly unchanged by the field.
                        cn = unit(tuple(dot(row, normals[i]) for row in rows))
                        delta = tuple(relief*v for v in cn)
                    distance = math.sqrt(dot(delta, delta))
                    if distance < 1e-10:
                        result.append(p); continue
                    change = tuple(sum(rows[j][axis]*delta[j] for j in range(3)) for axis in range(3))
                    result.append(tuple(p[axis]+change[axis] for axis in range(3)))
                    moved += 1; maximum = max(maximum, distance)
                accessor = doc['accessors'][key]
                if any(p[axis] < accessor['min'][axis]-1e-7 or p[axis] > accessor['max'][axis]+1e-7
                       for p in result for axis in range(3)):
                    raise ValueError('Local sculpt escaped original whole-mesh bounds')
                indices = [v[0] for v in mesh_file.read(primitive['indices'])]
                joints, weights = mesh_file.read(attributes['JOINTS_0']), mesh_file.read(attributes['WEIGHTS_0'])
                new_n, new_t = adjust_frames(positions, result, normals, tangents, indices, joints, weights)
                mesh_file.write(key, result); mesh_file.write(attributes['NORMAL'], new_n)
                mesh_file.write(attributes['TANGENT'], new_t)
                proof['changes'].append({'role': role, 'part': part, 'verticesMoved': moved, 'maximumOffsetMeters': maximum})
                bound = 'maximumFaceOffsetMeters' if part == 'Body' else 'maximumClothOffsetMeters'
                proof[bound] = max(proof[bound], maximum)
    result = bytes(mesh_file.data)
    if any(a != b and i not in mesh_file.allowed for i, (a, b) in enumerate(zip(raw, result))):
        raise AssertionError('Changed bytes outside sculpt attribute allowlist')
    proof.update(sourceSha256=hashlib.sha256(raw).hexdigest(), importSha256=hashlib.sha256(result).hexdigest(),
        jsonUnchanged=True, protectedBinaryBytesUnchanged=True,
        scope='Lower facial shaping and local cotton compression; original source retained')
    return result, proof
