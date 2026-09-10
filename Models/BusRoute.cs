using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json.Serialization;

namespace SERVER_OMSI_3_V1_0_0.Backend.Models;

[Table("routes")]
public class BusRoute
{
    public Guid Id { get; set; }

    public string Name { get; set; } = default!;
    public string City { get; set; } = default!;

    public float Distance { get; set; }

    public List<Stop> Stops { get; set; } = new();
}
