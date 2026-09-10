using System;

namespace SERVER_OMSI_3_V1_0_0.Backend.DTOs
{
    // ── List item (no content — safe to return in lists) ─────────────────────

    /// <summary>
    /// Lightweight metadata for a version entry.
    /// Content is NEVER included here — only in HofVersionDetailDto.
    /// </summary>
    public class HofVersionSummaryDto
    {
        public Guid   Id            { get; set; }
        public int    VersionNumber { get; set; }
        public string FileName      { get; set; } = string.Empty;
        public string? MapName      { get; set; }
        public string ContentHash   { get; set; } = string.Empty;
        public string ActionType    { get; set; } = string.Empty;
        public DateTime CreatedAt   { get; set; }
        public string? CreatedBy    { get; set; }
        public string? Notes        { get; set; }

        /// <summary>Content size in bytes (derived from Content.Length at creation time).</summary>
        public int SizeBytes        { get; set; }
    }

    // ── Detail (includes content — only returned by single-version endpoint) ──

    public class HofVersionDetailDto
    {
        public Guid   Id            { get; set; }
        public Guid   HofFileId     { get; set; }
        public int    VersionNumber { get; set; }
        public string FileName      { get; set; } = string.Empty;
        public string? MapName      { get; set; }

        /// <summary>Raw UTF-8 text content of the HOF file at this version.</summary>
        public string Content       { get; set; } = string.Empty;

        public string ContentHash   { get; set; } = string.Empty;
        public string ActionType    { get; set; } = string.Empty;
        public DateTime CreatedAt   { get; set; }
        public string? CreatedBy    { get; set; }
        public string? Notes        { get; set; }
    }

    // ── Rollback request ─────────────────────────────────────────────────────

    public class HofRollbackRequestDto
    {
        /// <summary>If true, re-run OMSI parse after rolling back the content.</summary>
        public bool ParseAfterRollback { get; set; } = false;

        /// <summary>Optional note recorded in the new version created by the rollback.</summary>
        public string? Notes { get; set; }
    }

    // ── Rollback response ────────────────────────────────────────────────────

    public class HofRollbackResponseDto
    {
        public bool   Success       { get; set; }
        public string Message       { get; set; } = string.Empty;

        /// <summary>The new version number created as a result of the rollback.</summary>
        public int?   NewVersionNumber { get; set; }

        /// <summary>The restored content (so the UI can load it into the editor).</summary>
        public string? RestoredContent { get; set; }
    }
}
