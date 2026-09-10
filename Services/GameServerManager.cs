using System.Text;
using System.Diagnostics;
using System.Configuration;
using System.Net.WebSockets;
using Microsoft.EntityFrameworkCore;

using SERVER_OMSI_3_V1_0_0.Backend.Data;
using SERVER_OMSI_3_V1_0_0.Backend.Models;

namespace SERVER_OMSI_3_V1_0_0.Backend.Services;

public class GameServerManager
{
    private Dictionary<Guid, GameServerInstance> servers = new();
    private Dictionary<Guid, List<WebSocket>> sockets = new();
    public HashSet<Guid> StartedSchedules = new();
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _config;

    public GameServerManager(IServiceScopeFactory scopeFactory, IConfiguration config)
    {
        _scopeFactory = scopeFactory;
        _config = config;
    }

    private readonly string logPath = Path.Combine(
        AppDomain.CurrentDomain.BaseDirectory,
        "Logs"
    );

    public async Task<GameServerInstance> StartServer(string path, string map, int port)
    {
        var serverId = Guid.NewGuid();
        var serverName = $"Server_{port}";

        using var scope = _scopeFactory.CreateScope();

        var db = scope.ServiceProvider
                      .GetRequiredService<ApplicationDbContext>();

        // Résolution de l'instance AVANT de lancer le process : LevelSaveLoad côté Unity a besoin
        // de connaître son instance-id (= dbInstance.Id) dès le démarrage pour charger le bon
        // layout depuis MapInstanceLayoutsController, donc il doit lui être passé en argument
        // de lancement.
        var dbInstance =
            await db.ServerInstances
                .FirstOrDefaultAsync(x => x.Port == port);

        if (dbInstance != null)
        {
            // Le serveur existe déjà

            if (dbInstance.Status == "Running")
            {
                throw new Exception(
                    $"Server already running on port {port}");
            }

            // Réutilisation de la ligne existante

            dbInstance.Status = "Running";
            dbInstance.StartedAt = DateTime.UtcNow;
            dbInstance.LastHeartbeat = DateTime.UtcNow;
            dbInstance.MapName = map;
        }
        else
        {
            // Création de la première ligne

            dbInstance = new ServerInstance
            {
                Id = serverId,
                Name = serverName,
                MapName = map,
                Port = port,
                Status = "Running",
                StartedAt = DateTime.UtcNow,
                LastHeartbeat = DateTime.UtcNow,
                ConnectedPlayers = 0,
                MaxPlayers = 100
            };

            db.ServerInstances.Add(dbInstance);
        }

        await db.SaveChangesAsync();

        var internalApiKey = _config["InternalApi:Key"] ?? string.Empty;
        var backendUrl = _config["InternalApi:SelfUrl"] ?? "http://localhost:5220";

        var process = new Process();

        process.StartInfo.FileName = path;
        process.StartInfo.WorkingDirectory = Path.GetDirectoryName(path);
        process.StartInfo.UseShellExecute = false;
        process.StartInfo.RedirectStandardOutput = true;
        process.StartInfo.RedirectStandardError = true;
        process.StartInfo.ArgumentList.Add($"--instance-id={dbInstance.Id}");
        process.StartInfo.ArgumentList.Add($"--internal-api-key={internalApiKey}");
        process.StartInfo.ArgumentList.Add($"--backend-url={backendUrl}");

        process.Start();

        dbInstance.ProcessId = process.Id;
        await db.SaveChangesAsync();

        var instance = new GameServerInstance
        {
            Id = dbInstance.Id,
            Name = dbInstance.Name,
            MapName = dbInstance.MapName,
            Port = dbInstance.Port,
            ProcessId = process.Id,
            Process = process,
            StartedAt = DateTime.Now
        };

        process.OutputDataReceived += (sender, e) =>
        {
            if (!string.IsNullOrEmpty(e.Data))
            {
                var line = "[OUT] " + e.Data;

                instance.Logs.Add(line);
                Console.WriteLine(line);
                WriteLogToFile(instance.Id, line);

                // 🔥 envoi WebSocket
                _ = BroadcastLog(instance.Id, line);
            }
        };

        process.ErrorDataReceived += (sender, e) =>
        {
            if (!string.IsNullOrEmpty(e.Data))
            {
                var line = "[ERR] " + e.Data;

                instance.Logs.Add(line);
                Console.WriteLine(line);
                WriteLogToFile(instance.Id, line);

                _ = BroadcastLog(instance.Id, line);
            }
        };

        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        servers[instance.Id] = instance;

        return instance;
    }

