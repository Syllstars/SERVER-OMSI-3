using System.Collections.Generic;

namespace SERVER_OMSI_3_V1_0_0.Backend.Models;

public class PlayerDashboard
{
    public User Player { get; set; } = default!;
    public List<Compagnie> Companies { get; set; } = new();
    public List<Mail> Mails { get; set; } = new();
}