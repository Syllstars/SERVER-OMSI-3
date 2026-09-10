using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace SERVER_OMSI_3_V1_0_0.Backend.Models;

[Table("server_events")]
public class ServerEvent
{
    [Key]
    [Column("id")]
    public Guid Id { get; set; }

    [Column("server_id")]
    public Guid? ServerId { get; set; }

    [Column("player_id")]
    public Guid? PlayerId { get; set; }

    [Column("event_type")]
    public string EventType { get; set; } = string.Empty;

    [Column("event_data")]
    public string? EventData { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }
}