    private void LoadLogs(GameServerInstance instance)
    {
        var file = Path.Combine(logPath, $"server_{instance.Id}.log");

        if (!File.Exists(file))
            return;

        if (File.Exists(file) && new FileInfo(file).Length > 5_000_000)
        {
            File.Move(file, file + ".old", true);
        }

        instance.Logs = File.ReadAllLines(file).ToList();
    }

    public async Task StopServer(Guid id)
    {
        if (!servers.ContainsKey(id))
            return;

        var runtimeInstance = servers[id];

        if (runtimeInstance.Process != null &&
            !runtimeInstance.Process.HasExited)
        {
            runtimeInstance.Process.Kill();
        }

        using var scope = _scopeFactory.CreateScope();

        var db = scope.ServiceProvider
                      .GetRequiredService<ApplicationDbContext>();

        var dbInstance =
            await db.ServerInstances
                .FirstOrDefaultAsync(x => x.Id == id);

        if (dbInstance != null)
        {
            dbInstance.Status = "Stopped";
            dbInstance.LastHeartbeat = DateTime.UtcNow;

            await db.SaveChangesAsync();
        }

        servers.Remove(id);
    }

    public List<GameServerDto> GetRunningServers()
    {
        return servers.Values.Select(s => new GameServerDto
        {
            Id = s.Id,
            Name = s.Name,
            MapName = s.MapName,
            Port = s.Port,
            ProcessId = s.ProcessId,
            IsRunning = !s.Process.HasExited,
            StartedAt = s.StartedAt
        }).ToList();
    }

    public GameServerInstance GetServer(Guid id)
    {
        return servers.ContainsKey(id) ? servers[id] : null;
    }

    public bool IsPortInUse(int port)
    {
        return servers.Values.Any(s =>
            s.Process != null &&
            !s.Process.HasExited &&
            s.Port == port
        );
    }

    public async Task BroadcastLog(Guid serverId, string message)
    {
        if (!sockets.ContainsKey(serverId)) return;

        var buffer = Encoding.UTF8.GetBytes(message);

        var deadSockets = new List<WebSocket>();

        foreach (var socket in sockets[serverId])
        {
            if (socket.State != WebSocketState.Open)
            {
                deadSockets.Add(socket);
                continue;
            }

            await socket.SendAsync(
                new ArraySegment<byte>(buffer),
                WebSocketMessageType.Text,
                true,
                CancellationToken.None
            );
        }

        // cleanup
        foreach (var s in deadSockets)
            sockets[serverId].Remove(s);
    }

    public bool HasSocketList(Guid id)
    {
        return sockets.ContainsKey(id);
    }

    public void CreateSocketList(Guid id)
    {
        sockets[id] = new List<WebSocket>();
    }

    public void AddSocket(Guid id, WebSocket socket)
    {
        sockets[id].Add(socket);
    }

    public void RemoveSocket(Guid id, WebSocket socket)
    {
        if (sockets.ContainsKey(id))
            sockets[id].Remove(socket);
    }

    public List<string> GetLogs(Guid id)
    {
        if (!servers.ContainsKey(id)) return new List<string>();
        return servers[id].Logs;
    }

    private void WriteLogToFile(Guid id, string line)
    {
        Directory.CreateDirectory(logPath);

        var file = Path.Combine(logPath, $"server_{id}.log");

        File.AppendAllText(file, line + Environment.NewLine);
    }

    public List<string> GetLogsFromFile(Guid id, int lastLines = 500)
    {
        var file = Path.Combine(logPath, $"server_{id}.log");

        if (!File.Exists(file))
            return new List<string>();

        return File.ReadLines(file)
            .TakeLast(lastLines)
            .ToList();
    }
}
