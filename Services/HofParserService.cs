using System.Text;
using SERVER_OMSI_3_V1_0_0.Backend.Models;

public class HofParserService
{
    public ParsedHofData Parse(byte[] fileContent)
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

        var text = Encoding.GetEncoding("windows-1252").GetString(fileContent);
        var lines = text
            .Replace("\r\n", "\n")
            .Replace("\r", "\n")
            .Split('\n')
            .Select(l => l.Trim())
            .ToList();

        var result = new ParsedHofData();

        result.MapName = ParseName(lines);

        Console.WriteLine($"[HOF PARSER] Lines count = {lines.Count}");
        Console.WriteLine($"[HOF PARSER] infosystem_trip count = {lines.Count(l => l.Equals("[infosystem_trip]", StringComparison.OrdinalIgnoreCase))}");
        Console.WriteLine($"[HOF PARSER] infosystem_busstop_list count = {lines.Count(l => l.Equals("[infosystem_busstop_list]", StringComparison.OrdinalIgnoreCase))}");

        for (int i = 0; i < lines.Count; i++)
        {
            if (lines[i] == "[infosystem_trip]")
            {
                var parsedRoute = ParseInfoSystemTrip(lines, ref i);

                if (parsedRoute != null)
                    result.Routes.Add(parsedRoute);
            }
        }

        Console.WriteLine($"[HOF PARSER] Parsed routes = {result.Routes.Count}");
        Console.WriteLine($"[HOF PARSER] Parsed stops = {result.Routes.Sum(r => r.Stops.Count)}");

        return result;
    }

    private string ParseName(List<string> lines)
    {
        var index = lines.FindIndex(l => l == "[name]");

        if (index >= 0 && index + 1 < lines.Count)
            return lines[index + 1];

        return "Unknown";
    }

    private ParsedRoute? ParseInfoSystemTrip(List<string> lines, ref int index)
    {
        // Format attendu :
        // [infosystem_trip]
        // 0031
        // REP FRANCAISE >> SART-TILMAN CHU
        // 031
        // 3

        if (index + 4 >= lines.Count)
            return null;

        var internalTripId = lines[index + 1];
        var directionLabel = lines[index + 2];
        var terminusCode = lines[index + 3];
        var lineNumber = lines[index + 4];

        var directionParts = directionLabel.Split(">>", StringSplitOptions.TrimEntries);

        var from = directionParts.Length > 0 ? directionParts[0].Trim() : "";
        var to = directionParts.Length > 1 ? directionParts[1].Trim() : directionLabel;

        var route = new ParsedRoute
        {
            Name = $"Ligne {lineNumber} - {from} → {to}",
            LineNumber = lineNumber,
            InternalTripId = internalTripId,
            TerminusCode = terminusCode,
            Direction = directionLabel,
            City = "Unknown"
        };

        // Cherche la section [infosystem_busstop_list] juste après
        var stopListIndex = -1;

        for (int j = index + 5; j < lines.Count; j++)
        {
            if (lines[j] == "[infosystem_trip]")
                break;

            if (lines[j] == "[infosystem_busstop_list]")
            {
                stopListIndex = j;
                break;
            }
        }

        if (stopListIndex == -1)
        {
            index += 4;
            return route;
        }

        ParseBusStopList(lines, stopListIndex, route);

        index = stopListIndex;

        return route;
    }

    private void ParseBusStopList(List<string> lines, int index, ParsedRoute route)
    {
        // Format :
        // [infosystem_busstop_list]
        // 26
        // stop 1
        // stop 2
        // ...

        if (index + 1 >= lines.Count)
            return;

        if (!int.TryParse(lines[index + 1], out int stopCount))
            return;

        for (int i = 0; i < stopCount; i++)
        {
            var stopLineIndex = index + 2 + i;

            if (stopLineIndex >= lines.Count)
                break;

            var stopName = lines[stopLineIndex].Trim();

            if (string.IsNullOrWhiteSpace(stopName))
                continue;

            route.Stops.Add(new ParsedStop
            {
                Name = stopName,
                Order = i + 1
            });
        }
    }
}
