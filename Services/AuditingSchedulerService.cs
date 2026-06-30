namespace OperationsApi.Services;

/// <summary>
/// Auditing (Surface 09) scheduled automation. On each tick it (1) auto-launches a
/// campaign for every active app flagged auto_launch=true that is due per its
/// cadence, and (2) sends one reminder per never-reminded outstanding packet in
/// campaigns nearing their due date. This is the consumer the auto_launch flag +
/// auto_launch_log table were built for.
///
/// OFF by default: it sends real attestation invites/reminders via SMTP, so an
/// operator must opt in with Auditing:Scheduler:Enabled=true. Config:
///   Auditing:Scheduler:Enabled            (bool, default false)
///   Auditing:Scheduler:IntervalHours      (double, default 24)
///   Auditing:Scheduler:ReminderWindowDays (int, default 3)
/// </summary>
public class AuditingSchedulerService : BackgroundService
{
    private readonly IServiceProvider _services;
    private readonly ILogger<AuditingSchedulerService> _log;
    private readonly bool _enabled;
    private readonly TimeSpan _interval;
    private readonly int _reminderWindowDays;

    public AuditingSchedulerService(IServiceProvider services, ILogger<AuditingSchedulerService> log, IConfiguration config)
    {
        _services = services;
        _log = log;
        _enabled = config.GetValue("Auditing:Scheduler:Enabled", false);
        var hours = config.GetValue("Auditing:Scheduler:IntervalHours", 24.0);
        _interval = TimeSpan.FromHours(hours <= 0 ? 24.0 : hours);
        var window = config.GetValue("Auditing:Scheduler:ReminderWindowDays", 3);
        _reminderWindowDays = window < 0 ? 3 : window;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_enabled)
        {
            _log.LogInformation("Auditing scheduler disabled (set Auditing:Scheduler:Enabled=true to activate auto-launch + reminders).");
            return;
        }

        _log.LogInformation("Auditing scheduler enabled; interval {Interval}, reminder window {Window}d.", _interval, _reminderWindowDays);

        // Let the app finish starting before the first tick.
        try { await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken); }
        catch (OperationCanceledException) { return; }

        while (!stoppingToken.IsCancellationRequested)
        {
            await RunOnceAsync(stoppingToken);
            try { await Task.Delay(_interval, stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
    }

    private async Task RunOnceAsync(CancellationToken ct)
    {
        try
        {
            // BackgroundService is a singleton; the auditing services are scoped.
            using var scope = _services.CreateScope();
            var campaigns = scope.ServiceProvider.GetRequiredService<ICampaignService>();

            var launched = await campaigns.AutoLaunchDueAsync("auto-launch");
            var reminded = await campaigns.SendDueRemindersAsync(_reminderWindowDays);

            if (launched > 0 || reminded > 0)
                _log.LogInformation("Auditing scheduler tick: launched {Launched} campaign(s), sent {Reminded} reminder(s).", launched, reminded);
        }
        catch (Exception ex)
        {
            // Never let a tick failure tear down the host; log and try again next interval.
            _log.LogError(ex, "Auditing scheduler tick failed.");
        }
    }
}
