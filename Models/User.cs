using System.ComponentModel.DataAnnotations.Schema;
namespace SERVER_OMSI_3_V1_0_0.Backend.Models;

[Table("Users")]
public class User
{
    [Column("Id")]
    public Guid Id { get; set; }

    [Column("Username")]
    public string Username { get; set; } = default!;

    [Column("Email")]
    public string Email { get; set; } = default!;

    [Column("PasswordHash")]
    public string PasswordHash { get; set; } = default!;
}
