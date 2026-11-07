"""Original fitted cotton folds in garment-panel coordinates, measured in meters.

Broad folds shape the skinned mesh. Finer relief uses the same UV1 panels;
neither layer changes the skeleton, garment openings or athlete contact points.
"""
import math


def smooth(lo, hi, value):
    t = min(1., max(0., (value - lo) / (hi - lo)))
    return t * t * (3. - 2. * t)


def ridge(distance, width, amplitude):
    return amplitude * (math.exp(-(distance / width) ** 2)
                        - .42 * math.exp(-((distance + width * 1.1) / (width * .68)) ** 2))


def fold_height(panel, u, v):
    angle = u * math.tau
    if panel == 'torso':
        window = smooth(.08, .19, v) * (1. - smooth(.68, .84, v))
        value = 0.
        # Unequal diagonal tension fans converge on the tied waist. They do
        # not form horizontal rings around the shoulder or a padded chest.
        for anchor, lean, amplitude in ((.12, .19, .0048), (.36, -.13, .0035),
                                         (.64, .15, .0041), (.87, -.18, .0051)):
            center = anchor + lean * (v - .35) + .009 * math.sin(v * 8.)
            distance = (u - center + .5) % 1. - .5
            value += ridge(distance, .018 + .014 * abs(v - .35), amplitude)
        return value * window * 1.35
    if panel == 'sleeve':
        window = smooth(.28, .37, v) * (1. - smooth(.89, .97, v))
        compression = .12 + .88 * max(0., math.cos(angle - math.pi * .5)) ** 4
        value = 0.
        for center, slant, width, amplitude in ((.50, .055, .038, .0056),
                                                (.62, -.040, .032, .0048),
                                                (.74, .045, .042, .0035)):
            value += ridge(v - center - slant * math.sin(angle), width, amplitude) * compression
        # Broad, unequal creases leave calm cloth between bent-arm folds.
        # One longer oblique pull breaks up the compression group. Cuff
        # folds fade into the turned hem instead of changing the wrist fit.
        value += ridge(v - .44 - .15 * math.cos(angle), .032, .0034) * max(0., -math.cos(angle)) ** 3
        value += ridge(v - .86 - .020 * math.sin(angle * 2), .022, .0034) * (.25 + .75 * math.cos(angle) ** 2)
        # Smoothly bound overlapping elbow/cuff creases to 11.5 mm. A soft
        # limit retains continuous normals instead of flattening a clipped peak.
        return .0115 * math.tanh(value * window * 1.55 / .0115)
    if panel == 'pants':
        window = smooth(.06, .14, v) * (1. - smooth(.84, .96, v))
        front = max(0., math.cos(angle - math.pi)) ** 4
        value = 0.
        for center, slant, width, amplitude in ((.34, .030, .022, .0047),
                                                (.42, -.042, .026, .0068),
                                                (.50, .027, .032, .0041)):
            value += ridge(v - center - slant * math.sin(angle), width, amplitude) * (.14 + .86 * front)
        value += ridge(v - .71 - .09 * math.sin(angle), .036, .0042) * max(0., -math.sin(angle)) ** 2
        value += ridge(v - .17 - .027 * math.cos(angle), .020, .0037) * (.25 + .75 * front)
        # Longer hanging channels between hip and cuff give the trouser leg
        # weight. Unequal directions avoid a pressed dress-trouser centerline;
        # only the side/back panels receive these drapes, leaving the front
        # knee compression readable. Both ends fade before the sewn openings.
        drape_window = smooth(.12, .24, v) * (1. - smooth(.65, .81, v))
        for anchor, lean, amplitude in ((.19, .065, .0038),
                                         (.74, -.045, .0031)):
            center = anchor + lean * (v - .45)
            distance = (u - center + .5) % 1. - .5
            value += ridge(distance, .050, amplitude) * drape_window
        return .0115 * math.tanh(value * window * 1.45 / .0115)
    return 0.


def relief_height(panel, u, v):
    # Cloth fibers remain much smaller than the modeled tension folds.
    weave = .000055 * math.sin(u * math.tau * 90) * math.sin(v * math.tau * 108)
    thread = .000035 * math.sin(v * math.tau * 61 + .4 * math.sin(u * math.tau * 3))
    return .38 * fold_height(panel, u, v) + weave + thread


def panel_normal(panel, u, v):
    step = 1. / 1024
    physical_size = {'torso': (1.25, .68), 'sleeve': (.43, .66),
                     'pants': (.61, .96), 'trim': (.055, .65)}[panel]
    du = (relief_height(panel, u + step, v) - relief_height(panel, u - step, v)) / (2 * step * physical_size[0])
    dv = (relief_height(panel, u, v + step) - relief_height(panel, u, v - step)) / (2 * step * physical_size[1])
    inverse = 1. / math.sqrt(du * du + dv * dv + 1.)
    return (-du * inverse * .5 + .5, -dv * inverse * .5 + .5, inverse * .5 + .5)
