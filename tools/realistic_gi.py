"""Author a loose, skinned BJJ uniform on JiuQuest's rest skeleton.

Jacket panels are authored separately; trousers reshape the fitted pelvis mesh
to preserve a continuous crotch and knee skinning while adding garment ease.
The cotton normal/roughness maps are CC0 ambientCG Fabric042; see assets README.
"""
from __future__ import annotations

import math
import json
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree
from original_surface_maps import panel_uv, ensure_surface_map

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
        self.detail_uvs = []
        self.periodic_pairs = []

    def vertex(self, point, uv, weights, detail_uv=None):
        index = len(self.vertices)
        self.vertices.append(tuple(point)); self.uvs.append(uv)
        self.weights.append(normalized(weights))
        self.detail_uvs.append(detail_uv)
        return index

    def grid(self, rows, columns, sample, keep=None, reverse=False, detail=None, periodic=False):
        start = len(self.vertices)
        for row in range(rows + 1):
            for column in range(columns + 1):
                t, u = row / rows, column / columns
                point, uv, weights = sample(t, u)
                self.vertex(point, uv, weights, detail(t, u) if detail else None)
            if periodic:
                first = start + row * (columns + 1)
                last = first + columns
                # A UV seam is not an open cut through the garment. Keep its
                # separate loop UVs, but join only coincident cylinder endpoints.
                if (Vector(self.vertices[first]) - Vector(self.vertices[last])).length > 1e-7:
                    raise ValueError('Periodic cloth endpoints must coincide')
                names = set(self.weights[first]) | set(self.weights[last])
                if any(abs(self.weights[first].get(name, 0.) - self.weights[last].get(name, 0.)) > 1e-7 for name in names):
                    raise ValueError('Periodic cloth endpoints must share skin weights')
                self.periodic_pairs.append((last, first))
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
        detail_uv = mesh.uv_layers.new(name='JQ_PanelUV') if any(value is not None for value in self.detail_uvs) else None
        for polygon in mesh.polygons:
            polygon.use_smooth = True
            for loop in polygon.loop_indices:
                uv.data[loop].uv = self.uvs[mesh.loops[loop].vertex_index]
                if detail_uv:
                    value = self.detail_uvs[mesh.loops[loop].vertex_index]
                    if value is None: raise ValueError('Every textured cloth panel requires an atlas coordinate')
                    detail_uv.data[loop].uv = value
        mesh.uv_layers.active_index = 0
        groups = {}
        for index, weights in enumerate(self.weights):
            for bone, weight in weights.items():
                if bone not in armature.data.bones:
                    raise ValueError('Missing uniform bone ' + bone)
                group = groups.setdefault(bone, obj.vertex_groups.get(bone) or obj.vertex_groups.new(name=bone))
                group.add([index], weight, 'REPLACE')
        if self.periodic_pairs:
            # Preserve loop UVs and already assigned deform groups while welding
            # only each sleeve/cuff's duplicate longitudinal boundary. Otherwise
            # Solidify closes both coincident cuts with overlapping side walls,
            # producing a dark nick and sharply split normals during grappling.
            joined = bmesh.new()
            try:
                joined.from_mesh(mesh)
                joined.verts.ensure_lookup_table()
                targets = {joined.verts[last]: joined.verts[first] for last, first in self.periodic_pairs}
                bmesh.ops.weld_verts(joined, targetmap=targets)
                joined.normal_update()
                joined.to_mesh(mesh)
            finally:
                joined.free()
            mesh.update()
        if thickness:
            bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            solid = obj.modifiers.new('Cotton fabric thickness', 'SOLIDIFY')
            solid.thickness = thickness; solid.offset = -1.; solid.use_even_offset = True
            bpy.ops.object.modifier_apply(modifier=solid.name)
        skin = obj.modifiers.new('Deform with athlete', 'ARMATURE')
        skin.object = armature
        return obj


