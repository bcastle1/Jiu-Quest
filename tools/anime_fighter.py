"""Deterministic adult action-anime styling of the CC0 fitted athlete.

The rest skeleton, skin weights and authored motions are unchanged. Face-space
warps are shared by the face, eyeballs and brows so their surfaces stay fitted.
Hair is an authored solid mesh with original root-to-tip paint and no alpha overdraw.
"""
import math
from pathlib import Path
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from original_surface_maps import ensure_surface_map


def smoothstep(low, high, value):
    t = min(1.0, max(0.0, (value - low) / (high - low)))
    return t * t * (3.0 - 2.0 * t)


def face_warp(co):
    x, y, z = co
    # Widen the eyes and their sockets together, fading into the cheek planes.
    side = 1 if x >= 0 else -1
    cx, cy, cz = side * .0314, -.077, 1.6434
    eye = math.exp(-((x-cx)/.029)**4 - ((z-cz)/.028)**4)
    eye *= 1.0 - smoothstep(-.049, -.020, y)
    x = cx + (x-cx) * (1.0 + .24*eye)
    # A narrower adult eye and slightly raised outer corner replace the rounder
    # expression. Apply the identical warp to the face, eyeballs and lid ink.
    z = cz + (z-cz) * (1.0 + .25*eye)
    z += .0018 * min(1., max(-1., (abs(x) - abs(cx)) / .022)) * eye
    # A modest larger cranium and tapered jaw keep an adult athletic silhouette.
    head = smoothstep(1.515, 1.605, z)
    jaw = math.exp(-((z-1.589)/.026)**2) * (1-smoothstep(-.025, .025, y))
    x *= (1.0 + .065*head) * (1.0 - .15*jaw)
    cheek = math.exp(-((abs(x) - .047) / .024) ** 2 - ((z - 1.615) / .023) ** 2)
    cheek *= 1. - smoothstep(-.030, .015, y)
    x += side * .0023 * cheek
    y -= .0015 * cheek
    y = .0174 + (y-.0174) * (1.0 + .055*head)
    z = 1.5998 + (z-1.5998) * (1.0 + .055*head)
    return Vector((x, y, z))


