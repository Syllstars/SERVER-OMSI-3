using SERVER_OMSI_3_V1_0_0.Backend.Models;
using SERVER_OMSI_3_V1_0_0.Backend.Data;

public class LineRuntimeManager
{
    private List<ActiveLineInstance> activeLines = new();

    public void Tick()
    {
        var now = DateTime.UtcNow;

        foreach (var line in activeLines)
        {
            line.Update(now); // ✅ maintenant correct
        }
    }

    public void StartLine(LineSchedule schedule)
    {
        activeLines.Add(new ActiveLineInstance(schedule)); // ✅ OK
    }

    public List<ActiveLineInstance> GetActiveLines()
    {
        return activeLines;
    }
}
