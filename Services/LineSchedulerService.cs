using SERVER_OMSI_3_V1_0_0.Backend.Models;
using SERVER_OMSI_3_V1_0_0.Backend.Data;

public class LineSchedulerService : BackgroundService
{
    private readonly IServiceScopeFactory scopeFactory;

    public LineSchedulerService(IServiceScopeFactory scopeFactory)
    {
        this.scopeFactory = scopeFactory;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            using var scope = scopeFactory.CreateScope();

            var runtime = scope.ServiceProvider.GetRequiredService<LineRuntimeManager>();
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();

            var now = DateTime.UtcNow;

            var schedules = db.LineSchedules.ToList();

            foreach (var schedule in schedules)
            {
                if (ShouldStart(schedule, now))
                {
                    runtime.StartLine(schedule);
                }
            }

            runtime.Tick();

            await Task.Delay(1000);
        }
    }

    private bool ShouldStart(LineSchedule schedule, DateTime now)
    {
        return schedule.StartTime.Hours == now.Hour
            && schedule.StartTime.Minutes == now.Minute;
    }
}
