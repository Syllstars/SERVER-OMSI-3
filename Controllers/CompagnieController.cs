using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SERVER_OMSI_3_V1_0_0.Backend.Data;
using SERVER_OMSI_3_V1_0_0.Backend.Models;

[ApiController]
[Route("api/[controller]")]
public class CompagniesController : ControllerBase
{
    private readonly ApplicationDbContext _context;

    public CompagniesController(ApplicationDbContext context)
    {
        _context = context;
    }

    [HttpGet]
    public async Task<IActionResult> GetCompagnies()
    {
        var compagnies = await _context.Compagnies.ToListAsync();
        return Ok(compagnies);
    }

    [HttpGet("player/{userId}")]
    public async Task<ActionResult<IEnumerable<Compagnie>>> GetPlayerCompanies(Guid userId)
    {
        var companyIds  = await _context.CompanyMembers
            .Where(c => c.Player_Id == userId)
            .Select(c => c.Company_Id)
            .ToListAsync();

        var companies = await _context.Compagnies
            .Where(c => companyIds.Contains(c.Id))
            .ToListAsync();

        return companies;
    }
}
