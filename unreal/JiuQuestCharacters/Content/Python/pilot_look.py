"""Bounded original face and cotton sculpt for an import-only GLB derivative.

Changes existing POSITION/NORMAL/TANGENT values and their POSITION bounds only.
Source files, topology, UVs, weights, rest rig, images and motion stay untouched.
"""
import hashlib
import copy
import json
import math
import struct

MAX_CLOTH_OFFSET = .022
MAX_CLOTH_BOUNDS_EXPANSION = .003


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


def folded_ridge(distance, width, amount):
    """Broad folded planes with a rounded crest and an unequal adjacent valley.

    Nearly straight flanks make cotton folds readable under a broad light.
    Round both the crest and the foot rather than introducing a sharp cusp;
    the support is wide enough for the existing limb rows, without new mesh.
    """
    def tent(r):
        a = math.sqrt(r*r + .10*.10) - .10
        h = 1.-a
        rounded = .5*(h + math.sqrt(h*h + .06*.06))
        return rounded * (1.-smooth(1.08, 1.40, a))
    r = distance / width
    return amount * (tent(r) - .52*tent((r+1.38)/.72))


def lower_pants_relief(u, v):
    """Unequal angular knee fans and lower-leg drape, away from the hip lining."""
    angle = math.tau*u
    support = window(.035, .085, .915, .965, u) * window(.16, .22, .82, .92, v)
    front = max(0., -math.cos(angle)) ** 3
    result = folded_ridge(v-.405-.090*math.sin(angle), .049, .0120) * front
    result += folded_ridge(v-.525+.120*math.sin(angle), .065, .0068) * front
    result += folded_ridge(u-.22-.13*(v-.45), .073, .0075) * window(.19, .27, .66, .77, v)
    result += folded_ridge(u-.78+.09*(v-.45), .078, .0058) * window(.23, .31, .63, .74, v)
    result += folded_ridge(v-.275-.145*math.sin(angle), .060, .0072) * front * window(.16, .23, .34, .41, v)
    return .0145 * math.tanh(result * support / .015)


def cloth_relief(panel, u, v):
    """Localized bend/drag folds, rather than rings around cylindrical limbs.

    UV1 follows the source garment panels. The same radial displacement applies
    to both lining surfaces, preserving thickness instead of pulling them apart.
    """
    edge = window(.035, .085, .915, .965, u)
    angle = math.tau * u
    if panel == 'sleeve':
        support = edge * window(.30, .39, .83, .92, v)
        inside = max(0., math.sin(angle)) ** 3
        underside = max(0., -math.cos(angle)) ** 4
        result = crease(v-.575-.078*math.cos(angle), .040, .0092) * inside
        result += crease(v-.695+.058*math.cos(angle), .048, .0064) * inside
        # A slanting branch and one long underside pull interrupt the bend fan.
        result += crease(v-.485-.15*math.cos(angle), .035, -.0042) * underside
        result += crease(u-.49-.075*(v-.62), .044, .0050) * window(.40, .48, .77, .87, v)
        drag = window(.34, .44, .76, .88, v)
        result += crease(u-.15-.17*(v-.52), .052, .0070) * drag
        result += crease(u-.39+.12*(v-.50), .047, -.0044) * drag
        return .011 * math.tanh(result * support / .011)
    if panel == 'pants':
        support = edge * window(.16, .22, .82, .92, v)
        front = max(0., -math.cos(angle)) ** 3
        side = abs(math.sin(angle)) ** 3
        result = crease(v-.405-.075*math.sin(angle), .037, .0095) * front
        result += crease(v-.515+.090*math.sin(angle), .050, .0060) * front
        # Hip compression turns diagonally into the outer thigh; lower-leg
        # drape runs lengthwise and leaves the knee center broad.
        result += crease(v-.755-.095*math.sin(angle), .052, .0075) * side
        result += crease(u-.23-.10*(v-.45), .052, .0058) * window(.19, .27, .66, .77, v)
        result += crease(u-.77+.075*(v-.45), .055, .0047) * window(.23, .31, .63, .74, v)
        thigh = window(.48, .57, .76, .86, v)
        result += crease(u-.34-.19*(v-.64), .061, .0080) * thigh
        result += crease(u-.65+.13*(v-.66), .066, .0060) * thigh
        result += crease(v-.275-.105*math.sin(angle), .046, .0062) * front * window(.16, .23, .34, .41, v)
        accepted = .012 * math.tanh(result * support / .012)
        # The accepted upper legs include a narrow inner-thigh overlap whose
        # lining crosses the canonical x=0 plane. Keep its existing fit exact;
        # a new radial ridge there can bring the lining through the outer shell.
        if v >= .58:
            return accepted
        angular = lower_pants_relief(u, v)
        return accepted + (angular-accepted)*(1.-smooth(.48, .58, v))
    if panel == 'torso':
        support = window(.04, .10, .90, .96, u) * window(.37, .44, .69, .81, v)
        result = 0.
        for anchor, lean, amount in ((.15, .28, .0068), (.37, -.17, .0048),
                                     (.65, .19, .0056), (.86, -.24, .0074)):
            center = anchor + lean*(v-.40) + .025*math.sin((v-.40)*5.)
            result += crease(u-center, .032+.075*abs(v-.40), amount)
        return .009 * math.tanh(result * support / .009)
    return 0.


