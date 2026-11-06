"""Deterministic adult action-anime styling of the CC0 fitted athlete.

The rest skeleton, skin weights and authored motions are unchanged. Face-space
warps are shared by the face and eyeballs; brows are fitted to the final face.
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
    x = cx + (x-cx) * (1.0 + .18*eye)
    # A narrower adult eye and slightly raised outer corner replace the rounder
    # expression. Apply the identical warp to the face, eyeballs and lid ink.
    z = cz + (z-cz) * (1.0 + .08*eye)
    z += .0022 * min(1., max(-1., (abs(x) - abs(cx)) / .022)) * eye
    # A modest larger cranium and tapered jaw keep an adult athletic silhouette.
    head = smoothstep(1.515, 1.605, z)
    jaw = math.exp(-((z-1.589)/.026)**2) * (1-smoothstep(-.025, .025, y))
    x *= (1.0 + .045*head) * (1.0 - .10*jaw)
    cheek = math.exp(-((abs(x) - .047) / .024) ** 2 - ((z - 1.615) / .023) ** 2)
    cheek *= 1. - smoothstep(-.030, .015, y)
    x += side * .0028 * cheek
    y -= .0024 * cheek
    # Shallow bridge/chin planes give the adult face a readable side profile.
    # The same continuous field reaches every facial mesh, with no raster edit.
    front = 1. - smoothstep(-.065, -.025, y)
    bridge = math.exp(-(x/.012)**2 - ((z-1.630)/.027)**2) * front
    chin = math.exp(-(x/.026)**4 - ((z-1.578)/.014)**2) * front
    y -= .0022 * bridge + .0012 * chin
    y = .0174 + (y-.0174) * (1.0 + .045*head)
    z = 1.5998 + (z-1.5998) * (1.0 + .045*head)
    return Vector((x, y, z))


def hair_mesh(name, rig, style, surface=None):
    vertices, faces, vertex_uvs, face_uvs, face_smooth = [], [], [], [], []

    def face(indices, cap_v=None, smooth=True):
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
                face_smooth.append(smooth)
        else:
            faces.append(indices)
            face_uvs.append(coordinates)
            face_smooth.append(smooth)

    def tube(points, widths, depths):
        # Six-sided asymmetric wedges form two broad painted planes and a
        # narrow ridge. They taper continuously, rather than swelling mid-lock.
        cross_section = ((1., 0.), (.36, .43), (-.10, .58),
                         (-1., 0.), (-.40, -.20), (.55, -.16))
        segments = len(cross_section)
        start = len(vertices)
        for row, (p, width, depth) in enumerate(zip(points, widths, depths)):
            previous = Vector(points[max(0, row - 1)])
            following = Vector(points[min(len(points) - 1, row + 1)])
            axis = (following - previous).normalized()
            # Orient the ridge away from the skull. Side locks therefore lie
            # along the temple instead of inflating laterally like round tubes.
            relief = Vector((p[0]/.09, (p[1]-.008)/.11, (p[2]-1.670)/.106))
            relief -= axis * relief.dot(axis)
            if relief.length_squared < 1e-8:
                relief = Vector((0, -1, 0))
                relief -= axis * relief.dot(axis)
            if relief.length_squared < 1e-8:
                relief = Vector((1, 0, 0))
                relief -= axis * relief.dot(axis)
            relief.normalize()
            side = relief.cross(axis).normalized()
            for j, (across, raised) in enumerate(cross_section):
                co = Vector(p) + side * width * across + relief * depth * raised
                vertices.append(tuple(co))
                vertex_uvs.append((j / segments, row / (len(points) - 1)))
        for row in range(len(points)-1):
            for j in range(segments):
                a=start+row*segments+j; b=start+row*segments+(j+1)%segments
                # Two visible planes retain crisp normal breaks. The narrow
                # ridge/underside stay smooth; this is not another outline pass.
                face((a,b,b+segments,a+segments), smooth=j not in (0, 2))
        face(tuple(start+j for j in reversed(range(segments))), cap_v=0., smooth=False)
        top=start+(len(points)-1)*segments
        face(tuple(top+j for j in range(segments)), cap_v=1., smooth=False)

    # Smooth scalp cap with a forehead hairline and lower coverage behind ears.
    around, rows = 32, 8
    for row in range(rows+1):
        for j in range(around):
            a=math.tau*j/around
            front=max(0.0, -math.sin(a))
            bottom=1.91-.56*front + .018*front*math.cos(3*a)
            theta=.035+(bottom-.035)*row/rows
            co = Vector((.089*math.sin(theta)*math.cos(a),
                         .008+.110*math.sin(theta)*math.sin(a),
                         1.670+.102*math.cos(theta)))
            if surface is not None:
                location, normal, _, _ = surface.find_nearest(co)
                if location is not None and location.z > 1.62 and (co-location).dot(normal) < .0032:
                    co = location + normal * .0032
            vertices.append(tuple(co))
            vertex_uvs.append((j / around, .18 + .64 * (1. - row / rows)))
    for row in range(rows):
        for j in range(around):
            a=row*around+j;b=row*around+(j+1)%around
            face((a,a+around,b+around,b))

    if style in ('Crew', 'Spikes'):
        # Keep the broad middle of each swept lock above the cap. Previously
        # buried midsections left only thin upright tips visible at phone size.
        lifts=(.65, .87, 1., .79, .53)
        for i in range(5):
            x=(i-2)*.027
            edge=abs(i-2)/2
            lean=.046 + .004*i
            sweep=.045 + .007*(i%3)
            height=(.014 if style=='Crew' else .041)*lifts[i]
            root=1.755-edge*.008
            shoulder=1.773-edge*.007+height*.30
            tip=1.773+height
            tube([(x,-.022,root),
                  (x+lean*.20,-.006,shoulder),
                  (x+lean*.64,sweep*.48,tip-.007),
                  (x+lean,sweep,tip)],
                 [.025,.026,.019,.0008], [.024,.022,.016,.0009])
        # Wide planar fringe flows out of the crown before tapering above the
        # eyes. The intermediate surfaces remain visible over the scalp shell.
        for x, fall, sweep in [(-.058,.008,.022),(-.031,.019,.033),(-.004,.006,.040),(.026,-.006,.025)]:
            tube([(x,-.025,1.764),(x+sweep*.28,-.065,1.750),
                  (x+sweep*.70,-.094,1.714-fall*.35),
                  (x+sweep,-.104,1.682-fall)],
                 [.024,.022,.014,.0008], [.023,.021,.014,.0009])
    elif style=='Slick':
        for i,x in enumerate([-.063,-.040,-.015,.010,.035,.058]):
            lift=(.004,.015,.023,.020,.012,.001)[i]
            tube([(x,-.056,1.747),(x+.012,-.003,1.776+lift),
                  (x+.022,.064,1.765+lift),(x+.026,.120,1.709+lift*.40)],
                 [.024,.023,.017,.0008], [.023,.021,.016,.0009])
    elif style=='Mohawk':
        for y,tip in [(-.050,1.791),(-.020,1.812),(.015,1.821),(.050,1.801),(.079,1.774)]:
            tube([(0,y,1.757),(.012,y+.014,1.757+(tip-1.757)*.68),
                  (.032,y+.039,tip)], [.021,.019,.0008], [.027,.023,.0009])
    else:
        # Three separated tapered tail locks replace the single bulbous tube.
        for side, fall in [(-1,.008),(0,0.),(1,.016)]:
            tube([(side*.009,.094,1.704),(side*.016,.140,1.668),
                  (side*.020+.006,.161,1.612-fall),
                  (side*.024+.014,.141,1.555-fall)],
                 [.015,.013,.007,.0004], [.020,.016,.008,.0005])
        for side in (-1,1):
            tube([(side*.061,-.032,1.720),(side*.073,-.045,1.673),
                  (side*.076,-.054,1.627),(side*.067,-.059,1.597)],
                 [.013,.010,.005,.00035], [.018,.013,.007,.00045])

    # Small swept secondary blades keep a broken silhouette without turning
    # the scalp into a helmet or covering the ears. Same Head weights/material.
    for side in (-1, 1):
        tube([(side*.073,-.039,1.699),(side*.079,-.035,1.670),
              (side*.074,-.029,1.644)], [.011,.007,.00035], [.014,.010,.00045])
        tube([(side*.063,.026,1.735),(side*.081,.044,1.716),
              (side*.092,.066,1.695)], [.013,.008,.00035], [.016,.010,.00045])
        tube([(side*.054,.064,1.733),(side*.070,.085,1.710),
              (side*.078,.109,1.683)], [.013,.008,.00035], [.016,.010,.00045])

    mesh=bpy.data.meshes.new(name+'Mesh');mesh.from_pydata(vertices,[],faces);mesh.update()
    uv = mesh.uv_layers.new(name='UVMap')
    for polygon, coordinates in zip(mesh.polygons, face_uvs):
        for loop, coordinate in zip(polygon.loop_indices, coordinates): uv.data[loop].uv = coordinate
    obj=bpy.data.objects.new(name,mesh);bpy.context.scene.collection.objects.link(obj)
    group=obj.vertex_groups.new(name='Head');group.add(list(range(len(vertices))),1.0,'REPLACE')
    modifier=obj.modifiers.new('Armature','ARMATURE');modifier.object=rig
    obj.parent=rig
    for polygon, smooth in zip(mesh.polygons, face_smooth): polygon.use_smooth=smooth
    return obj


def eyebrows_mesh(name,rig,body):
    """Fit continuous ink strips to the already-warped face, not a flat bridge."""
    vertices,faces=[],[]
    surface = BVHTree.FromPolygons([v.co.copy() for v in body.data.vertices],
                                   [list(p.vertices) for p in body.data.polygons])

    def projected(x, z):
        location, normal, _, _ = surface.ray_cast(Vector((x, -.24, z)), Vector((0,1,0)), .24)
        if location is None or location.y >= -.035 or normal.y >= -.08:
            return None
        # Dense independent edge fitting plus 1.2 mm normal clearance prevents
        # curved skin from cutting through a long chord and leaving dotted ink.
        return location + normal.normalized() * .0012

    def ribbon(side, points):
        samples=[]
        for i in range(len(points)-1):
            a,b=points[i],points[i+1]
            steps=max(2,math.ceil(math.hypot(b[0]-a[0],b[1]-a[1])/.00125))
            for step in range(steps):
                t=step/steps
                samples.append(tuple(a[j]+(b[j]-a[j])*t for j in range(3)))
        samples.append(points[-1])
        fitted=[]
        for x,z,width in samples:
            # The authored anchors are in source face space. Warp those anchors
            # once, then project on the final skin; never warp the fitted ribbon.
            low=face_warp(Vector((side*x,-.10,z-width)))
            high=face_warp(Vector((side*x,-.10,z+width)))
            lower=projected(low.x,low.z)
            upper=projected(high.x,high.z)
            if lower is None or upper is None:
                # A partial lid would recreate isolated ink speckles. The
                # source eye texture remains visible if a whole strip cannot fit.
                return
            fitted.append((lower,upper))
        start=len(vertices)
        for lower,upper in fitted: vertices.extend([tuple(lower),tuple(upper)])
        for i in range(len(fitted)-1):
            a=start+i*2; b=a+2
            faces.append((a,a+1,b+1,b) if side==1 else (b,b+1,a+1,a))

    for side in (-1,1):
        ribbon(side, [(.012,1.658,.0015),(.026,1.664,.0025),
                      (.041,1.665,.0020),(.058,1.661,.00055)])
        ribbon(side, [(.014,1.646,.00045),(.022,1.651,.00070),(.032,1.652,.00080),
                      (.043,1.650,.00065),(.052,1.647,.00035)])

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
    # White factor + neutral atlas lets the runtime apply selected hair color once.
    hair_material=make_material(prefix+'_Hair',(1,1,1,1),roughness=.66)
    hair_material.use_nodes = True
    hair_shader = hair_material.node_tree.nodes.get('Principled BSDF')
    hair_image = bpy.data.images.load(str(ensure_surface_map('hair', Path(__file__).resolve().parent / 'assets/jiuquest-realistic/textures')), check_existing=True)
    hair_image.colorspace_settings.name = 'sRGB'
    hair_texture = hair_material.node_tree.nodes.new('ShaderNodeTexImage'); hair_texture.name = 'Original painted strands'; hair_texture.image = hair_image
    hair_texture.extension = 'EXTEND'
    hair_material.node_tree.links.new(hair_texture.outputs['Color'], hair_shader.inputs['Base Color'])
    scalp_surface = BVHTree.FromPolygons([v.co.copy() for v in loaded['Realistic_Body'].data.vertices],
                                        [list(p.vertices) for p in loaded['Realistic_Body'].data.polygons])
    for style in ('Crew','Slick','Long','Mohawk','Spikes'):
        obj=hair_mesh(prefix+'_Hair'+style,rig,style,scalp_surface)
        obj.data.materials.append(hair_material)
    for obj in list(bpy.context.scene.objects):
        if obj.type!='MESH' or obj.find_armature()!=rig: continue
        if not any(token in obj.name for token in ('Body','Eyes','Hair')):continue
        for vertex in obj.data.vertices:
            p=vertex.co.copy()
            vertex.co=face_warp(p)
        obj.data.update()
    # Project on the final face surface. Warping sparse projected strips later
    # makes their edges diverge from the skin between vertices.
    brows=eyebrows_mesh(prefix+'_Brows',rig,loaded['Realistic_Body'])
    brow_material=make_material(prefix+'_Brows',(.035,.018,.012,1),roughness=.85)
    brow_material.use_backface_culling=False
    brows.data.materials.append(brow_material)
