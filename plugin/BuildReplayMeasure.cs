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
    [Info("BuildReplayMeasure", "BuildReplay", "0.4.0")]
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
            // Building pieces only: how they connect (sockets) and their construction / stability settings,
            // read field by field so nothing depends on Rust's internal names compiling.
            public List<Dictionary<string, object>> sockets;
            public Dictionary<string, object> construction;
            public Dictionary<string, object> stability;
        }

        // The exact shape of a mesh collider: vertices in the prefab root's local space, plus triangles.
        private class MeshShape
        {
            public string prefab;
            public string grade;
            public string name;
            public bool readable;
            public List<float[]> vertices = new List<float[]>();
            public List<int> triangles = new List<int>();
        }

        private class Output
        {
            public string format = "build-replay-measurements/1";
            public string measuredAt;
            public string rustVersion;
            public List<Entry> deployables = new List<Entry>();
            public List<Entry> building = new List<Entry>();
            public List<Entry> player = new List<Entry>();
            public List<string> searched = new List<string>();
            public List<MeshShape> meshes = new List<MeshShape>();
            public Dictionary<string, object> stabilitySettings;
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

            // Building pieces aren't items, so find their prefab paths in the game's string pool
            // (every prefab path is registered there), falling back to the manifest's entity list.
            var paths = new HashSet<string>();
            try { foreach (var str in StringPool.toString.Values) paths.Add(str); output.searched.Add("StringPool"); }
            catch (Exception ex) { output.errors.Add("StringPool: " + ex.Message); }
            try { foreach (var str in GameManifest.Current.entities) paths.Add(str); output.searched.Add("GameManifest.entities"); }
            catch (Exception ex) { output.errors.Add("GameManifest: " + ex.Message); }

            foreach (var path in paths)
            {
                if (path == null || seenPaths.Contains(path)) continue;
                var lower = path.ToLowerInvariant();
                if (!lower.EndsWith(".prefab")) continue;
                var isBuilding = lower.Contains("/building core/");
                var isPlayer = lower == "assets/prefabs/player/player.prefab";
                if (!isBuilding && !isPlayer) continue;
                try
                {
                    var go = GameManager.server.FindPrefab(path);
                    if (go == null) { output.errors.Add("No prefab for " + path); continue; }
                    var entry = Measure(go, path);
                    if (isPlayer) { output.player.Add(entry); continue; }
                    if (go.GetComponent<BuildingBlock>() == null) continue; // skins and helpers, not pieces
                    entry.gradeColliders = MeasureGrades(go, output.errors, output.meshes, entry.prefab);
                    DumpConnections(go, path, entry, output.errors);
                    output.building.Add(entry);
                    seenPaths.Add(path);
                }
                catch (Exception ex) { output.errors.Add(path + ": " + ex.Message); }
            }

            output.stabilitySettings = StaticFields("ConVar.Stability", output.errors);

            Interface.Oxide.DataFileSystem.WriteObject("BuildReplay/measurements", output);
            arg.ReplyWith($"BuildReplay: measured {output.deployables.Count} deployables, {output.building.Count} building pieces and {output.player.Count} player model " +
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

        private const BindingFlags AllInstance = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.DeclaredOnly;

        private void DumpConnections(GameObject go, string path, Entry entry, List<string> errors)
        {
            try
            {
                var id = StringPool.Get(path);
                var con = PrefabAttribute.server.Find<Construction>(id);
                if (con == null) { errors.Add("No construction for " + path); }
                else
                {
                    entry.construction = Fields(con, 0);
                    var socketsField = FindField(con.GetType(), "allSockets");
                    var arr = socketsField != null ? socketsField.GetValue(con) as Array : null;
                    entry.sockets = new List<Dictionary<string, object>>();
                    if (arr != null) foreach (var sock in arr) if (sock != null) entry.sockets.Add(Fields(sock, 0));
                }
            }
            catch (Exception ex) { errors.Add(path + " sockets: " + ex.Message); }
            try
            {
                foreach (var comp in go.GetComponents<Component>())
                {
                    if (comp == null) continue;
                    var n = comp.GetType().Name;
                    if (n == "BuildingBlock" || n == "StabilityEntity" || n == "DecayEntity")
                    {
                        if (entry.stability == null) entry.stability = new Dictionary<string, object>();
                        entry.stability[n] = Fields(comp, 1);
                    }
                }
            }
            catch (Exception ex) { errors.Add(path + " stability: " + ex.Message); }
        }

        private static FieldInfo FindField(Type t, string name)
        {
            for (; t != null; t = t.BaseType)
            {
                var f = t.GetField(name, AllInstance);
                if (f != null) return f;
            }
            return null;
        }

        // Every field of an object (including base classes up to Unity's own types), as JSON-friendly values.
        private Dictionary<string, object> Fields(object o, int depth)
        {
            var d = new Dictionary<string, object> { ["_type"] = o.GetType().Name };
            for (var t = o.GetType(); t != null && t != typeof(object) && t != typeof(UnityEngine.Object) && t != typeof(Component) && t != typeof(MonoBehaviour) && t != typeof(Behaviour); t = t.BaseType)
            {
                if (depth > 0 && (t.Name == "BaseEntity" || t.Name == "BaseNetworkable" || t.Name == "BaseMonoBehaviour")) break;
                foreach (var f in t.GetFields(AllInstance))
                {
                    if (d.ContainsKey(f.Name)) continue;
                    object v;
                    try { v = f.GetValue(o); } catch { continue; }
                    d[f.Name] = Simple(v, depth);
                }
            }
            return d;
        }

        private object Simple(object v, int depth)
        {
            if (v == null) return null;
            if (v is string || v is bool || v is int || v is uint || v is long || v is ulong || v is short || v is byte) return v;
            if (v is float) return R((float)v);
            if (v is double) return Math.Round((double)v, 4);
            if (v is Enum) return v.ToString();
            if (v is Vector3) return V((Vector3)v);
            if (v is Quaternion) return V(((Quaternion)v).eulerAngles);
            if (v is Bounds) { var b = (Bounds)v; return new Dictionary<string, object> { ["center"] = V(b.center), ["size"] = V(b.size) }; }
            var uo = v as UnityEngine.Object;
            if (uo != null) return "<" + v.GetType().Name + ":" + uo.name + ">";
            var e = v as System.Collections.IEnumerable;
            if (e != null)
            {
                var list = new List<object>();
                var n = 0;
                foreach (var item in e) { if (n++ >= 64) break; list.Add(depth < 2 && item != null && !(item is UnityEngine.Object) && item.GetType().IsClass && !(item is string) ? (object)Fields(item, depth + 1) : Simple(item, depth + 1)); }
                return list;
            }
            if (depth < 2 && v.GetType().IsClass) return Fields(v, depth + 1);
            return v.ToString();
        }

        private Dictionary<string, object> StaticFields(string typeName, List<string> errors)
        {
            var d = new Dictionary<string, object>();
            try
            {
                Type t = null;
                foreach (var asm in AppDomain.CurrentDomain.GetAssemblies()) { t = asm.GetType(typeName); if (t != null) break; }
                if (t == null) { errors.Add("Type not found: " + typeName); return d; }
                foreach (var f in t.GetFields(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static))
                {
                    try { d[f.Name] = Simple(f.GetValue(null), 1); } catch { }
                }
            }
            catch (Exception ex) { errors.Add(typeName + ": " + ex.Message); }
            return d;
        }

        private void DumpMeshes(GameObject skin, string prefab, string grade, List<MeshShape> meshes, List<string> errors)
        {
            foreach (var mc in skin.GetComponentsInChildren<MeshCollider>(true))
            {
                if (mc.isTrigger || mc.sharedMesh == null) continue;
                var shape = new MeshShape { prefab = prefab, grade = grade, name = mc.gameObject.name, readable = mc.sharedMesh.isReadable };
                try
                {
                    var verts = mc.sharedMesh.vertices;
                    foreach (var v in verts) shape.vertices.Add(V(skin.transform.InverseTransformPoint(mc.transform.TransformPoint(v))));
                    shape.triangles.AddRange(mc.sharedMesh.triangles);
                }
                catch (Exception ex) { errors.Add(prefab + " mesh " + mc.gameObject.name + ": " + ex.Message); }
                meshes.Add(shape);
            }
        }

        // Building blocks keep their collision on per-grade skins. Read them through reflection so this
        // compiles even if field names differ between Rust versions; anything missing is reported, not fatal.
        private Dictionary<string, List<Box>> MeasureGrades(GameObject go, List<string> errors, List<MeshShape> meshes, string prefab)
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
                    // One grade's exact collision shapes are enough: every grade shares the same footprint.
                    if (gradeName == "Stone") DumpMeshes(skin, prefab, gradeName, meshes, errors);
                }
            }
            catch (Exception ex) { errors.Add(go.name + " grades: " + ex.Message); }
            return result;
        }
    }
}
