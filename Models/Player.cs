using System.ComponentModel.DataAnnotations.Schema;
namespace SERVER_OMSI_3_V1_0_0.Backend.Models;

[Table("players")]
public class Player
{
    public Guid Id { get; set; }
    public Guid User_id { get; set; }
    public string Name { get; set; } = default!;
    public int Level { get; set; }
    public int Xp { get; set; }
    public int Money { get; set; }
}