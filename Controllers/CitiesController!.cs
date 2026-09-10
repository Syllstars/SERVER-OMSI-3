using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SERVER_OMSI_3_V1_0_0.Backend.Data;
using SERVER_OMSI_3_V1_0_0.Backend.Models;

[ApiController]
[Route("api/cities")]
public class CitiesController : ControllerBase
{
    private readonly ApplicationDbContext _context;

    public CitiesController(ApplicationDbContext context)
    {
        _context = context;
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<City>>> GetCities()
    {
        return await _context.Cities.ToListAsync();
    }
}