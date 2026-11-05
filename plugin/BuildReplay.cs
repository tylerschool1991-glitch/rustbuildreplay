using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using Newtonsoft.Json;
using Oxide.Core;
using UnityEngine;

namespace Oxide.Plugins
{
    [Info("BuildReplay", "BuildReplay", "0.1.0")]
    [Description("Records base builds as replay logs for the BuildReplay web viewer.")]
    public class BuildReplay : RustPlugin
    {
        private const string PermUse = "buildreplay.use";
        private const string FormatVersion = "build-replay/1";
        private static readonly HashSet<string> Settings = new HashSet<string> { "open", "rock", "cave", "cliff" };

        #region Configuration

        private PluginConfig config;

        private class PluginConfig
        {
            // The viewer expects a foundation's position 1 m below its top surface.
            // If foundations come out 1 m too high or low in the viewer, change this.
            [JsonProperty("Foundation pivot offset in metres")]
            public float FoundationPivotOffset = -1f;

            [JsonProperty("Capture terrain around the base")]
            public bool CaptureTerrain = true;

            [JsonProperty("Terrain patch size in metres")]
            public float TerrainSize = 72f;

            [JsonProperty("Terrain samples per side")]
            public int TerrainRes = 49;

            [JsonProperty("Auto-save when the recording player disconnects")]
            public bool AutoSaveOnDisconnect = true;
        }

        protected override void LoadDefaultConfig()
        {
            config = new PluginConfig();
        }

        protected override void LoadConfig()
        {
            base.LoadConfig();
            try
            {
                config = Config.ReadObject<PluginConfig>();
                if (config == null) throw new Exception("empty config");
            }
            catch
            {
                PrintWarning("Config file is invalid; using defaults.");
                LoadDefaultConfig();
            }
            if (config.TerrainRes < 2) config.TerrainRes = 2;
            if (config.TerrainRes > 129) config.TerrainRes = 129;
            SaveConfig();
        }

        protected override void SaveConfig() => Config.WriteObject(config, true);

        #endregion

        #region Recording state

        private class RawEvent
        {
            public float T;
            public string Op;
            public ulong NetId;
            public string Prefab;
            public string Grade;
            public Vector3 Pos;
            public float Yaw;
        }

        private class Session
        {
            public ulong PlayerId;
            public string PlayerName;
            public float Start;
            public Vector3 StartPos;
            public readonly List<RawEvent> Events = new List<RawEvent>();
        }

        // Active recordings by player, and which recording each placed entity belongs to.
        private readonly Dictionary<ulong, Session> sessions = new Dictionary<ulong, Session>();
        private readonly Dictionary<ulong, Session> trackedEntities = new Dictionary<ulong, Session>();

        private float Now(Session s) => Time.realtimeSinceStartup - s.Start;

        private static ulong IdOf(BasePlayer player) => (ulong)player.userID;

        private static string GradeName(BuildingGrade.Enum grade)
        {
            switch (grade)
            {
                case BuildingGrade.Enum.Twigs: return "twigs";
                case BuildingGrade.Enum.Wood: return "wood";
                case BuildingGrade.Enum.Stone: return "stone";
                case BuildingGrade.Enum.Metal: return "metal";
                case BuildingGrade.Enum.TopTier: return "toptier";
                default: return grade.ToString().ToLowerInvariant();
            }
        }

        #endregion

        #region Output format (matches the viewer's build log)

        private class LogFile
        {
            [JsonProperty("format")] public string Format = FormatVersion;
            [JsonProperty("name")] public string Name;
            [JsonProperty("builder")] public string Builder;
            [JsonProperty("setting")] public string Setting;
            [JsonProperty("source")] public string Source = "recorded";
            [JsonProperty("recordedAt")] public string RecordedAt;
            [JsonProperty("terrain", NullValueHandling = NullValueHandling.Ignore)] public TerrainPatch Terrain;
            [JsonProperty("events")] public List<LogEvent> Events = new List<LogEvent>();
        }

        private class TerrainPatch
        {
            [JsonProperty("size")] public float Size;
            [JsonProperty("res")] public int Res;
            [JsonProperty("heights")] public float[] Heights;
        }

        private class LogEvent
        {
            [JsonProperty("t")] public float T;
            [JsonProperty("op")] public string Op;
            [JsonProperty("id")] public int Id;
            [JsonProperty("prefab", NullValueHandling = NullValueHandling.Ignore)] public string Prefab;
            [JsonProperty("grade", NullValueHandling = NullValueHandling.Ignore)] public string Grade;
            [JsonProperty("pos", NullValueHandling = NullValueHandling.Ignore)] public float[] Pos;
            [JsonProperty("rot", NullValueHandling = NullValueHandling.Ignore)] public float? Rot;
        }

        private static float Round2(float v) => (float)Math.Round(v, 2);

        // Rust/Unity is left-handed; the viewer (three.js) is right-handed. Flip z and negate yaw.
        private static float ViewerYaw(float unityYaw)
        {
            var r = -unityYaw % 360f;
            if (r < 0) r += 360f;
            return (float)Math.Round(r, 1);
        }

