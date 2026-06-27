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
    {
        if (string.IsNullOrWhiteSpace(_host) || string.IsNullOrWhiteSpace(_from))
            return new EmailResult { Success = false, Response = "SMTP not configured (Smtp:Host / Smtp:From)." };
        if (string.IsNullOrWhiteSpace(req.To))
            return new EmailResult { Success = false, Response = "No recipient address." };

        try
        {
            var msg = new MimeMessage();
            msg.From.Add(MailboxAddress.Parse(_from));
            msg.To.Add(MailboxAddress.Parse(req.To));
            if (!string.IsNullOrWhiteSpace(req.Cc)) msg.Cc.Add(MailboxAddress.Parse(req.Cc));
            msg.Subject = req.Subject;
            var body = new BodyBuilder { TextBody = req.TextBody };
            if (!string.IsNullOrWhiteSpace(req.HtmlBody)) body.HtmlBody = req.HtmlBody;
            msg.Body = body.ToMessageBody();

            using var client = new SmtpClient { Timeout = 15000 };
            var tls = _useStartTls ? SecureSocketOptions.StartTls : SecureSocketOptions.None;
            await client.ConnectAsync(_host, _port, tls, ct);
            var response = await client.SendAsync(msg, ct);
            await client.DisconnectAsync(true, ct);
            return new EmailResult { Success = true, Response = Trunc(response) };
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "SMTP send to {To} failed", req.To);
            return new EmailResult { Success = false, Response = Trunc(ex.Message) };
        }
    }

    private static string? Trunc(string? s) => string.IsNullOrEmpty(s) || s.Length <= 1000 ? s : s[..1000];
}
