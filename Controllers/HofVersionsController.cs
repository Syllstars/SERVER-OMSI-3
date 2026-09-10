using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using SERVER_OMSI_3_V1_0_0.Backend.DTOs;
using SERVER_OMSI_3_V1_0_0.Backend.Services;

namespace SERVER_OMSI_3_V1_0_0.Backend.Controllers
{
    /// <summary>
    /// REST API for HOF file version history.
    ///
    /// All endpoints are scoped under /api/hof/{hofFileId}/versions.
    ///
    /// Security rules enforced:
    ///   - GET /versions      → metadata only, no content bytes
    ///   - GET /versions/{id} → full content (single version)
    ///   - POST .../rollback  → requires explicit confirmation (double-safety in frontend)
    ///   - DELETE             → cannot delete the latest version
    /// </summary>
    [ApiController]
    [Route("api/hof/{hofFileId:guid}/versions")]
    public class HofVersionsController : ControllerBase
    {
        private readonly HofVersionService _versionService;
        private readonly ILogger<HofVersionsController> _logger;

        public HofVersionsController(
            HofVersionService versionService,
            ILogger<HofVersionsController> logger)
        {
            _versionService = versionService;
            _logger         = logger;
        }

        // ── GET /api/hof/{hofFileId}/versions ────────────────────────────────────
        /// <summary>
        /// List all version summaries for a HOF file, newest first.
        /// Content bytes are NOT returned — only metadata.
        /// </summary>
        [HttpGet]
        [ProducesResponseType(typeof(HofVersionSummaryDto[]), 200)]
        public async Task<IActionResult> GetVersions([FromRoute] Guid hofFileId)
        {
            try
            {
                var versions = await _versionService.GetVersionsAsync(hofFileId);
                return Ok(versions);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching versions for HOF {FileId}", hofFileId);
                return StatusCode(500, new { message = "Failed to load version history.", error = ex.Message });
            }
        }

        // ── GET /api/hof/{hofFileId}/versions/{versionId} ────────────────────────
        /// <summary>
        /// Get a specific version with full text content.
        /// Use this before showing a diff or loading into the editor.
        /// </summary>
        [HttpGet("{versionId:guid}")]
        [ProducesResponseType(typeof(HofVersionDetailDto), 200)]
        [ProducesResponseType(404)]
        public async Task<IActionResult> GetVersion(
            [FromRoute] Guid hofFileId,
            [FromRoute] Guid versionId)
        {
            try
            {
                var detail = await _versionService.GetVersionAsync(hofFileId, versionId);
                if (detail is null)
                    return NotFound(new { message = $"Version {versionId} not found." });

                return Ok(detail);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching version {VerId} for HOF {FileId}", versionId, hofFileId);
                return StatusCode(500, new { message = "Failed to load version.", error = ex.Message });
            }
        }

        // ── POST /api/hof/{hofFileId}/versions/{versionId}/rollback ──────────────
        /// <summary>
        /// Restore the HOF file content to a specific version.
        ///
        /// Strategy B (safe UX):
        ///   Returns the restored content — the frontend loads it into the editor
        ///   and the user must click Save to commit.
        ///
        ///   Set parseAfterRollback=true in the request body to also run the OMSI parser.
        ///
        /// A new ROLLBACK version is created automatically in the history.
        /// </summary>
        [HttpPost("{versionId:guid}/rollback")]
        [ProducesResponseType(typeof(HofRollbackResponseDto), 200)]
        [ProducesResponseType(404)]
        public async Task<IActionResult> Rollback(
            [FromRoute] Guid hofFileId,
            [FromRoute] Guid versionId,
            [FromBody]  HofRollbackRequestDto? request)
        {
            try
            {
                var result = await _versionService.RollbackAsync(
                    hofFileId:   hofFileId,
                    versionId:   versionId,
                    restoredBy:  HttpContext.Connection.RemoteIpAddress?.ToString(),
                    notes:       request?.Notes
                );

                if (!result.Success)
                    return NotFound(new { message = result.Message });

                return Ok(result);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Rollback failed — HOF {FileId} version {VerId}", hofFileId, versionId);
                return StatusCode(500, new { message = "Rollback failed.", error = ex.Message });
            }
        }

        // ── DELETE /api/hof/{hofFileId}/versions/{versionId} ─────────────────────
        /// <summary>
        /// Delete a specific version.
        /// The latest version cannot be deleted (minimum one version must remain).
        /// </summary>
        [HttpDelete("{versionId:guid}")]
        [ProducesResponseType(200)]
        [ProducesResponseType(400)]
        [ProducesResponseType(404)]
        public async Task<IActionResult> DeleteVersion(
            [FromRoute] Guid hofFileId,
            [FromRoute] Guid versionId)
        {
            try
            {
                var (success, message) = await _versionService.DeleteVersionAsync(hofFileId, versionId);

                if (!success)
                    return BadRequest(new { message });

                return Ok(new { message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error deleting version {VerId} for HOF {FileId}", versionId, hofFileId);
                return StatusCode(500, new { message = "Failed to delete version.", error = ex.Message });
            }
        }
    }
}
