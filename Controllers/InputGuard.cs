namespace OperationsApi.Controllers;

/// <summary>Shared input validation helpers used across all API controllers.</summary>
internal static class InputGuard
{
    /// <summary>Returns true if the string contains ASCII control characters (tab, newline, CR, DEL, etc.).</summary>
    public static bool ContainsControlChars(string? s) =>
        s != null && s.Any(c => c < 0x20 || c == 0x7F);
}
