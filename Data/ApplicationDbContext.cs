using Microsoft.EntityFrameworkCore;
using SERVER_OMSI_3_V1_0_0.Backend.Models;

namespace SERVER_OMSI_3_V1_0_0.Backend.Data;

public class ApplicationDbContext : DbContext
{
    public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options)
        : base(options) { }

    public DbSet<User> Users => Set<User>();

    public DbSet<Player> Players => Set<Player>();
    public DbSet<Compagnie> Compagnies => Set<Compagnie>();
    public DbSet<Mail> Mails => Set<Mail>();

    public DbSet<BusRoute> Routes => Set<BusRoute>();

    public DbSet<City> Cities => Set<City>();
    public DbSet<Map> Maps => Set<Map>();
    public DbSet<Stop> Stops => Set<Stop>();
    public DbSet<BusModel> BusModels => Set<BusModel>();

    public DbSet<CompanyMember> CompanyMembers => Set<CompanyMember>();

    public DbSet<ServerLog> ServerLogs => Set<ServerLog>();
    public DbSet<HofFile> HofFiles { get; set; }

    public DbSet<LineSchedule> LineSchedules { get; set; }

    //public DbSet<BusLine> BusLines { get; set; }
    public DbSet<ActiveLineInstance> ActiveLineInstances { get; set; }

    public DbSet<Timetable> Timetables { get; set; }

    public DbSet<HofFileVersion> HofFileVersions { get; set; }

    public DbSet<ServerInstance> ServerInstances { get; set; }

    public DbSet<ServerEvent> ServerEvents { get; set; }

    public DbSet<RegisteredServer> RegisteredServers { get; set; }

    public DbSet<MapInstanceLayout> MapInstanceLayouts => Set<MapInstanceLayout>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
{
    modelBuilder.Entity<BusRoute>()
        .HasMany(r => r.Stops)
        .WithOne(s => s.Route)
        .HasForeignKey(s => s.RouteId)
        .OnDelete(DeleteBehavior.Cascade);

    modelBuilder.Entity<HofFileVersion>(entity =>
    {
        entity.ToTable("hof_file_versions");

        entity.HasKey(v => v.Id);

        // Auto-generate UUID on insert (PostgreSQL)
        entity.Property(v => v.Id)
            .HasDefaultValueSql("gen_random_uuid()");

        // Timestamps always UTC
        entity.Property(v => v.CreatedAt)
            .HasDefaultValueSql("now() at time zone 'utc'");

        // Unique constraint: (hofFileId, versionNumber)
        entity.HasIndex(v => new { v.HofFileId, v.VersionNumber })
            .IsUnique();

        // Foreign key → HofFiles
        entity.HasOne(v => v.HofFile)
            .WithMany()   // or .WithMany(f => f.Versions) if you add nav property
            .HasForeignKey(v => v.HofFileId)
            .OnDelete(DeleteBehavior.Cascade);

        // Content column as bytea
        entity.Property(v => v.Content)
            .HasColumnType("bytea");
        });
}
}
