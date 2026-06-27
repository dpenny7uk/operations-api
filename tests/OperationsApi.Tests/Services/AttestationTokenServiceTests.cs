using OperationsApi.Services;
using Xunit;

namespace OperationsApi.Tests.Services;

/// <summary>
/// Pure crypto unit tests for the HMAC attestation token (no DB). Covers the
/// sign/verify round-trip and the four ways verification must fail: expiry,
/// tampering, a wrong signing key, and malformed input.
/// </summary>
public class AttestationTokenServiceTests
{
    private static readonly AttestationTokenService Svc = new("unit-test-signing-key-abcdefghijklmnop");

    [Fact]
    public void Mint_then_verify_round_trips_the_packet_id()
    {
        var pid = Guid.NewGuid();
        var minted = Svc.Mint(pid, DateTimeOffset.UtcNow.AddDays(7));
        Assert.Equal(pid, Svc.Verify(minted.Raw));
    }

    [Fact]
    public void Verify_rejects_an_expired_token()
    {
        var minted = Svc.Mint(Guid.NewGuid(), DateTimeOffset.UtcNow.AddSeconds(-5));
        Assert.Null(Svc.Verify(minted.Raw));
    }

    [Fact]
    public void Verify_rejects_a_tampered_signature()
    {
        var minted = Svc.Mint(Guid.NewGuid(), DateTimeOffset.UtcNow.AddDays(1));
        var parts = minted.Raw.Split('.');
        // Flip the first signature char to a different valid base64url char.
        parts[2] = (parts[2][0] == 'A' ? 'B' : 'A') + parts[2].Substring(1);
        Assert.Null(Svc.Verify(string.Join('.', parts)));
    }

    [Fact]
    public void Verify_rejects_a_token_signed_with_a_different_key()
    {
        var other = new AttestationTokenService("a-totally-different-signing-key-99");
        var minted = other.Mint(Guid.NewGuid(), DateTimeOffset.UtcNow.AddDays(1));
        Assert.Null(Svc.Verify(minted.Raw));
    }

    [Theory]
    [InlineData("")]
    [InlineData("not-a-token")]
    [InlineData("a.b")]
    [InlineData("a.b.c.d")]
    [InlineData("....")]
    public void Verify_rejects_malformed_input(string raw) => Assert.Null(Svc.Verify(raw));

    [Fact]
    public void ComputeHash_matches_mint_and_differs_per_token()
    {
        var a = Svc.Mint(Guid.NewGuid(), DateTimeOffset.UtcNow.AddDays(1));
        var b = Svc.Mint(Guid.NewGuid(), DateTimeOffset.UtcNow.AddDays(1));
        Assert.Equal(Svc.ComputeHash(a.Raw), a.Hash);
        Assert.NotEqual(a.Hash, b.Hash);
    }

    // With no signing key configured the service must construct (so token-independent
    // endpoints keep working) but refuse to mint, and verify nothing.
    [Fact]
    public void Unconfigured_key_constructs_but_disables_minting_and_verifying()
    {
        var unconfigured = new AttestationTokenService(null);
        Assert.Throws<InvalidOperationException>(() => unconfigured.Mint(Guid.NewGuid(), DateTimeOffset.UtcNow.AddDays(1)));
        var minted = Svc.Mint(Guid.NewGuid(), DateTimeOffset.UtcNow.AddDays(1));
        Assert.Null(unconfigured.Verify(minted.Raw));
    }
}
