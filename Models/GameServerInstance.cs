using System.Diagnostics;
using System.Configuration;

public class GameServerInstance
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public string Name { get; set; }
    public string MapName { get; set; }

    public int Port { get; set; }

    public int ProcessId { get; set; }

    public bool IsRunning => Process != null && !Process.HasExited;

    public DateTime StartedAt { get; set; }

    public List<string> Logs { get; set; } = new();

    private static readonly (int min, int max) AllowedRange = (2000, 60000);

    [System.Text.Json.Serialization.JsonIgnore]
    public Process Process { get; set; }
}
