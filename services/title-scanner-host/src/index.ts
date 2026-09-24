import { Container, ContainerProxy } from '@cloudflare/containers';
import { validateRequest, proxyRequest, reply, scannerEnabled, routeScannerRequest, signatureRequest, healthResult, type Health } from './gateway';
export { ContainerProxy };
type ScannerEnv = Env & { TITLE_SCANNER_TOKEN?: string };

export class TitleScanner extends Container<ScannerEnv> {
  defaultPort = 8080;
  sleepAfter = '15m';
  enableInternet = false;
  interceptHttps = true;
  allowedHosts = ['database.clamav.net'];
  private inFlight = 0;
  private maintaining?: Promise<Health>;

  private enabled() { return scannerEnabled(this.env.TITLE_SCANNER_ENABLED, this.env.TITLE_SCANNER_TOKEN); }

  /** Cron is the single scheduling owner. Health/backoff persists across Durable Object evictions. */
  async maintain(): Promise<Health> {
    if (this.maintaining) return this.maintaining;
    this.maintaining = this.checkHealth().finally(() => { this.maintaining = undefined; });
    return this.maintaining;
  }

  private async checkHealth(): Promise<Health> {
    const previous = await this.ctx.storage.get<Health>('health');
    if (!this.enabled()) return healthResult(null, 0);
    if (previous && Date.parse(previous.nextCheckAt) > Date.now()) return previous;
    let value: unknown = null;
    try {
      if (!this.ctx.container?.running) {
        // Persist the cooldown before a new boot; parallel scans cannot cause repeated restarts.
        const pending = healthResult(null, previous?.consecutiveFailures ?? 0);
        await this.ctx.storage.put('health', pending);
        await this.start({ envVars: { TITLE_SCANNER_TOKEN: this.env.TITLE_SCANNER_TOKEN!,
          TITLE_SCANNER_TRANSPORT: 'cloudflare-private-http', TITLE_SCANNER_HOST: '0.0.0.0', TITLE_SCANNER_PORT: '8080',
          TITLE_SCANNER_REQUIRE_PLATFORM_CA: 'true' } },
          { signal: AbortSignal.timeout(8000), portToCheck: 8080 });
        return pending; // Freshclam/engine startup proceeds outside customer requests.
      }
      this.renewActivityTimeout();
      const req = new Request('https://scanner.internal/v1/health', { headers: { authorization: `Bearer ${this.env.TITLE_SCANNER_TOKEN}` } });
      const response = await proxyRequest(req, this.env.TITLE_SCANNER_TOKEN!, request => this.ctx.container!.getTcpPort(8080).fetch(request),
        length => new FixedLengthStream(length), 4500);
      if (response.ok) value = await response.json();
    } catch { /* Persist a bounded aggregate failure, not an exception or document identifier. */ }
    const health = healthResult(value, previous?.consecutiveFailures ?? 0);
    await this.ctx.storage.put('health', health);
    if (health.status !== previous?.status) console.log(JSON.stringify({ event: 'scanner_health_changed', status: health.status }));
    return health;
  }

  override async fetch(request: Request): Promise<Response> {
    const invalid = validateRequest(request, this.env.TITLE_SCANNER_TOKEN);
    if (invalid) return invalid;
    if (!this.enabled()) return reply(503, 'scanner_not_activated');
    if (this.inFlight >= 2) return reply(503, 'scanner_busy');
    this.inFlight++;
    try {
      const state = await this.maintain();
      if (!this.ctx.container?.running || state.status !== 'ready' || Date.now() - Date.parse(state.checkedAt) > 10 * 60000)
        return reply(503, 'scanner_warming_or_unavailable');
      this.renewActivityTimeout();
      return await proxyRequest(request, this.env.TITLE_SCANNER_TOKEN!, req => this.ctx.container!.getTcpPort(8080).fetch(req),
        length => new FixedLengthStream(length));
    } finally { this.inFlight--; }
  }

  override onError() { console.error('{"event":"scanner_container_unavailable"}'); }
  override onStop() { console.log('{"event":"scanner_container_stopped"}'); }
}

TitleScanner.outbound = async request => {
  const approved = signatureRequest(request);
  if (!approved) return reply(403, 'egress_denied');
  const response = await fetch(approved);
  if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); return reply(502, 'signature_source_redirect'); }
  return response;
};

export default {
  async fetch(request: Request, env: ScannerEnv): Promise<Response> {
    // Authenticate and bound headers before obtaining a DO stub or starting paid compute.
    return routeScannerRequest(request, env.TITLE_SCANNER_ENABLED, env.TITLE_SCANNER_TOKEN,
      accepted => env.TITLE_SCANNER.getByName('title-scanner-primary').fetch(accepted));
  },
  async scheduled(_event: ScheduledController, env: ScannerEnv, ctx: ExecutionContext) {
    if (!scannerEnabled(env.TITLE_SCANNER_ENABLED, env.TITLE_SCANNER_TOKEN)) return;
    ctx.waitUntil(env.TITLE_SCANNER.getByName('title-scanner-primary').maintain());
  },
} satisfies ExportedHandler<ScannerEnv>;
