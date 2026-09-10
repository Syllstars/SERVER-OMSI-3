namespace SERVER_OMSI_3_V1_0_0.Backend.Models;

public class RegisterRequest
{
    public string Username { get; set; } = default!;
    public string Email { get; set; } = default!;
    public string Password { get; set; } = default!;
}
