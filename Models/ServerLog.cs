using System.ComponentModel.DataAnnotations.Schema;

namespace SERVER_OMSI_3_V1_0_0.Backend.Models;

[Table("server_logs")]
public class ServerLog
{
    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    public string Action { get; set; } = default!;

    public DateTime Date { get; set; }

    public string IpAddress { get; set; } = default!;
}