def _accepted_shoulder_offset(p):
    """One continuous field shared by the separate torso/sleeve islands.

    Lower the high crown rather than independently shrinking the sleeve and
    dropping the torso, which can expose their buried overlap. The lower
    underarm stays fixed; the outer upper surface compresses smoothly by at
    most 18 mm. The entire neck, front opening and lapels are outside support.
    """
    x, y, z = p
    # The top torso rings reach x=.123 m; keep that complete neckline band.
    across = window(.125, .190, .285, .365, abs(x))
    upper = smooth(1.425, 1.535, z)
    if across == 0. or upper == 0.:
        return (0., 0., 0.)
    front_guard = 1.-smooth(.020, .070, -y)*(1.-smooth(.105, .140, abs(x)))
    support = across*upper*front_guard
    # This affine cross-section taper has no panel/UV-dependent discontinuity.
    return (-.0025*support*(1. if x > 0. else -1.),
            -.045*(y-.0654)*support, -.018*support)


def shoulder_crown_offset(p):
    """Ease the high round cap toward a sloped plane without crushing lining.

    Both overlapping jacket panels use this canonical field. Its inner and
    outer boundaries leave the neckline and inner-elbow shading rings fixed.
    A soft positive-part ramp limits the vertical slope; literal projection
    onto the plane would collapse the thickness between stacked surfaces.
    """
    x, y, z = p
    support = window(.175, .205, .265, .295, abs(x))
    support *= 1.-smooth(.020, .070, -y)*(1.-smooth(.105, .140, abs(x)))
    if support == 0.:
        return (0., 0., 0.)
    previous = _accepted_shoulder_offset(p)
    plane = 1.490-.22*(abs(x)-.19)
    excess = z+previous[2]-plane
    if excess <= 0.:
        return (0., 0., 0.)
    positive = excess*excess/.008 if excess < .004 else excess-.002
    return (0., 0., -.0035*math.tanh(positive/.024)*support)


def shoulder_offset(p):
    previous, crown = _accepted_shoulder_offset(p), shoulder_crown_offset(p)
    return tuple(a+b for a,b in zip(previous,crown))


