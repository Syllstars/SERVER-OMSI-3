using System.Collections.Generic;

public class HofLineFullDto
{
    public string Line { get; set; }
    public string Code { get; set; }
    public string TripId { get; set; }
    public string Direction { get; set; }
    public List<BusStopDto> Stops { get; set; } = new();
}

public class BusStopDto
{
    public int Order { get; set; }
    public string City { get; set; }
    public string Name { get; set; }
}

public class HofParsedData
{
    public List<HofLineFullDto> Lines { get; set; } = new();
}

public class UpdateHofContentRequest
{
    public string Content { get; set; } = "";
    public bool ParseAfterSave { get; set; } = false;
}
