using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json.Serialization;
namespace SERVER_OMSI_3_V1_0_0.Backend.Models;

[Table("stops")]
public class Stop
{
    public Guid Id { get; set; }

    public Guid RouteId { get; set; }

    public string Name { get; set; } = default!;

    public float PositionX { get; set; }
    public float PositionY { get; set; }
    public float PositionZ { get; set; }

    public int StopOrder { get; set; }

    [JsonIgnore]
    public BusRoute Route { get; set; } = default!;
}