def cloth_offset(panel, p, u, v, landmarks):
    """Fit broad limb envelopes, leaving seams, cuffs and exposed skin fixed.

    Original covered deltoid/arm/thigh/calf skin is absent in these GLBs. This
    field does not reshape any body vertices. Its support ends before retained
    distal forearms, ankles, neckline and the open chest/lapel boundary.
    """
    if panel == 'trim':
        return (0., 0., 0.)
    x, y, z = p
    shared = shoulder_offset(p) if panel in ('sleeve', 'torso') else (0., 0., 0.)
    if panel == 'sleeve':
        envelope = window(.18, .28, .85, .93, v)
        if envelope == 0.:
            return shared
        side = 'l' if x > 0. else 'r'
        shoulder, wrist = (landmarks[name+'_'+side] for name in ('upperarm', 'hand'))
        axis = unit(sub(wrist, shoulder))
        start = tuple(shoulder[k]-.155*axis[k] for k in range(3))
        center = tuple(start[k]+(wrist[k]-start[k])*v*.97 for k in range(3))
        radial = sub(p, center)
        radial = sub(radial, tuple(dot(radial, axis)*q for q in axis))
        outward = unit(radial)
        front = max(0., -outward[1])
        # Sleeve-specific fitting starts beyond the shared shoulder overlap.
        # Upper-arm fullness then tapers toward elbow and distal forearm.
        distal = smooth(.29, .39, abs(x))
        take_in = .0050*math.exp(-((v-.46)/.12)**2)*(.75+.25*front)
        take_in += .0110*math.exp(-((v-.635)/.080)**2)
        take_in += .0130*math.exp(-((v-.795)/.090)**2)
        relief = cloth_relief(panel, u, v)
        amount = MAX_CLOTH_OFFSET*math.tanh((relief-take_in*envelope)*distal/MAX_CLOTH_OFFSET)
        return tuple(shared[k]+amount*q for k,q in enumerate(outward))
    if panel == 'pants':
        envelope = window(.16, .23, .71, .83, v)
        if envelope == 0. and cloth_relief(panel, u, v) == 0.:
            return (0., 0., 0.)
        side = 'l' if x > 0. else 'r'
        hip, ankle = (landmarks[name+'_'+side] for name in ('thigh', 'foot'))
        along = min(1., max(0., (hip[2]-z)/(hip[2]-ankle[2])))
        center = tuple(hip[k]+(ankle[k]-hip[k])*along for k in range(3))
        outward = unit((x-center[0], y-center[1], 0.))
        take_in = .0070*math.exp(-((v-.64)/.13)**2)
        take_in += .0140*math.exp(-((v-.435)/.085)**2)
        take_in += .0120*math.exp(-((v-.205)/.085)**2)
        # Keep a calf belly above the tapered lower leg; a gi should suggest
        # anatomy through its silhouette rather than trace every muscle.
        take_in -= .0020*math.exp(-((v-.30)/.065)**2)*max(0., outward[1])**2
        relief = cloth_relief(panel, u, v)
        # The center crotch joins two leg panels; leave that bridge undisturbed.
        bridge = 1.-smooth(.70, .83, v)*(1.-smooth(.025, .070, abs(x)))
        amount = MAX_CLOTH_OFFSET*math.tanh((relief-take_in*envelope)*bridge/MAX_CLOTH_OFFSET)
        return tuple(amount*q for q in outward)
    if panel == 'torso':
        opening = window(.045, .11, .89, .955, u)
        # Retained chest triangles extend slightly beyond the nominal V mask.
        # Keep that complete front band fixed, including its hidden overlap.
        opening *= 1.-smooth(.020, .070, -y)*(1.-smooth(.105, .140, abs(x)))
        if opening == 0. or v <= .08 or v >= .94:
            return shared
        radial = unit((x, y-.018, 0.))
        waist = window(.37, .45, .66, .78, v)
        take_in = .0055*waist*(.55+.45*abs(radial[0]))
        amount = (cloth_relief(panel, u, v)-take_in)*opening
        # The waist field fades before the shoulder field starts. Both panels
        # therefore receive the same displacement throughout their armhole.
        amount *= 1.-smooth(1.355, 1.405, z)
        return tuple(shared[k]+amount*q for k,q in enumerate(radial))
    return (0., 0., 0.)


def jacket_fit_offset(panel, p, u, v, landmarks):
    """Small athletic fit outside the accepted shoulder and opening overlaps.

    This adds no bone scaling or new folds. The sleeve field is confined to
    the outer upper arm, ending before the forearm; waist fitting stays below
    the shared shoulder warp. Pants and every trim panel are excluded.
    """
    x, y, z = p
    if panel == 'sleeve':
        support = window(.43, .50, .57, .66, v) * smooth(.29, .39, abs(x))
        # The accepted inner-elbow shell/lining is close at u=.08-.17.
        # Leave its complete compression half and neighboring shading faces
        # fixed; narrow only the exposed outer/back plane, clear of the seam.
        support *= window(.50, .62, .88, .98, u)
        if support == 0.:
            return (0., 0., 0.)
        side = 'l' if x > 0. else 'r'
        shoulder, wrist = (landmarks[name+'_'+side] for name in ('upperarm', 'hand'))
        axis = unit(sub(wrist, shoulder))
        start = tuple(shoulder[k]-.155*axis[k] for k in range(3))
        center = tuple(start[k]+(wrist[k]-start[k])*v*.97 for k in range(3))
        radial = sub(p, center)
        outward = unit(sub(radial, tuple(dot(radial, axis)*q for q in axis)))
        return tuple(-.0040*support*q for q in outward)
    if panel == 'torso':
        opening = window(.045, .11, .89, .955, u)
        opening *= 1.-smooth(.020, .070, -y)*(1.-smooth(.105, .140, abs(x)))
        support = window(.37, .45, .66, .78, v) * opening
        support *= 1.-smooth(1.355, 1.405, z)
        if support == 0.:
            return (0., 0., 0.)
        outward = unit((x, y-.018, 0.))
        amount = -.0050*support*(.30+.70*abs(outward[0]))
        return tuple(amount*q for q in outward)
    return (0., 0., 0.)