def hair_mesh(name, rig, style):
    vertices, faces, vertex_uvs, face_uvs = [], [], [], []

    def face(indices, cap_v=None):
        indices = tuple(indices)
        coordinates = [vertex_uvs[index] for index in indices]
        if cap_v is not None:
            # Planar convex end caps use an explicit fan and a small nonzero UV
            # disc. This avoids Blender's n-gon tangent warning and degenerate
            # UV derivatives without adding vertices or changing the outline.
            center_v = .025 if cap_v == 0. else .975
            coordinates = [(.5 + .12 * math.cos(math.tau * i / len(indices)),
                            center_v + .02 * math.sin(math.tau * i / len(indices)))
                           for i in range(len(indices))]
        elif max(u for u, _ in coordinates) - min(u for u, _ in coordinates) > .5:
            coordinates = [(1. if u < .5 else u, v) for u, v in coordinates]
        if len(indices) > 4:
            for i in range(1, len(indices) - 1):
                faces.append((indices[0], indices[i], indices[i + 1]))
                face_uvs.append([coordinates[0], coordinates[i], coordinates[i + 1]])
        else:
            faces.append(indices)
            face_uvs.append(coordinates)

    def tube(points, widths, depths, segments=8):
        start = len(vertices)
        for row, (p, width, depth) in enumerate(zip(points, widths, depths)):
            previous = Vector(points[max(0, row - 1)])
            following = Vector(points[min(len(points) - 1, row + 1)])
            axis = (following - previous).normalized()
            side = Vector((1, 0, 0))
            if abs(axis.dot(side)) > .92:
                side = Vector((0, 1, 0))
            side = (side - axis * side.dot(axis)).normalized()
            relief = axis.cross(side).normalized()
            for j in range(segments):
                angle = math.tau*j/segments
                # A flattened swept lock, oriented along its curve. The old
                # horizontal round rings produced bulbous repeated spikes.
                ridge = math.sin(angle)
                ridge *= .53 if ridge >= 0 else .40
                co = Vector(p) + side * width * math.cos(angle) + relief * depth * ridge
                vertices.append(tuple(co))
                vertex_uvs.append((j / segments, row / (len(points) - 1)))
        for row in range(len(points)-1):
            for j in range(segments):
                a=start+row*segments+j; b=start+row*segments+(j+1)%segments
                face((a,b,b+segments,a+segments))
        face(tuple(start+j for j in reversed(range(segments))), cap_v=0.)
        top=start+(len(points)-1)*segments
        face(tuple(top+j for j in range(segments)), cap_v=1.)

    # Smooth scalp cap with a forehead hairline and lower coverage behind ears.
    around, rows = 32, 8
    for row in range(rows+1):
        for j in range(around):
            a=math.tau*j/around
            front=max(0.0, -math.sin(a))
            bottom=1.92-.58*front
            theta=.035+(bottom-.035)*row/rows
            vertices.append((.092*math.sin(theta)*math.cos(a), .008+.115*math.sin(theta)*math.sin(a), 1.670+.106*math.cos(theta)))
            vertex_uvs.append((j / around, .18 + .64 * (1. - row / rows)))
    for row in range(rows):
        for j in range(around):
            a=row*around+j;b=row*around+(j+1)%around
            face((a,a+around,b+around,b))

    if style in ('Crew', 'Spikes'):
        height=.022 if style=='Crew' else .064
        lifts=(.69, .91, 1., .82, .58)
        for i in range(5):
            x=(i-2)*.030
            edge=abs(i-2)/2
            lean=.024 + .004*i
            sweep=.018 + .006*(i%3)
            tube([(x,-.006,1.729-edge*.009),
                  (x+lean*.25,-.010,1.750+height*.22*lifts[i]),
                  (x+lean*.70,sweep*.35,1.766+height*.62*lifts[i]),
                  (x+lean,sweep,1.767+height*lifts[i])],
                 [.026,.027,.019,.001], [.035,.028,.019,.001])
        # Three swept fringe locks frame the brow, with distinct curved planes.
        for x, fall, sweep in [(-.053,.014,.025),(-.024,.029,.031),(.007,.018,.028),(.039,.005,.018)]:
            tube([(x,-.048,1.731),(x+sweep*.55,-.074,1.710),
                  (x+sweep,-.092,1.682-fall)], [.022,.016,.0007], [.019,.013,.0007])
    elif style=='Slick':
        for i,x in enumerate([-.055,-.028,0,.028,.055]):
            lift=(.012,.023,.026,.019,.009)[i]
            tube([(x,-.045,1.721),(x+.009,.000,1.750+lift),
                  (x+.016,.069,1.736+lift),(x+.010,.102,1.706)],
                 [.023,.023,.015,.001], [.024,.021,.014,.001])
    elif style=='Mohawk':
        for y,tip in [(-.050,1.795),(-.020,1.814),(.015,1.821),(.050,1.802),(.079,1.778)]:
            tube([(0,y,1.735),(.006,y+.008,(1.735+tip)*.5),
                  (.014,y+.022,tip)], [.024,.020,.001], [.027,.020,.001])
    else:
        # Solid tied ponytail plus two face-framing locks.
        tube([(0,.094,1.699),(0,.145,1.668),(.008,.167,1.610),(.016,.149,1.556)], [.031,.035,.024,.003], [.023,.025,.023,.003])
        for side in [-1,1]:
            tube([(side*.062,-.032,1.717),(side*.077,-.048,1.663),(side*.072,-.057,1.597)], [.018,.013,.001], [.024,.018,.001])

    # Short temple locks finish the hairline without covering ears or changing
    # the existing opaque material, head binding or hairstyle visibility names.
    for side in (-1, 1):
        tube([(side*.074,-.041,1.697),(side*.083,-.035,1.665),
              (side*.079,-.029,1.639)], [.014,.010,.0007], [.017,.013,.0007])
        # Two short overlapping secondary blades break up the smooth helmet
        # edge. They stay above the ears and use the existing Head influence.
        tube([(side*.064,.027,1.734),(side*.089,.039,1.714),
              (side*.098,.053,1.693)], [.017,.013,.0007], [.019,.014,.0007])
        tube([(side*.055,.064,1.732),(side*.078,.084,1.706),
              (side*.083,.099,1.680)], [.018,.013,.0007], [.020,.014,.0007])

    mesh=bpy.data.meshes.new(name+'Mesh');mesh.from_pydata(vertices,[],faces);mesh.update()
    uv = mesh.uv_layers.new(name='UVMap')
    for polygon, coordinates in zip(mesh.polygons, face_uvs):
        for loop, coordinate in zip(polygon.loop_indices, coordinates): uv.data[loop].uv = coordinate
    obj=bpy.data.objects.new(name,mesh);bpy.context.scene.collection.objects.link(obj)
    group=obj.vertex_groups.new(name='Head');group.add(list(range(len(vertices))),1.0,'REPLACE')
    modifier=obj.modifiers.new('Armature','ARMATURE');modifier.object=rig
    obj.parent=rig
    for polygon in mesh.polygons: polygon.use_smooth=True
    return obj


