using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

using SERVER_OMSI_3_V1_0_0.Backend.Data;
using SERVER_OMSI_3_V1_0_0.Backend.Services;


[ApiController]
[Route("api/servers")]
public class GameServerController : ControllerBase
{
    private readonly GameServerManager manager;
    private readonly ApplicationDbContext _context;

    public GameServerController(GameServerManager manager, ApplicationDbContext context)
    {
        this.manager = manager;
        _context = context;
    }

    [HttpPost("start")]
    public async Task<IActionResult> Start([FromBody] StartServerRequest request)
    {
        if (request == null)
            return BadRequest("Invalid request");

        if (!PortValidator.IsValid(request.Port))
            return BadRequest("Port not allowed");

        if (manager.IsPortInUse(request.Port))
            return Conflict(new
            {
                message = $"Port {request.Port} is already in use"
            });

        string executablePath;

        if (request.MapName == "AdminServer")
        {
            executablePath =
                "/home/raspberry/Documents/SERVEUR_MAP/ADMIN_SERVER/server_map.aarch64";
        }
        else if (request.MapName == "Liege")
        {
            executablePath =
                "/home/raspberry/Documents/SERVEUR_MAP/LIEGE/server_map.aarch64";
        }
        else
        {
            return BadRequest(new
            {
                message = "Map not on the Server"
            });
        }

        var server = await manager.StartServer(
            executablePath,
            request.MapName,
            request.Port
        );

        return Ok(server);
    }

    [HttpPost("{id}/stop")]
    public async Task<IActionResult> Stop(Guid id)
    {
        await manager.StopServer(id);

        return Ok();
    }

    [HttpGet]
    public IActionResult GetAll()
    {
        return Ok(manager.GetRunningServers());
    }

    [HttpGet("{id}/logs")]
    public IActionResult GetLogs(Guid id)
    {
        var file = Path.Combine("logs", $"server_{id}.log");

        if (!System.IO.File.Exists(file))
            return Ok(new List<string>());

        var logs = System.IO.File.ReadAllLines(file)
            .TakeLast(500)
            .ToList();

        return Ok(logs);
    }

    [HttpGet("instances")]
    public async Task<IActionResult> GetInstances()
    {
        var instances =
            await _context.ServerInstances
                .OrderBy(x => x.Name)
                .ToListAsync();

        return Ok(instances);
    }

    [HttpPost("{id}/restart")]
    public async Task<IActionResult> Restart(Guid id)
    {
        var instance = await _context.ServerInstances
        .FirstOrDefaultAsync(x => x.Id == id);

        if (instance == null)
            return NotFound(new
            {
                message = "Server instance not found"
            });

        if (string.IsNullOrWhiteSpace(instance.ExecutablePath))
            return BadRequest(new
            {
                message = "Cannot restart this instance because ExecutablePath is empty"
            });

        await manager.StopServer(id);

        await Task.Delay(2000);

        var server = await manager.StartServer(
            instance.ExecutablePath,
            instance.MapName,
            instance.Port
        );

        return Ok(server);
    }
}
