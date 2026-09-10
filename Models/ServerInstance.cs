using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace SERVER_OMSI_3_V1_0_0.Backend.Models;

[Table("server_instances")]
public class ServerInstance
{
    [Key]
    [Column("id")]
    public Guid Id { get; set; }

    [Column("name")]
    public string Name { get; set; } = "";

    [Column("map_name")]
    public string MapName { get; set; } = "";

    [Column("port")]
    public int Port { get; set; }

    [Column("status")]
    public string Status { get; set; } = "Stopped";

    [Column("process_id")]
    public int? ProcessId { get; set; }

    [Column("started_at")]
    public DateTime? StartedAt { get; set; }

    [Column("last_heartbeat")]
    public DateTime? LastHeartbeat { get; set; }

    [Column("cpu_usage")]
    public double CpuUsage { get; set; }

    [Column("memory_usage_mb")]
    public long MemoryUsageMb { get; set; }

    [Column("connected_players")]
    public int ConnectedPlayers { get; set; }

    [Column("max_players")]
    public int MaxPlayers { get; set; } = 100;

    [Column("auto_restart")]
    public bool AutoRestart { get; set; } = true;

    [Column("executable_path")]
    public string? ExecutablePath { get; set; }

    [Column("total_uptime_seconds")]
    public long TotalUptimeSeconds { get; set; } = 0;

    [Column("last_started_at")]
    public DateTime? LastStartedAt { get; set; }

    [Column("stopped_at")]
    public DateTime? StoppedAt { get; set; }

    [Column("restart_count")]
    public int RestartCount { get; set; } = 0;

    [Column("last_crash_at")]
    public DateTime? LastCrashAt { get; set; }
}