def eyebrows_mesh(name,rig,body):
    vertices,faces=[],[]
    for side in (-1,1):
        start=len(vertices)
        for x,y,z,width in [(.012,-.103,1.656,.0016),(.027,-.101,1.665,.0035),(.042,-.095,1.666,.0029),(.060,-.080,1.659,.0004)]:
            vertices.extend([(side*x,y-.001,z-width),(side*x,y-.001,z+width)])
        for i in range(3):
            a=start+i*2
            faces.append((a,a+1,a+3,a+2) if side==1 else (a+2,a+3,a+1,a))
    # Upper-lid accents are part of the existing brow renderer/material. Project
    # them onto the actual unwarped face surface rather than a floating eye bar.
    surface = BVHTree.FromPolygons([v.co.copy() for v in body.data.vertices],
                                   [list(p.vertices) for p in body.data.polygons])
    for side in (-1, 1):
        ribbon = []
        for x, z, width in [(.014,1.645,.00045),(.022,1.651,.00085),(.032,1.652,.0010),
                            (.043,1.650,.00080),(.052,1.647,.00025)]:
            hit = None
            for lift in (0., .0015, .003):
                location, normal, _, _ = surface.ray_cast(Vector((side*x, -.24, z+lift)), Vector((0,1,0)), .20)
                if location is not None and location.y < -.055:
                    hit = location; break
            if hit is None:
                # Omit an unfitted segment instead of drawing ink across an eye hole.
                if len(ribbon) >= 2:
                    for a, b in zip(ribbon, ribbon[1:]):
                        faces.append((a,a+1,b+1,b) if side==1 else (b,b+1,a+1,a))
                ribbon = []; continue
            index = len(vertices)
            vertices.extend([(hit.x, hit.y-.0006, hit.z-width), (hit.x, hit.y-.0006, hit.z+width)])
            ribbon.append(index)
        for a, b in zip(ribbon, ribbon[1:]):
            faces.append((a,a+1,b+1,b) if side==1 else (b,b+1,a+1,a))
    mesh=bpy.data.meshes.new(name+'Mesh');mesh.from_pydata(vertices,[],faces);mesh.update()
    obj=bpy.data.objects.new(name,mesh);bpy.context.scene.collection.objects.link(obj)
    group=obj.vertex_groups.new(name='Head');group.add(list(range(len(vertices))),1,'REPLACE')
    modifier=obj.modifiers.new('Armature','ARMATURE');modifier.object=rig;obj.parent=rig
    return obj


def stylize_anime(loaded, rig, prefix, make_material):
    """Replace scalp hair and reshape all facial meshes in the same rest space."""
    for key in ('Realistic_HairCrew','Realistic_HairSlick','Realistic_HairLong'):
        old=loaded[key]
        bpy.data.objects.remove(old,do_unlink=True)
    bpy.data.objects.remove(loaded['Realistic_Eyebrows'],do_unlink=True)
    brows=eyebrows_mesh(prefix+'_Brows',rig,loaded['Realistic_Body'])
    brow_material=make_material(prefix+'_Brows',(.035,.018,.012,1),roughness=.85)
    brow_material.use_backface_culling=False
    brows.data.materials.append(brow_material)
    # White factor + neutral atlas lets the runtime apply selected hair color once.
    hair_material=make_material(prefix+'_Hair',(1,1,1,1),roughness=.8)
    hair_material.use_nodes = True
    hair_shader = hair_material.node_tree.nodes.get('Principled BSDF')
    hair_image = bpy.data.images.load(str(ensure_surface_map('hair', Path(__file__).resolve().parent / 'assets/jiuquest-realistic/textures')), check_existing=True)
    hair_image.colorspace_settings.name = 'sRGB'
    hair_texture = hair_material.node_tree.nodes.new('ShaderNodeTexImage'); hair_texture.name = 'Original painted strands'; hair_texture.image = hair_image
    hair_texture.extension = 'EXTEND'
    hair_material.node_tree.links.new(hair_texture.outputs['Color'], hair_shader.inputs['Base Color'])
    for style in ('Crew','Slick','Long','Mohawk','Spikes'):
        obj=hair_mesh(prefix+'_Hair'+style,rig,style)
        obj.data.materials.append(hair_material)
    for obj in list(bpy.context.scene.objects):
        if obj.type!='MESH' or obj.find_armature()!=rig: continue
        if not any(token in obj.name for token in ('Body','Eyes','Brows','Hair')):continue
        for vertex in obj.data.vertices:
            p=vertex.co.copy()
            vertex.co=face_warp(p)
        obj.data.update()
