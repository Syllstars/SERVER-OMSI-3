using System.ComponentModel.DataAnnotations.Schema;

namespace SERVER_OMSI_3_V1_0_0.Backend.Models;

[Table("company_members")]
public class CompanyMember
{
    public Guid Id { get; set; }

    public Guid Player_Id { get; set; }

    public Guid Company_Id { get; set; }

    public string Role { get; set; } = default!;
}