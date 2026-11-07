using System.Collections.Generic;
using UnityEngine;

namespace JiuQuest.Combat
{
    // Original architectural stroke alphabet, in a five-by-seven cap space.
    // Curved letters are sampled continuously rather than made of pixel blocks.
    internal static class StudioLettering
    {
        static Vector2[] Line(params float[] values)
        {
            var points = new Vector2[values.Length / 2];
            for (int i = 0; i < points.Length; i++) points[i] = new Vector2(values[i * 2], values[i * 2 + 1]);
            return points;
        }

        static Vector2[] Arc(float x, float y, float rx, float ry, float start, float end)
        {
            int count = Mathf.CeilToInt(Mathf.Abs(end - start) / 12);
            var points = new Vector2[count + 1];
            for (int i = 0; i <= count; i++)
            {
                float angle = Mathf.Lerp(start, end, i / (float)count) * Mathf.Deg2Rad;
                points[i] = new Vector2(x + rx * Mathf.Cos(angle), y + ry * Mathf.Sin(angle));
            }
            return points;
        }

        public static IEnumerable<Vector2[]> Paths(char letter)
        {
            switch (letter)
            {
                case 'J':
                    yield return Line(1, 6.6f, 4.5f, 6.6f, 4.5f, 2);
                    yield return Arc(2.5f, 2, 2, 1.6f, 0, -180);
                    yield return Line(.5f, 2, .5f, 2.5f); break;
                case 'I': yield return Line(2.5f, .4f, 2.5f, 6.6f); break;
                case 'U':
                    yield return Line(.5f, 6.6f, .5f, 2);
                    yield return Arc(2.5f, 2, 2, 1.6f, 180, 360);
                    yield return Line(4.5f, 2, 4.5f, 6.6f); break;
                case 'Q':
                    yield return Arc(2.5f, 3.5f, 2, 3.1f, 0, 360);
                    yield return Line(3, 1.7f, 4.9f, .1f); break;
                case 'E':
                    yield return Line(4.5f, 6.6f, .5f, 6.6f, .5f, .4f, 4.5f, .4f);
                    yield return Line(.5f, 3.6f, 3.9f, 3.6f); break;
                case 'S':
                    yield return Arc(2.5f, 5.1f, 2, 1.5f, 32, 270);
                    yield return Arc(2.5f, 1.9f, 2, 1.7f, 90, -148); break;
                case 'T':
                    yield return Line(.3f, 6.6f, 4.7f, 6.6f);
                    yield return Line(2.5f, 6.6f, 2.5f, .4f); break;
                case 'R':
                    yield return Line(.5f, .4f, .5f, 6.6f, 2.7f, 6.6f);
                    yield return Arc(2.7f, 5.1f, 1.8f, 1.5f, 90, -90);
                    yield return Line(2.7f, 3.6f, .5f, 3.6f);
                    yield return Line(2.5f, 3.6f, 4.7f, .4f); break;
                case 'A':
                    yield return Line(.3f, .4f, 2.5f, 6.6f, 4.7f, .4f);
                    yield return Line(1.15f, 2.7f, 3.85f, 2.7f); break;
                case 'N': yield return Line(.5f, .4f, .5f, 6.6f, 4.5f, .4f, 4.5f, 6.6f); break;
                case 'G':
                    yield return Arc(2.5f, 3.5f, 2, 3.1f, 42, 360);
                    yield return Line(4.5f, 3.5f, 2.8f, 3.5f); break;
                case 'P':
                    yield return Line(.5f, .4f, .5f, 6.6f, 2.7f, 6.6f);
                    yield return Arc(2.7f, 5.1f, 1.8f, 1.5f, 90, -90);
                    yield return Line(2.7f, 3.6f, .5f, 3.6f); break;
                case 'L': yield return Line(.5f, 6.6f, .5f, .4f, 4.5f, .4f); break;
                case '-': yield return Line(1, 3.5f, 4, 3.5f); break;
            }
        }
    }
}
