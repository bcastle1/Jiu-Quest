"""Scoped standing gi-body profile and explicit internal thin-shell authoring.

The source-topology support constants below are original authored constraints,
not encoded GLB deltas. Ground and Slick remain byte-exact. No external dependencies.
"""
import copy
import hashlib
import json
import math
import struct
from pilot_look import MeshFile, adjust_frames, panel_at, rigid_frame, window

STANDING_INPUT_SHA256 = '2e2da70678646a93dd6a6a9a1c2eaf59b2fa72ab6161f67761d690256f1262f8'

STANDING_OUTPUT_SHA256 = '3c263e76986d1de15f72c9797a51007294bb1bade3dd388ba8e62864fea51078'

INPUT_DOCUMENT_SHA256 = 'dd33d28afeb6fd23c4181add3d3c9b4750c8d76e65b803b74913d3b63de1ffe2'

OUTPUT_DOCUMENT_SHA256 = 'f77f3353e2fc60711412d467af0afc4dfb207709b4de4c482d983b45e2a247c1'

INPUT_PANTS_SHA256 = '53d78ba025f85a21b88769344fc689285d5c173725a8d543dddbc9714124c30b'

OUTPUT_PANTS_SHA256 = 'a12ac9646dc2b6249547ee1fe8e1e1173f116d85a39e2d0588b4054a77a24744'

RIG_TEXTURE_SHA256 = '7165746b02ababf1586c14bae34cbf52f2a22c1e30e31c40ea5152b09a99909e'

AUTHORED_CONTRACT_SHA256 = 'ecf0d653bd3c108b724c0a2ed7c613e66c076dc3a1e17f81d16d8396fede67fe'

REMOVED_INNER_FACE_RANGES = ((2907, 2913), (2915, 2945), (2995, 3015), (3025, 3029), (3069, 3083), (3087, 3095), (3116, 3118),
 (3132, 3660), (3789, 3795), (3821, 3909), (3925, 4133), (4231, 4237), (4239, 4269), (4339, 4359),
 (4373, 4377), (4437, 4451), (4457, 4459), (4468, 4474), (4505, 4507), (4531, 5059), (5248, 5254),
 (5271, 5359), (5383, 5591))

FOOT_RISK_SEED_FACES = (2063, 2130, 2137, 2138, 2155, 2197, 2198, 2205, 2206, 2209, 2223, 2224, 2247, 2248, 2262, 2269,
 2282, 2457, 2458, 2461, 2464, 2467, 2468, 2472, 2476, 2565, 2566, 2569, 2570, 2571, 2572, 2575,
 2578, 2665, 2666, 2667, 2668, 4874, 4948, 4966, 4989, 5008, 5015, 5016, 5020, 5033, 5034, 5057,
 5058, 5071, 5072, 5079, 5080, 5092, 5099, 5267, 5268, 5272, 5273, 5274, 5277, 5278, 5288, 5375,
 5376, 5383, 5384, 5475, 5476, 5477, 5478)

