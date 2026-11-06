"""Deterministic adult action-anime styling of the CC0 fitted athlete.

The rest skeleton, skin weights and authored motions are unchanged. Face-space
warps are shared by the face, eyeballs and brows so their surfaces stay fitted.
Hair is an authored low-poly solid mesh: no extra maps or alpha overdraw.
"""
import math
import bpy
from mathutils import Vector


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
    z = cz + (z-cz) * (1.0 + .36*eye)
    # A modest larger cranium and tapered jaw keep an adult athletic silhouette.
    head = smoothstep(1.515, 1.605, z)
    jaw = math.exp(-((z-1.589)/.026)**2) * (1-smoothstep(-.025, .025, y))
    x *= (1.0 + .09*head) * (1.0 - .10*jaw)
    y = .0174 + (y-.0174) * (1.0 + .055*head)
    z = 1.5998 + (z-1.5998) * (1.0 + .055*head)
    return Vector((x, y, z))


def hair_mesh(name, rig, style):
    vertices, faces = [], []

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
                ridge *= .64 if ridge >= 0 else .48
                co = Vector(p) + side * width * math.cos(angle) + relief * depth * ridge
                vertices.append(tuple(co))
        for row in range(len(points)-1):
            for j in range(segments):
                a=start+row*segments+j; b=start+row*segments+(j+1)%segments
                faces.append((a,b,b+segments,a+segments))
        faces.append(tuple(start+j for j in reversed(range(segments))))
        top=start+(len(points)-1)*segments
        faces.append(tuple(top+j for j in range(segments)))

    # Smooth scalp cap with a forehead hairline and lower coverage behind ears.
    around, rows = 32, 8
    for row in range(rows+1):
        for j in range(around):
            a=math.tau*j/around
            front=max(0.0, -math.sin(a))
            bottom=1.92-.58*front
            theta=.035+(bottom-.035)*row/rows
            vertices.append((.092*math.sin(theta)*math.cos(a), .008+.115*math.sin(theta)*math.sin(a), 1.670+.106*math.cos(theta)))
    for row in range(rows):
        for j in range(around):
            a=row*around+j;b=row*around+(j+1)%around
            faces.append((a,a+around,b+around,b))

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
        for x, fall, sweep in [(-.047,.012,.021),(-.012,.026,.026),(.030,.009,.015)]:
            tube([(x,-.048,1.731),(x+sweep*.55,-.074,1.710),
                  (x+sweep,-.089,1.682-fall)], [.025,.018,.001], [.021,.015,.001])
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
              (side*.079,-.029,1.639)], [.014,.010,.001], [.017,.013,.001])

    mesh=bpy.data.meshes.new(name+'Mesh');mesh.from_pydata(vertices,[],faces);mesh.update()
    obj=bpy.data.objects.new(name,mesh);bpy.context.scene.collection.objects.link(obj)
    group=obj.vertex_groups.new(name='Head');group.add(list(range(len(vertices))),1.0,'REPLACE')
    modifier=obj.modifiers.new('Armature','ARMATURE');modifier.object=rig
    obj.parent=rig
    for polygon in mesh.polygons: polygon.use_smooth=True
    return obj


def eyebrows_mesh(name,rig):
    vertices,faces=[],[]
    for side in (-1,1):
        start=len(vertices)
        for x,y,z,width in [(.012,-.103,1.656,.0015),(.027,-.101,1.664,.0033),(.042,-.095,1.665,.0028),(.060,-.080,1.658,.0004)]:
            vertices.extend([(side*x,y-.001,z-width),(side*x,y-.001,z+width)])
        for i in range(3):
            a=start+i*2
            faces.append((a,a+1,a+3,a+2) if side==1 else (a+2,a+3,a+1,a))
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
    brows=eyebrows_mesh(prefix+'_Brows',rig)
    brow_material=make_material(prefix+'_Brows',(.035,.018,.012,1),roughness=.85)
    brow_material.use_backface_culling=False
    brows.data.materials.append(brow_material)
    hair_material=make_material(prefix+'_Hair',(.025,.014,.009,1),roughness=.8)
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
