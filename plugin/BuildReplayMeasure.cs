using System;
using System.Collections.Generic;
using System.Reflection;
using Oxide.Core;
using UnityEngine;

namespace Oxide.Plugins
{
    // One-time measuring tool for the BuildReplay sandbox.
    // Run `brmeasure` in the server console. It reads (without spawning anything into the world) the exact
    // bounds and collision boxes of every deployable item and every building-core prefab, and writes them to
    // oxide/data/BuildReplay/measurements.json (carbon/data/... on Carbon). Send that file back to be imported.
    [Info("BuildReplayMeasure", "BuildReplay", "0.1.0")]
    [Description("Dumps exact sizes of deployables and building pieces for the BuildReplay sandbox.")]
    public class BuildReplayMeasure : RustPlugin
    {
        private class Box
        {
            public float[] center;
            public float[] size;
            public string name;
            public string type;
        }

        private class Entry
        {
            public string item;
            public string name;
            public string category;
            public string prefab;
            public string path;
            public Box bounds;
            public List<Box> colliders = new List<Box>();
            public Dictionary<string, List<Box>> gradeColliders;
        }

        private class Output
        {
            public string format = "build-replay-measurements/1";
            public string measuredAt;
            public string rustVersion;
            public List<Entry> deployables = new List<Entry>();
            public List<Entry> building = new List<Entry>();
            public List<string> errors = new List<string>();
        }

        private static float R(float v) => (float)Math.Round(v, 4);
        private static float[] V(Vector3 v) => new[] { R(v.x), R(v.y), R(v.z) };

        [ConsoleCommand("brmeasure")]
        private void CmdMeasure(ConsoleSystem.Arg arg)
        {
            if (arg.Connection != null && arg.Connection.authLevel < 2)
            {
                arg.ReplyWith("Run this from the server console (or as an owner).");
                return;
            }

            var output = new Output { measuredAt = DateTime.UtcNow.ToString("o"), rustVersion = Rust.Protocol.printable };
            var seenPaths = new HashSet<string>();

            foreach (var def in ItemManager.itemList)
            {
                try
                {
                    var dep = def.GetComponent<ItemModDeployable>();
                    if (dep == null || dep.entityPrefab == null) continue;
                    var path = dep.entityPrefab.resourcePath;
                    if (string.IsNullOrEmpty(path)) continue;
                    var go = GameManager.server.FindPrefab(path);
                    if (go == null) { output.errors.Add("No prefab for " + def.shortname); continue; }
                    var entry = Measure(go, path);
                    entry.item = def.shortname;
                    entry.name = def.displayName != null ? def.displayName.english : def.shortname;
                    entry.category = def.category.ToString();
                    output.deployables.Add(entry);
                    seenPaths.Add(path);
                }
                catch (Exception ex) { output.errors.Add(def.shortname + ": " + ex.Message); }
            }

            foreach (var path in GameManifest.Current.entities)
            {
                if (path == null || !path.Contains("/building core/") || !path.EndsWith(".prefab") || seenPaths.Contains(path)) continue;
                try
                {
                    var go = GameManager.server.FindPrefab(path);
                    if (go == null) continue;
                    var entry = Measure(go, path);
                    entry.gradeColliders = MeasureGrades(go, output.errors);
                    output.building.Add(entry);
                }
                catch (Exception ex) { output.errors.Add(path + ": " + ex.Message); }
            }

            Interface.Oxide.DataFileSystem.WriteObject("BuildReplay/measurements", output);
            arg.ReplyWith($"BuildReplay: measured {output.deployables.Count} deployables and {output.building.Count} building pieces " +
                          $"({output.errors.Count} errors). Saved to data/BuildReplay/measurements.json");
        }

        private Entry Measure(GameObject go, string path)
        {
            var entry = new Entry { path = path, prefab = go.name };
            var ent = go.GetComponent<BaseEntity>();
            if (ent != null)
            {
                entry.prefab = ent.ShortPrefabName;
                entry.bounds = new Box { center = V(ent.bounds.center), size = V(ent.bounds.size), type = "bounds" };
            }
            entry.colliders = CollidersOf(go, go.transform);
            return entry;
        }

