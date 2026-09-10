using System.ComponentModel.DataAnnotations.Schema;

namespace SERVER_OMSI_3_V1_0_0.Backend.Models;

[Table("timetables")]
public class Timetable
{
    public Guid Id { get; set; }

    public Guid RouteId { get; set; }

    public string Name { get; set; } = string.Empty;

    public bool IsActive { get; set; }

    public DateTime CreatedAt { get; set; }
}
