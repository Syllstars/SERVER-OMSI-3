using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;

using SERVER_OMSI_3_V1_0_0.Backend.Data;
using SERVER_OMSI_3_V1_0_0.Backend.Models;

using System.Security.Claims;

public class PlayerDashboardDto
{
    public PlayerDto Player { get; set; }
    public List<CompanyDto> Companies { get; set; }
    public List<MailDto> Mails { get; set; }
}

public class PlayerDto
{
    public Guid Id { get; set; }
    public string Name { get; set; }
    public int Level { get; set; }
    public int Money { get; set; }
}

[ApiController]
[Route("api/player")]
public class PlayerController : ControllerBase
{
    private readonly ApplicationDbContext _context;

    public PlayerController(ApplicationDbContext context)
    {
        _context = context;
    }

    [HttpGet("dashboard")]
    public async Task<ActionResult<PlayerDashboardDto>> GetDashboard()
    {
        // Get userId from JWT
        var userId = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;

        if (userId == null)
            return Unauthorized();

        var userGuid = Guid.Parse(userId);

        var player = await _context.Players
            .FirstOrDefaultAsync(p => p.User_id == userGuid);

        if (player == null)
            return NotFound("Player not found");

        var companies = await _context.CompanyMembers
            .Where(cm => cm.Player_Id == player.Id)
            .Join(_context.Compagnies,
                cm => cm.Company_Id,
                c => c.Id,
                (cm, c) => new CompanyDto
                {
                    Id = c.Id,
                    Name = c.Name,
                    Description = c.Description,
                    ServerRegion = c.ServerRegion,
                    Stars = c.Stars,
                    OnlinePlayers = c.OnlinePlayers,
                    MaxPlayers = c.MaxPlayers,
                    LogoKey = c.logo_key
                })
            .ToListAsync();

        var mails = await _context.Mails
            .Where(m => m.UserId == userGuid)
            .OrderByDescending(m => m.Date)
            .Select(m => new MailDto
            {
                Id = m.Id,
                Title = m.Title,
                Content = m.Content,
                Date = m.Date
            })
            .ToListAsync();

        var dashboard = new PlayerDashboardDto
        {
            Player = new PlayerDto
            {
                Id = player.Id,
                Name = player.Name,
                Level = player.Level,
                Money = player.Money
            },
            Companies = companies,
            Mails = mails
        };

        return Ok(dashboard);
    }

    // Validate current session

    [Authorize]
    [HttpGet("me")]
    public IActionResult Me()
    {
        var userId = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;

        return Ok(new
        {
            userId,
            status = "valid"
        });
    }

    /*[Authorize]
    [HttpGet("admin-server")]
    public IActionResult GetAdminServer()
    {
        return Ok(new
        {
            ip = "100.65.176.92", // ton IP Raspberry
            port = 7777
        });
    }

    [Authorize]
    [HttpGet("liege-server")]
    public IActionResult GetLiegeServer()
    {
        return Ok(new
        {
            ip = "100.65.176.92", // ton IP Raspberry
            port = 7778
        });
    }*/

    [Authorize]
    [HttpGet("admin-server")]
    public Task<IActionResult> GetAdminServer() => ResolveServer("AdminServer");

    [Authorize]
    [HttpGet("liege-server")]
    public Task<IActionResult> GetLiegeServer() => ResolveServer("Liege");

    private async Task<IActionResult> ResolveServer(string name)
    {
        var server = await _context.RegisteredServers
            .FirstOrDefaultAsync(s => s.Name == name);

        if (server == null)
        {
            return NotFound(new
            {
                message = $"Server '{name}' is not registered (never sent a heartbeat)."
            });
        }

        if (!server.IsOnline)
        {
            return StatusCode(503, new
            {
                message = $"Server '{name}' is offline.",
                lastSeenUtc = server.LastHeartbeatUtc
            });
        }

        return Ok(new
        {
            ip = server.EffectiveIp,
            port = server.Port
        });
    }
}
