import { Injectable } from "@nestjs/common";
import { aiMetrik } from "./ai-metrikleri";

@Injectable()
export class MetricsService {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly durations = { count: 0, sum: 0 };

  increment(name: string, labels: Record<string, string> = {}, value = 1): void {
    const key = `${name}|${JSON.stringify(labels)}`;
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
  }

  set(name: string, value: number, labels: Record<string, string> = {}): void {
    this.gauges.set(`${name}|${JSON.stringify(labels)}`, value);
  }

  observeHttp(durationMs: number, labels: { method: string; route: string; status: number }): void {
    this.durations.count += 1;
    this.durations.sum += durationMs / 1000;
    this.increment("http_requests_total", {
      method: labels.method,
      route: labels.route,
      status_code: String(labels.status),
    });
  }

  render(): string {
    const lines = [
      "# HELP http_requests_total Total HTTP requests.",
      "# TYPE http_requests_total counter",
    ];
    for (const [key, value] of this.counters) {
      const [name, rawLabels] = key.split("|", 2);
      const labels = Object.entries(JSON.parse(rawLabels) as Record<string, string>)
        .map(([k, v]) => `${k}="${v.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}` + `"`).join(",");
      lines.push(`${name}{${labels}} ${value}`);
    }
    for (const [key, value] of this.gauges) {
      const [name, rawLabels] = key.split("|", 2);
      const labels = Object.entries(JSON.parse(rawLabels) as Record<string, string>)
        .map(([k, v]) => `${k}="${v.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join(",");
      lines.push(`${name}{${labels}} ${value}`);
    }
    lines.push(
      "# HELP http_request_duration_seconds HTTP request duration.",
      "# TYPE http_request_duration_seconds summary",
      `http_request_duration_seconds_count ${this.durations.count}`,
      `http_request_duration_seconds_sum ${this.durations.sum}`,
    );
    // AI-112: yapay zekâ metrikleri aynı uçtan.
    return `${lines.join("\n")}\n${aiMetrik.render()}`;
  }
}
