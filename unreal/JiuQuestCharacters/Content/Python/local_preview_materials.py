"""Color parameters on new local copies; accepted material graphs stay intact."""
import unreal

SKIN_REFERENCE_HEX = '#E9B28D'


def require(value, message):
    if not value:raise RuntimeError(message)


def appearance_field(name):
    if '_Skin_Ref_' in name:return 'skinTone'
    for suffix,field in (('_Hair','hairColor'),('_GiTop','giTop'),('_GiPants','giPants'),('_Belt','belt')):
        if name.endswith(suffix):return field
    return None


def parameter_copy(source, folder, name):
    if appearance_field(source.get_name())=='skinTone':
        require(source.get_name().endswith('_Skin_Ref_'+SKIN_REFERENCE_HEX[1:]),
                'Unsupported baked skin reference; appearance ratio must be reviewed')
    edit=unreal.MaterialEditingLibrary
    material=unreal.AssetToolsHelpers.get_asset_tools().duplicate_asset(name,folder,source)
    require(material is not None,'Runtime material duplication failed')
    prop=unreal.MaterialProperty.MP_BASE_COLOR
    attributes=edit.get_material_property_input_node(material,unreal.MaterialProperty.MP_MATERIAL_ATTRIBUTES)
    if attributes is not None:
        names=list(edit.get_material_expression_input_names(attributes))
        inputs=list(edit.get_inputs_for_material_expression(material,attributes))
        require(len(names)==len(inputs) and 'BaseColor' in names,'Cloth material input layout changed')
        base=inputs[names.index('BaseColor')]
    else:base=edit.get_material_property_input_node(material,prop)
    require(base is not None,'Runtime material has no base color')
    colors=[];visited=set()
    def walk(node):
        if node is None or node.get_path_name() in visited:return
        visited.add(node.get_path_name())
        if isinstance(node,unreal.MaterialExpressionConstant3Vector):colors.append(node)
        for item in edit.get_inputs_for_material_expression(material,node):walk(item)
    walk(base)
    require(len(colors)==1,'Expected one base-color factor')
    original=colors[0]
    parameter=edit.create_material_expression(material,unreal.MaterialExpressionVectorParameter)
    parameter.set_editor_property('parameter_name','JQAppearance')
    parameter.set_editor_property('default_value',original.get_editor_property('constant'))
    connections=0
    for node in edit.get_material_expressions(material):
        names=list(edit.get_material_expression_input_names(node))
        inputs=list(edit.get_inputs_for_material_expression(material,node))
        require(len(names)==len(inputs),'Material graph input inventory changed')
        for key,item in zip(names,inputs):
            if item==original:
                require(edit.connect_material_expressions(parameter,'RGB',node,key),'Could not parameterize material input')
                connections+=1
    if base==original and attributes is None:
        require(edit.connect_material_property(parameter,'RGB',prop),'Could not parameterize base color')
        connections+=1
    require(connections>0,'Appearance parameter is disconnected')
    edit.recompile_material(material)
    return material


def linear_rgb(hex_value):
    values=[int(hex_value[i:i+2],16)/255. for i in (1,3,5)]
    return [v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in values]


def linear_color(hex_value, field):
    values=linear_rgb(hex_value)
    if field=='skinTone':
        # Skin albedo already contains the reference color. A target/reference
        # factor changes its hue once while preserving baked texture detail.
        values=[target/reference*.82 for target,reference in zip(values,linear_rgb(SKIN_REFERENCE_HEX))]
    elif field in ('giTop','giPants'):
        values=[v*.72 for v in values]
    return unreal.LinearColor(*values,1.)
