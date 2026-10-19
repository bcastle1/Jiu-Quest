// Four isolated source-fabric hues let each athlete keep independent jacket and
// trouser colors without changing skin, hair, belts or the neutral mat.
export function fabricChannel(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  if (max < 22 || delta < 20) return -1;
  let hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  // Lime cloth turns yellow in its lit folds. Include those highlights without
  // classifying the warmer orange/tan skin tones as garment fabric.
  if (hue >= 48 && hue < 119 && delta / max >= 0.30) return 3;
  if (delta / max < 0.48) return -1;
  if (hue >= 211 && hue <= 266) return 0;
  if (hue >= 175 && hue < 211) return 1;
  if (hue >= 119 && hue < 175) return 2;
  return -1;
}

export function parseGiColor(color, fallback = '#f8fbff') {
  const safe = /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
  return [1, 3, 5].map((offset) => parseInt(safe.slice(offset, offset + 2), 16));
}

export function applyGiPalette(pixels, colors) {
  const palette = colors.map((color) => parseGiColor(color));
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const channel = fabricChannel(r, g, b);
    if (channel < 0) continue;
    // Use the source's lightest channel for cloth shading, preserving drawn folds.
    const light = Math.max(r, g, b) / 255;
    const shade = Math.min(1.08, 0.18 + light * 1.02);
    const highlight = Math.max(0, light - 0.70) * 42;
    for (let c = 0; c < 3; c++) pixels[i + c] = Math.min(255, Math.round(palette[channel][c] * shade + highlight));
  }
  return pixels;
}
