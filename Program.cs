using Microsoft.IdentityModel.Tokens;
using System.Text;
using System.Net.WebSockets;
using Npgsql;
using Microsoft.EntityFrameworkCore;
using SERVER_OMSI_3_V1_0_0.Backend.Data;
using SERVER_OMSI_3_V1_0_0.Backend.Models;
using SERVER_OMSI_3_V1_0_0.Backend.Services;

var builder = WebApplication.CreateBuilder(args);

builder.WebHost.UseUrls("http://0.0.0.0:5220");

// Add services to the container.
builder.Services.AddAuthentication("Bearer")
    .AddJwtBearer("Bearer", options =>
    {
        options.TokenValidationParameters = new()
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            ValidAudience = builder.Configuration["Jwt:Audience"],
            IssuerSigningKey = new SymmetricSecurityKey(
                System.Text.Encoding.UTF8.GetBytes(builder.Configuration["Jwt:Key"]!)
            )
        };
    });

builder.Services.AddAuthorization();

builder.Services.AddScoped<HofRepository>();
builder.Services.AddScoped<HofService>();
builder.Services.AddScoped<HofParserService>();
builder.Services.AddScoped<HofImportService>();
builder.Services.AddScoped<HofValidationService>();
builder.Services.AddSingleton<GameServerManager>();
builder.Services.AddSingleton<LineRuntimeManager>();
builder.Services.AddScoped<HofVersionService>();
builder.Services.AddScoped<HofExportService>();
builder.Services.AddHostedService<ServerMonitoringService>();

builder.Services
    .AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
    });

// Learn more about configuring Swagger/OpenAPI at https://aka.ms/aspnetcore/swashbuckle
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddHostedService<LineSchedulerService>();

var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");

var dataSourceBuilder = new NpgsqlDataSourceBuilder(connectionString);

var dataSource = dataSourceBuilder.Build();

builder.Services.AddDbContext<ApplicationDbContext>(options =>
    options.UseNpgsql(dataSource)
        .UseSnakeCaseNamingConvention()
        .EnableSensitiveDataLogging());

builder.Logging.SetMinimumLevel(LogLevel.Trace);

var app = builder.Build();

app.UseRouting();
app.MapControllers();

app.UseDefaultFiles();
app.UseStaticFiles();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseAuthentication();
app.UseAuthorization();

//app.UseHttpsRedirection();

app.UseWebSockets();
app.MapControllers();

app.Map("/ws/logs/{id}", async (HttpContext context, GameServerManager manager) =>
{
    if (!context.WebSockets.IsWebSocketRequest)
    {
        context.Response.StatusCode = 400;
        return;
    }

    var idStr = context.Request.RouteValues["id"]?.ToString();

    if (!Guid.TryParse(idStr, out var serverId))
    {
        context.Response.StatusCode = 400;
        return;
    }

    var socket = await context.WebSockets.AcceptWebSocketAsync();

    var history = manager.GetLogsFromFile(serverId, 500);

    foreach (var line in history)
    {
        var linebuffer = Encoding.UTF8.GetBytes(line);
        await socket.SendAsync(linebuffer, WebSocketMessageType.Text, true, CancellationToken.None);
    }

    if (!manager.HasSocketList(serverId))
        manager.CreateSocketList(serverId);

    manager.AddSocket(serverId, socket);

    var buffer = new byte[1024 * 4];

    while (socket.State == WebSocketState.Open)
    {
        var result = await socket.ReceiveAsync(
            new ArraySegment<byte>(buffer),
            CancellationToken.None
        );

        if (result.MessageType == WebSocketMessageType.Close)
            break;
    }

    manager.RemoveSocket(serverId, socket);

    await socket.CloseAsync(
        WebSocketCloseStatus.NormalClosure,
        "Closed",
        CancellationToken.None
    );
});

app.Run();
