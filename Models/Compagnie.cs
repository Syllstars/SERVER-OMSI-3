using System.ComponentModel.DataAnnotations.Schema;
namespace SERVER_OMSI_3_V1_0_0.Backend.Models;

[Table("Compagnies")]
public class Compagnie
{
    [Column("Id")]
    public Guid Id { get; set; }

    [Column("Name")]
    public string Name { get; set; } = default!;

    [Column("Description")]
    public string Description { get; set; } = default!;

    [Column("ServerRegion")]
    public string ServerRegion { get; set; } = default!;

    [Column("Stars")]
    public int Stars { get; set; }

    [Column("OnlinePlayers")]
    public int OnlinePlayers { get; set; }

    [Column("MaxPlayers")]
    public int MaxPlayers { get; set; }

    [Column("logo_key")]
    public string logo_key { get; set; }= "logo1";
}
