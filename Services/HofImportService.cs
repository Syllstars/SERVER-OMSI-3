using SERVER_OMSI_3_V1_0_0.Backend.Data;
using SERVER_OMSI_3_V1_0_0.Backend.Models;

public class ImportResult
{
    public int RoutesCreated { get; set; }
    public int StopsCreated { get; set; }
}

public class HofImportService
{
    private readonly ApplicationDbContext _context;

    public HofImportService(ApplicationDbContext context)
    {
        _context = context;
    }

    public async Task<ImportResult> Import(ParsedHofData data)
    {
        int routesCreated = 0;
        int stopsCreated = 0;

        foreach (var parsedRoute in data.Routes)
        {
            var route = new BusRoute
            {
                Id = Guid.NewGuid(),
                Name = parsedRoute.Name,
                City = data.MapName,
                Distance = 0
            };

            _context.Routes.Add(route);
            routesCreated++;

            foreach (var parsedStop in parsedRoute.Stops)
            {
                _context.Stops.Add(new Stop
                {
                    Id = Guid.NewGuid(),
                    RouteId = route.Id,
                    Name = parsedStop.Name,
                    StopOrder = parsedStop.Order,
                    PositionX = 0,
                    PositionY = 0,
                    PositionZ = 0
                });

                stopsCreated++;
            }
        }

        await _context.SaveChangesAsync();

        return new ImportResult
        {
            RoutesCreated = routesCreated,
            StopsCreated = stopsCreated
        };
    }
}
