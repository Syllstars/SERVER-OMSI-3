public class GameServerDto
{
    public Guid Id { get; set; }
    public string Name { get; set; }
    public string MapName { get; set; }
    public int Port { get; set; }
    public int ProcessId { get; set; }
    public bool IsRunning { get; set; }
    public DateTime StartedAt { get; set; }

    public double CpuUsage { get; set; }

    public long MemoryUsageMb { get; set; }

    public int ConnectedPlayers { get; set; }

    public int MaxPlayers { get; set; }

    public string Status { get; set; } = "";

    public DateTime LastHeartbeat { get; set; }

    public TimeSpan Uptime { get; set; }
}
