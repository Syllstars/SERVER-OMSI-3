using System.Text;

public class HofValidationService
{
    private static readonly HashSet<string> KnownSections = new()
    {
        "[name]",
        "[servicetrip]",
        "[global_strings]",
        "[addterminus_list]",
        "[addbusstop_list]",
        "[infosystem_trip]",
        "[infosystem_busstop_list]",
        "[end]"
    };

    public HofValidationResult Validate(byte[] fileContent)
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

        var text = Encoding.GetEncoding("windows-1252").GetString(fileContent);

        return ValidateText(text);
    }

    public HofValidationResult ValidateText(string text)
    {
        var result = new HofValidationResult();

        var lines = text
            .Replace("\r\n", "\n")
            .Replace("\r", "\n")
            .Split('\n')
            .ToList();

        bool hasName = false;
        bool hasTrip = false;
        bool hasBusStopList = false;

        for (int i = 0; i < lines.Count; i++)
        {
            string line = lines[i].Trim();

            if (string.IsNullOrWhiteSpace(line))
                continue;

            if (line == "[name]")
                hasName = true;

            if (line == "[infosystem_trip]")
                hasTrip = true;

            if (line == "[infosystem_busstop_list]")
                hasBusStopList = true;

            if (line.StartsWith("[") && line.EndsWith("]"))
            {
                if (!KnownSections.Contains(line))
                {
                    result.Warnings.Add(new HofValidationMessage
                    {
                        Line = i + 1,
                        Code = "UNKNOWN_SECTION",
                        Message = $"Section inconnue : {line}"
                    });
                }
            }

            if (line == "[infosystem_trip]")
            {
                ValidateTrip(lines, i, result);
            }

            if (line == "[infosystem_busstop_list]")
            {
                ValidateBusStopList(lines, i, result);
            }
        }

        if (!hasName)
        {
            result.Warnings.Add(new HofValidationMessage
            {
                Line = 1,
                Code = "MISSING_NAME",
                Message = "Le fichier HOF ne contient pas de section [name]."
            });
        }

        if (!hasTrip)
        {
            result.Errors.Add(new HofValidationMessage
            {
                Line = 1,
                Code = "NO_TRIPS",
                Message = "Aucune section [infosystem_trip] trouvée."
            });
        }

        if (!hasBusStopList)
        {
            result.Errors.Add(new HofValidationMessage
            {
                Line = 1,
                Code = "NO_BUSSTOP_LIST",
                Message = "Aucune section [infosystem_busstop_list] trouvée."
            });
        }

        return result;
    }

    private void ValidateTrip(List<string> lines, int index, HofValidationResult result)
    {
        if (index + 4 >= lines.Count)
        {
            result.Errors.Add(new HofValidationMessage
            {
                Line = index + 1,
                Code = "INVALID_TRIP",
                Message = "Section [infosystem_trip] incomplète."
            });

            return;
        }

        string internalTripId = lines[index + 1].Trim();
        string direction = lines[index + 2].Trim();
        string terminusCode = lines[index + 3].Trim();
        string lineNumber = lines[index + 4].Trim();

        if (string.IsNullOrWhiteSpace(internalTripId))
            AddTripError(result, index + 2, "EMPTY_TRIP_ID", "Trip ID vide.");

        if (string.IsNullOrWhiteSpace(direction))
            AddTripError(result, index + 3, "EMPTY_DIRECTION", "Direction vide.");

        if (string.IsNullOrWhiteSpace(terminusCode))
            AddTripError(result, index + 4, "EMPTY_TERMINUS", "Code terminus vide.");

        if (string.IsNullOrWhiteSpace(lineNumber))
            AddTripError(result, index + 5, "EMPTY_LINE_NUMBER", "Numéro de ligne vide.");
    }

    private void ValidateBusStopList(List<string> lines, int index, HofValidationResult result)
    {
        if (index + 1 >= lines.Count)
        {
            result.Errors.Add(new HofValidationMessage
            {
                Line = index + 1,
                Code = "INVALID_STOP_LIST",
                Message = "Section [infosystem_busstop_list] sans compteur d'arrêts."
            });

            return;
        }

        string countLine = lines[index + 1].Trim();

        if (!int.TryParse(countLine, out int stopCount))
        {
            result.Errors.Add(new HofValidationMessage
            {
                Line = index + 2,
                Code = "INVALID_STOP_COUNT",
                Message = $"Nombre d'arrêts invalide : {countLine}"
            });

            return;
        }

        int availableStops = 0;

        for (int i = index + 2; i < lines.Count; i++)
        {
            string line = lines[i].Trim();

            if (line.StartsWith("[") && line.EndsWith("]"))
                break;

            if (!string.IsNullOrWhiteSpace(line))
                availableStops++;
        }

        if (availableStops < stopCount)
        {
            result.Warnings.Add(new HofValidationMessage
            {
                Line = index + 1,
                Code = "STOP_COUNT_MISMATCH",
                Message = $"La section annonce {stopCount} arrêts, mais seulement {availableStops} sont trouvés."
            });
        }
    }

    private void AddTripError(HofValidationResult result, int line, string code, string message)
    {
        result.Errors.Add(new HofValidationMessage
        {
            Line = line,
            Code = code,
            Message = message
        });
    }
}
