using System.ComponentModel.DataAnnotations.Schema;

namespace SERVER_OMSI_3_V1_0_0.Backend.Models;

[Table("bus_models")]
public class BusModel
{
    public Guid Id { get; set; }

    public string Name { get; set; } = default!;
    public string Manufacturer { get; set; } = default!;

    public int Capacity { get; set; }

    public float MaxSpeed { get; set; }

    public string FuelType { get; set; } = default!;
}