"""Original JiuQuest textile and hair paint, authored as deterministic game assets.

No source photograph is read or changed. These small neutral maps preserve the
runtime cosmetic tint contract. Their filenames include this recipe's digest.
"""
from pathlib import Path
import hashlib
import math
import struct
import zlib


PANELS = {'torso': (0, 0), 'sleeve': (1, 0), 'pants': (0, 1), 'trim': (1, 1)}


def panel_uv(panel, u, v):
    """Half-atlas islands with four pixels of duplicated edge padding at 512px."""
    x, y = PANELS[panel]
    return (x * .5 + .008 + .484 * min(1., max(0., u)),
            y * .5 + .008 + .484 * min(1., max(0., v)))


def _line(value, center, width):
    return math.exp(-((value - center) / width) ** 2)


def _segment(u, v, a, b, width):
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = min(1., max(0., ((u - a[0]) * dx + (v - a[1]) * dy) / (dx * dx + dy * dy)))
    return math.exp(-((u - a[0] - t * dx) ** 2 + (v - a[1] - t * dy) ** 2) / width ** 2)


def _crest(u, v, cx, cy, scale):
    # An original split-summit embroidered mark, not a franchise emblem.
    u, v = (u - cx) / scale, (v - cy) / scale
    return max(_segment(u, v, (-.72, -.40), (-.10, .55), .085),
               _segment(u, v, (.10, .55), (.72, -.40), .085),
               _segment(u, v, (-.28, -.05), (0., .33), .07),
               _segment(u, v, (0., .33), (.28, -.05), .07),
               _segment(u, v, (0., -.15), (0., -.58), .07))


def cloth_value(panel, u, v):
    """Broad construction reads at phone size; fine weave is secondary."""
    weave = .014 * math.sin(u * math.tau * 90) * math.sin(v * math.tau * 108)
    value = .91 + weave + .018 * math.sin(v * math.tau * 3 + .4 * math.sin(u * math.tau))
    if panel == 'torso':
        side = max(_line(u, .24, .075), _line(u, .76, .075))
        seams = max(_line(u, .16, .007), _line(u, .84, .007))
        yoke = .82 - .14 * abs(u - .5)
        value -= .075 * side + .24 * seams + .18 * _line(v, yoke, .012)
        value -= .11 * _line(v, .055, .035) + .15 * _line(v, .10, .006)
        stitches = (.35 + .65 * max(0., math.cos(v * math.tau * 43)) ** 3)
        value += .065 * max(_line(u, .175, .004), _line(u, .825, .004)) * stitches
        value -= .40 * max(_crest(u, v, .09, .68, .052), _crest(u, v, .50, .65, .082))
    elif panel == 'sleeve':
        panel_edge = (abs(u - .5) / .37) ** 4 + (abs(v - .61) / .24) ** 4
        value -= .07 * math.exp(-panel_edge * 2) + .20 * _line(panel_edge, 1., .12)
        value -= .12 * _line(v, .30, .012) + .15 * _line(v, .93, .035)
        value += .065 * _line(v, .905, .005) * (.5 + .5 * math.cos(u * math.tau * 40))
    elif panel == 'pants':
        knee = (abs(u - .5) / .24) ** 4 + (abs(v - .49) / .18) ** 4
        value -= .055 * math.exp(-knee * 2) + .23 * _line(knee, 1., .13)
        value -= .16 * max(_line(u, .17, .012), _line(u, .83, .012))
        value -= .12 * _line(v, .06, .035) + .16 * _line(v, .105, .006)
        value += .055 * _line(v, .12, .004) * (.5 + .5 * math.cos(u * math.tau * 48))
    else:
        value -= .14 * max(_line(u, .075, .055), _line(u, .925, .055))
        value -= .23 * max(_line(u, .14, .013), _line(u, .86, .013))
        stitch = .4 + .6 * max(0., math.cos(v * math.tau * 48)) ** 3
        value += .075 * max(_line(u, .19, .008), _line(u, .81, .008)) * stitch
        value += .018 * math.sin(u * math.tau * 24)
    return min(.99, max(.42, value))


def hair_value(u, v):
    """Root-to-tip painted planes and sparse strand grooves, without alpha cards."""
    broad = .11 * math.cos((u - .43) * math.tau)
    strands = .045 * math.cos(u * math.tau * 11 + .6 * math.sin(v * math.pi))
    groove = .10 * max(0., math.cos(u * math.tau * 7 + v * .8)) ** 12
    band = .105 * math.exp(-((v - .58 - .10 * math.sin(u * math.tau)) / .19) ** 2)
    root = .10 * math.exp(-(v / .12) ** 2)
    return min(1., max(.48, .79 + broad + strands + band - groove - root))


def _png(width, height, sample):
    # RGB8 PNG: original grayscale paint needs neither an alpha channel nor a dependency.
    rows = bytearray()
    for y in range(height):
        rows.append(0)
        v = 1. - (y + .5) / height
        for x in range(width):
            value = round(255 * sample((x + .5) / width, v))
            rows.extend((value, value, value))
    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', width, height, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b''))


def ensure_surface_map(kind, destination):
    """Content-addressed recipe names prevent reuse of stale exported texture derivatives."""
    if kind not in ('cloth', 'hair'):
        raise ValueError('Unknown original fighter map: ' + kind)
    digest = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()[:12]
    size = 512 if kind == 'cloth' else 256
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    output = destination / ('jq-original-' + kind + '-' + digest + '-' + str(size) + '.png')
    if not output.exists():
        if kind == 'cloth':
            def sample(u, v):
                x, y = min(1, int(u * 2)), min(1, int(v * 2))
                panel = next(name for name, tile in PANELS.items() if tile == (x, y))
                return cloth_value(panel, min(1., max(0., (u - x * .5 - .008) / .484)),
                                   min(1., max(0., (v - y * .5 - .008) / .484)))
        else:
            sample = hair_value
        output.write_bytes(_png(size, size, sample))
    return output
