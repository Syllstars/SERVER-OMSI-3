using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SERVER_OMSI_3_V1_0_0.Backend.Data;
using SERVER_OMSI_3_V1_0_0.Backend.Models;

[ApiController]
[Route("api/routes")]
public class RoutesController : ControllerBase
{
    private readonly ApplicationDbContext _context;

    public RoutesController(ApplicationDbContext context)
    {
        _context = context;
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<RouteDto>>> GetRoutes()
    {
        var routes = await _context.Routes
            .Include(r => r.Stops)
            .ToListAsync();

        var result = routes.Select(r => new RouteDto
        {
            Id = r.Id,
            Name = r.Name,
            City = r.City,
            Distance = r.Distance,
            Stops = r.Stops
                .OrderBy(s => s.StopOrder)
                .Select(s => new StopDto
                {
                    Id = s.Id,
                    Name = s.Name,
                    StopOrder = s.StopOrder,
                    PositionX = s.PositionX,
                    PositionY = s.PositionY,
                    PositionZ = s.PositionZ
                }).ToList()
        });

        return Ok(result);
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<BusRoute>> GetRoute(Guid id)
    {
        var route = await _context.Routes
            .Include(r => r.Stops.OrderBy(s => s.StopOrder))
            .FirstOrDefaultAsync(r => r.Id == id);

        if (route == null)
            return NotFound();

        return route;
    }

    [HttpPost("{routeId}/stops")]
    public async Task<ActionResult> AddStop(Guid routeId, [FromBody] Stop stop)
    {
        var route = await _context.Routes.FindAsync(routeId);

        if (route == null)
            return NotFound("Route not found");

        stop.Id = Guid.NewGuid();
        stop.RouteId = routeId;

        _context.Stops.Add(stop);
        await _context.SaveChangesAsync();

        return Ok(stop);
    }

    [HttpDelete("{id}")]
    public async Task<ActionResult> DeleteRoute(Guid id)
    {
        var route = await _context.Routes.FindAsync(id);

        if (route == null)
            return NotFound();

        _context.Routes.Remove(route);
        await _context.SaveChangesAsync();

        return Ok();
    }

    [HttpGet("{routeId}/timetables")]
    public async Task<IActionResult> GetTimetables(Guid routeId)
    {
        var timetables = await _context.Timetables
            .Where(t => t.RouteId == routeId)
            .OrderByDescending(t => t.CreatedAt)
            .ToListAsync();

        return Ok(timetables);
    }

    [HttpPost("{routeId}/timetables")]
    public async Task<IActionResult> CreateTimetable(Guid routeId, [FromBody] CreateTimetableRequest request)
    {
        var routeExists = await _context.Routes.AnyAsync(r => r.Id == routeId);

        if (!routeExists)
            return NotFound("Route not found");

        var timetable = new Timetable
        {
            Id = Guid.NewGuid(),
            RouteId = routeId,
            Name = string.IsNullOrWhiteSpace(request.Name)
                ? $"Timetable {DateTime.UtcNow:yyyy-MM-dd HH:mm}"
                : request.Name,
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };

        _context.Timetables.Add(timetable);
        await _context.SaveChangesAsync();

        return Ok(timetable);
    }

    [HttpGet("{routeId}/stops")]
    public async Task<IActionResult> GetStops(Guid routeId)
    {
        var stops = await _context.Stops
            .Where(s => s.RouteId == routeId)
            .OrderBy(s => s.StopOrder)
            .Select(s => new StopDto
            {
                Id = s.Id,
                Name = s.Name,
                StopOrder = s.StopOrder,
                PositionX = s.PositionX,
                PositionY = s.PositionY,
                PositionZ = s.PositionZ
            })
            .ToListAsync();

        return Ok(stops);
    }
}
