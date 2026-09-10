using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SERVER_OMSI_3_V1_0_0.Backend.Data;
using SERVER_OMSI_3_V1_0_0.Backend.Models;

[ApiController]
[Route("api/maps")]
public class MapsController : ControllerBase
{
    private readonly ApplicationDbContext _context;

    public MapsController(ApplicationDbContext context)
    {
        _context = context;
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<Map>>> GetMaps()
    {
        return await _context.Maps.ToListAsync();
    }
}