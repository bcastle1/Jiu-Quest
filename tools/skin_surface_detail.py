"""Original regional skin roughness, sampled from rest-body coordinates.

The atlas contains numeric material response only. No photograph, diffuse map,
geometry, skin tone or eye material is changed. Both athletes share the same
content-addressed UV rasterization of their identical rest mesh.
"""
from pathlib import Path
import hashlib
import math
import struct
import zlib


BASE_ROUGHNESS = .56
MAX_ATLAS_SIZE = 512


def smooth(lo, hi, value):
    t = min(1., max(0., (value - lo) / (hi - lo)))
    return t * t * (3. - 2. * t)


def skin_roughness(position):
    x, y, z = position
    # All exposed skin outside the front of the adult face keeps the previous
    # response, including neck, ears, scalp, hands and feet.
    if abs(x) >= .074 or y >= -.025 or y <= -.145 or z <= 1.550 or z >= 1.710:
        return BASE_ROUGHNESS
    mask = (1. - smooth(.058, .074, abs(x)))
    mask *= smooth(-.145, -.120, y) * (1. - smooth(-.045, -.025, y))
    mask *= smooth(1.550, 1.565, z) * (1. - smooth(1.685, 1.710, z))
    nose = math.exp(-(x / .016) ** 4 - ((z - 1.616) / .035) ** 4)
    forehead = math.exp(-(x / .035) ** 4 - ((z - 1.669) / .025) ** 4)
    cheeks = math.exp(-((abs(x) - .042) / .020) ** 4 - ((z - 1.615) / .027) ** 4)
    lower_face = math.exp(-(x / .048) ** 4 - ((z - 1.571) / .016) ** 4)
    value = BASE_ROUGHNESS + mask * (-.100 * nose - .045 * forehead
                                    + .050 * cheeks + .035 * lower_face)
    return min(.64, max(.44, value))


def _png(width, height, pixels):
    def chunk(kind, data):
        return (struct.pack('>I', len(data)) + kind + data
                + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff))
    rows = b''.join(b'\0' + bytes(pixels[y * width * 3:(y + 1) * width * 3])
                    for y in range(height))
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b''))


def ensure_skin_roughness_map(body, destination, size=MAX_ATLAS_SIZE):
    """Rasterize the original body UVs; unknown texels keep uniform roughness."""
    if size < 32 or size > MAX_ATLAS_SIZE:
        raise ValueError('Skin roughness atlas must be between 32 and 512 pixels')
    mesh = body.data
    if mesh.uv_layers.active is None:
        raise ValueError('Skin roughness requires the original body UV map')
    mesh.calc_loop_triangles()
    uv = mesh.uv_layers.active.data
    vertices = [tuple(v.co) for v in mesh.vertices]
    triangles = [(tuple(t.vertices), tuple(tuple(uv[i].uv) for i in t.loops))
                 for t in mesh.loop_triangles]
    recipe = hashlib.sha256(Path(__file__).read_bytes())
    recipe.update(struct.pack('<I', size))
    for p in vertices: recipe.update(struct.pack('<3f', *p))
    for indices, coordinates in triangles:
        recipe.update(struct.pack('<3I', *indices))
        for point in coordinates: recipe.update(struct.pack('<2f', *point))
    path = Path(destination) / f'jq-original-skin-roughness-{recipe.hexdigest()[:16]}-{size}.png'
    if path.exists():
        return path

    sums = [0.] * (size * size)
    counts = [0] * (size * size)
    for indices, coordinates in triangles:
        # PNG scanlines run down; Blender/glTF UV v runs up.
        p = [(u * size, (1. - v) * size) for u, v in coordinates]
        (ax, ay), (bx, by), (cx, cy) = p
        denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(denominator) < 1e-10:
            continue
        xmin = max(0, math.floor(min(q[0] for q in p)))
        xmax = min(size - 1, math.ceil(max(q[0] for q in p)))
        ymin = max(0, math.floor(min(q[1] for q in p)))
        ymax = min(size - 1, math.ceil(max(q[1] for q in p)))
        a, b, c = (vertices[i] for i in indices)
        for row in range(ymin, ymax + 1):
            for col in range(xmin, xmax + 1):
                px, py = col + .5, row + .5
                wa = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denominator
                wb = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denominator
                wc = 1. - wa - wb
                if min(wa, wb, wc) < -1e-7:
                    continue
                position = tuple(wa * a[k] + wb * b[k] + wc * c[k] for k in range(3))
                i = row * size + col
                sums[i] += skin_roughness(position)
                counts[i] += 1
    values = [s / n if n else BASE_ROUGHNESS for s, n in zip(sums, counts)]
    occupied = [bool(n) for n in counts]
    # Two texels of border dilation keep bilinear filtering from introducing
    # a roughness seam at a UV boundary. No photographic pixels are involved.
    for _ in range(2):
        updates = []
        for i, filled in enumerate(occupied):
            if filled: continue
            row, col = divmod(i, size)
            neighbors = []
            for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                x, y = col + dx, row + dy
                if 0 <= x < size and 0 <= y < size:
                    n = y * size + x
                    if occupied[n]: neighbors.append(values[n])
            if neighbors: updates.append((i, sum(neighbors) / len(neighbors)))
        for i, value in updates:
            values[i] = value
            occupied[i] = True
    # Standard glTF metallic-roughness packing: G=roughness, B=metallic zero.
    pixels = bytearray(size * size * 3)
    for i, value in enumerate(values):
        pixels[i * 3:i * 3 + 3] = bytes((255, round(value * 255), 0))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(_png(size, size, pixels))
    return path


def attach_skin_roughness(material, body, destination):
    """Use glTF's recognized green-channel roughness chain; share one image."""
    import bpy
    path = ensure_skin_roughness_map(body, destination)
    image = bpy.data.images.load(str(path), check_existing=True)
    image.colorspace_settings.name = 'Non-Color'
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes.get('Principled BSDF')
    texture = nodes.new('ShaderNodeTexImage')
    texture.name = 'Original regional skin roughness'
    texture.image = image
    separate = nodes.new('ShaderNodeSeparateColor')
    separate.mode = 'RGB'
    links.new(texture.outputs['Color'], separate.inputs['Color'])
    links.new(separate.outputs['Green'], shader.inputs['Roughness'])
    shader.inputs['Roughness'].default_value = 1.
    return path
