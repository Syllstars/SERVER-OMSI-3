using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SERVER_OMSI_3_V1_0_0.Backend.Data;
using SERVER_OMSI_3_V1_0_0.Backend.Models;


[ApiController]
[Route("api/[controller]")]
public class MailsController : ControllerBase
{
    private readonly ApplicationDbContext _context;

    public MailsController(ApplicationDbContext context)
    {
        _context = context;
    }

    [HttpGet("{UserId}")]
    public async Task<ActionResult<IEnumerable<Mail>>> GetPlayerMail(Guid userId)
    {
        return await _context.Mails
            .Where(m => m.UserId == userId)
            .OrderByDescending(m => m.Date)
            .ToListAsync();
    }

    [HttpPost("send")]
    public async Task<ActionResult> SendMail(Mail mail)
    {
        mail.Id = Guid.NewGuid();
        mail.Date = DateTime.UtcNow;

        _context.Mails.Add(mail);
        await _context.SaveChangesAsync();

        return Ok();
    }

    [HttpPost("read/{mailId}")]
    public async Task<ActionResult> MarkAsRead(Guid mailId)
    {
        var mail = await _context.Mails.FindAsync(mailId);

        if (mail == null)
            return NotFound();

        mail.IsRead = true;
        await _context.SaveChangesAsync();

        return Ok();
    }

    [HttpGet("player/{userId}")]
    public async Task<ActionResult<IEnumerable<Mail>>> GetPlayerMails(Guid userId)
    {
        return await _context.Mails
            .Where(m => m.UserId == userId)
            .OrderByDescending(m => m.Date)
            .ToListAsync();
    }
}
