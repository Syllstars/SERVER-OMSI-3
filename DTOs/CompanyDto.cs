// DTO representing a company for the client

public class CompanyDto
{
    public Guid Id { get; set; }
    public string Name { get; set; }
    public string Description { get; set; }
    public string ServerRegion { get; set; }
    public int Stars { get; set; }
    public int OnlinePlayers { get; set; }
    public int MaxPlayers { get; set; }
    public string LogoKey { get; set; }
}
