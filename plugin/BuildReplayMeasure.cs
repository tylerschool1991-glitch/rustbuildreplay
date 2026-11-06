using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Oxide.Core;
using UnityEngine;

namespace Oxide.Plugins
{
    // One-time measuring tool for the BuildReplay sandbox.
    // Run `brmeasure` in the server console. It reads (without spawning anything into the world) the exact
    // bounds and collision boxes of every deployable item and every building-core prefab, and writes them to
    // oxide/data/BuildReplay/measurements.json (carbon/data/... on Carbon). Send that file back to be imported.
    //
    // `brstability` (0.5) builds a set of small test structures on flat ground, lets Rust's own stability system
    // settle, records every piece's stability and the supports it found, then deletes everything it built.
    // While it runs (about 30 seconds) collapse is switched off so nothing falls; the setting is put back after.
    // Results: data/BuildReplay/stability.json. Run it on a local test server, not a live one.
    [Info("BuildReplayMeasure", "BuildReplay", "0.5.2")]
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

        // ---------------------------------------------------------------------------------------------
        // brstability: measure Rust's stability on real test structures.
        // ---------------------------------------------------------------------------------------------
        private class Piece
        {
            public string label;
            public string prefab;
            public float[] offset;      // metres from the scenario's first foundation top (Unity axes)
            public float yaw;
            public bool spawned;
            public bool alive;
            public bool grounded;
            public float stability = -1f;
            public float check = -1f;  // StabilityCheck() if the game has it
            public int distanceFromGround = -1;
            public int strikes;
            public List<float> history = new List<float>();
            public object supports;
            [Newtonsoft.Json.JsonIgnore] public BaseEntity entity;
        }

        private class Scenario
        {
            public string name;
            public string note;
            public float[] origin;
            public bool inAir;
            public List<Piece> pieces = new List<Piece>();
        }

        private class StabilityOutput
        {
            public string format = "build-replay-stability/1";
            public string measuredAt;
            public string rustVersion;
            public Dictionary<string, object> settingsBefore;
            public int worldSize;
            public Dictionary<string, int> spotRejections;
            public List<string> methodsFound = new List<string>();
            public List<Scenario> scenarios = new List<Scenario>();
            public List<string> errors = new List<string>();
        }

        private StabilityOutput stab;
        private Dictionary<BaseNetworkable, string> labels = new Dictionary<BaseNetworkable, string>();
        private FieldInfo collapseField;
        private object collapseBefore;
        private const int Passes = 20;

        private static Scenario Sc(string name, string note) => new Scenario { name = name, note = note };
        private static void Put(Scenario s, string prefab, float x, float y, float z, float yaw = 0f)
        {
            s.pieces.Add(new Piece { label = s.name + "#" + s.pieces.Count, prefab = prefab, offset = new[] { x, y, z }, yaw = yaw });
        }
        // Four walls round the square foundation or floor whose top is at height y.
        private static void Ring(Scenario s, float y, string prefab = "wall")
        {
            Put(s, prefab, 0, y, 1.5f, 90); Put(s, prefab, 0, y, -1.5f, 90); Put(s, prefab, 1.5f, y, 0); Put(s, prefab, -1.5f, y, 0);
        }

