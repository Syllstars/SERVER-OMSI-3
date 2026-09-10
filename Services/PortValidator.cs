public static class PortValidator
{
    private static readonly HashSet<int> ForbiddenPorts = new()
    {
        22, 80, 81, 443, 3306, 5432, 6379, 5000
    };

    public static bool IsValid(int port)
    {
        if (port < 1024 || port > 65535)
            return false;

        if (ForbiddenPorts.Contains(port))
            return false;

        return true;
    }
}