def cotton_material(material, *, normal_strength=0.15):
    """UV1 construction paint and UV0 fine cotton relief, both neutral for tinting."""
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
    # Textured cosmetics divide by the neutral white reference at runtime.
    # Retaining the old colored factor would tint the selected gi/belt twice.
    shader.inputs['Base Color'].default_value = (1., 1., 1., 1.)
    shader.inputs['Metallic'].default_value = 0.
    shader.inputs['Roughness'].default_value = 0.90
    shader.inputs['Coat Weight'].default_value = 0.
    shader.inputs['Sheen Weight'].default_value = 0.06
    panel_image = bpy.data.images.load(str(ensure_surface_map('cloth', ROOT / 'assets/jiuquest-realistic/textures')), check_existing=True)
    panel_image.colorspace_settings.name = 'sRGB'
    panel_texture = nodes.new('ShaderNodeTexImage'); panel_texture.name = 'Original stitched panels'; panel_texture.image = panel_image
    panel_texture.extension = 'EXTEND'
    panel_coordinates = nodes.new('ShaderNodeUVMap'); panel_coordinates.uv_map = 'JQ_PanelUV'
    links.new(panel_coordinates.outputs['UV'], panel_texture.inputs['Vector'])
    links.new(panel_texture.outputs['Color'], shader.inputs['Base Color'])
    fabric_coordinates = nodes.new('ShaderNodeUVMap'); fabric_coordinates.uv_map = 'UVMap'
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
        links.new(fabric_coordinates.outputs['UV'], node.inputs['Vector'])
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
    armhole_x = min(abs(bone_head('upperarm_l').x), abs(bone_head('upperarm_r').x))
    neck_z = bone_head('neck_01').z + 0.040
    waist_z = pelvis.z + 0.105
    hem_z = pelvis.z - 0.115
    center_y = 0.018
    # The full body is still present here. Fit the narrowed sleeves to their
    # rest surface before covered skin is removed by realistic_fighter. Keep
    # the buried armhole overlap; the upper torso and sleeves share the same
    # bounded 6 mm skin clearance after shaping the cloth envelope.
    body_points = [vertex.co.copy() for vertex in body.data.vertices]
    body_faces = [tuple(face.vertices) for face in body.data.polygons]
    body_surface = BVHTree.FromPolygons(body_points, body_faces)
    clearance_report = {'fighter': prefix, 'sampleQueries': 0,
                        'correctedSamples': 0, 'maxCorrectionMeters': 0.,
                        'maxCorrectionRegion': None, 'limitMeters': .025,
                        'torsoArmholeBoundaryMeters': armhole_x,
                        'torsoArmholeFadeMeters': .045}

    def clear_body(point, coverage, region):
        clearance_report['sampleQueries'] += 1
        nearest, normal, _, _ = body_surface.find_nearest(point)
        if nearest is not None and normal.length_squared > 1e-8:
            normal = normal.normalized()
            distance = (point - nearest).dot(normal)
            if distance < .006:
                correction = (.006 - distance) * max(0., min(1., coverage))
                if correction > clearance_report['maxCorrectionMeters']:
                    clearance_report['maxCorrectionMeters'] = correction
                    clearance_report['maxCorrectionRegion'] = region
                    clearance_report['maxCorrectionPoint'] = list(point)
                    clearance_report['nearestBodyPoint'] = list(nearest)
                    clearance_report['nearestBodyNormal'] = list(normal)
                # A large projection is a construction defect, not a safe fit.
                # Stop before it can snap the sleeve to a different body region.
                if correction > clearance_report['limitMeters']:
                    print('JiuQuest gi rest-clearance: ' + json.dumps(clearance_report))
                    raise ValueError('Gi rest-clearance exceeds 25 mm in ' + region)
                if correction > 0.:
                    clearance_report['correctedSamples'] += 1
                    point += normal * correction
        return point

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
            # Ease remains below the arms, but the upper chest no longer grows
            # into a broad inflated yoke immediately below the neckline.
            return mix(.195, .236, t), mix(.13, .140, t)
        t = smooth((z - crown_z) / (neck_z - crown_z))
        return mix(.236, .073, t), mix(.140, .072, t)

    for name in ('gi_top', 'gi_pants', 'belt'):
        cotton_material(materials[name], normal_strength=.15 if name == 'belt' else .16)

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
        folds = (.0014 * math.sin(theta * 11 + t * 8)
                 + .0016 * math.sin(theta * 19 - t * 14)) * (1. - .55 * t)
        # A few broad tension folds read at combat distance; fine textile relief
        # remains in the existing cotton map. The belt compresses the waist.
        waist_t = (waist_z - hem_z) / (neck_z - hem_z)
        tension = math.exp(-((t - waist_t - .055) / .11) ** 2)
        folds += .0055 * math.sin(theta * 6 + .35) * tension
        folds += .0030 * math.sin(theta * 5 - t * 5) * (1. - smooth(t / .32))
        # Diagonal drag folds run from the armholes toward the belt. Their
        # shallow valleys interrupt the inflated horizontal shoulder band.
        side = abs(math.sin(theta)) ** 4
        diagonal = .76 - .18 * abs(math.cos(theta))
        folds -= .0032 * math.exp(-((t - diagonal) / .042) ** 2) * side
        folds += .0016 * math.exp(-((t - diagonal + .045) / .055) ** 2) * side
        # A small unbelted skirt drop breaks the rigid cylindrical hem. The
        # waist and opening stay fixed, preserving belt and exposed-chest fit.
        skirt = (1. - smooth(t / .24)) * (.004 + .004 * math.cos(theta) ** 2)
        point = Vector(((rx + folds) * math.sin(theta), center_y - (ry + folds) * math.cos(theta), z - skirt))
        # Keep the reviewed neckline/V opening width; only the narrowed upper
        # torso away from that exposed chest boundary needs projection.
        crown_z = shoulder_z + .035
        upper_fit = smooth((z - waist_z - .045) / .15) * (1. - smooth((z - crown_z) / (neck_z - crown_z)))
        opening_fit = smooth((abs(point.x) - edge_x - .024) / .045)
        # The side of this grid is deliberately buried under the sleeve. Its
        # nearest body surface can be the underside of the T-pose upper arm,
        # whose downward normal would pull the jacket into the armhole. Limit
        # torso fitting to chest/back inside the actual shoulder joints and
        # fade before that junction; sleeve fitting still covers the arms.
        armhole_fit = 1. - smooth((abs(point.x) - armhole_x + .045) / .045)
        point = clear_body(point, upper_fit * opening_fit * armhole_fit, 'torso')
        return point, (u * 5.5, t * 3.8), torso_weights(point.z)
    jacket.grid(42, 72, torso, detail=lambda t, u: panel_uv('torso', u, t))

    # Raised hems are part of the skinned jacket, not rigid attachment bars.
    def hem(t, u):
        point, uv, weights = torso(mix(.008, .045, t), u)
        outward = Vector((point.x, point.y - center_y, 0)).normalized()
        point += outward * (.0017 + .0023 * math.sin(t * math.pi))
        return point, uv, weights
    jacket.grid(3, 72, hem, detail=lambda t, u: panel_uv('torso', u, mix(.008, .045, t)))

    # Skinned overlapping collar panels bend with all spine sections.
    for side in (-1., 1.):
        def lapel(t, u, side=side):
            z = mix(neck_z, waist_z - .04, t)
            x = side * (.066 * (z - v_bottom) / (neck_z - v_bottom))
            rx, ry = torso_radius(z)
            # Collar width and roll taper into the tied waist, rather than
            # behaving as two uniformly raised rigid rails down the chest.
            width = .043 + .007 * math.sin(t * math.pi) - .005 * smooth((t - .73) / .27)
            across = (u - .5) * width
            lapel_x = x + across
            y = center_y - ry * math.sqrt(max(.05, 1. - (lapel_x / rx) ** 2)) - .007
            # The left panel overlaps the right below the V. A shallow turn
            # follows the chest toward the knot, not a uniformly inflated rail.
            overlap = .002 * smooth((t - .60) / .28) * (1. if side > 0 else 0.)
            drape = .0018 * math.sin(t * math.pi) * math.sin(u * math.pi)
            roll = .0023 * math.sin(u * math.pi) ** 1.4
            # Stitch channels belong to this collar surface. Independent thin
            # solidified ribbons had free ends at the shoulder and could pull
            # apart from their supporting panel under different skin weights.
            channel = .0006 * (math.exp(-((u - .16) / .065) ** 2)
                              + math.exp(-((u - .84) / .065) ** 2))
            turn = .0030 * math.sin(t * math.pi) * (u - .5)
            point = Vector((lapel_x, y - roll - drape - overlap + channel,
                            z + across * side * .31 - turn))
            return point, (u * .45, t * 3.6), torso_weights(z)
        jacket.grid(24, 9, lapel, reverse=True, detail=lambda t, u: panel_uv('trim', u, t))
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
            radius = mix(.082, .056, t) + .001 * math.sin(t * math.pi)
            radius *= mix(.40, 1., smooth(t / .21))
            fold = .0006 * math.sin(angle * 5 + t * 8)
            elbow_t = (elbow - start).length / (wrist - start).length
            front = max(0., math.sin(angle) * (1. if suffix == 'l' else -1.)) ** 2
            underarm = max(0., -math.cos(angle)) ** 3
            # Offset compression creases, rather than complete rippled rings,
            # make the elbow read as folded cotton instead of a padded tube.
            crease = elbow_t - .045 + .028 * math.cos(angle)
            fold -= .0045 * math.exp(-((t - crease) / .044) ** 2) * (.15 + .85 * front)
            fold += .0032 * math.exp(-((t - crease - .055) / .055) ** 2) * (.15 + .85 * front)
            fold -= .0030 * math.exp(-((t - .32 - .065 * math.sin(angle)) / .060) ** 2) * underarm
            # Shoulder construction is sewn into this surface. There is no
            # second floating reinforcement shell to silhouette as armor.
            raglan = .29 + .075 * math.sin(angle)
            fold -= .0010 * math.exp(-((t - raglan) / .018) ** 2) * max(0., math.cos(angle))
            # A narrow underarm seam and the existing turned cuff provide
            # construction detail using the same sleeve grid and UV islands.
            fold -= .0012 * math.exp(-((math.cos(angle) + 1.) / .10) ** 2) * smooth(t / .3)
            # A restrained longitudinal fold runs beside the sewn sleeve seam.
            # It fades before both the armhole and cuff, interrupting the round
            # tube without adding a patch, a full compression ring or more bulk.
            fold_window = smooth((t - .28) / .13) * (1. - smooth((t - .80) / .13))
            seam_angle = .62 * (1. if suffix == 'l' else -1.)
            fold -= .0024 * max(0., math.cos(angle - seam_angle)) ** 14 * fold_window
            fold += .0009 * max(0., math.cos(angle - seam_angle - .28)) ** 18 * fold_window
            fold += .0013 * math.exp(-((t - .965) / .028) ** 2)
            oval = mix(1.035, 1.025, smooth(t))
            # Loose cotton hangs slightly below the arm instead of describing
            # a perfectly centered padded tube; fade out before the wrist.
            hang = .005 * math.sin(t * math.pi) ** 2 * (1. - smooth((t - .72) / .22))
            center -= basis_a * hang
            point = center + (basis_a * math.cos(angle) + basis_b * math.sin(angle) * oval) * (radius + fold)
            point = clear_body(point, smooth((t - .20) / .14), 'sleeve_' + suffix)
            low = smooth((t - elbow_t + .11) / .22)
            weights = {'upperarm_' + suffix: 1. - low, 'lowerarm_' + suffix: low}
            if t < .31:
                upper = smooth(t / .31)
                weights = {'spine_03': (1. - upper) * .80, 'clavicle_' + suffix: .20 * (1. - upper), 'upperarm_' + suffix: upper}
            return point, (u * 2., t * 4.2), weights
        jacket.grid(32, 28, sleeve, detail=lambda t, u: panel_uv('sleeve', u, t), periodic=True)
        def cuff(t, u, sample=sleeve, shoulder=shoulder, wrist=wrist):
            sleeve_t = mix(.944, .989, t)
            point, uv, weights = sample(sleeve_t, u)
            start = shoulder - (wrist - shoulder).normalized() * .155
            center = start.lerp(wrist, sleeve_t * .97)
            point += (point - center).normalized() * (.0012 + .0013 * math.sin(t * math.pi))
            return point, uv, weights
        jacket.grid(3, 28, cuff, detail=lambda t, u: panel_uv('sleeve', u, mix(.944, .989, t)), periodic=True)

    belt = ClothMesh()
    def belt_wrap(t, u):
        theta = u * TAU
        z = waist_z + (t - .5) * .052
        return (.207 * math.sin(theta), center_y - .144 * math.cos(theta), z), (u * 6., t * .7), torso_weights(waist_z)
    belt.grid(3, 64, belt_wrap, detail=lambda t, u: panel_uv('trim', t, u))
    for side in (-1., 1.):
        def tail(t, u, side=side):
            x = side * (.022 + .036 * t) + (u - .5) * .043
            y = center_y - .17 - .014 * math.sin(t * math.pi)
            z = waist_z - .025 - .25 * t
            return (x, y, z), (u * .55, t * 2.2), torso_weights(waist_z)
        belt.grid(16, 4, tail, reverse=True, detail=lambda t, u: panel_uv('trim', u, t))
    def knot(t, u):
        angle = t * TAU
        point = (.041 * math.cos(angle), center_y - .165 - .014 * math.sin(angle), waist_z + (u - .5) * .044)
        return point, (t * .9, u * .6), torso_weights(waist_z)
    belt.grid(20, 3, knot, detail=lambda t, u: panel_uv('trim', u, t))

    print('JiuQuest gi rest-clearance: ' + json.dumps(clearance_report))
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
            # Keep loose trouser ease, but exchange repeated circular ripples
            # for broad directional drape and localized bend compression.
            desired = mix(.107, .070, t) - .002 * math.cos(angle * 2)
            desired += .0013 * math.sin(angle * 3 + t * 8)
            knee_z = armature.data.bones['calf_' + side].head_local.z
            knee_t = (hip.z - knee_z) / (hip.z - ankle.z)
            front = max(0., -math.sin(angle)) ** 3
            knee_crease = knee_t + .028 * math.cos(angle)
            desired -= .0035 * math.exp(-((t - knee_crease) / .044) ** 2) * (.25 + .75 * front)
            desired += .0030 * math.exp(-((t - knee_crease - .055) / .060) ** 2) * (.25 + .75 * front)
            # The same knee fabric remains reinforced, but its geometry is
            # nearly flush instead of a raised rounded protective pad.
            panel = 1. - smooth((abs(p.z - knee_z) - .055) / .035)
            desired += .0010 * panel * front
            # One oblique shin fold dies away toward both side seams.
            shin = knee_t + .24 + .035 * math.cos(angle)
            desired += .0025 * math.exp(-((t - shin) / .045) ** 2) * front
            cuff_t = (hip.z - .155) / (hip.z - ankle.z)
            desired += .0030 * math.exp(-((t - cuff_t) / .018) ** 2)
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
        obj.data.uv_layers.active.name = 'UVMap'
        for uv in obj.data.uv_layers.active.data: uv.uv *= 7.
    # Independent atlas coordinates do not replace the reviewed cotton UVs.
    # A seam at the rear of each leg keeps the front knee panels undistorted.
    detail = obj.data.uv_layers.new(name='JQ_PanelUV')
    for polygon in obj.data.polygons:
        coordinates = []
        for loop in polygon.loop_indices:
            p = obj.data.vertices[obj.data.loops[loop].vertex_index].co
            side = 'l' if p.x >= 0 else 'r'
            hip = armature.data.bones['thigh_' + side].head_local
            ankle = armature.data.bones['foot_' + side].head_local
            t = max(0., min(1., (hip.z - p.z) / (hip.z - ankle.z)))
            center = hip.lerp(ankle, t)
            u = (math.atan2(p.x - center.x, -(p.y - center.y)) / TAU + .5) % 1.
            v = (p.z - .129) / (waist_z + .025 - .129)
            coordinates.append((loop, u, v))
        crosses_rear_seam = max(u for _, u, _ in coordinates) - min(u for _, u, _ in coordinates) > .5
        for loop, u, v in coordinates:
            if crosses_rear_seam and u < .5: u = 1.
            detail.data[loop].uv = panel_uv('pants', u, v)
    obj.data.uv_layers.active_index = 0
    bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True)
    bpy.context.view_layer.objects.active=obj
    solid=obj.modifiers.new('Woven cuff thickness','SOLIDIFY'); solid.thickness=.003; solid.offset=-1.
    bpy.ops.object.modifier_apply(modifier=solid.name)
    skin=obj.modifiers.new('Deform with athlete','ARMATURE'); skin.object=armature
    return obj
