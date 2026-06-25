namespace OperationsApi.Controllers;

internal static class InputGuard
{
    // True if the string contains ASCII control characters (tab, newline, CR, DEL).
    public static bool ContainsControlChars(string? s) =>
        s != null && s.Any(c => c < 0x20 || c == 0x7F);

    // Like ContainsControlChars but permits the common whitespace controls
    // (tab, newline, carriage return). For free-text multi-line fields - e.g. a
    // notes textarea - where line breaks are legitimate input.
    public static bool ContainsControlCharsExceptWhitespace(string? s) =>
        s != null && s.Any(c => (c < 0x20 && c is not ('\t' or '\n' or '\r')) || c == 0x7F);
}