FOOT_SUPPORT_GROUPS = ((0.0,
  (1278, 1296, 1299, 1300, 1317, 1320, 1321, 1338, 1341, 1342, 1343, 1344, 1351, 1359, 1362, 1363,
   1364, 1365, 1366, 1368, 1380, 1383, 1384, 1385, 1386, 1387, 1389, 1404, 1405, 1406, 1407, 1408,
   1410, 1425, 1426, 1427, 1428, 1429, 1431, 1446, 1447, 1448, 1449, 1519, 1520, 1521, 1522, 1523,
   1524, 1525, 2927, 2945, 2948, 2949, 2966, 2969, 2970, 2987, 2990, 2991, 2992, 2993, 3000, 3008,
   3011, 3012, 3013, 3014, 3015, 3017, 3029, 3032, 3033, 3034, 3035, 3036, 3038, 3053, 3054, 3055,
   3056, 3057, 3059, 3074, 3075, 3076, 3077, 3078, 3080, 3095, 3096, 3097, 3098, 3168, 3169, 3170,
   3171, 3172, 3173, 3174)),
 (0.15625,
  (1254, 1257, 1267, 1275, 1279, 1288, 1309, 1322, 1323, 1330, 1337, 1345, 1347, 1350, 1358, 1371,
   1372, 1392, 1401, 1413, 1422, 1434, 1443, 1450, 1452, 1468, 1469, 1470, 1471, 1472, 1518, 1527,
   2903, 2906, 2916, 2924, 2928, 2937, 2958, 2971, 2972, 2979, 2986, 2994, 2996, 2999, 3007, 3020,
   3021, 3041, 3050, 3062, 3071, 3083, 3092, 3099, 3101, 3117, 3118, 3119, 3120, 3121, 3167,
   3176)),
 (0.5,
  (1225, 1233, 1236, 1246, 1253, 1258, 1274, 1295, 1301, 1302, 1316, 1318, 1324, 1326, 1329, 1339,
   1348, 1349, 1360, 1369, 1370, 1379, 1390, 1391, 1393, 1411, 1412, 1414, 1432, 1433, 1435, 1457,
   1458, 1466, 1474, 1487, 1488, 1489, 1490, 1491, 1493, 1517, 1528, 2874, 2882, 2885, 2895, 2902,
   2907, 2923, 2944, 2950, 2951, 2965, 2967, 2973, 2975, 2978, 2988, 2997, 2998, 3009, 3018, 3019,
   3028, 3039, 3040, 3042, 3060, 3061, 3063, 3081, 3082, 3084, 3106, 3107, 3115, 3123, 3136, 3137,
   3138, 3139, 3140, 3142, 3166, 3177)),
 (0.84375,
  (1204, 1211, 1212, 1215, 1232, 1234, 1237, 1255, 1276, 1280, 1281, 1297, 1298, 1303, 1305, 1308,
   1319, 1327, 1328, 1340, 1353, 1361, 1374, 1381, 1395, 1400, 1416, 1421, 1437, 1442, 1455, 1456,
   1465, 1475, 1476, 1477, 1478, 1485, 1494, 1495, 1496, 1498, 1500, 1501, 1516, 1529, 2853, 2860,
   2861, 2864, 2881, 2883, 2886, 2904, 2925, 2929, 2930, 2946, 2947, 2952, 2954, 2957, 2968, 2976,
   2977, 2989, 3002, 3010, 3023, 3030, 3044, 3049, 3065, 3070, 3086, 3091, 3104, 3105, 3114, 3124,
   3125, 3126, 3127, 3134, 3143, 3144, 3145, 3147, 3149, 3150, 3165, 3178)))

