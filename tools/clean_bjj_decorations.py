"""Remove only the rigid chest decorations from paired JiuQuest GLBs.

The named attachment nodes and material slots remain available for a later
skinned cosmetic design. Animation, joints, retained geometry and the complete
binary buffer are preserved exactly; this is deliberately not a re-export.
"""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import struct
import sys


TARGET_NAMES = {
    f"JQ_{role}_{part}"
    for role in ("Attacker", "Defender")
    for part in ("ChestPatch", "Lapel_L", "Lapel_R")
}


def digest(value):
    if not isinstance(value, bytes):
        value = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(value).hexdigest()


def clean_decorations(path):
    path = Path(path)
    original = path.read_bytes()
    magic, version, size = struct.unpack_from("<III", original)
    if (magic, version, size) != (0x46546C67, 2, len(original)):
        raise ValueError(f"Invalid GLB header: {path.name}")
    json_size, json_type = struct.unpack_from("<II", original, 12)
    if json_type != 0x4E4F534A:
        raise ValueError("Expected the GLB JSON chunk first")
    document = json.loads(original[20:20 + json_size])
    binary_chunks = original[20 + json_size:]
    before = copy.deepcopy(document)
    targets = [node for node in document["nodes"] if node.get("name") in TARGET_NAMES]
    if len(targets) != len(TARGET_NAMES):
        raise ValueError("Expected all six exact decorative attachment nodes")
    removed = {node["mesh"] for node in targets if "mesh" in node}
    if removed and len(removed) != len(TARGET_NAMES):
        raise ValueError("Refusing a partially cleaned or shared decorative mesh set")
    for node in document["nodes"]:
        if node.get("name") not in TARGET_NAMES and node.get("mesh") in removed:
            raise ValueError("A retained node shares a decorative mesh; refusing cleanup")
    old_meshes = document["meshes"]
    mesh_map = {}
    document["meshes"] = []
    for index, mesh in enumerate(old_meshes):
        if index not in removed:
            mesh_map[index] = len(document["meshes"])
            document["meshes"].append(mesh)
    for node in document["nodes"]:
        if node.get("name") in TARGET_NAMES:
            node.pop("mesh", None)
            node.pop("skin", None)
        elif "mesh" in node:
            node["mesh"] = mesh_map[node["mesh"]]

    # Normalize only the intended deletions and mesh index remapping. All other
    # JSON, including animation samplers, node transforms and skin bindings,
    # must still be identical to the input.
    restored = copy.deepcopy(document)
    restored["meshes"] = before["meshes"]
    for node, old_node in zip(restored["nodes"], before["nodes"]):
        if "mesh" in old_node:
            node["mesh"] = old_node["mesh"]
        if node.get("name") in TARGET_NAMES and "skin" in old_node:
            node["skin"] = old_node["skin"]
    if restored != before:
        raise AssertionError("Cleanup changed non-decorative data")
    if removed:
        encoded = json.dumps(document, separators=(",", ":"), ensure_ascii=False).encode()
        encoded += b" " * (-len(encoded) % 4)
        output = (struct.pack("<III", magic, version, 20 + len(encoded) + len(binary_chunks))
                  + struct.pack("<II", len(encoded), json_type) + encoded + binary_chunks)
        path.write_bytes(output)
    else:
        output = original
    return {
        "file": path.name,
        "beforeBytes": len(original), "afterBytes": len(output),
        "beforeSha256": digest(original), "afterSha256": digest(output),
        "removedMeshes": len(removed), "retainedMeshes": len(document["meshes"]),
        "retainedNodes": len(document["nodes"]),
        "binaryBufferUnchanged": output[-len(binary_chunks):] == binary_chunks,
        "binaryBufferSha256": digest(binary_chunks),
        "animationJsonSha256": digest(document["animations"]),
        "animationJsonUnchanged": document["animations"] == before["animations"],
        "skinsUnchanged": document["skins"] == before["skins"],
        "nonDecorativeDataUnchanged": restored == before,
    }


if __name__ == "__main__":
    target = Path(sys.argv[1])
    paths = sorted(target.glob("*.glb")) if target.is_dir() else [target]
    results = [clean_decorations(path) for path in paths]
    print(json.dumps(results, indent=2))