def lower_leg_offset(panel, p, u, v, landmarks):
    """One outer knee break and a short calf drape below the hip overlap.

    Apply a continuous radial field to both cloth surfaces. The inner leg,
    rear seam, ankle opening and all upper-leg rows stay at the accepted fit.
    No jacket, skin or bone changes are part of this lower-leg pass.
    """
    if panel != 'pants' or not .19 < v < .52 or not .06 < u < .94:
        return (0., 0., 0.)
    x, y, z = p
    side = 'l' if x > 0. else 'r'
    hip, ankle = (landmarks[name+'_'+side] for name in ('thigh', 'foot'))
    along = min(1., max(0., (hip[2]-z)/(hip[2]-ankle[2])))
    center = tuple(hip[k]+(ankle[k]-hip[k])*along for k in range(3))
    radial = (x-center[0], y-center[1], 0.)
    outward = unit(radial)
    lateral = outward[0]*(1. if x > 0. else -1.)
    support = window(.19, .25, .46, .52, v) * window(.06, .10, .90, .94, u)
    support *= smooth(-.10, .35, lateral) * (1.-smooth(.20, .70, outward[1]))
    if support == 0.:
        return (0., 0., 0.)
    angle = math.atan2(lateral, -outward[1])
    # Unequal sloping flanks replace a full ring. A smaller lengthwise ridge
    # carries the fold toward the calf, with no repeated corrugation pattern.
    knee = folded_ridge(v-.385-.065*lateral, .045, .0045)
    drape = folded_ridge(angle-.90-.45*(v-.32), .30, .0022)
    drape *= window(.21, .27, .38, .45, v)
    amount = .005*math.tanh((knee+drape-.0012)*support/.005)
    return tuple(amount*q for q in outward)


def jacket_tension_offset(panel, p, u, v, landmarks):
    """Oblique cotton pulls on the exposed upper sleeve and lateral waist.

    Pull the broad panels inward instead of adding volume to their crests.
    The unequal neighboring flank leaves a folded plane rather than a ring.
    Both cloth surfaces receive the same field; the inner elbow, shoulder
    overlap, cuffs, lapels, front opening and all trousers remain excluded.
    """
    x, y, z = p
    if panel == 'sleeve':
        support = window(.40, .47, .63, .73, v) * window(.52, .64, .88, .96, u)
        support *= smooth(.31, .40, abs(x))
        if support == 0.:
            return (0., 0., 0.)
        side = 'l' if x > 0. else 'r'
        shoulder, wrist = (landmarks[name+'_'+side] for name in ('upperarm', 'hand'))
        axis = unit(sub(wrist, shoulder))
        start = tuple(shoulder[k]-.155*axis[k] for k in range(3))
        center = tuple(start[k]+(wrist[k]-start[k])*v*.97 for k in range(3))
        radial = sub(p, center)
        outward = unit(sub(radial, tuple(dot(radial, axis)*q for q in axis)))
        pull = folded_ridge(u-.735-.24*(v-.53), .070, -.0054)
        pull += folded_ridge(v-.54+.24*(u-.73), .050, -.0022) * window(.60, .66, .79, .85, u)
        amount = .005*math.tanh((pull-.0008)*support/.005)
        return tuple(amount*q for q in outward)
    if panel == 'torso':
        support = window(.14, .22, .78, .86, u) * window(.39, .47, .65, .73, v)
        support *= 1.-smooth(1.325, 1.365, z)
        support *= 1.-smooth(.020, .070, -y)*(1.-smooth(.105, .140, abs(x)))
        if support == 0.:
            return (0., 0., 0.)
        outward = unit((x, y-.018, 0.))
        pull = folded_ridge(u-.29+.22*(v-.48), .050, -.0045)
        pull += folded_ridge(u-.73-.16*(v-.48), .060, -.0037)
        amount = .005*math.tanh((pull-.0006)*support/.005)
        return tuple(amount*q for q in outward)
    return (0., 0., 0.)


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


