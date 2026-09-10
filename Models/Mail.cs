using System.ComponentModel.DataAnnotations.Schema;
namespace SERVER_OMSI_3_V1_0_0.Backend.Models;

[Table("Mails")]
public class Mail
{
    [Column("Id")]
    public Guid Id { get; set; }

    [Column("Title")]
    public string Title { get; set; } = default!;

    [Column("Content")]
    public string Content { get; set; } = default!;

    [Column("Sender")]
    public string Sender { get; set; } = default!;

    [Column("Type")]
    public string Type { get; set; }

    [Column("IsRead")]
    public bool IsRead { get; set; }

    [Column("Date")]
    public DateTime Date { get; set; }

    [Column("UserId")]
    public Guid UserId { get; set; }
}
