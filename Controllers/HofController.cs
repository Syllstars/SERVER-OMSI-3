using Microsoft.AspNetCore.Mvc;
using SERVER_OMSI_3_V1_0_0.Backend.Data;
using SERVER_OMSI_3_V1_0_0.Backend.Models;
using SERVER_OMSI_3_V1_0_0.Backend.Services;
using Microsoft.EntityFrameworkCore;
using System.Text;

[ApiController]
[Route("api/hof")]
public class HofController : ControllerBase
{
    private readonly HofService _service;
    private readonly ApplicationDbContext _context;
    private readonly HofParserService _parser;
    private readonly HofImportService _importService;
    private readonly HofValidationService _validator;
    private readonly HofVersionService _versionService;
    private readonly HofExportService _exportService;

    public HofController(
        HofService service,
        ApplicationDbContext context,
        HofParserService parser,
        HofImportService importService,
        HofValidationService validator,
        HofVersionService versionService,
        HofExportService exportService)
    {
        _service = service;
        _context = context;
        _parser = parser;
        _importService = importService;
        _validator = validator;
        _versionService = versionService;
        _exportService = exportService;
    }

    [HttpGet]
    public async Task<IActionResult> GetAllHofFiles()
    {
        var files = await _context.HofFiles
            .Select(h => new
            {
                id = h.Id,
                fileName = h.FileName,
                mapName = h.MapName
            })
            .ToListAsync();

        return Ok(files);
    }

    [HttpGet("{mapName}")]
    public IActionResult GetHof(string mapName)
    {
        var data = _service.GetParsedHof(mapName);

        if (data == null)
            return NotFound("HOF not found");

        return Ok(data);
    }

    [HttpPost("upload")]
    public async Task<IActionResult> Upload(IFormFile file)
    {
        using var ms = new MemoryStream();
        await file.CopyToAsync(ms);

        var hof = new HofFile
        {
            FileName = file.FileName,
            FileContent = ms.ToArray(),
            MapName = "unknown"
        };

        _context.HofFiles.Add(hof);
        await _context.SaveChangesAsync();

        return Ok(new
        {
            id = hof.Id,
            fileName = hof.FileName,
            mapName = hof.MapName
        });
    }

    [HttpPost("{id}/parse")]
    public async Task<IActionResult> Parse(Guid id)
    {
        var hof = await _context.HofFiles.FindAsync(id);

        if (hof == null)
            return NotFound(new
            {
                message = "HOF file not found"
            });

        var parsed = _parser.Parse(hof.FileContent);

        var result = await _importService.Import(parsed);

        return Ok(new
        {
            routesCreated = result.RoutesCreated,
            stopsCreated = result.StopsCreated,
            mapName = parsed.MapName,
            success = true
        });
    }

    [HttpPut("{id}/replace")]
    public async Task<IActionResult> ReplaceHofFile(Guid id, IFormFile file)
    {
        if (file == null || file.Length == 0)
            return BadRequest("Invalid file");

        if (!file.FileName.EndsWith(".hof", StringComparison.OrdinalIgnoreCase))
            return BadRequest("Only .hof files are allowed");

        var hof = await _context.HofFiles.FindAsync(id);

        if (hof == null)
            return NotFound("HOF file not found");

        using var ms = new MemoryStream();
        await file.CopyToAsync(ms);

        hof.FileName = file.FileName;
        hof.FileContent = ms.ToArray();

        await _context.SaveChangesAsync();

        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

        var content = Encoding
            .GetEncoding("windows-1252")
            .GetString(hof.FileContent);

        await _versionService.CreateVersionAsync(
            hofFileId: hof.Id,
            fileName: hof.FileName ?? "Unknown.hof",
            content: content,
            actionType: "REPLACE",
            mapName: hof.MapName,
            createdBy: HttpContext.Connection.RemoteIpAddress?.ToString(),
            notes: $"Replaced with file: {hof.FileName}"
        );

        return Ok(new
        {
            hof.Id,
            hof.FileName,
            hof.MapName
        });
    }

