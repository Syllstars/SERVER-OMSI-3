using System.Text;
using System.Collections.Generic;

public class HofService
{
    private readonly HofRepository _repo;

    public HofService(HofRepository repo)
    {
        _repo = repo;
    }

    public HofParsedData GetParsedHof(string mapName)
    {
        var hof = _repo.GetByMap(mapName);

        if (hof == null)
            return null;

        string content = Encoding.UTF8.GetString(hof.FileContent);

        return ParseHof(content);
    }

    private HofParsedData ParseHof(string content)
    {
        var result = new HofParsedData();

        var lines = content.Split('\n');

        var trips = new Dictionary<string, (string origin, string destination, string code, string line)>();
        var stopsLists = new Dictionary<string, List<BusStopDto>>();

        int i = 0;

        // =========================
        // 🥉 PARSE AFFICHAGE (FIX)
        // =========================
        i = 0;

        while (i < lines.Length)
        {
            var line = lines[i].Trim();

            if (line.StartsWith("0") && line.Contains("Ligne"))
            {
                i++;

                while (i < lines.Length && !lines[i].Contains("{ALLEX}"))
                {
                    var raw = lines[i].Trim();

                    if (!string.IsNullOrEmpty(raw) && char.IsDigit(raw[0]))
                    {
                        var parts = raw.Split('\t', StringSplitOptions.RemoveEmptyEntries);

                        if (parts.Length >= 2)
                        {
                            string internalCode = parts[0].Trim();

                            // ex: "3 SART-TILMAN CHU"
                            var subParts = parts[1].Trim().Split(' ', 2);

                            string lineNumber = subParts.Length > 0 ? subParts[0] : "0";
                            string destination = subParts.Length > 1 ? subParts[1] : "";

                            result.Lines.Add(new HofLineFullDto
                            {
                                Line = lineNumber.PadLeft(4, '0'),
                                Code = internalCode.PadLeft(3, '0'),
                                TripId = internalCode.PadLeft(4, '0'),
                                Direction = destination,
                                Stops = new List<BusStopDto>()
                            });
                        }
                    }

                    i++;
                }
            }

            i++;
        }

        // =========================
        // 🥇 PARSE TRIPS & STOPS
        // =========================
        i = 0;

        while (i < lines.Length)
        {
            int index = 0;
            if (lines[i].Trim() == "[infosystem_trip]")
            {
                i++;
                string tripId = lines[i++].Trim();

                string route = lines[i++].Trim(); // "A >> B"

                string origin = "";
                string destination = "";

                var parts = route.Split(">>");

                origin = parts[0].Trim();
                destination = parts.Length > 1 ? parts[1].Trim() : "";

                string code = lines[i++].Trim();
                string lineNumber = lines[i++].Trim();

                trips[code] = (origin, destination, code, lineNumber);

                bool busstopwritting = true;

                while (busstopwritting == true)
                {
                    if (lines[i].Trim() == "[infosystem_busstop_list]")
                    {
                        i++;
                        string listIndex = lines[i++].Trim();
                        int diclistIndex = 0;

                        var stops = new List<BusStopDto>();

                        for (int x = 0; x < int.Parse(listIndex); x++)
                        {
                            var stopLine = lines[i + x].Trim();

                            if (string.IsNullOrWhiteSpace(stopLine))
                                continue;

                            var busparts = stopLine.Split(' ', 2);

                            stops.Add(new BusStopDto
                            {
                                Order = x + 1,
                                City = busparts.Length > 0 ? busparts[0].Trim() : "",
                                Name = busparts.Length > 1 ? busparts[1].Trim() : ""
                            });
                        }

                        stopsLists[$"list_{diclistIndex}"] = stops;

                        // SENDING BUS LIST STOP ON THE TRAME
                        for (int a = 0; a < result.Lines.Count; a++)
                        {
                            if (result.Lines[a].Code == code)
                            {
                                result.Lines[a].Stops = stopsLists[$"list_{diclistIndex}"];
                            }
                        }

                        index++;
                        diclistIndex++;
                        busstopwritting = false;
                    }
                    else
                    {
                        i++;
                    }
                }
            }
            else
            {
                i++;
            }
        }
        return result;
    }
}