ANATOMICAL_SUPPORT_GROUPS = {'Attacker': ((0.0,
               (109, 110, 111, 112, 113, 119, 120, 121, 122, 123, 124, 130, 131, 132, 133, 134, 217,
                232, 240, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254, 255,
                256, 257, 259, 260, 261, 262, 292, 293, 294, 295, 301, 302, 303, 304, 306, 307, 308,
                309, 310, 313, 314, 330, 331, 332, 333, 335, 351, 352, 353, 354, 356, 372, 373, 374,
                375, 377, 393, 394, 395, 396, 398, 759, 764, 765, 766, 767, 768, 769, 770, 771, 772,
                791, 795, 796, 797, 798, 799, 800, 868, 869, 870, 871, 877, 878, 879, 880, 881, 887,
                888, 889, 890, 980, 987, 988, 989, 990, 991, 992, 993, 994, 995, 996, 997, 999,
                1000, 1001, 1002, 1030, 1031, 1032, 1033, 1039, 1040, 1041, 1042, 1044, 1045, 1046,
                1047, 1048, 1051, 1052, 1068, 1069, 1070, 1071, 1073, 1089, 1090, 1091, 1092, 1094,
                1111, 1112, 1113, 1114, 1116, 1132, 1133, 1134, 1135, 1137, 1497, 1502, 1503, 1504,
                1505, 1506, 1507, 1508, 1509, 1510, 1532, 1533, 1534, 1535, 1536, 1537, 1758, 1759,
                1760, 1761, 1762, 1768, 1769, 1770, 1771, 1772, 1773, 1779, 1780, 1781, 1782, 1783,
                1866, 1881, 1889, 1890, 1891, 1892, 1893, 1894, 1895, 1896, 1897, 1898, 1899, 1900,
                1901, 1902, 1903, 1904, 1905, 1906, 1908, 1909, 1910, 1911, 1941, 1942, 1943, 1944,
                1950, 1951, 1952, 1953, 1955, 1956, 1957, 1958, 1959, 1962, 1963, 1979, 1980, 1981,
                1982, 1984, 2000, 2001, 2002, 2003, 2005, 2021, 2022, 2023, 2024, 2026, 2042, 2043,
                2044, 2045, 2047, 2408, 2413, 2414, 2415, 2416, 2417, 2418, 2419, 2420, 2421, 2440,
                2444, 2445, 2446, 2447, 2448, 2449, 2517, 2518, 2519, 2520, 2526, 2527, 2528, 2529,
                2530, 2536, 2537, 2538, 2539, 2629, 2636, 2637, 2638, 2639, 2640, 2641, 2642, 2643,
                2644, 2645, 2646, 2648, 2649, 2650, 2651, 2679, 2680, 2681, 2682, 2688, 2689, 2690,
                2691, 2693, 2694, 2695, 2696, 2697, 2700, 2701, 2717, 2718, 2719, 2720, 2722, 2738,
                2739, 2740, 2741, 2743, 2760, 2761, 2762, 2763, 2765, 2781, 2782, 2783, 2784, 2786,
                3146, 3151, 3152, 3153, 3154, 3155, 3156, 3157, 3158, 3159, 3181, 3182, 3183, 3184,
                3185, 3186)),
              (0.009448788492931293, (1075, 2724)), (0.009570817103650042, (337, 1986)),
              (0.01595595928314364, (419, 1158, 2068, 2807)), (0.01793987502423633, (258, 1907)),
              (0.023227613864682306, (1054, 2703)), (0.02399554450908936, (998, 2647)),
              (0.025671577568531334, (316, 1965)), (0.03983793986505779, (801, 2450)),
              (0.04068072135280454, (417, 1156, 2066, 2805)), (0.04421648338577644, (219, 1868)),
              (0.04536388345680087, (358, 2007)), (0.046992695623665925, (967, 2616)),
              (0.050436989904951046, (1097, 2746)), (0.05331038072172589, (1153, 2802)),
              (0.06292948227585449, (415, 416, 1154, 1155, 2064, 2065, 2803, 2804)),
              (0.06385752496725439, (773, 1511, 2422, 3160)), (0.06893610994992339, (867, 2516)),
              (0.07192167335134281, (414, 2063)), (0.07203426990798345, (108, 1757)),
              (0.07328484125558654, (291, 1940)), (0.08309143343962355, (1538, 3187)),
              (0.0880268107421478, (886, 2535)), (0.09168864360612516, (300, 1949)),
              (0.0933899907130249, (1043, 2692)), (0.09425886445943199, (129, 1778)),
              (0.09667275269267406, (1029, 2678)), (0.09871403486544938, (305, 1954)),
              (0.10526546052008434, (1067, 2716)), (0.10592555188778452, (1038, 2687)),
              (0.10742099039083264, (379, 2028)), (0.12067182184083625, (329, 1978)),
              (0.12811157664805584, (1088, 2737)), (0.1334322797639882, (350, 1999)),
              (0.17037396990174314, (1119, 2768)), (0.17522810505186304, (876, 2525)),
              (0.18351827815887556, (118, 1767)), (0.2401303085722648, (1110, 2759)),
              (0.2528969610586832, (371, 2020)), (0.3520009736323383, (1140, 2789)),
              (0.37099210293818474, (400, 2049)), (0.3739795746927602, (440, 1179, 2089, 2828)),
              (0.3843152997568029, (794, 2443)), (0.3908980634648904, (1531, 3180)),
              (0.45050970296023785, (438, 1177, 2087, 2826)), (0.48949229576235453, (1174, 2823)),
              (0.49040890505578405, (1512, 3161)), (0.49042552760385427, (774, 2423)),
              (0.4908540231552331, (436, 437, 1175, 1176, 2085, 2086, 2824, 2825)),
              (0.5022291773991039, (435, 2084)), (0.565141701307613, (1131, 2780)),
              (0.5671234975902292, (392, 2041)), (0.6333731433758546, (866, 2515)),
              (0.6438726586895838, (107, 1756)), (0.6549056044019215, (421, 2070)),
              (0.6583267557536363, (1161, 2810)), (0.7313143938880684, (1152, 2801)),
              (0.7457127654471034, (413, 2062)), (0.7533612256801694, (968, 2617)),
              (0.757343273390335, (220, 1869)), (0.8053405034979105, (461, 1200, 2110, 2849)),
              (0.8633555663956586, (972, 2621)), (0.8709188552818121, (1074, 2723)),
              (0.8754077621366154, (459, 1198, 2108, 2847)), (0.8798099597146104, (442, 2091)),
              (0.8812063733720658, (224, 1873)), (0.8815121109219707, (1182, 2831)),
              (0.8874426705717704, (1053, 2702)), (0.8890975617470829, (1195, 2844)),
              (0.8942743189156024, (456, 2105)), (0.8974224375031348, (1026, 2675)),
              (0.9034706285090458, (336, 1985)), (0.9063783380725936, (1513, 3162)),
              (0.9063862646320779, (775, 2424)), (0.9069639479653719, (288, 1937)),
              (0.9101800002647324, (1196, 1197, 2845, 2846)),
              (0.9101811133517131, (457, 458, 2106, 2107)), (0.910293158383494, (1173, 2822)),
              (0.9129202943368941, (315, 1964)), (0.9134250219477662, (1035, 2684)),
              (0.9187031541231309, (297, 1946)), (0.9211602175995898, (434, 2083)),
              (0.9403087713192441, (1064, 2713)), (0.9406831358238968, (326, 1975)),
              (0.9531238376104784, (885, 2534)), (0.9664131074327142, (128, 1777)),
              (0.9673790315554838, (1095, 1096, 2744, 2745)), (0.9698135590808327, (347, 1996)),
              (0.9717630596937182, (1085, 2734)), (0.979135386569053, (357, 2006)),
              (0.9827781932092805, (463, 2112)), (0.983678716488491, (368, 2017)),
              (0.9839327883762045, (1203, 2852)), (0.987664525459882, (1107, 2756)),
              (0.9889981789687062, (1194, 2843)), (0.9933733980856109, (455, 2104)),
              (0.994702781300794, (482, 1221, 2131, 2870)), (0.9999997963599875, (793, 2442))),
 'Defender': ((0.0,
               (109, 110, 111, 112, 113, 119, 120, 121, 122, 123, 124, 130, 131, 132, 133, 134, 217,
                232, 240, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254, 255,
                256, 257, 259, 260, 261, 262, 292, 293, 294, 295, 301, 302, 303, 304, 306, 307, 308,
                309, 310, 313, 314, 330, 331, 332, 333, 335, 351, 352, 353, 354, 356, 372, 373, 374,
                375, 377, 393, 394, 395, 396, 398, 759, 764, 765, 766, 767, 768, 769, 770, 771, 772,
                791, 795, 796, 797, 798, 799, 800, 868, 869, 870, 871, 877, 878, 879, 880, 881, 887,
                888, 889, 890, 980, 987, 988, 989, 990, 991, 992, 993, 994, 995, 996, 997, 999,
                1000, 1001, 1002, 1030, 1031, 1032, 1033, 1039, 1040, 1041, 1042, 1044, 1045, 1046,
                1047, 1048, 1051, 1052, 1068, 1069, 1070, 1071, 1073, 1089, 1090, 1091, 1092, 1094,
                1111, 1112, 1113, 1114, 1116, 1132, 1133, 1134, 1135, 1137, 1497, 1502, 1503, 1504,
                1505, 1506, 1507, 1508, 1509, 1510, 1532, 1533, 1534, 1535, 1536, 1537, 1758, 1759,
                1760, 1761, 1762, 1768, 1769, 1770, 1771, 1772, 1773, 1779, 1780, 1781, 1782, 1783,
                1866, 1881, 1889, 1890, 1891, 1892, 1893, 1894, 1895, 1896, 1897, 1898, 1899, 1900,
                1901, 1902, 1903, 1904, 1905, 1906, 1908, 1909, 1910, 1911, 1941, 1942, 1943, 1944,
                1950, 1951, 1952, 1953, 1955, 1956, 1957, 1958, 1959, 1962, 1963, 1979, 1980, 1981,
                1982, 1984, 2000, 2001, 2002, 2003, 2005, 2021, 2022, 2023, 2024, 2026, 2042, 2043,
                2044, 2045, 2047, 2408, 2413, 2414, 2415, 2416, 2417, 2418, 2419, 2420, 2421, 2440,
                2444, 2445, 2446, 2447, 2448, 2449, 2517, 2518, 2519, 2520, 2526, 2527, 2528, 2529,
                2530, 2536, 2537, 2538, 2539, 2629, 2636, 2637, 2638, 2639, 2640, 2641, 2642, 2643,
                2644, 2645, 2646, 2648, 2649, 2650, 2651, 2679, 2680, 2681, 2682, 2688, 2689, 2690,
                2691, 2693, 2694, 2695, 2696, 2697, 2700, 2701, 2717, 2718, 2719, 2720, 2722, 2738,
                2739, 2740, 2741, 2743, 2760, 2761, 2762, 2763, 2765, 2781, 2782, 2783, 2784, 2786,
                3146, 3151, 3152, 3153, 3154, 3155, 3156, 3157, 3158, 3159, 3181, 3182, 3183, 3184,
                3185, 3186)),
              (0.009448757425211451, (1075, 2724)), (0.009570848356061257, (337, 1986)),
              (0.01595595928314364, (419, 1158, 2068, 2807)), (0.017939807887272896, (258, 1907)),
              (0.0232275612913293, (1054, 2703)), (0.023995621854179028, (998, 2647)),
              (0.025671632839196157, (316, 1965)), (0.039838016093418416, (801, 2450)),
              (0.04068072135280454, (417, 1156, 2066, 2805)), (0.044216349489053064, (219, 1868)),
              (0.04536395584652975, (358, 2007)), (0.046992833405175904, (967, 2616)),
              (0.05043691359538993, (1097, 2746)), (0.05331040551816357, (1153, 2802)),
              (0.06292948227585449, (415, 416, 1154, 1155, 2064, 2065, 2803, 2804)),
              (0.06385752496725439, (773, 1511, 2422, 3160)), (0.06893603855079034, (867, 2516)),
              (0.07192164445633742, (414, 2063)), (0.0720343428833723, (108, 1757)),
              (0.07328469238736535, (291, 1940)), (0.08309130407789922, (1538, 3187)),
              (0.08802676942903298, (886, 2535)), (0.09168845493715627, (300, 1949)),
              (0.09339018388569953, (1043, 2692)), (0.09425888600083832, (129, 1778)),
              (0.09667294346182242, (1029, 2678)), (0.09871383672693501, (305, 1954)),
              (0.10526566502099455, (1067, 2716)), (0.10592575320486197, (1038, 2687)),
              (0.10742113914064322, (379, 2028)), (0.12067160440705282, (329, 1978)),
              (0.12811179960882624, (1088, 2737)), (0.13343205269761882, (350, 1999)),
              (0.1703737868005939, (1119, 2768)), (0.17522807249656014, (876, 2525)),
              (0.1835183119138757, (118, 1767)), (0.2401305926928592, (1110, 2759)),
              (0.25289667117519143, (371, 2020)), (0.352000775572441, (1140, 2789)),
              (0.3709923047702628, (400, 2049)), (0.3739795746927602, (440, 1179, 2089, 2828)),
              (0.38431510920825573, (794, 2443)), (0.39089825516927834, (1531, 3180)),
              (0.45050970296023785, (438, 1177, 2087, 2826)), (0.489492335916049, (1174, 2823)),
              (0.49040890505578405, (1512, 3161)), (0.49042552760385427, (774, 2423)),
              (0.4908540231552331, (436, 437, 1175, 1176, 2085, 2086, 2824, 2825)),
              (0.5022291194711077, (435, 2084)), (0.5651419098136198, (1131, 2780)),
              (0.567123288907421, (392, 2041)), (0.6333730056409792, (866, 2515)),
              (0.6438727966139766, (107, 1756)), (0.6549057300735364, (421, 2070)),
              (0.6583266295403392, (1161, 2810)), (0.7313145286089692, (1152, 2801)),
              (0.745712631176463, (413, 2062)), (0.7533615452534339, (968, 2617)),
              (0.7573429548454905, (220, 1869)), (0.8053405034979105, (461, 1200, 2110, 2849)),
              (0.8633557871805926, (972, 2621)), (0.8709187185297422, (1074, 2723)),
              (0.8754077621366154, (459, 1198, 2108, 2847)), (0.8798100210754697, (442, 2091)),
              (0.8812062091125299, (224, 1873)), (0.8815120493623778, (1182, 2831)),
              (0.8874425673447305, (1053, 2702)), (0.8890975785724722, (1195, 2844)),
              (0.8942743004231941, (456, 2105)), (0.8974225968656147, (1026, 2675)),
              (0.9034707543116255, (336, 1985)), (0.9063783380725936, (1513, 3162)),
              (0.9063862646320779, (775, 2424)), (0.906963793444422, (288, 1937)),
              (0.9101800002647324, (1196, 1197, 2845, 2846)),
              (0.9101811133517131, (457, 458, 2106, 2107)), (0.910293231569935, (1173, 2822)),
              (0.9129203490183971, (315, 1964)), (0.9134251750464011, (1035, 2684)),
              (0.9187030041369588, (297, 1946)), (0.9211601465826279, (434, 2083)),
              (0.9403089043451924, (1064, 2713)), (0.9406830030870055, (326, 1975)),
              (0.9531237873218582, (885, 2534)), (0.9664131522908149, (128, 1777)),
              (0.9673789638279153, (1095, 1096, 2744, 2745)), (0.9698134614294672, (347, 1996)),
              (0.9717631547039082, (1085, 2734)), (0.9791354434366392, (357, 2006)),
              (0.9827781984364534, (463, 2112)), (0.9836786253025983, (368, 2017)),
              (0.9839327829962358, (1203, 2852)), (0.9876646060160331, (1107, 2756)),
              (0.9889982011130053, (1194, 2843)), (0.9933733851511398, (455, 2104)),
              (0.994702781300794, (482, 1221, 2131, 2870)), (0.9999997960844256, (793, 2442)))}

