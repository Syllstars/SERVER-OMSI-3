using System.IO.Compression;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SERVER_OMSI_3_V1_0_0.Backend.Data;

namespace SERVER_OMSI_3_V1_0_0.Backend.Services;

/// <summary>
/// Builds an OMSI-HOF-PACKAGE ZIP archive in memory.
///
/// ZIP structure:
///   hof/
///     {fileName}.hof          — original file bytes (Windows-1252)
///   metadata/
///     manifest.json           — hofId, fileName, mapName, exportedAt
///     preview.json            — result of HofParserService.Parse()
///     validation.json         — result of HofValidationService.Validate()
/// </summary>
public class HofExportService
{
    private readonly ApplicationDbContext _context;
    private readonly HofParserService     _parser;
    private readonly HofValidationService _validator;

    public HofExportService(
        ApplicationDbContext context,
        HofParserService     parser,
        HofValidationService validator)
    {
        _context   = context;
        _parser    = parser;
        _validator = validator;
    }

    /// <summary>
    /// Build and return the ZIP archive bytes for the given HOF file.
    /// Throws <see cref="KeyNotFoundException"/> when the file does not exist.
    /// </summary>
    public async Task<(byte[] ZipBytes, string SafeFileName)> ExportPackageAsync(Guid hofId)
    {
        var hof = await _context.HofFiles.FindAsync(hofId)
            ?? throw new KeyNotFoundException($"HOF file {hofId} not found.");

        // Decode stored bytes back to text (Windows-1252 is the project encoding)
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        var win1252  = Encoding.GetEncoding("windows-1252");
        var hofText  = win1252.GetString(hof.FileContent);

        // ── Metadata ─────────────────────────────────────────────────────────
        var manifest = new
        {
            hofId      = hof.Id,
            fileName   = hof.FileName,
            mapName    = hof.MapName,
            exportedAt = DateTime.UtcNow.ToString("O"),   // ISO-8601 UTC
            format     = "OMSI-HOF-PACKAGE",
            version    = 1
        };

        var preview    = _parser.Parse(hof.FileContent);
        var validation = _validator.Validate(hof.FileContent);

        var jsonOpts = new JsonSerializerOptions
        {
            WriteIndented        = true,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        };

        var manifestBytes   = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(manifest,   jsonOpts));
        var previewBytes    = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(preview,    jsonOpts));
        var validationBytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(validation, jsonOpts));

        // ── Build ZIP in memory ───────────────────────────────────────────────
        using var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
        {
            var hofFileName = string.IsNullOrWhiteSpace(hof.FileName)
                ? $"hof_{hof.Id}.hof"
                : Path.GetFileName(hof.FileName);

            AddEntry(zip, $"hof/{hofFileName}",          hof.FileContent);
            AddEntry(zip, "metadata/manifest.json",      manifestBytes);
            AddEntry(zip, "metadata/preview.json",       previewBytes);
            AddEntry(zip, "metadata/validation.json",    validationBytes);
        }

        // Safe file name for the Content-Disposition header
        var baseName = Path.GetFileNameWithoutExtension(
            string.IsNullOrWhiteSpace(hof.FileName) ? $"hof_{hof.Id}" : hof.FileName);
        var safeName = string.Concat(
            baseName.Select(c => Path.GetInvalidFileNameChars().Contains(c) ? '_' : c));

        return (ms.ToArray(), safeName);
    }

    // ── Helper ────────────────────────────────────────────────────────────────

    private static void AddEntry(ZipArchive zip, string entryName, byte[] data)
    {
        var entry = zip.CreateEntry(entryName, CompressionLevel.Optimal);
        using var stream = entry.Open();
        stream.Write(data, 0, data.Length);
    }
}
