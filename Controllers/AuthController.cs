using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using SERVER_OMSI_3_V1_0_0.Backend.Data;
using SERVER_OMSI_3_V1_0_0.Backend.Models;
using System.ComponentModel.DataAnnotations;
using System.Data.Common;
using System.IdentityModel.Tokens.Jwt;
using System.Reflection.Metadata;
using System.Security.Claims;
using System.Text;

// Clean AuthController - PRODUCTION READY

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    private readonly ApplicationDbContext _context;
    private readonly IConfiguration _config;

    public AuthController(ApplicationDbContext context, IConfiguration config)
    {
        _context = context;
        _config = config;
    }

    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest request)
    {
        // Validate input
        if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
            return BadRequest("Invalid credentials");

        var user = await _context.Users
            .FirstOrDefaultAsync(u => u.Username == request.Username);

        if (user == null)
            return Unauthorized("User not found");

        if (!BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash))
            return Unauthorized("Invalid password");

        var token = GenerateJwtToken(user);

        return Ok(new
        {
            token,
            username = user.Username,
            userId = user.Id
        });
    }

    [HttpPost("register")]
    public async Task<IActionResult> Register([FromBody] RegisterRequest request)
    {
        // Validate input
        if (string.IsNullOrWhiteSpace(request.Username) ||
            string.IsNullOrWhiteSpace(request.Email) ||
            string.IsNullOrWhiteSpace(request.Password))
            return BadRequest("Invalid data");

        // Check duplicates
        if (await _context.Users.AnyAsync(u => u.Username == request.Username))
            return Conflict("Username already exists");

        if (await _context.Users.AnyAsync(u => u.Email == request.Email))
            return Conflict("Email already exists");

        var user = new User
        {
            Id = Guid.NewGuid(),
            Username = request.Username,
            Email = request.Email,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password)
        };

        var player = new Player
        {
            Id = Guid.NewGuid(),
            User_id = user.Id,
            Name = request.Username,
            Level = 1,
            Xp = 0,
            Money = 1000
        };

        _context.Users.Add(user);
        _context.Players.Add(player);

        await _context.SaveChangesAsync();

        // 🔥 AUTO LOGIN
        var token = GenerateJwtToken(user);

        return Ok(new
        {
            token,
            username = user.Username,
            userId = user.Id
        });
    }

    private string GenerateJwtToken(User user)
    {
        var key = new SymmetricSecurityKey(
            Encoding.UTF8.GetBytes(_config["Jwt:Key"]!)
        );

        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Name, user.Username)
        };

        var token = new JwtSecurityToken(
            issuer: _config["Jwt:Issuer"],
            audience: _config["Jwt:Audience"],
            claims: claims,
            expires: DateTime.UtcNow.AddHours(12),
            signingCredentials: creds
        );

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
