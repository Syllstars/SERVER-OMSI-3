using System.ComponentModel.DataAnnotations.Schema;

namespace SERVER_OMSI_3_V1_0_0.Backend.Models;

[Table("cities")]
public class City
{
    public Guid Id { get; set; }
    public string Name { get; set; } = default!;
    public string Country { get; set; } = default!;
}