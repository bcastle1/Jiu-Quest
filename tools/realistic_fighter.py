"""Assemble a clothed CC0 athlete on the stable paired-choreography rig.

The source is exported MPFB/MakeHuman data; no MPFB add-on or GPL code is
needed by this generator or distributed with the application.
"""
import bpy, bmesh, json, os, sys, math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tools/assets/jiuquest-realistic'
from realistic_gi import build_realistic_gi
from anime_fighter import stylize_anime
optimized_images={}

def limit_weights(obj,limit=4):
    if obj.type!='MESH' or not obj.find_armature():return
    saved=[]
    for vertex in obj.data.vertices:
        weights=sorted([(group.group,group.weight) for group in vertex.groups if group.weight>1e-6],key=lambda row:row[1],reverse=True)[:limit]
        total=sum(weight for _,weight in weights)
        saved.append([(group,weight/total) for group,weight in weights] if total else [])
    indices=list(range(len(obj.data.vertices)))
    for group in obj.vertex_groups:group.remove(indices)
    for index,weights in enumerate(saved):
        for group,weight in weights:obj.vertex_groups[group].add([index],weight,'REPLACE')

def optimized_image(image, maximum, jpeg=False):
    source=bpy.path.abspath(image.filepath)
    key=(source,maximum,jpeg)
    if key in optimized_images:return optimized_images[key]
    destination=OUT/'textures';destination.mkdir(exist_ok=True)
    filename=Path(source).stem+'-'+str(maximum)+('.jpg' if jpeg else '.png')
    if (destination/filename).exists():
        result=bpy.data.images.load(str(destination/filename),check_existing=True)
        result.colorspace_settings.name=image.colorspace_settings.name
        optimized_images[key]=result
        return result
    image=image.copy()
    width,height=image.size
    ratio=min(1,maximum/max(width,height))
    if ratio<1:image.scale(round(width*ratio),round(height*ratio))
    image.filepath_raw=str(destination/filename)
    image.file_format='JPEG' if jpeg else 'PNG'
    image.save(quality=93)
    optimized_images[key]=image
    return image

def hide_covered_body(body):
    """Remove only covered skin after garments have sampled the full rest body."""
    groups={g.index:g.name for g in body.vertex_groups}
    visible=set()
    for vertex in body.data.vertices:
        p=vertex.co
        terminal=sum(g.weight for g in vertex.groups if groups[g.group].startswith(('hand_','thumb_','index_','middle_','ring_','pinky_','foot_','ball_')))
        neck=sum(g.weight for g in vertex.groups if groups[g.group] in {'neck_01','Head'})
        v_width=.016+.061*max(0,min(1,(p.z-1.205)/.30))
        chest=p.z>1.19 and p.z<1.52 and p.y<-.055 and abs(p.x)<v_width
        if terminal>.10 or neck>.06 or p.z>1.49 or chest:visible.add(vertex.index)
    mesh=bmesh.new();mesh.from_mesh(body.data);mesh.verts.ensure_lookup_table()
    delete=[face for face in mesh.faces if not any(v.index in visible for v in face.verts)]
    bmesh.ops.delete(mesh,geom=delete,context='FACES')
    bmesh.ops.delete(mesh,geom=[v for v in mesh.verts if not v.link_faces],context='VERTS')
    mesh.to_mesh(body.data);mesh.free();body.data.update()

def derive_hair(crew, name, mohawk=False):
    obj=crew.copy();obj.data=crew.data.copy();obj.name=name
    bpy.context.scene.collection.objects.link(obj)
    if mohawk:
        mesh=bmesh.new();mesh.from_mesh(obj.data)
        remove=[face for face in mesh.faces if abs(face.calc_center_median().x)>.034 or face.calc_center_median().z<1.69]
        bmesh.ops.delete(mesh,geom=remove,context='FACES')
        bmesh.ops.delete(mesh,geom=[v for v in mesh.verts if not v.link_faces],context='VERTS')
        mesh.to_mesh(obj.data);mesh.free()
    for vertex in obj.data.vertices:
        p=vertex.co
        top=max(0,min(1,(p.z-1.72)/.12))
        if mohawk:p.z+=.027*top*(1-min(1,abs(p.x)/.04))
        else:
            # Several restrained textured tufts; no rigid cartoon cones.
            peaks=(.5+.5*math.cos(p.x*155))*(.5+.5*math.cos((p.y+.03)*132))
            p.z+=.025*top*peaks
    return obj

