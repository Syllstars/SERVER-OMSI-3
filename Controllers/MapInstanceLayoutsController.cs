using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using SERVER_OMSI_3_V1_0_0.Backend.Data;
using SERVER_OMSI_3_V1_0_0.Backend.Models;

namespace SERVER_OMSI_3_V1_0_0.Backend.Controllers
{
    /// <summary>
    /// Endpoints internes (serveur-à-serveur) appelés par chaque process Unity dédié pour
    /// charger/sauvegarder le layout de SA instance. Pas de JWT joueur : protégé par une clé
    /// partagée (header X-Internal-Key, valeur dans appsettings "InternalApi:Key" ou variable
    /// d'env correspondante), trafic attendu en LAN (même Raspberry Pi ou réseau local).
    ///
    /// ponytail: clé statique partagée — suffisant tant que Unity et le backend restent sur le
    /// même réseau de confiance. Passer à un vrai jeton de service si ça sort un jour du LAN.
    /// </summary>
    [ApiController]
    [Route("api/map-instance-layouts")]
    public class MapInstanceLayoutsController : ControllerBase
    {
        private readonly ApplicationDbContext _context;
        private readonly IConfiguration _config;

        public MapInstanceLayoutsController(ApplicationDbContext context, IConfiguration config)
        {
            _context = context;
            _config = config;
        }

        [HttpGet("{instanceId}")]
        public async Task<IActionResult> Get(string instanceId)
        {
            if (!IsAuthorized(Request)) return Unauthorized();

            var layout = await _context.MapInstanceLayouts.FindAsync(instanceId);
            if (layout == null) return NotFound();

            return Content(layout.LevelJson, "application/json");
        }

        [HttpPut("{instanceId}")]
        public async Task<IActionResult> Put(string instanceId, [FromBody] LevelJsonPayload payload)
        {
            if (!IsAuthorized(Request)) return Unauthorized();

            var layout = await _context.MapInstanceLayouts.FindAsync(instanceId);
            if (layout == null)
            {
                layout = new MapInstanceLayout { InstanceId = instanceId };
                _context.MapInstanceLayouts.Add(layout);
            }

            layout.LevelJson = payload.LevelJson;
            layout.UpdatedAt = DateTime.UtcNow;

            await _context.SaveChangesAsync();
            return Ok();
        }

        bool IsAuthorized(HttpRequest request)
        {
            var expected = _config["InternalApi:Key"];
            return !string.IsNullOrEmpty(expected) &&
                   request.Headers.TryGetValue("X-Internal-Key", out var provided) &&
                   provided == expected;
        }
    }

    public class LevelJsonPayload
    {
        public string LevelJson { get; set; } = string.Empty;
    }
}
