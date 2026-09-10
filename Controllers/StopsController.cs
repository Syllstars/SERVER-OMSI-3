using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SERVER_OMSI_3_V1_0_0.Backend.Data;
using SERVER_OMSI_3_V1_0_0.Backend.Models;

[ApiController]
[Route("api/stops")]
public class StopsController : ControllerBase
{
    private readonly ApplicationDbContext _context;

    public StopsController(ApplicationDbContext context)
    {
        _context = context;
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<Stop>>> GetStops()
    {
        return await _context.Stops.ToListAsync();
    }
}