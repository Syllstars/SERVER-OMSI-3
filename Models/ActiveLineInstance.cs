using SERVER_OMSI_3_V1_0_0.Backend.Models;
using SERVER_OMSI_3_V1_0_0.Backend.Data;

public class ActiveLineInstance
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ScheduleId { get; set; }

    public TimeSpan StartTime { get; set; }
    public int CurrentStopIndex { get; set; }

    public DateTime StartedAt { get; set; }

    // ✅ constructeur propre
    public ActiveLineInstance(LineSchedule schedule)
    {
        ScheduleId = schedule.Id;
        StartTime = schedule.StartTime;
        StartedAt = DateTime.UtcNow;
        CurrentStopIndex = 0;
    }

    public ActiveLineInstance() { }

    // ✅ runtime update (temps réel)
    public void Update(DateTime now)
    {
        var elapsed = now - StartedAt;

        // exemple simple : avance toutes les X secondes
        if (elapsed.TotalSeconds > (CurrentStopIndex + 1) * 30)
        {
            CurrentStopIndex++;
        }
    }
}
