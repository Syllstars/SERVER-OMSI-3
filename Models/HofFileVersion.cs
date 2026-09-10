using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace SERVER_OMSI_3_V1_0_0.Backend.Models
{
    /// <summary>
    /// Represents a saved snapshot (version) of a HOF file.
    /// Versions are created automatically on every Save, Save &amp; Parse, or Replace.
    /// A maximum of 50 versions per HOF file is retained; older ones are pruned automatically.
    /// </summary>
    [Table("hof_file_versions")]
    public class HofFileVersion
    {
        [Key]
        [Column("id")]
        public Guid Id { get; set; } = Guid.NewGuid();

        // ── Foreign key ──────────────────────────────────────────────────────────
        [Required]
        [Column("hof_file_id")]
        public Guid HofFileId { get; set; }

        [ForeignKey(nameof(HofFileId))]
        public HofFile? HofFile { get; set; }

        // ── Version metadata ─────────────────────────────────────────────────────
        [Column("version_number")]
        public int VersionNumber { get; set; }

        [Required]
        [MaxLength(255)]
        [Column("file_name")]
        public string FileName { get; set; } = string.Empty;

        [MaxLength(255)]
        [Column("map_name")]
        public string? MapName { get; set; }

        // ── Content ──────────────────────────────────────────────────────────────

        /// <summary>File content stored as UTF-8 bytes.</summary>
        [Required]
        [Column("content")]
        public byte[] Content { get; set; } = Array.Empty<byte>();

        /// <summary>SHA-256 hex digest of Content — for deduplication and integrity checks.</summary>
        [Required]
        [MaxLength(64)]
        [Column("content_hash")]
        public string ContentHash { get; set; } = string.Empty;

        // ── Action tracking ──────────────────────────────────────────────────────

        /// <summary>
        /// What triggered this version snapshot.
        /// Known values: SAVE, SAVE_AND_PARSE, REPLACE, ROLLBACK, UPLOAD, INITIAL
        /// </summary>
        [Required]
        [MaxLength(64)]
        [Column("action_type")]
        public string ActionType { get; set; } = "SAVE";

        // ── Audit ────────────────────────────────────────────────────────────────
        [Column("created_at")]
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        [MaxLength(255)]
        [Column("created_by")]
        public string? CreatedBy { get; set; }

        [MaxLength(1000)]
        [Column("notes")]
        public string? Notes { get; set; }
    }
}
