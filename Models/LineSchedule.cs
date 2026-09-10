namespace SERVER_OMSI_3_V1_0_0.Backend.Models
{
    public class LineSchedule
    {
        public Guid Id { get; set; }

        public Guid RouteId { get; set; }

        public TimeSpan DepartureTime { get; set; }
        public TimeSpan StartTime { get; set; } // ⬅️ IMPORTANT
        public TimeSpan EndTime { get; set; }

        public int IntervalMinutes { get; set; }

        public int Direction { get; set; }

        public bool IsActive { get; set; }
    }
}
