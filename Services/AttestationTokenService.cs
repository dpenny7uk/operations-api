using System.Security.Cryptography;
using System.Text;

namespace OperationsApi.Services;

/// <summary>A freshly minted attestation token: the raw link value and the
/// SHA-256 hash to persist (the raw is never stored server-side).</summary>
public sealed class MintedToken
{
    public required string Raw { get; init; }
    public required byte[] Hash { get; init; }
    public required DateTimeOffset ExpiresAt { get; init; }
}

public interface IAttestationTokenService
{
    /// <summary>Mint a signed token for a packet. Returns the raw token (goes in the
    /// email link) and SHA-256(raw) to store in attestation_packets.token_hash.</summary>
    MintedToken Mint(Guid packetId, DateTimeOffset expiresAt);

    /// <summary>Structural + HMAC + (embedded) expiry check. Returns the packet_id
    /// the token claims, or null if malformed / tampered / expired. Does NOT touch
    /// the DB — revocation (hash match against the row) is checked by the caller.</summary>
    Guid? Verify(string rawToken);

    /// <summary>SHA-256(raw) — compared in constant time against the stored hash.</summary>
    byte[] ComputeHash(string rawToken);
}

/// <summary>
/// HMAC-signed, self-describing attestation tokens. Format:
///   base64url(packet_id) "." base64url(expiry_unix_be) "." base64url(HMAC_SHA256(packet_id||expiry, key))
/// The token is unguessable (256-bit keyed MAC); the DB stores only SHA-256(raw)
/// so a DB read alone never yields a usable link. Verify checks the MAC + expiry;
/// the caller additionally matches ComputeHash(raw) against the stored row hash
/// (which also gives revocation: drop/replace the row and the token stops working).
/// Pure crypto, no DB, no NuGet (System.Security.Cryptography is in the BCL).
/// </summary>
public sealed class AttestationTokenService : IAttestationTokenService
{
    private readonly byte[] _key;

    public AttestationTokenService(string signingKey)
    {
        if (string.IsNullOrEmpty(signingKey))
            throw new ArgumentException("Signing key is required.", nameof(signingKey));
        _key = Encoding.UTF8.GetBytes(signingKey);
    }

    public MintedToken Mint(Guid packetId, DateTimeOffset expiresAt)
    {
        var pid = packetId.ToByteArray();
        var exp = ToBigEndian(expiresAt.ToUnixTimeSeconds());
        var mac = Hmac(pid, exp);
        var raw = $"{B64(pid)}.{B64(exp)}.{B64(mac)}";
        return new MintedToken { Raw = raw, Hash = ComputeHash(raw), ExpiresAt = expiresAt };
    }

    public Guid? Verify(string rawToken)
    {
        if (string.IsNullOrEmpty(rawToken)) return null;
        var parts = rawToken.Split('.');
        if (parts.Length != 3) return null;

        byte[] pid, exp, mac;
        try { pid = UnB64(parts[0]); exp = UnB64(parts[1]); mac = UnB64(parts[2]); }
        catch { return null; }
        if (pid.Length != 16 || exp.Length != 8 || mac.Length != 32) return null;

        // Recompute the MAC with our key — a token forged without the key fails here.
        var expected = Hmac(pid, exp);
        if (!CryptographicOperations.FixedTimeEquals(expected, mac)) return null;

        var unix = FromBigEndian(exp);
        if (DateTimeOffset.FromUnixTimeSeconds(unix) < DateTimeOffset.UtcNow) return null;

        return new Guid(pid);
    }

    public byte[] ComputeHash(string rawToken)
        => SHA256.HashData(Encoding.UTF8.GetBytes(rawToken));

    private byte[] Hmac(byte[] a, byte[] b)
    {
        var msg = new byte[a.Length + b.Length];
        Buffer.BlockCopy(a, 0, msg, 0, a.Length);
        Buffer.BlockCopy(b, 0, msg, a.Length, b.Length);
        using var h = new HMACSHA256(_key);
        return h.ComputeHash(msg);
    }

    private static byte[] ToBigEndian(long v)
    {
        var b = BitConverter.GetBytes(v);
        if (BitConverter.IsLittleEndian) Array.Reverse(b);
        return b;
    }

    private static long FromBigEndian(byte[] b)
    {
        var c = (byte[])b.Clone();
        if (BitConverter.IsLittleEndian) Array.Reverse(c);
        return BitConverter.ToInt64(c, 0);
    }

    private static string B64(byte[] b)
        => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static byte[] UnB64(string s)
    {
        var t = s.Replace('-', '+').Replace('_', '/');
        switch (t.Length % 4) { case 2: t += "=="; break; case 3: t += "="; break; }
        return Convert.FromBase64String(t);
    }
}
