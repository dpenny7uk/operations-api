using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;

namespace OperationsApi.Services;

/// <summary>An outbound email (transport-agnostic).</summary>
public sealed class EmailRequest
{
    public required string To { get; init; }
    public string? Cc { get; init; }
    public required string Subject { get; init; }
    public required string TextBody { get; init; }
    public string? HtmlBody { get; init; }
}

/// <summary>Outcome of a send attempt — never throws; failures come back as Success=false.</summary>
public sealed class EmailResult
{
    public bool Success { get; init; }
    public string? Response { get; init; }
}

public interface IEmailService
{
    Task<EmailResult> SendAsync(EmailRequest req, CancellationToken ct = default);

    /// <summary>Send many messages over a SINGLE SMTP connection (one connect for the
    /// whole batch). Results are positional, one per request; a per-message failure
    /// doesn't abort the rest. Used by campaign launch/reminders so a 30-recipient
    /// campaign is one connection, not 30.</summary>
    Task<IReadOnlyList<EmailResult>> SendBatchAsync(IReadOnlyList<EmailRequest> reqs, CancellationToken ct = default);
}

/// <summary>
/// SMTP transport via MailKit. Aimed at an internal relay (anonymous, allowlisted
/// by source IP + sender), so no credentials. Returns a result rather than throwing
/// so the caller can log every attempt to auditing.email_log. A missing Smtp:Host /
/// Smtp:From is treated as "not configured" (failure result, not an exception), so
/// the rest of auditing keeps working until SMTP is wired up.
/// </summary>
public sealed class SmtpEmailService : IEmailService
{
    private readonly string _host;
    private readonly int _port;
    private readonly string _from;
    private readonly bool _useStartTls;
    private readonly ILogger<SmtpEmailService> _logger;

    public SmtpEmailService(IConfiguration config, ILogger<SmtpEmailService> logger)
    {
        _host = config["Smtp:Host"] ?? "";
        _port = int.TryParse(config["Smtp:Port"], out var p) ? p : 25;
        _from = config["Smtp:From"] ?? "";
        _useStartTls = bool.TryParse(config["Smtp:UseStartTls"], out var s) && s;
        _logger = logger;
    }

    public async Task<EmailResult> SendAsync(EmailRequest req, CancellationToken ct = default)
        => (await SendBatchAsync(new[] { req }, ct))[0];

    public async Task<IReadOnlyList<EmailResult>> SendBatchAsync(IReadOnlyList<EmailRequest> reqs, CancellationToken ct = default)
    {
        var results = new EmailResult[reqs.Count];

        if (string.IsNullOrWhiteSpace(_host) || string.IsNullOrWhiteSpace(_from))
        {
            for (var i = 0; i < reqs.Count; i++)
                results[i] = new EmailResult { Success = false, Response = "SMTP not configured (Smtp:Host / Smtp:From)." };
            return results;
        }

        // Mark recipient-less requests up front; only open a connection if something
        // is actually sendable (so a no-recipient batch never touches the network).
        var anySendable = false;
        for (var i = 0; i < reqs.Count; i++)
        {
            if (string.IsNullOrWhiteSpace(reqs[i].To))
                results[i] = new EmailResult { Success = false, Response = "No recipient address." };
            else
                anySendable = true;
        }
        if (!anySendable) return results;

        var client = new SmtpClient { Timeout = 15000 };
        try
        {
            var tls = _useStartTls ? SecureSocketOptions.StartTls : SecureSocketOptions.None;
            await client.ConnectAsync(_host, _port, tls, ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "SMTP connect to {Host}:{Port} failed", _host, _port);
            client.Dispose();
            var msg = Trunc(ex.Message);
            for (var i = 0; i < reqs.Count; i++)
                results[i] ??= new EmailResult { Success = false, Response = msg };
            return results;
        }

        try
        {
            for (var i = 0; i < reqs.Count; i++)
            {
                if (results[i] != null) continue; // recipient-less, already marked
                try
                {
                    var response = await client.SendAsync(BuildMime(reqs[i]), ct);
                    results[i] = new EmailResult { Success = true, Response = Trunc(response) };
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "SMTP send to {To} failed", reqs[i].To);
                    results[i] = new EmailResult { Success = false, Response = Trunc(ex.Message) };
                }
            }
        }
        finally
        {
            try { if (client.IsConnected) await client.DisconnectAsync(true, ct); } catch { /* best effort */ }
            client.Dispose();
        }
        return results;
    }

    private MimeMessage BuildMime(EmailRequest req)
    {
        var msg = new MimeMessage();
        msg.From.Add(MailboxAddress.Parse(_from));
        msg.To.Add(MailboxAddress.Parse(req.To));
        if (!string.IsNullOrWhiteSpace(req.Cc)) msg.Cc.Add(MailboxAddress.Parse(req.Cc));
        msg.Subject = req.Subject;
        var body = new BodyBuilder { TextBody = req.TextBody };
        if (!string.IsNullOrWhiteSpace(req.HtmlBody)) body.HtmlBody = req.HtmlBody;
        msg.Body = body.ToMessageBody();
        return msg;
    }

    private static string? Trunc(string? s) => string.IsNullOrEmpty(s) || s.Length <= 1000 ? s : s[..1000];
}