        #endregion

        #region Lifecycle

        private void Init()
        {
            permission.RegisterPermission(PermUse, this);
        }

        private void Unload()
        {
            sessions.Clear();
            trackedEntities.Clear();
        }

        private void OnPlayerDisconnected(BasePlayer player, string reason)
        {
            if (player == null) return;
            Session s;
            if (!sessions.TryGetValue(IdOf(player), out s)) return;
            if (config.AutoSaveOnDisconnect && s.Events.Count > 0)
            {
                var file = Save(s, "Autosave " + s.PlayerName, "open");
                Puts($"{s.PlayerName} disconnected while recording; saved {file}");
            }
            EndSession(s);
        }

        #endregion

        #region Hooks

        private void OnEntityBuilt(Planner plan, GameObject go)
        {
            var player = plan?.GetOwnerPlayer();
            if (player == null) return;
            Session s;
            if (!sessions.TryGetValue(IdOf(player), out s)) return;
            var entity = go?.ToBaseEntity();
            if (entity == null || entity.net == null) return;

            var block = entity as BuildingBlock;
            var id = entity.net.ID.Value;
            trackedEntities[id] = s;
            s.Events.Add(new RawEvent
            {
                T = Now(s),
                Op = "place",
                NetId = id,
                Prefab = entity.ShortPrefabName,
                Grade = block != null ? GradeName(block.grade) : null,
                Pos = entity.transform.position,
                Yaw = entity.transform.eulerAngles.y
            });
        }

        private object OnStructureUpgrade(BuildingBlock block, BasePlayer player, BuildingGrade.Enum grade)
        {
            if (block == null || block.net == null) return null;
            var id = block.net.ID.Value;
            Session s;
            if (!trackedEntities.TryGetValue(id, out s)) return null;
            // The hook runs before the upgrade happens (and may be cancelled), so read the grade next tick.
            NextTick(() =>
            {
                if (block == null || block.IsDestroyed || !sessions.ContainsValue(s)) return;
                s.Events.Add(new RawEvent { T = Now(s), Op = "upgrade", NetId = id, Grade = GradeName(block.grade) });
            });
            return null;
        }

        private object OnStructureRotate(BuildingBlock block, BasePlayer player)
        {
            if (block == null || block.net == null) return null;
            var id = block.net.ID.Value;
            Session s;
            if (!trackedEntities.TryGetValue(id, out s)) return null;
            NextTick(() =>
            {
                if (block == null || block.IsDestroyed || !sessions.ContainsValue(s)) return;
                s.Events.Add(new RawEvent { T = Now(s), Op = "rotate", NetId = id, Yaw = block.transform.eulerAngles.y });
            });
            return null;
        }

        // Covers demolish, pick-up and destruction alike.
        private void OnEntityKill(BaseNetworkable entity)
        {
            if (entity == null || entity.net == null) return;
            var id = entity.net.ID.Value;
            Session s;
            if (!trackedEntities.TryGetValue(id, out s)) return;
            trackedEntities.Remove(id);
            if (!sessions.ContainsValue(s)) return;
            s.Events.Add(new RawEvent { T = Now(s), Op = "remove", NetId = id });
        }

        #endregion

        #region Commands

        [ChatCommand("rec")]
        private void CmdRec(BasePlayer player, string command, string[] args)
        {
            if (!permission.UserHasPermission(player.UserIDString, PermUse))
            {
                SendReply(player, "You don't have permission to record builds (buildreplay.use).");
                return;
            }

            var sub = args.Length > 0 ? args[0].ToLowerInvariant() : "help";
            Session s;
            sessions.TryGetValue(IdOf(player), out s);

            switch (sub)
            {
                case "start":
                    if (s != null)
                    {
                        SendReply(player, $"Already recording ({s.Events.Count} events). Use /rec stop <name> to save.");
                        return;
                    }
                    sessions[IdOf(player)] = new Session
                    {
                        PlayerId = IdOf(player),
                        PlayerName = player.displayName,
                        Start = Time.realtimeSinceStartup,
                        StartPos = player.transform.position
                    };
                    SendReply(player, "Recording started. Everything you place, upgrade, rotate or demolish is logged. /rec stop <name> to save.");
                    return;

                case "stop":
                {
                    if (s == null) { SendReply(player, "You aren't recording. Use /rec start first."); return; }
                    if (s.Events.Count == 0) { EndSession(s); SendReply(player, "Recording stopped. Nothing was built, so nothing was saved."); return; }
                    string name, setting;
                    ParseStopArgs(args, out name, out setting);
                    var file = Save(s, string.IsNullOrEmpty(name) ? "Base by " + s.PlayerName : name, setting);
                    var count = s.Events.Count;
                    EndSession(s);
                    SendReply(player, $"Saved {count} events to data/BuildReplay/{file}.json. Load that file in the BuildReplay viewer.");
                    return;
                }

                case "cancel":
                    if (s == null) { SendReply(player, "You aren't recording."); return; }
                    EndSession(s);
                    SendReply(player, "Recording discarded.");
                    return;

                case "status":
                    if (s == null) { SendReply(player, "Not recording."); return; }
                    SendReply(player, $"Recording for {FormatTime(Now(s))}, {s.Events.Count} events so far.");
                    return;

                default:
                    SendReply(player,
                        "BuildReplay commands:\n" +
                        "/rec start - start recording your build\n" +
                        "/rec stop <name> [setting:open|rock|cave|cliff] - save the recording\n" +
                        "/rec status - show progress\n" +
                        "/rec cancel - discard the recording");
                    return;
            }
        }

