"""Author a loose, skinned BJJ uniform on JiuQuest's rest skeleton.

Jacket panels are authored separately; trousers reshape the fitted pelvis mesh
to preserve a continuous crotch and knee skinning while adding garment ease.
The cotton normal/roughness maps are CC0 ambientCG Fabric042; see assets README.
"""
from __future__ import annotations

import math
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector
from mathutils.kdtree import KDTree

TAU = math.tau
ROOT = Path(__file__).resolve().parent


def mix(a, b, t):
    return a + (b - a) * t


def smooth(t):
    t = max(0., min(1., t))
    return t * t * (3. - 2. * t)


def normalized(weights):
    weights = {name: max(0., value) for name, value in weights.items() if value > 0.0001}
    total = sum(weights.values()) or 1.
    return {name: value / total for name, value in weights.items()}


class ClothMesh:
    def __init__(self):
        self.vertices, self.faces, self.uvs, self.weights = [], [], [], []

    def vertex(self, point, uv, weights):
        index = len(self.vertices)
        self.vertices.append(tuple(point)); self.uvs.append(uv)
        self.weights.append(normalized(weights))
        return index

    def grid(self, rows, columns, sample, keep=None, reverse=False):
        start = len(self.vertices)
        for row in range(rows + 1):
            for column in range(columns + 1):
                point, uv, weights = sample(row / rows, column / columns)
                self.vertex(point, uv, weights)
        for row in range(rows):
            for column in range(columns):
                a = start + row * (columns + 1) + column
                face = (a, a + 1, a + columns + 2, a + columns + 1)
                center = sum((Vector(self.vertices[i]) for i in face), Vector()) / 4
                if keep is None or keep(center):
                    self.faces.append(tuple(reversed(face)) if reverse else face)

    def create(self, name, armature, material, thickness=0.003):
        mesh = bpy.data.meshes.new(name + '_Mesh')
        mesh.from_pydata(self.vertices, [], self.faces); mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        obj.parent = armature
        mesh.materials.append(material)
        uv = mesh.uv_layers.new(name='UVMap')
        for polygon in mesh.polygons:
            polygon.use_smooth = True
            for loop in polygon.loop_indices:
                uv.data[loop].uv = self.uvs[mesh.loops[loop].vertex_index]
        groups = {}
        for index, weights in enumerate(self.weights):
            for bone, weight in weights.items():
                if bone not in armature.data.bones:
                    raise ValueError('Missing uniform bone ' + bone)
                group = groups.setdefault(bone, obj.vertex_groups.get(bone) or obj.vertex_groups.new(name=bone))
                group.add([index], weight, 'REPLACE')
        if thickness:
            bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            solid = obj.modifiers.new('Cotton fabric thickness', 'SOLIDIFY')
            solid.thickness = thickness; solid.offset = -1.; solid.use_even_offset = True
            bpy.ops.object.modifier_apply(modifier=solid.name)
        skin = obj.modifiers.new('Deform with athlete', 'ARMATURE')
        skin.object = armature
        return obj


def cotton_material(material, *, normal_strength=0.22):
    """Keep tint neutral and let small woven normals carry textile detail."""
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
    shader.inputs['Metallic'].default_value = 0.
    shader.inputs['Roughness'].default_value = 0.86
    shader.inputs['Coat Weight'].default_value = 0.
    shader.inputs['Sheen Weight'].default_value = 0.16
    texture_dir = ROOT / 'assets/jiuquest-gi/Fabric042'
    normal_path = texture_dir / 'Fabric042_1K-JPG_NormalGL.jpg'
    rough_path = texture_dir / 'Fabric042_1K-JPG_Roughness.jpg'
    if not normal_path.exists() or not rough_path.exists():
        raise FileNotFoundError('The approved cotton texture maps are missing')
    for label, path in [('Cotton normal', normal_path), ('Cotton roughness', rough_path)]:
        image = bpy.data.images.load(str(path), check_existing=True)
        image.colorspace_settings.name = 'Non-Color'
        node = nodes.new('ShaderNodeTexImage'); node.name = label; node.image = image
        node.extension = 'REPEAT'
        if label == 'Cotton normal':
            normal = nodes.new('ShaderNodeNormalMap')
            normal.inputs['Strength'].default_value = normal_strength
            links.new(node.outputs['Color'], normal.inputs['Color'])
            links.new(normal.outputs['Normal'], shader.inputs['Normal'])
        else:
            links.new(node.outputs['Color'], shader.inputs['Roughness'])


