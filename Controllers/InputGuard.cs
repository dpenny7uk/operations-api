namespace OperationsApi.Controllers;

internal static class InputGuard
{
    // True if the string contains ASCII control characters (tab, newline, CR, DEL).
    public static bool ContainsControlChars(string? s) =>
        s != null && s.Any(c => c < 0x20 || c == 0x7F);
}
