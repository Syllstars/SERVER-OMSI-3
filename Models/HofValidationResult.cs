public class HofValidationResult
{
    public bool IsValid => Errors.Count == 0;

    public List<HofValidationMessage> Errors { get; set; } = new();
    public List<HofValidationMessage> Warnings { get; set; } = new();
}

public class ValidateHofContentRequest
{
    public string Content { get; set; } = string.Empty;
}
