using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using SERVER_OMSI_3_V1_0_0.Backend.DTOs;
using SERVER_OMSI_3_V1_0_0.Backend.Models;
using SERVER_OMSI_3_V1_0_0.Backend.Data;
using SERVER_OMSI_3_V1_0_0.Backend.Services;

namespace SERVER_OMSI_3_V1_0_0.Backend.Services
{
    /// <summary>
    /// Manages persistent server-side version history for HOF files.
    ///
    /// Strategy:
    ///   - A snapshot is created AFTER every successful save / replace.
    ///   - The snapshot contains the NEW content (what was just saved).
    ///   - At most MAX_VERSIONS_PER_FILE versions are kept; older ones are pruned automatically.
    ///
    /// ActionType values:
    ///   SAVE            — user clicked Save
    ///   SAVE_AND_PARSE  — user clicked Save &amp; Parse
    ///   REPLACE         — user replaced file via upload
    ///   ROLLBACK        — system restored a previous version
    ///   UPLOAD          — initial upload
    ///   INITIAL         — first-time record (if created retroactively)
    /// </summary>
    public class HofVersionService
    {
        private const int MAX_VERSIONS_PER_FILE = 50;

        private readonly ApplicationDbContext _db;
        private readonly ILogger<HofVersionService> _logger;

        public HofVersionService(ApplicationDbContext db, ILogger<HofVersionService> logger)
        {
            _db     = db;
            _logger = logger;
        }

        // ── Public API ───────────────────────────────────────────────────────────

        /// <summary>
        /// Create a new version snapshot for a HOF file.
        /// Call this after a successful save/replace.
        /// Automatically prunes oldest versions above MAX_VERSIONS_PER_FILE.
        /// </summary>
        public async Task<HofFileVersion> CreateVersionAsync(
            Guid   hofFileId,
            string fileName,
            string content,
            string actionType  = "SAVE",
            string? mapName    = null,
            string? createdBy  = null,
            string? notes      = null)
        {
            // Compute next version number atomically
            var maxVersion = await _db.HofFileVersions
                .Where(v => v.HofFileId == hofFileId)
                .MaxAsync(v => (int?)v.VersionNumber) ?? 0;

            var contentBytes = Encoding.UTF8.GetBytes(content);
            var hash         = ComputeSha256(contentBytes);

            var version = new HofFileVersion
            {
                Id            = Guid.NewGuid(),
                HofFileId     = hofFileId,
                VersionNumber = maxVersion + 1,
                FileName      = fileName,
                MapName       = mapName,
                Content       = contentBytes,
                ContentHash   = hash,
                ActionType    = actionType.ToUpperInvariant(),
                CreatedAt     = DateTime.UtcNow,
                CreatedBy     = createdBy,
                Notes         = notes
            };

            _db.HofFileVersions.Add(version);
            await _db.SaveChangesAsync();

            // Prune old versions (keep latest MAX_VERSIONS_PER_FILE)
            await PruneOldVersionsAsync(hofFileId);

            _logger.LogInformation(
                "Version {Num} created for HOF {FileId} — action={Action} size={Size}B",
                version.VersionNumber, hofFileId, actionType, contentBytes.Length);

            return version;
        }

        /// <summary>
        /// List all version summaries for a HOF file, newest first.
        /// Content is NOT included — call GetVersionAsync for full content.
        /// </summary>
        public async Task<List<HofVersionSummaryDto>> GetVersionsAsync(Guid hofFileId)
        {
            var versions = await _db.HofFileVersions
                .Where(v => v.HofFileId == hofFileId)
                .OrderByDescending(v => v.VersionNumber)
                .ToListAsync();

            return versions.Select(v => new HofVersionSummaryDto
            {
                Id            = v.Id,
                VersionNumber = v.VersionNumber,
                FileName      = v.FileName,
                MapName       = v.MapName,
                ContentHash   = v.ContentHash,
                ActionType    = v.ActionType,
                CreatedAt     = v.CreatedAt,
                CreatedBy     = v.CreatedBy,
                Notes         = v.Notes,
                SizeBytes     = v.Content.Length
            }).ToList();
        }

        /// <summary>
        /// Get a specific version with full content.
        /// Returns null if not found.
        /// </summary>
        public async Task<HofVersionDetailDto?> GetVersionAsync(Guid hofFileId, Guid versionId)
        {
            var v = await _db.HofFileVersions
                .FirstOrDefaultAsync(x => x.HofFileId == hofFileId && x.Id == versionId);

            if (v is null) return null;

            return new HofVersionDetailDto
            {
                Id            = v.Id,
                HofFileId     = v.HofFileId,
                VersionNumber = v.VersionNumber,
                FileName      = v.FileName,
                MapName       = v.MapName,
                Content       = Encoding.UTF8.GetString(v.Content),
                ContentHash   = v.ContentHash,
                ActionType    = v.ActionType,
                CreatedAt     = v.CreatedAt,
                CreatedBy     = v.CreatedBy,
                Notes         = v.Notes
            };
        }