def build_realistic_gi(body, armature, root, materials, prefix):
    """Return torso/sleeves, trousers and woven belt in original rig coordinates."""
    bones = armature.data.bones
    bone_head = lambda name: bones[name].head_local.copy()
    pelvis = bone_head('pelvis')
    shoulder_z = bone_head('upperarm_l').z
    neck_z = bone_head('neck_01').z + 0.040
    waist_z = pelvis.z + 0.105
    hem_z = pelvis.z - 0.115
    center_y = 0.018

    def torso_weights(z):
        stations = [('pelvis', pelvis.z), ('spine_01', bone_head('spine_01').z),
                    ('spine_02', bone_head('spine_02').z), ('spine_03', bone_head('spine_03').z)]
        if z <= stations[0][1]: return {stations[0][0]: 1.}
        for (a, za), (b, zb) in zip(stations, stations[1:]):
            if z <= zb:
                t = smooth((z - za) / (zb - za)); return {a: 1. - t, b: t}
        return {'spine_03': 1.}

    def torso_radius(z):
        if z < waist_z:
            t = (z - hem_z) / (waist_z - hem_z)
            return mix(.235, .195, t), mix(.155, .13, t)
        crown_z = shoulder_z + .035
        if z < crown_z:
            t = (z - waist_z) / (crown_z - waist_z)
            return mix(.195, .246, t), mix(.13, .151, t)
        t = smooth((z - crown_z) / (neck_z - crown_z))
        return mix(.246, .073, t), mix(.151, .072, t)

    for name in ('gi_top', 'gi_pants', 'belt'):
        cotton_material(materials[name], normal_strength=.18 if name == 'belt' else .22)

    jacket = ClothMesh()
    v_bottom = 1.205
    def torso(t, u):
        z = mix(hem_z, neck_z, t)
        rx, ry = torso_radius(z)
        edge_x = .066 * max(0., (z - v_bottom) / (neck_z - v_bottom))
        edge_angle = math.asin(min(.97, edge_x / rx))
        # Parameterize the actual opening boundary. Removing grid faces leaves
        # staircase edges that remain visible beside the lapel in close views.
        theta = mix(edge_angle, TAU - edge_angle, u)
        folds = (.0025 * math.sin(theta * 11 + t * 8)
                 + .003 * math.sin(theta * 19 - t * 14)) * (1. - .45 * t)
        point = Vector(((rx + folds) * math.sin(theta), center_y - (ry + folds) * math.cos(theta), z))
        return point, (u * 5.5, t * 3.8), torso_weights(z)
    jacket.grid(42, 72, torso)

    # Skinned overlapping collar panels bend with all spine sections.
    for side in (-1., 1.):
        def lapel(t, u, side=side):
            z = mix(neck_z, waist_z - .04, t)
            x = side * (.066 * (z - v_bottom) / (neck_z - v_bottom))
            rx, ry = torso_radius(z)
            y = center_y - ry * math.sqrt(max(.05, 1. - (x / rx) ** 2)) - .011
            width = .039
            across = (u - .5) * width
            point = Vector((x + across, y - .004 * math.sin(u * math.pi), z + across * side * .31))
            return point, (u * .45, t * 3.6), torso_weights(z)
        jacket.grid(24, 5, lapel, reverse=True)

    # Sleeves follow the actual upper/lower-arm rest axis, with roomy cuffs.
    for suffix in ('l', 'r'):
        shoulder, elbow, wrist = (bone_head(n + '_' + suffix) for n in ('upperarm', 'lowerarm', 'hand'))
        axis = (wrist - shoulder).normalized()
        basis_a = Vector((0, 0, 1)); basis_b = axis.cross(basis_a).normalized()
        def sleeve(t, u, suffix=suffix, shoulder=shoulder, elbow=elbow, wrist=wrist, basis_a=basis_a, basis_b=basis_b):
            # Begin the sleeve inside the torso. A sleeve beginning exactly at
            # the upper-arm joint exposes the deltoid when the arm bends down.
            start = shoulder - (wrist - shoulder).normalized() * .155
            center = start.lerp(wrist, t * .97)
            angle = u * TAU
            radius = mix(.093, .056, t) + .003 * math.sin(t * math.pi)
            radius *= mix(.40, 1., smooth(t / .21))
            fold = (.0017 * math.sin(t * 37 + angle * 2) + .001 * math.sin(angle * 9 + t * 12))
            point = center + (basis_a * math.cos(angle) + basis_b * math.sin(angle) * 1.18) * (radius + fold)
            elbow_t = (elbow - start).length / (wrist - start).length
            low = smooth((t - elbow_t + .11) / .22)
            weights = {'upperarm_' + suffix: 1. - low, 'lowerarm_' + suffix: low}
            if t < .31:
                upper = smooth(t / .31)
                weights = {'spine_03': (1. - upper) * .80, 'clavicle_' + suffix: .20 * (1. - upper), 'upperarm_' + suffix: upper}
            return point, (u * 2., t * 4.2), weights
        jacket.grid(28, 28, sleeve)

    belt = ClothMesh()
    def belt_wrap(t, u):
        theta = u * TAU
        z = waist_z + (t - .5) * .052
        return (.207 * math.sin(theta), center_y - .144 * math.cos(theta), z), (u * 6., t * .7), torso_weights(waist_z)
    belt.grid(3, 64, belt_wrap)
    for side in (-1., 1.):
        def tail(t, u, side=side):
            x = side * (.022 + .036 * t) + (u - .5) * .043
            y = center_y - .17 - .014 * math.sin(t * math.pi)
            z = waist_z - .025 - .25 * t
            return (x, y, z), (u * .55, t * 2.2), torso_weights(waist_z)
        belt.grid(16, 4, tail, reverse=True)
    def knot(t, u):
        angle = t * TAU
        point = (.041 * math.cos(angle), center_y - .165 - .014 * math.sin(angle), waist_z + (u - .5) * .044)
        return point, (t * .9, u * .6), torso_weights(waist_z)
    belt.grid(20, 3, knot)

    jacket_obj = jacket.create(prefix + '_GiJacket', armature, materials['gi_top'], .0035)
    transfer_cloth_weights(jacket_obj, body)
    pants_obj = fitted_trousers(body, armature, materials['gi_pants'], prefix, waist_z)
    belt_obj = belt.create(prefix + '_Belt', armature, materials['belt'], .004)
    for index in range(1, 5):
        stripe = ClothMesh()
        def stripe_patch(t, u, index=index):
            center_t = .67 + index * .055
            x = .022 + .036 * center_t + (u - .5) * .044
            y = center_y - .173 - .014 * math.sin(center_t * math.pi)
            z = waist_z - .025 - .25 * center_t + (t - .5) * .009
            return (x, y, z), (u, t), torso_weights(waist_z)
        stripe.grid(1, 1, stripe_patch)
        stripe.create(prefix + '_BeltStripe_' + str(index), armature, materials['stripe'], .001)

    for name in ('ChestPatch', 'Lapel_L', 'Lapel_R'):
        attachment = bpy.data.objects.new(prefix + '_' + name, None)
        bpy.context.collection.objects.link(attachment); attachment.parent = armature
    return jacket_obj, pants_obj, belt_obj


