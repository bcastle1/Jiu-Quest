import { Color } from 'three';

const authoredColors = new WeakMap();

// Only explicit cosmetic slots are recolored. Eyes, sclera, iris and other
// authored detail remain exactly as imported by GLTFLoader.
export function pairedMaterialSlot(name, role) {
  const prefix = `JQ_${role}_`;
  if (typeof name !== 'string' || !name.startsWith(prefix)) return null;
  const match = /^(GiTop|GiPants|Skin|Hair|Brows|Belt|BeltStripe|Patch)(?:_Ref_([0-9a-f]{6}))?$/i.exec(name.slice(prefix.length));
  if (!match) return null;
  return { slot: match[1].toLowerCase(), reference: match[2] ? `#${match[2]}` : '#ffffff' };
}

export function tintPairedMaterial(material, selectedColor, reference = '#ffffff') {
  if (!material?.color || !selectedColor) return;
  if (!authoredColors.has(material)) authoredColors.set(material, material.color.clone());
  if (!material.map) {
    material.color.copy(selectedColor);
    return;
  }

  // Three stores Color channels in linear space. Preserve the original glTF
  // base-color factor and every PBR map; recolor relative to the texture's
  // declared reference swatch. Starting from the original avoids cumulative
  // darkening when appearance or performer changes repeatedly.
  const authored = authoredColors.get(material);
  const swatch = new Color(reference);
  material.color.setRGB(
    authored.r * selectedColor.r / Math.max(swatch.r, 0.001),
    authored.g * selectedColor.g / Math.max(swatch.g, 0.001),
    authored.b * selectedColor.b / Math.max(swatch.b, 0.001),
  );
}