def image_for(obj):
    for material in obj.data.materials:
        if material and material.node_tree:
            for node in material.node_tree.nodes:
                if node.type=='TEX_IMAGE' and node.image:
                    path=str(OUT/'textures'/Path(node.image.filepath).name)
                    if not Path(path).exists():raise FileNotFoundError('Missing redistributable athlete texture: '+path)
                    return bpy.data.images.load(path,check_existing=True)
    return None

def textured_material(name,image,roughness=.5,cutout=False):
    material=bpy.data.materials.new(name)
    material.use_nodes=True
    shader=material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value=(1,1,1,1)
    shader.inputs['Roughness'].default_value=roughness
    shader.inputs['Metallic'].default_value=0
    if image:
        texture=material.node_tree.nodes.new('ShaderNodeTexImage');texture.image=image
        material.node_tree.links.new(texture.outputs['Color'],shader.inputs['Base Color'])
        if cutout:
            threshold=material.node_tree.nodes.new('ShaderNodeMath')
            threshold.operation='GREATER_THAN';threshold.inputs[1].default_value=.5
            material.node_tree.links.new(texture.outputs['Alpha'],threshold.inputs[0])
            material.node_tree.links.new(threshold.outputs[0],shader.inputs['Alpha'])
            material.surface_render_method='DITHERED'
            material.use_backface_culling=False
    return material

def make_realistic_fighter(role,colors,g):
    prefix='JQ_'+role
    root=g.add_empty(prefix);root.scale=(1,1,1);root['JQ_role']=role.lower()
    requested=['JQ_RealisticRig','Realistic_Body','Realistic_Eyes','Realistic_Eyebrows','Realistic_HairCrew','Realistic_HairSlick','Realistic_HairLong']
    with bpy.data.libraries.load(str(OUT/'athlete-cc0.blend'),link=False) as (src,dst):
        dst.objects=requested.copy()
    loaded={original:obj for original,obj in zip(requested,dst.objects)}
    for obj in loaded.values():bpy.context.scene.collection.objects.link(obj)
    rig=loaded['JQ_RealisticRig'];rig.name=prefix+'_Rig';rig.parent=root
    body=loaded['Realistic_Body']
    for obj in loaded.values():limit_weights(obj)
    for key,suffix,slot,rough,alpha in [('Realistic_Body','Body','Skin_Ref_E9B28D',.56,False),('Realistic_Eyes','Eyes','Eyes',.20,False),('Realistic_Eyebrows','Brows','Brows_Ref_0D0605',.80,True),('Realistic_HairCrew','HairCrew','Hair_Ref_4B3C31',.78,True),('Realistic_HairSlick','HairSlick','Hair_Ref_222323',.78,True),('Realistic_HairLong','HairLong','Hair_Ref_543727',.78,True)]:
        obj=loaded[key];image=image_for(obj)
        material=textured_material(prefix+'_'+slot,image,rough,alpha)
        obj.name=prefix+'_'+suffix
        obj.data.materials.clear();obj.data.materials.append(material)
        for poly in obj.data.polygons:poly.material_index=0
    materials={key:g.make_material(prefix+'_'+name,colors[key],roughness=.75) for key,name in [('gi_top','GiTop'),('gi_pants','GiPants'),('belt','Belt'),('stripe','BeltStripe')]}
    build_realistic_gi(body,rig,root,materials,prefix)
    hide_covered_body(body)
    stylize_anime(loaded,rig,prefix,g.make_material)
    for material in materials.values():
        for node in material.node_tree.nodes:
            if node.type=='TEX_IMAGE' and node.image:
                node.image=optimized_image(node.image,512 if 'Normal' in node.image.name else 256,True)
    for obj in bpy.context.scene.objects:
        if obj.type=='MESH' and obj.find_armature()==rig:limit_weights(obj)
    for bone in rig.pose.bones:bone.rotation_mode='QUATERNION'
    return {'role':role,'root':root,'armature':rig,'base_root':(root.location.copy(),root.rotation_euler.copy(),root.scale.copy()),'pose_bones':[rig.pose.bones[n] for n in g.ANIMATED_BONES]}