def transfer_cloth_weights(garment, body):
    """Fit shoulder/elbow skinning to the athlete instead of disconnected rings.

    Both meshes are in the same armature rest space. Four nearby surface
    vertices contribute smoothly; retain only the strongest four bone weights
    so Blender preview and the glTF's four-influence export agree.
    """
    tree = KDTree(len(body.data.vertices))
    for vertex in body.data.vertices: tree.insert(vertex.co, vertex.index)
    tree.balance()
    names = {g.index: g.name for g in body.vertex_groups}
    garment.vertex_groups.clear()
    groups = {name: garment.vertex_groups.new(name=name) for name in names.values()}
    for vertex in garment.data.vertices:
        weights = {}
        for _, index, distance in tree.find_n(vertex.co, 4):
            contribution = 1. / max(distance, .002) ** 2
            for group in body.data.vertices[index].groups:
                name = names[group.group]
                weights[name] = weights.get(name, 0.) + group.weight * contribution
        strongest = normalized(dict(sorted(weights.items(), key=lambda pair: -pair[1])[:4]))
        for name, weight in strongest.items(): groups[name].add([vertex.index], weight, 'REPLACE')


def fitted_trousers(body, armature, material, prefix, waist_z):
    """Continuous trousers with extra ease, using the source's joint weights."""
    obj = body.copy(); obj.data = body.data.copy()
    obj.name = prefix + '_GiPantsMesh'
    bpy.context.collection.objects.link(obj)
    obj.data.materials.clear(); obj.data.materials.append(material)
    for modifier in list(obj.modifiers): obj.modifiers.remove(modifier)
    bm = bmesh.new(); bm.from_mesh(obj.data)
    for z, sign in [(waist_z + .025, 1.), (.129, -1.)]:
        bmesh.ops.bisect_plane(bm, geom=list(bm.verts)+list(bm.edges)+list(bm.faces),
            plane_co=(0, 0, z), plane_no=(0, 0, sign), dist=.00001,
            clear_outer=True, clear_inner=False)
    # Remove the internal/detail geometry rather than preserving an anatomical
    # bulge below the garment. Relax only the central crotch, not knees/cuffs.
    central = [v for v in bm.verts if abs(v.co.x) < .075 and .80 < v.co.z < .96]
    for _ in range(4):
        bmesh.ops.smooth_vert(bm, verts=central, factor=.45, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    for v in bm.verts:
        p = v.co; side = 'l' if p.x >= 0 else 'r'
        hip = armature.data.bones['thigh_' + side].head_local
        ankle = armature.data.bones['foot_' + side].head_local
        t = max(0., min(1., (hip.z - p.z)/(hip.z - ankle.z)))
        center = hip.lerp(ankle, t)
        delta = Vector((p.x-center.x, p.y-center.y, 0))
        length = delta.length
        lower_blend = smooth((.94-p.z)/.13)
        if length > .0001:
            angle = math.atan2(delta.y,delta.x)
            desired = mix(.107,.070,t) + .0017*math.sin(t*39+angle*3)
            inflated = center + delta.normalized()*max(length+.009,desired)
            p.x = mix(p.x,inflated.x,lower_blend)
            p.y = mix(p.y,inflated.y,lower_blend)
        # Hip fabric sits outside the athlete and under the jacket skirt.
        hip_delta = Vector((p.x,p.y-.018,0))
        if hip_delta.length > .0001:
            p.x += hip_delta.normalized().x*.013*(1-lower_blend)
            p.y += hip_delta.normalized().y*.013*(1-lower_blend)
    # Plane cuts can leave n-gons along waist/cuffs. Resolve them before export
    # so every renderer receives the same authored tangent basis for fabric.
    cut_polygons = [face for face in bm.faces if len(face.verts) > 4]
    if cut_polygons:
        bmesh.ops.triangulate(bm, faces=cut_polygons, quad_method='BEAUTY', ngon_method='BEAUTY')
    bm.to_mesh(obj.data); bm.free(); obj.data.update()
    for polygon in obj.data.polygons:
        polygon.material_index=0; polygon.use_smooth=True
    if obj.data.uv_layers.active:
        for uv in obj.data.uv_layers.active.data: uv.uv *= 7.
    bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True)
    bpy.context.view_layer.objects.active=obj
    solid=obj.modifiers.new('Woven cuff thickness','SOLIDIFY'); solid.thickness=.003; solid.offset=-1.
    bpy.ops.object.modifier_apply(modifier=solid.name)
    skin=obj.modifiers.new('Deform with athlete','ARMATURE'); skin.object=armature
    return obj