        // Every structure is built from the first foundation's top centre (offset 0,0,0). Unity axes: x east, y up,
        // z north. Walls stand on their bottom edge; floors sit on the storey line; a roof's low edge is local +z.
        private List<Scenario> BuildScenarios()
        {
            var list = new List<Scenario>();
            Scenario s;

            s = Sc("wall_stack", "Walls stacked on one foundation edge, 5 high."); list.Add(s);
            Put(s, "foundation", 0, 0, 0); for (var i = 0; i < 5; i++) Put(s, "wall", 1.5f, 3 * i, 0);

            s = Sc("wall_row_stack", "Three foundations in a row, a wall on each north edge, 3 high (neighbouring walls)."); list.Add(s);
            for (var i = 0; i < 3; i++) Put(s, "foundation", 3 * i, 0, 0);
            for (var h = 0; h < 3; h++) for (var i = 0; i < 3; i++) Put(s, "wall", 3 * i, 3 * h, 1.5f, 90);

            s = Sc("floor_one_wall", "Floor over a foundation, held by one wall."); list.Add(s);
            Put(s, "foundation", 0, 0, 0); Put(s, "wall", 0, 0, 1.5f, 90); Put(s, "floor", 0, 3, 0);

            s = Sc("floor_two_walls_opposite", "Floor on two opposite walls."); list.Add(s);
            Put(s, "foundation", 0, 0, 0); Put(s, "wall", 0, 0, 1.5f, 90); Put(s, "wall", 0, 0, -1.5f, 90); Put(s, "floor", 0, 3, 0);

            s = Sc("floor_two_walls_corner", "Floor on two walls meeting at a corner."); list.Add(s);
            Put(s, "foundation", 0, 0, 0); Put(s, "wall", 0, 0, 1.5f, 90); Put(s, "wall", 1.5f, 0, 0); Put(s, "floor", 0, 3, 0);

            s = Sc("tower_four_walls", "1x1 tower, four walls per storey, 5 storeys."); list.Add(s);
            Put(s, "foundation", 0, 0, 0);
            for (var h = 0; h < 5; h++) { Ring(s, 3 * h); Put(s, "floor", 0, 3 * h + 3, 0); }

            s = Sc("cantilever_one_wall", "Floor on one wall, then floors running out north with nothing under them."); list.Add(s);
            Put(s, "foundation", 0, 0, 0); Put(s, "wall", 0, 0, 1.5f, 90);
            for (var k = 0; k <= 10; k++) Put(s, "floor", 0, 3, 3 * k);

            s = Sc("cantilever_room", "Floor on four walls, then floors running out north."); list.Add(s);
            Put(s, "foundation", 0, 0, 0); Ring(s, 0);
            for (var k = 0; k <= 10; k++) Put(s, "floor", 0, 3, 3 * k);

            s = Sc("cantilever_sideways", "Floor on four walls, floors out north 3, then turning east 3 (L-shape)."); list.Add(s);
            Put(s, "foundation", 0, 0, 0); Ring(s, 0);
            for (var k = 0; k <= 3; k++) Put(s, "floor", 0, 3, 3 * k);
            for (var k = 1; k <= 3; k++) Put(s, "floor", 3 * k, 3, 9);

            s = Sc("floor_grid_over_room", "3x3 floors, only the middle one over a walled room."); list.Add(s);
            Put(s, "foundation", 0, 0, 0); Ring(s, 0);
            for (var i = -1; i <= 1; i++) for (var j = -1; j <= 1; j++) Put(s, "floor", 3 * i, 3, 3 * j);

            s = Sc("bridge", "Floors spanning between two single-wall supports 5 floors apart."); list.Add(s);
            Put(s, "foundation", 0, 0, 0); Put(s, "foundation", 0, 0, 18);
            Put(s, "wall", 0, 0, 1.5f, 90); Put(s, "wall", 0, 0, 16.5f, 90);
            for (var k = 0; k <= 6; k++) Put(s, "floor", 0, 3, 3 * k);

            s = Sc("half_wall_floor", "Half wall, floor on its top over the foundation and one outside."); list.Add(s);
            Put(s, "foundation", 0, 0, 0); Put(s, "wall.half", 0, 0, 1.5f, 90); Put(s, "floor", 0, 1.5f, 0); Put(s, "floor", 0, 1.5f, 3);

            s = Sc("half_wall_ring", "Four half walls, floor on top, then a wall on each half wall."); list.Add(s);
            Put(s, "foundation", 0, 0, 0); Ring(s, 0, "wall.half"); Put(s, "floor", 0, 1.5f, 0); Ring(s, 1.5f);

            s = Sc("mid_wall_floor", "Plain wall with floors at its mid-height socket on both sides."); list.Add(s);
            Put(s, "foundation", 0, 0, 0); Put(s, "wall", 0, 0, 1.5f, 90); Put(s, "floor", 0, 1.5f, 0); Put(s, "floor", 0, 1.5f, 3);

            s = Sc("mid_room_floor", "Four plain walls, a floor at mid-height inside."); list.Add(s);
            Put(s, "foundation", 0, 0, 0); Ring(s, 0); Put(s, "floor", 0, 1.5f, 0);

            s = Sc("doorway_mid_floor", "Doorway with a floor at its mid-height socket outside."); list.Add(s);
            Put(s, "foundation", 0, 0, 0); Put(s, "wall.doorway", 0, 0, 1.5f, 90); Put(s, "floor", 0, 1.5f, 3);

            s = Sc("wall_types", "One of each wall type on a row of foundations, a floor on each."); list.Add(s);
            var types = new[] { "wall", "wall.doorway", "wall.window", "wall.frame", "wall.half", "wall.low" };
            for (var i = 0; i < types.Length; i++) Put(s, "foundation", 3 * i, 0, 0);
            for (var i = 0; i < types.Length; i++) Put(s, types[i], 3 * i, 0, 1.5f, 90);
            for (var i = 0; i < types.Length; i++) Put(s, "floor", 3 * i, types[i] == "wall.half" ? 1.5f : 3, 0);

            s = Sc("wall_on_half", "Half wall, then two walls stacked on it."); list.Add(s);
            Put(s, "foundation", 0, 0, 0); Put(s, "wall.half", 1.5f, 0, 0); Put(s, "wall", 1.5f, 1.5f, 0); Put(s, "wall", 1.5f, 4.5f, 0);

            s = Sc("roof", "Roof on a north wall rising south, a wall on its high edge, a floor off its high edge."); list.Add(s);
            Put(s, "foundation", 0, 0, 0); Put(s, "wall", 0, 0, 1.5f, 90); Put(s, "wall", 0, 0, -1.5f, 90);
            Put(s, "roof", 0, 3, 0); Put(s, "wall", 0, 6, -1.5f, 90); Put(s, "floor", 0, 6, -3);

            s = Sc("triangle_floors", "Floor on four walls, a triangle floor off its north edge, then a square off the triangle."); list.Add(s);
            Put(s, "foundation", 0, 0, 0); Ring(s, 0); Put(s, "floor", 0, 3, 0);
            Put(s, "floor.triangle", 0, 3, 1.5f, 0);
            // The triangle's far edges: midpoints at (+-0.75, 1.299) from its origin; a square off the east one.
            Put(s, "floor", 0.75f + 1.5f * 0.866f, 3, 1.5f + 1.299f + 1.5f * 0.5f, 60);

            s = Sc("upper_walls_on_floor", "Room, floor, then a single wall on the floor's outer edge, and a second room above."); list.Add(s);
            Put(s, "foundation", 0, 0, 0); Ring(s, 0); Put(s, "floor", 0, 3, 0); Put(s, "floor", 0, 3, 3);
            Put(s, "wall", 0, 3, 4.5f, 90); Put(s, "wall", 1.5f, 3, 3); Put(s, "wall", -1.5f, 3, 3); Put(s, "floor", 0, 6, 3);

            return list;
        }

