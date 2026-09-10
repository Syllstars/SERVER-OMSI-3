using SERVER_OMSI_3_V1_0_0.Backend.Data;
using SERVER_OMSI_3_V1_0_0.Backend.Models;

public class RouteDto
{
    public Guid Id { get; set; }
    public string Name { get; set; }
    public string City { get; set; }
    public float Distance { get; set; }

    public List<StopDto> Stops { get; set; }
}
