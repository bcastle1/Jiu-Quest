"""Safety contracts for the fitted fold recipe; no Blender dependency."""
import math
import unittest
from fighter_fabric_detail import (fold_height, panel_normal, sleeve_panel_u, cleared_fold_radius,
                                  lapel_crown, sleeve_panel_section)


class FabricDetailTests(unittest.TestCase):
    def test_lapel_has_flat_folded_face_and_retains_sewn_ends(self):
        for u in (.25, .5, .75):
            self.assertAlmostEqual(lapel_crown(u, .5), .0068)
        for i in range(65):
            u = i / 64
            for t in (0., 1.):
                self.assertAlmostEqual(lapel_crown(u, t), .0033 * math.sin(u * math.pi) ** 1.4)
            for j in range(65):
                self.assertTrue(0 <= lapel_crown(u, j / 64) <= .00680001)

    def test_sleeve_panels_preserve_area_joins_and_periodic_seam(self):
        points = [sleeve_panel_section(i * math.tau / 1024, .58) for i in range(1024)]
        area = abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(points, points[1:] + points[:1]))) * .5
        self.assertAlmostEqual(area, math.pi, places=4)
        for i in range(129):
            angle = i * math.tau / 128
            for t in (0., .30, .93, 1.):
                self.assertEqual(sleeve_panel_section(angle, t), (math.cos(angle), math.sin(angle)))
            top, side = sleeve_panel_section(angle, .58)
            self.assertLess(math.hypot(top - math.cos(angle), side - math.sin(angle)), .11)
        for a, b in zip(sleeve_panel_section(0., .58), sleeve_panel_section(math.tau, .58)):
            self.assertAlmostEqual(a, b, places=10)

    def test_fuller_thigh_keeps_outward_folds_and_inward_clearance(self):
        self.assertAlmostEqual(cleared_fold_radius(.132, .121, .006), .147)
        self.assertAlmostEqual(cleared_fold_radius(.132, .121, -.006), .141)
        self.assertAlmostEqual(cleared_fold_radius(.060, .090, -.006), .084)
        self.assertAlmostEqual(cleared_fold_radius(.060, .090, .006), .096)

    def test_hanging_channels_reach_upper_cuff_without_crossing_hem(self):
        self.assertGreater(fold_height('pants', .19, .08), .001)
        self.assertGreater(fold_height('pants', .74, .08), .001)
        for i in range(65):
            self.assertEqual(fold_height('pants', i / 64, .025), 0.)

    def test_left_and_right_elbows_share_forward_compression(self):
        # The outward arm axes reverse basis_b = axis cross up. A point at
        # -Y (the athlete's front) is u=.25 on the left and u=.75 on the right.
        for v in (.46, .50, .57, .62, .74):
            left = sleeve_panel_u('l', .25)
            right = sleeve_panel_u('r', .75)
            self.assertAlmostEqual(fold_height('sleeve', left, v),
                                   fold_height('sleeve', right, v), places=10)
            self.assertEqual(panel_normal('sleeve', left, v),
                             panel_normal('sleeve', right, v))
        self.assertGreater(abs(fold_height('sleeve', sleeve_panel_u('r', .75), .50)),
                           abs(fold_height('sleeve', sleeve_panel_u('r', .25), .50)))

    def test_folds_preserve_openings_and_remain_bounded(self):
        for panel in ('torso', 'sleeve', 'pants'):
            heights = []
            for i in range(65):
                u = i / 64
                self.assertEqual(fold_height(panel, u, 0), 0)
                self.assertEqual(fold_height(panel, u, 1), 0)
                for j in range(65):
                    height = fold_height(panel, u, j / 64)
                    self.assertTrue(math.isfinite(height))
                    self.assertLess(abs(height), .012, (panel, u, j / 64))
                    heights.append(height)
            self.assertGreater(max(heights) - min(heights), .003, panel)

    def test_angular_seams_do_not_split_fold_shape_or_relief(self):
        for panel in ('torso', 'sleeve', 'pants', 'trim'):
            for j in range(65):
                v = j / 64
                self.assertAlmostEqual(fold_height(panel, 0, v), fold_height(panel, 1, v), places=10)
                a, b = panel_normal(panel, 0, v), panel_normal(panel, 1, v)
                for left, right in zip(a, b): self.assertAlmostEqual(left, right, places=8)

    def test_exported_rgb_normals_are_finite_unit_vectors(self):
        for panel in ('torso', 'sleeve', 'pants', 'trim'):
            relief = []
            for i in range(33):
                for j in range(33):
                    rgb = panel_normal(panel, i / 32, j / 32)
                    self.assertTrue(all(math.isfinite(value) and 0 <= value <= 1 for value in rgb))
                    xyz = tuple(value * 2 - 1 for value in rgb)
                    self.assertAlmostEqual(sum(value * value for value in xyz), 1., places=8)
                    self.assertGreater(xyz[2], 0., 'Fold relief must not invert the visible cloth normal.')
                    relief.append(abs(xyz[0]) + abs(xyz[1]))
            self.assertGreater(max(relief), .03, panel)


if __name__ == '__main__': unittest.main()
