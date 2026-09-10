namespace SERVER_OMSI_3_V1_0_0.Backend.Models;

public class ParsedHofData
{
    public string MapName { get; set; } = "";
    public List<ParsedRoute> Routes { get; set; } = new();
}

public class ParsedRoute
{
    public string Name { get; set; } = "";
    public string City { get; set; } = "";

    public string LineNumber { get; set; } = "";
    public string InternalTripId { get; set; } = "";
    public string TerminusCode { get; set; } = "";
    public string Direction { get; set; } = "";

    public List<ParsedStop> Stops { get; set; } = new();
}

public class ParsedStop
{
    public string Name { get; set; } = "";
    public int Order { get; set; }
}