        private static Type FindType(string name)
        {
            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies()) { var t = asm.GetType(name); if (t != null) return t; }
            return null;
        }
        private static MethodInfo FindMethod(Type t, string name, int args)
        {
            for (; t != null; t = t.BaseType)
                foreach (var m in t.GetMethods(AllInstance))
                    if (m.Name == name && m.GetParameters().Length == args) return m;
            return null;
        }

        private readonly Dictionary<string, string> pathOf = new Dictionary<string, string>();
        private string PathFor(string prefab)
        {
            if (pathOf.Count == 0)
                foreach (var str in StringPool.toString.Values)
                {
                    if (str == null) continue;
                    var lower = str.ToLowerInvariant();
                    if (!lower.Contains("/building core/") || !lower.EndsWith(".prefab")) continue;
                    var n = lower.Substring(lower.LastIndexOf('/') + 1).Replace(".prefab", "");
                    if (!pathOf.ContainsKey(n)) pathOf[n] = str;
                }
            string p;
            return pathOf.TryGetValue(prefab, out p) ? p : null;
        }

        // Ground where every foundation of the scenario can stand (the ground under it varies by no more than
        // tol), above sea level and well away from any building. Stability ignores trees and rocks, so those
        // don't matter. Rejection counts go into the results so a failed search can be explained.
        private readonly Dictionary<string, int> rejected = new Dictionary<string, int>();
        private void Reject(string why) { int n; rejected.TryGetValue(why, out n); rejected[why] = n + 1; }
        private Vector3? FindSpot(Scenario s, List<Vector3> used, Vector3? near)
        {
            var size = (float)World.Size;
            var half = Mathf.Max(100f, size / 2f - 300f);
            var mask = LayerMask.GetMask("Construction");
            foreach (var tol in new[] { 1.2f, 2.6f })
                for (var attempt = 0; attempt < 1500; attempt++)
                {
                    Vector3 c;
                    if (near.HasValue)
                    {
                        var r = 40f + attempt * 0.25f;
                        var ang = attempt * 2.39996f;
                        c = near.Value + new Vector3(Mathf.Cos(ang) * r, 0, Mathf.Sin(ang) * r);
                    }
                    else c = new Vector3(UnityEngine.Random.Range(-half, half), 0, UnityEngine.Random.Range(-half, half));
                    var ok = true;
                    foreach (var u in used) if ((u - c).sqrMagnitude < 60f * 60f) { ok = false; break; }
                    if (!ok) { Reject("near another test"); continue; }
                    float lo = float.MaxValue, hi = float.MinValue;
                    foreach (var p in s.pieces)
                    {
                        if (p.prefab != "foundation") continue;
                        for (var i = -1; i <= 1; i++) for (var j = -1; j <= 1; j++)
                        {
                            var h = TerrainMeta.HeightMap.GetHeight(c + new Vector3(p.offset[0] + 1.5f * i, 0, p.offset[2] + 1.5f * j));
                            lo = Mathf.Min(lo, h); hi = Mathf.Max(hi, h);
                        }
                    }
                    if (lo < 1f) { Reject("below sea level"); continue; }
                    if (hi - lo > tol) { Reject("ground too uneven"); continue; }
                    var top = hi + 0.3f;
                    if (Physics.CheckSphere(c + new Vector3(0, top, 0), 25f, mask)) { Reject("buildings nearby"); continue; }
                    c.y = top;
                    return c;
                }
            return null;
        }

        private Vector3? SkySpot(List<Vector3> used)
        {
            var mask = LayerMask.GetMask("Construction", "Deployed");
            var reach = Mathf.Max(60f, (float)World.Size / 2f - 100f);
            for (var i = 0; i < 400; i++)
            {
                // Rows 50 m apart, filling outward from the middle of the map, 250 m up.
                var col = i % 20 - 10; var row = i / 20 - 10;
                var c = new Vector3(col * 50f, 250f, row * 50f);
                if (Mathf.Abs(c.x) > reach || Mathf.Abs(c.z) > reach) continue;
                var ok = true;
                foreach (var u in used) if ((u - c).sqrMagnitude < 45f * 45f) { ok = false; break; }
                if (!ok || Physics.CheckSphere(c, 25f, mask)) continue;
                return c;
            }
            return null;
        }

        [ConsoleCommand("brstability")]
        private void CmdStability(ConsoleSystem.Arg arg)
        {
            if (arg.Connection != null && arg.Connection.authLevel < 2) { arg.ReplyWith("Run this from the server console (or as an owner)."); return; }
            if (stab != null) { arg.ReplyWith("BuildReplay: a stability run is already going; give it a minute."); return; }
            stab = new StabilityOutput { measuredAt = DateTime.UtcNow.ToString("o"), rustVersion = Rust.Protocol.printable };
            labels.Clear();
            stab.settingsBefore = StaticFields("ConVar.Stability", stab.errors);

            var seType = typeof(StabilityEntity);
            foreach (var m in seType.GetMethods(AllInstance)) stab.methodsFound.Add(m.Name + "(" + m.GetParameters().Length + ")");

            // No collapsing while we measure: a piece only collapses when its stability is below this value.
            try
            {
                var conv = FindType("ConVar.Stability");
                collapseField = conv != null ? conv.GetField("collapse", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static) : null;
                if (collapseField != null) { collapseBefore = collapseField.GetValue(null); collapseField.SetValue(null, 0f); }
                else stab.errors.Add("ConVar.Stability.collapse not found; weak pieces may collapse during the run");
            }
            catch (Exception ex) { stab.errors.Add("collapse convar: " + ex.Message); }

            // AttachToBuilding(id): the overload that takes a numeric building ID.
            MethodInfo attachNum = null;
            for (var t = typeof(DecayEntity); t != null && attachNum == null; t = t.BaseType)
                foreach (var m in t.GetMethods(AllInstance))
                    if (m.Name == "AttachToBuilding" && m.GetParameters().Length == 1 && m.GetParameters()[0].ParameterType.IsPrimitive) { attachNum = m; break; }
            object manager = null; MethodInfo newId = null;
            try
            {
                var bm = FindType("BuildingManager");
                var srv = bm != null ? bm.GetField("server", BindingFlags.Public | BindingFlags.Static) : null;
                manager = srv != null ? srv.GetValue(null) : null;
                newId = manager != null ? FindMethod(manager.GetType(), "NewBuildingID", 0) : null;
            }
            catch (Exception ex) { stab.errors.Add("building id: " + ex.Message); }

            var used = new List<Vector3>();
            rejected.Clear();
            // Run from the F1 console in game, the tests are built around you; from the server console, anywhere.
            Vector3? near = null;
            var caller = arg.Player();
            if (caller != null) near = caller.transform.position;
            stab.worldSize = (int)World.Size;
            var count = 0;
            foreach (var sc in BuildScenarios())
            {
                stab.scenarios.Add(sc);
                var spot = FindSpot(sc, used, near);
                if (spot == null)
                {
                    // No room on the ground (small or crowded maps): build it in the air instead. Rust treats
                    // foundations as grounded however they're placed, so stability comes out the same.
                    spot = SkySpot(used);
                    sc.inAir = true;
                }
                if (spot == null) { stab.errors.Add(sc.name + ": no room on the ground or in the air"); continue; }
                used.Add(spot.Value);
                sc.origin = V(spot.Value);
                object buildingId = null;
                try { if (newId != null) buildingId = newId.Invoke(manager, null); } catch (Exception ex) { stab.errors.Add("NewBuildingID: " + ex.Message); }
                foreach (var p in sc.pieces)
                {
                    try
                    {
                        var path = PathFor(p.prefab);
                        if (path == null) { stab.errors.Add(p.label + ": no prefab path for " + p.prefab); continue; }
                        var pos = spot.Value + new Vector3(p.offset[0], p.offset[1], p.offset[2]);
                        var ent = GameManager.server.CreateEntity(path, pos, Quaternion.Euler(0, p.yaw, 0), true);
                        if (ent == null) { stab.errors.Add(p.label + ": CreateEntity returned null"); continue; }
                        if (attachNum != null && buildingId != null)
                        {
                            try { attachNum.Invoke(ent, new[] { Convert.ChangeType(buildingId, attachNum.GetParameters()[0].ParameterType) }); }
                            catch (Exception ex) { if (p == sc.pieces[0]) stab.errors.Add(sc.name + " AttachToBuilding: " + ex.Message); }
                        }
                        ent.Spawn();
                        p.entity = ent; p.spawned = true;
                        labels[ent] = p.label;
                        count++;
                    }
                    catch (Exception ex) { stab.errors.Add(p.label + " spawn: " + ex.Message); }
                }
            }
            stab.spotRejections = new Dictionary<string, int>(rejected);
            if (count == 0)
            {
                try { if (collapseField != null) collapseField.SetValue(null, collapseBefore); } catch { }
                Interface.Oxide.DataFileSystem.WriteObject("BuildReplay/stability", stab);
                var why = string.Join(", ", rejected.Select(kv => kv.Key + " " + kv.Value).ToArray());
                arg.ReplyWith("BuildReplay: couldn't find room for the tests (" + why + "). Saved details to data/BuildReplay/stability.json");
                stab = null;
                return;
            }
            arg.ReplyWith("BuildReplay: built " + count + " test pieces in " + stab.scenarios.Count + " structures; measuring for about 30 seconds...");
            timer.Once(3f, () => StabilityPass(0));
        }

        private void StabilityPass(int pass)
        {
            var init = FindMethod(typeof(StabilityEntity), "InitializeSupports", 0);
            var update = FindMethod(typeof(StabilityEntity), "UpdateStability", 0);
            var cachedField = FindField(typeof(StabilityEntity), "cachedStability");
            foreach (var sc in stab.scenarios)
                foreach (var p in sc.pieces)
                {
                    var se = p.entity as StabilityEntity;
                    if (se == null || se.IsDestroyed) continue;
                    try
                    {
                        if (pass == 0 && init != null) init.Invoke(se, null);
                        if (update != null) update.Invoke(se, null);
                        if (cachedField != null) p.history.Add(R((float)cachedField.GetValue(se)));
                    }
                    catch (Exception ex) { if (pass == 0) stab.errors.Add(p.label + " pass: " + (ex.InnerException ?? ex).Message); }
                }
            if (pass + 1 < Passes) { timer.Once(1.25f, () => StabilityPass(pass + 1)); return; }
            FinishStability();
        }

        private void FinishStability()
        {
            var check = FindMethod(typeof(StabilityEntity), "StabilityCheck", 0);
            foreach (var sc in stab.scenarios)
                foreach (var p in sc.pieces)
                {
                    var se = p.entity as StabilityEntity;
                    if (p.entity == null) continue;
                    p.alive = !p.entity.IsDestroyed;
                    if (se == null || !p.alive) continue;
                    try
                    {
                        p.grounded = (bool)FindField(typeof(StabilityEntity), "grounded").GetValue(se);
                        p.stability = R((float)FindField(typeof(StabilityEntity), "cachedStability").GetValue(se));
                        p.distanceFromGround = (int)FindField(typeof(StabilityEntity), "cachedDistanceFromGround").GetValue(se);
                        var strikesF = FindField(typeof(StabilityEntity), "stabilityStrikes");
                        if (strikesF != null) p.strikes = Convert.ToInt32(strikesF.GetValue(se));
                        if (check != null && check.ReturnType == typeof(float)) p.check = R((float)check.Invoke(se, null));
                        var supF = FindField(typeof(StabilityEntity), "supports");
                        p.supports = supF != null ? Dump(supF.GetValue(se), 0, 4) : null;
                    }
                    catch (Exception ex) { stab.errors.Add(p.label + " read: " + (ex.InnerException ?? ex).Message); }
                }

            try { if (collapseField != null) collapseField.SetValue(null, collapseBefore); }
            catch (Exception ex) { stab.errors.Add("restore collapse: " + ex.Message); }

            Interface.Oxide.DataFileSystem.WriteObject("BuildReplay/stability", stab);

            var removed = 0;
            foreach (var sc in stab.scenarios)
                for (var i = sc.pieces.Count - 1; i >= 0; i--)
                {
                    var e = sc.pieces[i].entity;
                    if (e != null && !e.IsDestroyed) { e.Kill(); removed++; }
                }
            Puts("BuildReplay: stability measured (" + stab.errors.Count + " errors). Saved to data/BuildReplay/stability.json; removed " + removed + " test pieces.");
            stab = null;
        }

        // Like Fields/Simple, but deeper, and names the test pieces it meets so links can be followed.
        private static readonly HashSet<string> SkipFields = new HashSet<string> { "gameManager", "prefabAttribute", "socketMods", "attribute" };
        private object Dump(object v, int depth, int max)
        {
            if (v == null) return null;
            var bn = v as BaseNetworkable;
            if (bn != null) { string l; return labels.TryGetValue(bn, out l) ? "<" + l + ">" : "<" + bn.ShortPrefabName + ">"; }
            if (v is UnityEngine.Object) return "<" + v.GetType().Name + ">";
            if (v is string || v is bool || v is int || v is uint || v is long || v is ulong || v is short || v is byte || v is Enum) return v is Enum ? v.ToString() : v;
            if (v is float) return R((float)v);
            if (v is double) return Math.Round((double)v, 4);
            if (v is Vector3) return V((Vector3)v);
            if (v is Quaternion) return V(((Quaternion)v).eulerAngles);
            if (depth >= max) return v.GetType().Name;
            var e = v as System.Collections.IEnumerable;
            if (e != null)
            {
                var list = new List<object>(); var n = 0;
                foreach (var item in e) { if (n++ >= 64) break; list.Add(Dump(item, depth + 1, max)); }
                return list;
            }
            var d = new Dictionary<string, object> { ["_type"] = v.GetType().Name };
            for (var t = v.GetType(); t != null && t != typeof(object) && t != typeof(ValueType); t = t.BaseType)
                foreach (var f in t.GetFields(AllInstance))
                {
                    if (d.ContainsKey(f.Name) || SkipFields.Contains(f.Name)) continue;
                    try { d[f.Name] = Dump(f.GetValue(v), depth + 1, max); } catch { }
                }
            return d;
        }
    }
}
