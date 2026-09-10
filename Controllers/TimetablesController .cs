using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SERVER_OMSI_3_V1_0_0.Backend.Data;

[ApiController]
[Route("api/timetables")]
public class TimetablesController : ControllerBase
{
    private readonly ApplicationDbContext _context;

    public TimetablesController(ApplicationDbContext context)
    {
        _context = context;
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetTimetable(Guid id)
    {
        var timetable = await _context.Timetables
            .FirstOrDefaultAsync(t => t.Id == id);

        if (timetable == null)
            return NotFound("Timetable not found");

        var stops = await _context.Stops
            .Where(s => s.RouteId == timetable.RouteId)
            .OrderBy(s => s.StopOrder)
            .Select(s => new
            {
                stopId = s.Id,
                stopName = s.Name,
                arrivalTime = "08:00",
                departureTime = "08:05",
                order = s.StopOrder
            })
            .ToListAsync();

        return Ok(new
        {
            timetable.Id,
            timetable.RouteId,
            timetable.Name,
            timetable.IsActive,
            timetable.CreatedAt,
            stops
        });
    }

    [HttpPut("{id}/rename")]
    public async Task<IActionResult> RenameTimetable(Guid id, [FromBody] CreateTimetableRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest("Name is required");

        var timetable = await _context.Timetables
            .FirstOrDefaultAsync(t => t.Id == id);

        if (timetable == null)
            return NotFound("Timetable not found");

        timetable.Name = request.Name.Trim();
        await _context.SaveChangesAsync();

        return Ok(new { timetable.Id, timetable.Name });
    }
}
