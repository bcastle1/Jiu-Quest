"""Material contracts for original regional skin roughness; no Blender needed."""
import unittest
from skin_surface_detail import skin_roughness, BASE_ROUGHNESS


class SkinRoughnessTests(unittest.TestCase):
    def test_face_field_is_bounded_and_bilateral(self):
        for ix in range(31):
            for iz in range(41):
                x, z = -.075 + ix * .005, 1.53 + iz * .005
                a = skin_roughness((x, -.075, z))
                b = skin_roughness((-x, -.075, z))
                self.assertGreaterEqual(a, .44)
                self.assertLessEqual(a, .64)
                self.assertAlmostEqual(a, b, places=12)

    def test_nonface_skin_retains_approved_response(self):
        for position in ((0, -.07, 1.54), (.08, -.06, 1.63), (0, .05, 1.63),
                         (0, -.05, 1.72), (.8, 0, 1.4), (.1, -.08, .15)):
            self.assertEqual(skin_roughness(position), BASE_ROUGHNESS)

    def test_t_zone_is_distinct_without_clamping_extremes(self):
        nose = skin_roughness((0, -.10, 1.616))
        cheek = skin_roughness((.043, -.07, 1.615))
        forehead = skin_roughness((0, -.07, 1.67))
        self.assertGreater(cheek - nose, .10)
        self.assertLess(nose, forehead)
        self.assertLess(forehead, BASE_ROUGHNESS)
        self.assertGreater(nose, .44)
        self.assertLess(cheek, .64)


if __name__ == '__main__': unittest.main()