    [HttpDelete("{id}/delete")]
    public async Task<IActionResult> DeleteHofFile(Guid id)
    {
        var hof = await _context.HofFiles.FindAsync(id);

        if (hof == null)
            return NotFound("HOF file not found");

        _context.HofFiles.Remove(hof);
        await _context.SaveChangesAsync();

        return Ok(new { message = "HOF file deleted", id });
    }

    [HttpGet("{id}/preview")]
    public async Task<IActionResult> Preview(Guid id)
    {
        var hof = await _context.HofFiles.FindAsync(id);

        if (hof == null)
            return NotFound("HOF file not found");

        var parsed = _parser.Parse(hof.FileContent);

        return Ok(parsed);
    }

    [HttpGet("{id:guid}/download")]
    public async Task<IActionResult> DownloadHofFile(Guid id)
    {
        var hof = await _context.HofFiles.FindAsync(id);

        if (hof == null)
            return NotFound("HOF file not found");

        var fileName = string.IsNullOrWhiteSpace(hof.FileName)
            ? $"hof_{hof.Id}.hof"
            : Path.GetFileName(hof.FileName);

        return File(
            hof.FileContent,
            "application/octet-stream",
            fileName
        );
    }

    [HttpGet("{id:guid}/raw")]
    public async Task<IActionResult> GetRawHofContent(Guid id)
    {
        var hof = await _context.HofFiles.FindAsync(id);

        if (hof == null)
            return NotFound("HOF file not found");

        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

        var content = Encoding
            .GetEncoding("windows-1252")
            .GetString(hof.FileContent);

        return Ok(new
        {
            hof.Id,
            hof.FileName,
            hof.MapName,
            content
        });
    }

    [HttpPut("{id:guid}/content")]
    public async Task<IActionResult> UpdateRawHofContent(Guid id, [FromBody] UpdateHofContentRequest request)
    {
        if (request == null || string.IsNullOrWhiteSpace(request.Content))
            return BadRequest("Content is empty");

        var hof = await _context.HofFiles.FindAsync(id);

        if (hof == null)
            return NotFound("HOF file not found");

        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

        hof.FileContent = Encoding
            .GetEncoding("windows-1252")
            .GetBytes(request.Content);

        await _context.SaveChangesAsync();

        await _versionService.CreateVersionAsync(
            hofFileId: hof.Id,
            fileName: hof.FileName ?? "Unknown.hof",
            content: request.Content,
            actionType: request.ParseAfterSave ? "SAVE_AND_PARSE" : "SAVE",
            mapName: hof.MapName,
            createdBy: HttpContext.Connection.RemoteIpAddress?.ToString(),
            notes: null
        );

        object? parsed = null;

        if (request.ParseAfterSave)
            parsed = _parser.Parse(hof.FileContent);

        return Ok(new
        {
            hof.Id,
            hof.FileName,
            hof.MapName,
            size = hof.FileContent.Length,
            parsed
        });
    }

    [HttpPost("{id}/validate")]
    public async Task<IActionResult> Validate(Guid id)
    {
        var hof = await _context.HofFiles.FindAsync(id);

        if (hof == null)
            return NotFound("HOF file not found");

        var result = _validator.Validate(hof.FileContent);

        return Ok(result);
    }

    [HttpPost("validate-content")]
    public IActionResult ValidateContent([FromBody] ValidateHofContentRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Content))
        {
            return BadRequest("Content is empty");
        }

        var bytes = Encoding.GetEncoding("windows-1252")
            .GetBytes(request.Content);

        var result = _validator.Validate(bytes);

        return Ok(result);
    }

    [HttpGet("{id:guid}/export-package")]
    public async Task<IActionResult> ExportPackage(Guid id)
    {
        try
        {
            var (zipBytes, safeName) = await _exportService.ExportPackageAsync(id);
            return File(zipBytes, "application/zip", $"{safeName}_package.zip");
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = "Export failed.", error = ex.Message });
        }
    }
}