        private static void ParseStopArgs(string[] args, out string name, out string setting)
        {
            setting = "open";
            var parts = new List<string>();
            for (var i = 1; i < args.Length; i++)
            {
                var a = args[i];
                if (a.StartsWith("setting:", StringComparison.OrdinalIgnoreCase))
                {
                    var v = a.Substring(8).ToLowerInvariant();
                    if (Settings.Contains(v)) setting = v;
                }
                else parts.Add(a);
            }
            name = string.Join(" ", parts.ToArray()).Trim();
        }

        private static string FormatTime(float seconds)
        {
            var t = TimeSpan.FromSeconds(seconds);
            return t.TotalHours >= 1 ? t.ToString(@"h\:mm\:ss") : t.ToString(@"m\:ss");
        }

        #endregion

        #region Saving

        private void EndSession(Session s)
        {
            sessions.Remove(s.PlayerId);
            var stale = new List<ulong>();
            foreach (var kv in trackedEntities) if (kv.Value == s) stale.Add(kv.Key);
            foreach (var id in stale) trackedEntities.Remove(id);
        }

        private string Save(Session s, string name, string setting)
        {
            // Origin: the first foundation placed, so the base sits at the viewer's origin on its ground floor.
            var origin = s.StartPos;
            var foundOrigin = false;
            foreach (var e in s.Events)
            {
                if (e.Op == "place" && e.Prefab != null && e.Prefab.StartsWith("foundation"))
                {
                    origin = e.Pos;
                    origin.y += config.FoundationPivotOffset;
                    foundOrigin = true;
                    break;
                }
            }
            if (!foundOrigin && TerrainMeta.HeightMap != null)
                origin.y = TerrainMeta.HeightMap.GetHeight(origin);

            var log = new LogFile
            {
                Name = name,
                Builder = s.PlayerName,
                Setting = setting,
                RecordedAt = DateTime.UtcNow.ToString("o")
            };

            var ids = new Dictionary<ulong, int>();
            foreach (var e in s.Events)
            {
                int id;
                if (!ids.TryGetValue(e.NetId, out id))
                {
                    if (e.Op != "place") continue;
                    id = ids.Count + 1;
                    ids[e.NetId] = id;
                }
                var le = new LogEvent { T = Round2(e.T), Op = e.Op, Id = id };
                switch (e.Op)
                {
                    case "place":
                        var isFoundation = e.Prefab != null && e.Prefab.StartsWith("foundation");
                        le.Prefab = e.Prefab;
                        le.Grade = e.Grade;
                        le.Pos = new[]
                        {
                            Round2(e.Pos.x - origin.x),
                            Round2(e.Pos.y - origin.y + (isFoundation ? config.FoundationPivotOffset : 0f)),
                            Round2(-(e.Pos.z - origin.z))
                        };
                        le.Rot = ViewerYaw(e.Yaw);
                        break;
                    case "upgrade":
                        le.Grade = e.Grade;
                        break;
                    case "rotate":
                        le.Rot = ViewerYaw(e.Yaw);
                        break;
                }
                log.Events.Add(le);
            }

            if (config.CaptureTerrain && TerrainMeta.HeightMap != null)
                log.Terrain = SampleTerrain(origin);

            var file = Regex.Replace(name, @"[^A-Za-z0-9_-]+", "-").Trim('-');
            if (file.Length == 0) file = "base";
            if (file.Length > 48) file = file.Substring(0, 48);
            file += "-" + DateTime.UtcNow.ToString("yyyyMMdd-HHmmss");
            Interface.Oxide.DataFileSystem.WriteObject("BuildReplay/" + file, log);
            return file;
        }

        // Heights relative to the base's ground floor; rows run along the viewer's z axis from -size/2.
        private TerrainPatch SampleTerrain(Vector3 origin)
        {
            var size = config.TerrainSize;
            var res = config.TerrainRes;
            var step = size / (res - 1);
            var half = size / 2f;
            var heights = new float[res * res];
            for (var i = 0; i < res; i++)
            {
                var zViewer = -half + i * step;
                for (var j = 0; j < res; j++)
                {
                    var xViewer = -half + j * step;
                    var world = new Vector3(origin.x + xViewer, 0f, origin.z - zViewer);
                    heights[i * res + j] = Round2(TerrainMeta.HeightMap.GetHeight(world) - origin.y);
                }
            }
            return new TerrainPatch { Size = size, Res = res, Heights = heights };
        }

        #endregion
    }
}
