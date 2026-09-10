using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

using SERVER_OMSI_3_V1_0_0.Backend.Data;
using SERVER_OMSI_3_V1_0_0.Backend.Models;

/// <summary>
/// Registre des serveurs de map. Trois rôles :
///  - recevoir les heartbeats des serveurs Unity (où qu'ils tournent),
///  - exposer l'état au Dashboard,
///  - permettre l'override manuel de l'IP depuis le Dashboard.
///
/// SÉCURITÉ : le heartbeat vient d'un process serveur, pas d'un joueur —
/// pas de JWT. À la place, une clé partagée dans le header X-Server-Key,
/// comparée à la valeur de configuration "ServerRegistry:ApiKey"
/// (appsettings.json). Mets-y une chaîne longue aléatoire et passe la
/// même au serveur Unity en argument de ligne de commande.
/// </summary>
[ApiController]
[Route("api/registry")]
public class ServerRegistryController : ControllerBase
{
    private readonly ApplicationDbContext _context;
    private readonly IConfiguration _config;

    public ServerRegistryController(ApplicationDbContext context, IConfiguration config)
    {
        _context = context;
        _config = config;
    }

    public class HeartbeatRequest
    {
        public string Name { get; set; } = string.Empty;
        public int Port { get; set; }
        public int PlayersOnline { get; set; }
        public string? HostMachine { get; set; }
    }

    /// <summary>
    /// POST api/registry/heartbeat — appelé toutes les ~15 s par chaque
    /// serveur Unity en vie. Upsert : crée la ligne au premier battement,
    /// la met à jour ensuite. L'IP est auto-détectée depuis la connexion
    /// entrante (IP Tailscale de la machine du serveur).
    /// </summary>
    [HttpPost("heartbeat")]
    public async Task<IActionResult> Heartbeat([FromBody] HeartbeatRequest request)
    {
        if (!IsServerKeyValid())
            return Unauthorized(new { message = "Invalid or missing X-Server-Key" });

        if (request == null || string.IsNullOrWhiteSpace(request.Name))
            return BadRequest(new { message = "Name is required" });

        string remoteIp = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "";

        // IPv6 mappé IPv4 (::ffff:100.65.x.x) → forme IPv4 propre
        if (remoteIp.StartsWith("::ffff:"))
            remoteIp = remoteIp["::ffff:".Length..];

        var server = await _context.RegisteredServers
            .FirstOrDefaultAsync(s => s.Name == request.Name);

        if (server == null)
        {
            server = new RegisteredServer { Name = request.Name };
            _context.RegisteredServers.Add(server);
        }

        server.Ip = remoteIp;
        server.Port = request.Port;
        server.PlayersOnline = request.PlayersOnline;
        server.HostMachine = request.HostMachine;
        server.LastHeartbeatUtc = DateTime.UtcNow;

        await _context.SaveChangesAsync();

        return Ok(new { server.Name, ip = server.EffectiveIp, server.Port, online = true });
    }

    /// <summary>
    /// GET api/registry — état de tous les serveurs connus, pour le Dashboard.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var servers = await _context.RegisteredServers
            .OrderBy(s => s.Name)
            .ToListAsync();

        var result = servers.Select(s => new
        {
            s.Id,
            s.Name,
            ip = s.EffectiveIp,
            autoDetectedIp = s.Ip,
            s.ManualIpOverride,
            s.Port,
            s.PlayersOnline,
            s.HostMachine,
            lastHeartbeatUtc = s.LastHeartbeatUtc,
            online = s.IsOnline,
            secondsSinceHeartbeat = (int)(DateTime.UtcNow - s.LastHeartbeatUtc).TotalSeconds
        });

        return Ok(result);
    }

    public class IpOverrideRequest
    {
        /// <summary>IP à forcer, ou null/vide pour revenir à l'auto-détection.</summary>
        public string? Ip { get; set; }
    }

    /// <summary>
    /// POST api/registry/{name}/ip-override — le champ "renseigner l'IP"
    /// du Dashboard. Vide = retour à l'auto-détection par heartbeat.
    /// </summary>
    [HttpPost("{name}/ip-override")]
    public async Task<IActionResult> SetIpOverride(string name, [FromBody] IpOverrideRequest request)
    {
        var server = await _context.RegisteredServers
            .FirstOrDefaultAsync(s => s.Name == name);

        if (server == null)
        {
            // Autorise la pré-déclaration d'un serveur avant son premier heartbeat.
            server = new RegisteredServer
            {
                Name = name,
                LastHeartbeatUtc = DateTime.MinValue
            };
            _context.RegisteredServers.Add(server);
        }

        server.ManualIpOverride =
            string.IsNullOrWhiteSpace(request?.Ip) ? null : request!.Ip!.Trim();

        await _context.SaveChangesAsync();

        return Ok(new { server.Name, ip = server.EffectiveIp, overridden = server.ManualIpOverride != null });
    }

    private bool IsServerKeyValid()
    {
        var expected = _config["ServerRegistry:ApiKey"];

        if (string.IsNullOrEmpty(expected))
            return false; // clé non configurée = heartbeats refusés, fail-safe

        return Request.Headers.TryGetValue("X-Server-Key", out var provided) &&
               provided == expected;
    }
}