        // Each collider's box in the prefab root's local space (axis-aligned around its 8 corners).
        private List<Box> CollidersOf(GameObject go, Transform root)
        {
            var list = new List<Box>();
            foreach (var col in go.GetComponentsInChildren<Collider>(true))
            {
                if (col.isTrigger) continue;
                Vector3 c, s;
                string type;
                var box = col as BoxCollider;
                var mesh = col as MeshCollider;
                var sphere = col as SphereCollider;
                var capsule = col as CapsuleCollider;
                if (box != null) { c = box.center; s = box.size; type = "box"; }
                else if (mesh != null && mesh.sharedMesh != null) { c = mesh.sharedMesh.bounds.center; s = mesh.sharedMesh.bounds.size; type = "mesh"; }
                else if (sphere != null) { c = sphere.center; s = Vector3.one * sphere.radius * 2f; type = "sphere"; }
                else if (capsule != null)
                {
                    c = capsule.center;
                    var r2 = capsule.radius * 2f;
                    s = new Vector3(r2, r2, r2);
                    s[capsule.direction] = Mathf.Max(capsule.height, r2);
                    type = "capsule";
                }
                else continue;

                var min = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue);
                var max = new Vector3(float.MinValue, float.MinValue, float.MinValue);
                for (var i = 0; i < 8; i++)
                {
                    var corner = c + Vector3.Scale(s * 0.5f, new Vector3((i & 1) == 0 ? -1 : 1, (i & 2) == 0 ? -1 : 1, (i & 4) == 0 ? -1 : 1));
                    var p = root.InverseTransformPoint(col.transform.TransformPoint(corner));
                    min = Vector3.Min(min, p);
                    max = Vector3.Max(max, p);
                }
                list.Add(new Box { center = V((min + max) * 0.5f), size = V(max - min), name = col.gameObject.name, type = type });
            }
            return list;
        }

        // Building blocks keep their collision on per-grade skins. Read them through reflection so this
        // compiles even if field names differ between Rust versions; anything missing is reported, not fatal.
        private Dictionary<string, List<Box>> MeasureGrades(GameObject go, List<string> errors)
        {
            var result = new Dictionary<string, List<Box>>();
            var bb = go.GetComponent<BuildingBlock>();
            if (bb == null) return result;
            try
            {
                var defField = typeof(BuildingBlock).GetField("blockDefinition", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                var construction = defField != null ? defField.GetValue(bb) : null;
                if (construction == null) construction = PrefabAttribute.server.Find<Construction>(bb.prefabID);
                if (construction == null) return result;
                var gradesField = construction.GetType().GetField("grades", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                var grades = gradesField != null ? gradesField.GetValue(construction) as Array : null;
                if (grades == null) return result;
                foreach (var g in grades)
                {
                    if (g == null) continue;
                    var gradeName = g.ToString();
                    var gradeBaseField = g.GetType().GetField("gradeBase", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                    var gradeBase = gradeBaseField != null ? gradeBaseField.GetValue(g) : null;
                    if (gradeBase != null)
                    {
                        var typeField = gradeBase.GetType().GetField("type", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                        if (typeField != null) gradeName = typeField.GetValue(gradeBase).ToString();
                    }
                    var skinField = g.GetType().GetField("skinObject", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                    var skinRef = skinField != null ? skinField.GetValue(g) as GameObjectRef : null;
                    if (skinRef == null || string.IsNullOrEmpty(skinRef.resourcePath)) continue;
                    var skin = GameManager.server.FindPrefab(skinRef.resourcePath);
                    if (skin == null) continue;
                    result[gradeName] = CollidersOf(skin, skin.transform);
                }
            }
            catch (Exception ex) { errors.Add(go.name + " grades: " + ex.Message); }
            return result;
        }
    }
}