        /// <summary>
        /// Delete a single version. The latest version cannot be deleted
        /// (at least one version must remain as audit trail).
        /// Returns false if the version was not found or is protected.
        /// </summary>
        public async Task<(bool Success, string Message)> DeleteVersionAsync(Guid hofFileId, Guid versionId)
        {
            var v = await _db.HofFileVersions
                .FirstOrDefaultAsync(x => x.HofFileId == hofFileId && x.Id == versionId);

            if (v is null)
                return (false, "Version not found.");

            // Guard: don't delete the latest version
            var maxVersion = await _db.HofFileVersions
                .Where(x => x.HofFileId == hofFileId)
                .MaxAsync(x => x.VersionNumber);

            if (v.VersionNumber == maxVersion)
                return (false, "Cannot delete the latest version.");

            _db.HofFileVersions.Remove(v);
            await _db.SaveChangesAsync();

            _logger.LogInformation("Deleted version {Num} of HOF {FileId}", v.VersionNumber, hofFileId);
            return (true, $"Version {v.VersionNumber} deleted.");
        }

        /// <summary>
        /// Rollback: restore the HOF file content to a specific version.
        ///
        /// This does NOT modify the editor — the frontend loads the content
        /// and the user must click Save to commit.
        ///
        /// A new version is created automatically after the rollback so the
        /// rollback action is itself part of the history.
        /// </summary>
        public async Task<HofRollbackResponseDto> RollbackAsync(
            Guid   hofFileId,
            Guid   versionId,
            string? restoredBy = null,
            string? notes      = null)
        {
            // Load target version
            var targetVersion = await _db.HofFileVersions
                .FirstOrDefaultAsync(v => v.HofFileId == hofFileId && v.Id == versionId);

            if (targetVersion is null)
                return new HofRollbackResponseDto { Success = false, Message = "Version not found." };

            // Load current HOF file record
            var hofFile = await _db.HofFiles.FindAsync(hofFileId);
            if (hofFile is null)
                return new HofRollbackResponseDto { Success = false, Message = "HOF file not found." };

            var restoredContent = Encoding.UTF8.GetString(targetVersion.Content);
            var restoredBytes   = targetVersion.Content;

            // Update the HOF file record with restored content
            // (adjust to match your actual HofFile model property names)
            hofFile.FileContent = restoredBytes;

            // Create a new version recording the rollback
            var rollbackNote = notes ?? $"Rollback to version {targetVersion.VersionNumber}";

            var maxVersion = await _db.HofFileVersions
                .Where(v => v.HofFileId == hofFileId)
                .MaxAsync(v => (int?)v.VersionNumber) ?? 0;

            var rollbackVersion = new HofFileVersion
            {
                Id            = Guid.NewGuid(),
                HofFileId     = hofFileId,
                VersionNumber = maxVersion + 1,
                FileName      = hofFile.FileName ?? targetVersion.FileName,
                MapName       = targetVersion.MapName,
                Content       = restoredBytes,
                ContentHash   = targetVersion.ContentHash,
                ActionType    = "ROLLBACK",
                CreatedAt     = DateTime.UtcNow,
                CreatedBy     = restoredBy,
                Notes         = rollbackNote
            };

            _db.HofFileVersions.Add(rollbackVersion);
            await _db.SaveChangesAsync();

            _logger.LogInformation(
                "Rollback completed for HOF {FileId}: v{Target} → new v{New}",
                hofFileId, targetVersion.VersionNumber, rollbackVersion.VersionNumber);

            return new HofRollbackResponseDto
            {
                Success          = true,
                Message          = $"Rolled back to version {targetVersion.VersionNumber}.",
                NewVersionNumber = rollbackVersion.VersionNumber,
                RestoredContent  = restoredContent
            };
        }

        /// <summary>
        /// Return the content of a specific version for comparison.
        /// The frontend will display a diff against the current editor content.
        /// </summary>
        public async Task<string?> GetVersionContentAsync(Guid hofFileId, Guid versionId)
        {
            var v = await _db.HofFileVersions
                .FirstOrDefaultAsync(x => x.HofFileId == hofFileId && x.Id == versionId);

            return v is null ? null : Encoding.UTF8.GetString(v.Content);
        }

        // ── Helpers ──────────────────────────────────────────────────────────────

        /// <summary>Remove oldest versions beyond MAX_VERSIONS_PER_FILE.</summary>
        private async Task PruneOldVersionsAsync(Guid hofFileId)
        {
            var allVersions = await _db.HofFileVersions
                .Where(v => v.HofFileId == hofFileId)
                .OrderByDescending(v => v.VersionNumber)
                .ToListAsync();

            if (allVersions.Count <= MAX_VERSIONS_PER_FILE) return;

            var toDelete = allVersions.Skip(MAX_VERSIONS_PER_FILE).ToList();
            _db.HofFileVersions.RemoveRange(toDelete);
            await _db.SaveChangesAsync();

            _logger.LogInformation(
                "Pruned {Count} old versions for HOF {FileId}",
                toDelete.Count, hofFileId);
        }

        private static string ComputeSha256(byte[] data)
        {
            using var sha = SHA256.Create();
            return Convert.ToHexString(sha.ComputeHash(data)).ToLowerInvariant();
        }
    }
}