def require(condition,message):
    if not condition:raise ValueError(message)

def _accessor_payload(mesh,index):
    accessor,start,stride,fmt=mesh.layout(index);width=struct.calcsize(fmt)
    return b''.join(mesh.data[start+i*stride:start+i*stride+width] for i in range(accessor['count']))

def _document_digest(mesh):
    return hashlib.sha256(json.dumps(mesh.doc,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def _pants_digest(mesh):
    digest=hashlib.sha256()
    for role in ('Attacker','Defender'):
        name='JQ_'+role+'_GiPantsMesh';nodes=[n for n in mesh.doc['nodes'] if n.get('name')==name];require(len(nodes)==1,'Missing reviewed pants node')
        primitives=mesh.doc['meshes'][nodes[0]['mesh']]['primitives'];require(len(primitives)==1,'Unexpected pants primitive count');primitive=primitives[0]
        for semantic,index in sorted({**primitive['attributes'],'INDICES':primitive['indices']}.items()):
            payload=_accessor_payload(mesh,index);digest.update((name+'/'+semantic).encode());digest.update(len(payload).to_bytes(8,'little'));digest.update(payload)
    return digest.hexdigest()

def _rig_texture_digest(mesh):
    indices={skin['inverseBindMatrices'] for skin in mesh.doc['skins']}
    indices.update(index for animation in mesh.doc['animations'] for sampler in animation['samplers'] for index in (sampler['input'],sampler['output']))
    digest=hashlib.sha256()
    for index in sorted(indices):
        payload=_accessor_payload(mesh,index);digest.update(index.to_bytes(4,'little'));digest.update(len(payload).to_bytes(8,'little'));digest.update(payload)
    for image in mesh.doc.get('images',[]):
        require('bufferView' in image,'Reviewed images must be embedded');view=mesh.doc['bufferViews'][image['bufferView']];start=mesh.start+view.get('byteOffset',0);payload=mesh.data[start:start+view['byteLength']];digest.update(len(payload).to_bytes(8,'little'));digest.update(payload)
    return digest.hexdigest()

def _profile(u,v,anatomical_support):
    support=window(.15,.23,.72,.82,v)*anatomical_support
    if support==0:return (0.,0.,0.)
    angle=2*math.pi*((u%1)-.5);sx=math.sin(angle);front=math.cos(angle)
    knee=math.exp(-((v-.425)/.085)**2);calf=math.exp(-((v-.245)/.075)**2);thigh=math.exp(-((v-.635)/.13)**2)
    dx=(-.0060*knee-.0040*calf)*sx
    dy=(.0060*thigh+.0030*knee)*max(0.,front)**2
    dy+=.0018*math.exp(-((v-.31)/.07)**2)*max(0.,-front)**2*window(.15,.23,.39,.48,v)
    return (support*dx,support*dy,0.)

def refine_gi_body(raw,clip_name,style='Spikes'):
    """Return bytes and explicit proof; approved standing source only."""
    require(clip_name in ('standing_stance','rear_naked_choke','armbar'),'Unknown gi-body clip')
    require(style in ('Spikes','Slick'),'Unreviewed hair style for gi-body refinement')
    source_hash=hashlib.sha256(raw).hexdigest()
    if clip_name!='standing_stance' or style!='Spikes':
        return raw,{'sourceSha256':source_hash,'importSha256':source_hash,'applied':False,'selectedHair':style,'scope':'Input unchanged: this authoring is reviewed only for standing Spikes; ground and Slick remain exact.'}
    mesh=MeshFile(raw)
    require(_document_digest(mesh)==INPUT_DOCUMENT_SHA256,'Standing reviewed input document differs')
    require(_pants_digest(mesh)==INPUT_PANTS_SHA256,'Standing reviewed input pants differ')
    require(_rig_texture_digest(mesh)==RIG_TEXTURE_SHA256,'Standing reviewed rig, motion or embedded textures differ')
    initial_doc=copy.deepcopy(mesh.doc);parts=[];removed={i for lo,hi in REMOVED_INNER_FACE_RANGES for i in range(lo,hi)}
    require(len(removed)==1828 and min(removed)>=2810 and max(removed)<5620,'Invalid hidden-lining removal scope')
    for role in ('Attacker','Defender'):
        name='JQ_'+role+'_GiPantsMesh';nodes=[n for n in mesh.doc['nodes'] if n.get('name')==name];require(len(nodes)==1,'Missing unique pants mesh');node=nodes[0]
        primitives=mesh.doc['meshes'][node['mesh']]['primitives'];require(len(primitives)==1,'Unexpected pants primitives');primitive=primitives[0];attrs=primitive['attributes'];require(set(attrs)=={'POSITION','NORMAL','TANGENT','TEXCOORD_0','TEXCOORD_1','JOINTS_0','WEIGHTS_0'},'Unexpected pants attributes')
        positions=mesh.read(attrs['POSITION']);normals=mesh.read(attrs['NORMAL']);tangents=mesh.read(attrs['TANGENT']);joints=mesh.read(attrs['JOINTS_0']);weights=mesh.read(attrs['WEIGHTS_0']);panels=[panel_at(q) for q in mesh.read(attrs['TEXCOORD_1'])]
        indices=[x[0] for x in mesh.read(primitive['indices'])];require(len(positions)==3299 and len(indices)==17400,'Unexpected pants topology')
        require(mesh.doc['materials'][primitive['material']].get('doubleSided') is True,'Thin-shell material must remain double-sided')
        skin=mesh.doc['skins'][node['skin']];root=[i for i,j in enumerate(skin['joints']) if mesh.doc['nodes'][j]['name']=='root'];require(len(root)==1,'Missing root binding');rotation,translation=rigid_frame(mesh.read(skin['inverseBindMatrices'])[root[0]])
        shared={}
        for i,(p,(panel,u,v)) in enumerate(zip(positions,panels)):
            key=(p,joints[i],weights[i],panel)
            if key not in shared or min(u,1-u)>min(shared[key][1],1-shared[key][1]):shared[key]=(panel,u,v)
        anatomical={i:value for value,ids in ANATOMICAL_SUPPORT_GROUPS[role] for i in ids}
        contact={i:value for value,ids in FOOT_SUPPORT_GROUPS for i in ids}
        result=[];maximum=0.
        for i,p in enumerate(positions):
            panel,u,v=shared[(p,joints[i],weights[i],panels[i][0])];require(panel=='pants','Unexpected cloth panel');u=0. if u<1e-6 or u>1-1e-6 else u
            canonical=_profile(u,v,anatomical.get(i,1.));mask=contact.get(i,1.)
            offset=tuple(sum(canonical[a]*rotation[a][k] for a in range(3))*mask for k in range(3))
            maximum=max(maximum,math.sqrt(sum(x*x for x in offset)));result.append(tuple(p[k]+offset[k] for k in range(3)))
        audit={};new_n,new_t=adjust_frames(positions,result,normals,tangents,indices,joints,weights,audit)
        require(maximum<=.0120001,'Standing profile exceeds added12mm limit')
        require(audit['minimumTriangleAreaRatio']>=.65 and audit['minimumTriangleNormalDot']>=.85,'Standing profile exceeds original triangle guards')
        mesh.write(attrs['POSITION'],result);mesh.write(attrs['NORMAL'],new_n);mesh.write(attrs['TANGENT'],new_t)
        stored=mesh.read(attrs['POSITION']);mesh.doc['accessors'][attrs['POSITION']].update(min=[min(p[k] for p in stored) for k in range(3)],max=[max(p[k] for p in stored) for k in range(3)])
        selected=[value for face in range(5800) if face not in removed for value in indices[face*3:face*3+3]]
        require(len(selected)==11916,'Unexpected retained pants triangles')
        parts.append({'role':role,'mesh':node['mesh'],'positionAccessor':attrs['POSITION'],'selectedIndices':selected,'maximumAddedMeters':maximum,**audit})
    binary=bytearray(mesh.data[mesh.start:]);prefix_length=len(binary)
    require(all(a==b or i+mesh.start in mesh.allowed for i,(a,b) in enumerate(zip(raw[MeshFile(raw).start:],binary))),'Unexpected protected binary mutation')
    for part in parts:
        binary.extend(b'\0'*(-len(binary)%4));start=len(binary);selected=part.pop('selectedIndices');payload=struct.pack('<'+'H'*len(selected),*selected);binary.extend(payload);binary.extend(b'\0'*(-len(binary)%4))
        view=len(mesh.doc['bufferViews']);mesh.doc['bufferViews'].append({'buffer':0,'byteOffset':start,'byteLength':len(payload),'target':34963})
        accessor=len(mesh.doc['accessors']);mesh.doc['accessors'].append({'bufferView':view,'byteOffset':0,'componentType':5123,'count':len(selected),'type':'SCALAR','min':[min(selected)],'max':[max(selected)]})
        mesh.doc['meshes'][part['mesh']]['primitives'][0]['indices']=accessor
    mesh.doc['buffers'][0]['byteLength']=len(binary)
    expected=copy.deepcopy(initial_doc)
    for part in parts:
        expected['accessors'][part['positionAccessor']]=mesh.doc['accessors'][part['positionAccessor']]
        expected['meshes'][part['mesh']]['primitives'][0]['indices']=mesh.doc['meshes'][part['mesh']]['primitives'][0]['indices']
    expected['accessors']+=mesh.doc['accessors'][len(initial_doc['accessors']):];expected['bufferViews']+=mesh.doc['bufferViews'][len(initial_doc['bufferViews']):];expected['buffers'][0]['byteLength']=len(binary)
    require(expected==mesh.doc,'Unexpected non-pants JSON mutation')
    encoded=json.dumps(mesh.doc,separators=(',',':')).encode();encoded+=b' '*(-len(encoded)%4)
    output=struct.pack('<III',0x46546c67,2,28+len(encoded)+len(binary))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(binary),0x004e4942)+bytes(binary)
    output_hash=hashlib.sha256(output).hexdigest();encoded_mesh=MeshFile(output)
    require(_pants_digest(encoded_mesh)==OUTPUT_PANTS_SHA256,'Standing pants output differs from exact reviewed geometry')
    require(_document_digest(encoded_mesh)==OUTPUT_DOCUMENT_SHA256,'Standing output document differs from reviewed topology')
    require(_rig_texture_digest(encoded_mesh)==RIG_TEXTURE_SHA256,'Standing output changed rig, motion or embedded textures')
    return output,{'sourceSha256':source_hash,'importSha256':output_hash,'applied':True,'selectedHair':style,'roles':parts,'geometrySourceProofSha256':AUTHORED_CONTRACT_SHA256,'inputPantsSha256':INPUT_PANTS_SHA256,'outputPantsSha256':OUTPUT_PANTS_SHA256,'protectedOtherInputBytesExact':True,'matchesWholeReviewedArtifact':output_hash==STANDING_OUTPUT_SHA256,'scope':'Standing-only analytic broad profile; explicit double-sided middle shell,982retained inner faces/180rims/all2810exterior faces perrole.','limitations':['No dynamic cloth or muscle simulation.','Ground and Slick unchanged.','Middle lining is intentionally absent; deep cuff/waist lining and exact declared internal boundaries remain.','Unrelated upstream hair/jacket floating-point output may vary acrossPython versions and is preserved exactly from input; pants, rig, motion, textures and full document contracts are pinned.'],'originalBinaryLengthBeforeIndices':prefix_length}
