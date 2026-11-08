"""Pure source checks for the local import-only appearance selection."""
import hashlib
import json
import struct


def select_hair(raw, style="Slick"):
    styles = ("Crew", "Long", "Mohawk", "Slick", "Spikes")
    if style not in styles:
        raise ValueError("Unsupported pilot hairstyle")
    if len(raw) < 28 or struct.unpack_from("<III", raw) != (0x46546C67, 2, len(raw)):
        raise ValueError("Invalid GLB header")
    length, kind = struct.unpack_from("<II", raw, 12)
    if kind != 0x4E4F534A or length % 4 or 20 + length >= len(raw):
        raise ValueError("Expected aligned JSON followed by binary data")
    original = json.loads(raw[20:20 + length])
    doc = json.loads(raw[20:20 + length])
    suffix = raw[20 + length:]
    removed = []
    changed_indices = set()
    for role in ("Attacker", "Defender"):
        names = {f"JQ_{role}_Hair{s}" for s in styles}
        present = [(i, n) for i, n in enumerate(doc["nodes"]) if n.get("name") in names]
        if len(present) != 5 or {n["name"] for _, n in present} != names or not all("mesh" in n for _, n in present):
            raise ValueError("Hair inventory changed")
        for index, node in present:
            if node["name"] != f"JQ_{role}_Hair{style}":
                removed.append({"nodeIndex": index, "name": node["name"],
                                "mesh": node.pop("mesh"), "skin": node.pop("skin", None)})
                changed_indices.add(index)
        for part in ("Body", "Brows", "Eyes", "GiJacket", "GiPantsMesh", "Hair" + style):
            kept = [n for n in doc["nodes"] if n.get("name") == f"JQ_{role}_{part}"]
            if len(kept) != 1 or "mesh" not in kept[0] or "skin" not in kept[0]:
                raise ValueError("Required original fighter attachment missing: " + part)
    # Assert the full JSON contract, not just a count of removed hairstyles.
    for key in original:
        if key != "nodes" and doc[key] != original[key]:
            raise AssertionError("Non-node glTF data changed: " + key)
    if len(doc["nodes"]) != len(original["nodes"]):
        raise AssertionError("Node indices changed")
    for index, (before, after) in enumerate(zip(original["nodes"], doc["nodes"])):
        expected = dict(before)
        if index in changed_indices:
            expected.pop("mesh", None)
            expected.pop("skin", None)
        if after != expected:
            raise AssertionError("Unexpected source node change")
    encoded = json.dumps(doc, separators=(",", ":")).encode()
    encoded += b" " * ((-len(encoded)) % 4)
    result = struct.pack("<III", 0x46546C67, 2, 20 + len(encoded) + len(suffix))
    result += struct.pack("<II", len(encoded), 0x4E4F534A) + encoded + suffix
    if result[20 + len(encoded):] != suffix:
        raise AssertionError("Binary chunks changed")
    sha = lambda data: hashlib.sha256(data).hexdigest()
    return result, {"selectedHair": style, "removedMeshAttachments": removed,
        "sourceSha256": sha(raw), "importSha256": sha(result),
        "binaryChunksUnchanged": True, "nodeIndicesUnchanged": True,
        "nonHairAttachmentsUnchanged": True, "materialsAndUVsUnchanged": True,
        "skinsAndAnimationJSONUnchanged": True,
        "scope": "Eight unselected hair node mesh/skin references removed; original source file retained"}
