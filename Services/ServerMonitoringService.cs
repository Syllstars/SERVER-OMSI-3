using Microsoft.EntityFrameworkCore;
using System.Diagnostics;
using SERVER_OMSI_3_V1_0_0.Backend.Data;

public class ServerMonitoringService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;

    public ServerMonitoringService(
        IServiceScopeFactory scopeFactory)
    {
        _scopeFactory = scopeFactory;
    }

    protected override async Task ExecuteAsync(
        CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            using var scope =
                _scopeFactory.CreateScope();

            var db =
                scope.ServiceProvider
                .GetRequiredService<ApplicationDbContext>();

            var instances =
                await db.ServerInstances.ToListAsync();

            foreach (var instance in instances)
            {
                instance.LastHeartbeat = DateTime.UtcNow;

                if (instance.ProcessId == null)
                    continue;

                try
                {
                    var process =
                        Process.GetProcessById(
                            instance.ProcessId.Value);

                    instance.MemoryUsageMb =
                        process.WorkingSet64
                        / 1024
                        / 1024;

                    instance.CpuUsage = GetCpuUsage(instance.ProcessId.Value);
                }
                catch
                {
                    instance.Status = "Stopped";
                }
            }

            await db.SaveChangesAsync();

            await Task.Delay(
                TimeSpan.FromSeconds(5),
                stoppingToken);
        }
    }

    private double GetCpuUsage(int pid)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "/bin/bash",
                Arguments = $"-c \"ps -p {pid} -o %cpu= | xargs\"",
                RedirectStandardOutput = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            using var process = Process.Start(psi);

            if (process == null)
                return 0;

            var output =
                process.StandardOutput
                       .ReadToEnd()
                       .Trim();

            process.WaitForExit();

            if (double.TryParse(
                output.Replace(',', '.'),
                System.Globalization.NumberStyles.Any,
                System.Globalization.CultureInfo.InvariantCulture,
                out var cpu))
            {
                return Math.Round(cpu, 1);
            }
        }
        catch
        {
        }

        return 0;
    }
}
