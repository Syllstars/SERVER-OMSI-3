using System.ComponentModel.DataAnnotations.Schema;

namespace SERVER_OMSI_3_V1_0_0.Backend.Models;

[Table("maps")]
public class Map
{
    public Guid Id { get; set; }
    public Guid? CityId { get; set; }

    public string Name { get; set; } = default!;
    public string Description { get; set; } = default!;
    public string Version { get; set; } = default!;
}