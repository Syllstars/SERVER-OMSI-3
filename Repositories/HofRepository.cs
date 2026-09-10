using System.Linq;
using SERVER_OMSI_3_V1_0_0.Backend.Models;
using SERVER_OMSI_3_V1_0_0.Backend.Data;

public class HofRepository
{
    private readonly ApplicationDbContext _context;

    public HofRepository(ApplicationDbContext context)
    {
        _context = context;
    }

    public HofFile GetByMap(string mapName)
    {
        return _context.HofFiles
            .FirstOrDefault(h => h.MapName == mapName);
    }
}
