using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SERVER_OMSI_3_V1_0_0.Backend.Data;
using SERVER_OMSI_3_V1_0_0.Backend.Models;

[ApiController]
[Route("api/bus-models")]
public class BusModelsController : ControllerBase
{
    private readonly ApplicationDbContext _context;

    public BusModelsController(ApplicationDbContext context)
    {
        _context = context;
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<BusModel>>> GetBusModels()
    {
        return await _context.BusModels.ToListAsync();
    }
}