def adjust_frames(old, new, normals, tangents, indices, joints, weights, audit=None):
    old_sum = [[0., 0., 0.] for _ in old]
    new_sum = [[0., 0., 0.] for _ in old]
    changed = set()
    for k in range(0, len(indices), 3):
        ids = indices[k:k+3]
        a = cross(sub(old[ids[1]], old[ids[0]]), sub(old[ids[2]], old[ids[0]]))
        b = cross(sub(new[ids[1]], new[ids[0]]), sub(new[ids[2]], new[ids[0]]))
        if dot(a, a) > 1e-20 and dot(a, b) <= 0.:
            raise ValueError('Sculpt inverted a triangle')
        if audit is not None and dot(a, a) > 1e-20:
            audit['minimumTriangleAreaRatio'] = min(audit.get('minimumTriangleAreaRatio', 1.),
                math.sqrt(dot(b, b)/dot(a, a)))
            audit['minimumTriangleNormalDot'] = min(audit.get('minimumTriangleNormalDot', 1.),
                dot(unit(a), unit(b)))
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
    original_doc = copy.deepcopy(doc)
    proof = {'version': 9, 'changes': [], 'maximumFaceOffsetMeters': 0., 'maximumClothOffsetMeters': 0.,
             'maximumShoulderCrownOffsetMeters': 0., 'shoulderCrownOffsetLimitMeters': .0035,
             'maximumJacketFitOffsetMeters': 0., 'jacketFitOffsetLimitMeters': .005,
             'maximumJacketTensionOffsetMeters': 0., 'jacketTensionOffsetLimitMeters': .005,
             'maximumLowerLegOffsetMeters': 0., 'lowerLegOffsetLimitMeters': .005,
             'clothOffsetLimitMeters': MAX_CLOTH_OFFSET,
             'clothBoundsExpansionLimitMeters': MAX_CLOTH_BOUNDS_EXPANSION}
    handled = set()
    updated_bounds = []
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
            inverse_binds = mesh_file.read(skin['inverseBindMatrices'])
            rows, translation = rigid_frame(inverse_binds[root_index[0]])
            landmarks = {}
            for joint_index, joint in enumerate(skin['joints']):
                name = doc['nodes'][joint]['name']
                if name in {prefix+'_'+side for prefix in ('upperarm', 'hand', 'thigh', 'foot') for side in ('l', 'r')}:
                    rotation, origin = rigid_frame(inverse_binds[joint_index])
                    world = tuple(-sum(rotation[j][axis]*origin[j] for j in range(3)) for axis in range(3))
                    landmarks[name] = tuple(dot(row, world)+translation[j] for j, row in enumerate(rows))
            if len(landmarks) != 8:
                raise ValueError('Missing original limb landmarks')
            for primitive in doc['meshes'][node['mesh']]['primitives']:
                if primitive.get('mode', 4) != 4 or 'targets' in primitive:
                    raise ValueError('Sculpt requires triangle mesh without morph targets')
                attributes = primitive['attributes']; key = attributes['POSITION']
                if key in handled:
                    raise ValueError('Unexpected shared sculpt POSITION accessor')
                handled.add(key)
                positions = mesh_file.read(key); normals = mesh_file.read(attributes['NORMAL'])
                tangents = mesh_file.read(attributes['TANGENT'])
                joints, weights = mesh_file.read(attributes['JOINTS_0']), mesh_file.read(attributes['WEIGHTS_0'])
                uvs = mesh_file.read(attributes['TEXCOORD_1']) if part != 'Body' else None
                shared_panels = {}
                if uvs is not None:
                    # Source trouser seam triangles sometimes replace an
                    # interior u with 1 on a UV copy. Use the retained interior
                    # coordinate for every copy of that same skinned point;
                    # UVs themselves remain exact and geometry cannot crack.
                    for i, p in enumerate(positions):
                        panel, u, v = panel_at(uvs[i])
                        seam_key = (p, joints[i], weights[i], panel)
                        previous = shared_panels.get(seam_key)
                        if previous is None or min(u, 1.-u) > min(previous[1], 1.-previous[1]):
                            shared_panels[seam_key] = (panel, u, v)
                result = []; moved = 0; maximum = 0.; panel_maxima = {}
                fitted = 0; fit_maximum = 0.
                tension_count = 0; tension_maximum = 0.
                crown_count = 0; crown_maximum = 0.
                lower_leg_count = 0; lower_leg_maximum = 0.
                for i, p in enumerate(positions):
                    canonical = tuple(dot(row, p)+translation[j] for j, row in enumerate(rows))
                    if part == 'Body':
                        delta = face_offset(canonical)
                    else:
                        panel, _, _ = panel_at(uvs[i])
                        panel, u, v = shared_panels[(p, joints[i], weights[i], panel)]
                        delta = cloth_offset(panel, canonical, u, v, landmarks)
                        if part == 'GiJacket':
                            if panel in ('torso', 'sleeve'):
                                crown = shoulder_crown_offset(canonical)
                                crown_distance = math.sqrt(dot(crown, crown))
                                if crown_distance > .003500001:
                                    raise ValueError('Shoulder crown exceeded its separate 3.5 mm bound')
                                if crown_distance > 1e-10:
                                    crown_count += 1
                                    crown_maximum = max(crown_maximum, crown_distance)
                                # The common shoulder field is already included
                                # in cloth_offset; only record its bound here.
                            fit = jacket_fit_offset(panel, canonical, u, v, landmarks)
                            fit_distance = math.sqrt(dot(fit, fit))
                            if fit_distance > .005000001:
                                raise ValueError('Jacket fit exceeded its separate 5 mm bound')
                            if fit_distance > 1e-10:
                                fitted += 1
                                fit_maximum = max(fit_maximum, fit_distance)
                                delta = tuple(delta[k]+fit[k] for k in range(3))
                            tension = jacket_tension_offset(panel, canonical, u, v, landmarks)
                            tension_distance = math.sqrt(dot(tension, tension))
                            if tension_distance > .005000001:
                                raise ValueError('Jacket tension exceeded its separate 5 mm bound')
                            if tension_distance > 1e-10:
                                tension_count += 1
                                tension_maximum = max(tension_maximum, tension_distance)
                                delta = tuple(delta[k]+tension[k] for k in range(3))
                        if part == 'GiPantsMesh':
                            lower_leg = lower_leg_offset(panel, canonical, u, v, landmarks)
                            lower_leg_distance = math.sqrt(dot(lower_leg, lower_leg))
                            if lower_leg_distance > .005000001:
                                raise ValueError('Lower-leg fold exceeded its separate 5 mm bound')
                            if lower_leg_distance > 1e-10:
                                lower_leg_count += 1
                                lower_leg_maximum = max(lower_leg_maximum, lower_leg_distance)
                                delta = tuple(delta[k]+lower_leg[k] for k in range(3))
                    distance = math.sqrt(dot(delta, delta))
                    if part != 'Body':
                        if distance > MAX_CLOTH_OFFSET:
                            raise ValueError('Cloth displacement exceeded the regional envelope')
                        panel_maxima[panel] = max(panel_maxima.get(panel, 0.), distance)
                    if distance < 1e-10:
                        result.append(p); continue
                    change = tuple(sum(rows[j][axis]*delta[j] for j in range(3)) for axis in range(3))
                    result.append(tuple(p[axis]+change[axis] for axis in range(3)))
                    moved += 1; maximum = max(maximum, distance)
                accessor = doc['accessors'][key]
                allowance = MAX_CLOTH_BOUNDS_EXPANSION if part != 'Body' else 0.
                if any(p[axis] < accessor['min'][axis]-allowance-1e-7 or p[axis] > accessor['max'][axis]+allowance+1e-7
                       for p in result for axis in range(3)):
                    raise ValueError('Local sculpt escaped its whole-mesh envelope')
                expansion = max(0., max(accessor['min'][axis]-p[axis] for p in result for axis in range(3)),
                                max(p[axis]-accessor['max'][axis] for p in result for axis in range(3)))
                indices = [v[0] for v in mesh_file.read(primitive['indices'])]
                audit = {}
                new_n, new_t = adjust_frames(positions, result, normals, tangents, indices, joints, weights, audit)
                if part != 'Body' and (audit['minimumTriangleAreaRatio'] < .65
                                       or audit['minimumTriangleNormalDot'] < .85):
                    raise ValueError('Cloth fit excessively compressed or tilted a triangle')
                mesh_file.write(key, result); mesh_file.write(attributes['NORMAL'], new_n)
                mesh_file.write(attributes['TANGENT'], new_t)
                # glTF bounds describe stored float32 values, not the old mesh
                # envelope or Python's intermediate double-precision values.
                # A narrower silhouette can move the actual extrema inward.
                if moved:
                    stored = mesh_file.read(key)
                    accessor['min'] = [min(p[axis] for p in stored) for axis in range(3)]
                    accessor['max'] = [max(p[axis] for p in stored) for axis in range(3)]
                    updated_bounds.append(key)
                proof['changes'].append({'role': role, 'part': part, 'verticesMoved': moved,
                    'maximumOffsetMeters': maximum, 'panelMaximumOffsetsMeters': panel_maxima,
                    'jacketFitVertices': fitted, 'maximumJacketFitOffsetMeters': fit_maximum,
                    'jacketTensionVertices': tension_count, 'maximumJacketTensionOffsetMeters': tension_maximum,
                    'shoulderCrownVertices': crown_count, 'maximumShoulderCrownOffsetMeters': crown_maximum,
                    'lowerLegVertices': lower_leg_count, 'maximumLowerLegOffsetMeters': lower_leg_maximum,
                    'maximumOriginalBoundsExpansionMeters': expansion, **audit})
                proof['maximumJacketFitOffsetMeters'] = max(proof['maximumJacketFitOffsetMeters'], fit_maximum)
                proof['maximumJacketTensionOffsetMeters'] = max(proof['maximumJacketTensionOffsetMeters'], tension_maximum)
                proof['maximumShoulderCrownOffsetMeters'] = max(proof['maximumShoulderCrownOffsetMeters'], crown_maximum)
                proof['maximumLowerLegOffsetMeters'] = max(proof['maximumLowerLegOffsetMeters'], lower_leg_maximum)
                bound = 'maximumFaceOffsetMeters' if part == 'Body' else 'maximumClothOffsetMeters'
                proof[bound] = max(proof[bound], maximum)
    binary = bytes(mesh_file.data[mesh_file.start:])
    if any(a != b and i+mesh_file.start not in mesh_file.allowed
           for i, (a, b) in enumerate(zip(raw[mesh_file.start:], binary))):
        raise AssertionError('Changed bytes outside sculpt attribute allowlist')
    expected = copy.deepcopy(original_doc)
    for index in updated_bounds:
        for key in ('min', 'max'):
            expected['accessors'][index][key] = doc['accessors'][index][key]
    if doc != expected:
        raise AssertionError('Changed JSON outside sculpt POSITION bounds')
    encoded = json.dumps(doc, separators=(',', ':')).encode('utf8')
    encoded += b' ' * (-len(encoded) % 4)
    result = (struct.pack('<III', 0x46546c67, 2, 28+len(encoded)+len(binary))
              + struct.pack('<II', len(encoded), 0x4e4f534a) + encoded
              + struct.pack('<II', len(binary), 0x004e4942) + binary)
    proof.update(sourceSha256=hashlib.sha256(raw).hexdigest(), importSha256=hashlib.sha256(result).hexdigest(),
        scopedPositionBoundsOnly=True, positionBoundsAccessors=updated_bounds,
        protectedBinaryBytesUnchanged=True, binaryByteLengthUnchanged=True,
        scope='Accepted face, trousers and jacket fit retained; bounded shared shoulder crown easing outside protected neckline, underarm, elbow and cuff boundaries; original source retained',
        limitations=['Rest-pose triangle/frame checks do not establish every posed contact or skin clearance.',
                     'Covered body skin, hands, cuffs, lapels, rig, motion and texture coordinates are not reauthored.',
                     'Baked cloth shapes suggest anatomy; no dynamic cloth or muscle simulation.'])
    return result, proof
