const PROVIDER = (process.env.NOTIFICATION_PROVIDER ?? "webhook").toLowerCase();
const WEBHOOK_URL = process.env.WEBHOOK_URL ?? "";
const TEAMS_URL = process.env.TEAMS_WEBHOOK_URL ?? "";
const SMTP = {
  host: process.env.SMTP_HOST ?? "",
  port: Number(process.env.SMTP_PORT) || 587,
  user: process.env.SMTP_USER ?? "",
  pass: process.env.SMTP_PASS ?? "",
};
const NOTIFICATION_EMAIL_TO = process.env.NOTIFICATION_EMAIL_TO ?? "it@company.com";
const APP_BASE_URL = (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

export type CollectionPayload = {
  assetTag: string;
  serial?: string;
  employeeId: string;
  employeeName: string;
  markedByManagerId: string;
  markedByManagerName: string;
  notes?: string;
  markedAt: string;
  eventId: string;
  returnRecipientRole?: string;
  returnLocation?: string;
};

export type NotificationResult = {
  ok: boolean;
  error?: string;
  reference?: string;
};

async function responseError(response: Response): Promise<string> {
  const body = (await response.text().catch(() => "")).trim();
  return body.slice(0, 2_000) || `HTTP ${response.status} ${response.statusText}`;
}

function responseReference(response: Response, provider: string): string {
  const requestId =
    response.headers.get("x-request-id") ??
    response.headers.get("x-ms-request-id") ??
    response.headers.get("request-id");
  return requestId ? `${provider}:${requestId}` : `${provider}:http-${response.status}`;
}

export async function notifyItCollected(payload: CollectionPayload): Promise<NotificationResult> {
  const returnHandoff = payload.returnRecipientRole
    ? ` Return handoff: ${payload.returnRecipientRole}${payload.returnLocation ? ` at ${payload.returnLocation}` : ""}.`
    : "";
  const text = `Equipment collection: ${payload.assetTag} (${payload.serial ?? "n/a"}) — assigned to ${payload.employeeName} (${payload.employeeId}). Marked collected by ${payload.markedByManagerName} at ${payload.markedAt}.${returnHandoff} ${payload.notes ? `Notes: ${payload.notes}` : ""} View: ${APP_BASE_URL}/collection`;
  const body = {
    event: "equipment_collected",
    ...payload,
    message: text,
    link: `${APP_BASE_URL}/collection`,
  };

  if (PROVIDER === "teams" && TEAMS_URL) {
    try {
      const res = await fetch(TEAMS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          "@type": "MessageCard",
          summary: "Equipment collected",
          title: "Equipment collection",
          text,
          potentialAction: [{ "@type": "OpenUri", name: "View portal", targets: [{ os: "default", uri: body.link }] }],
        }),
      });
      return res.ok
        ? { ok: true, reference: responseReference(res, "teams") }
        : { ok: false, error: await responseError(res) };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  if (PROVIDER === "webhook" && WEBHOOK_URL) {
    try {
      const res = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return res.ok
        ? { ok: true, reference: responseReference(res, "webhook") }
        : { ok: false, error: await responseError(res) };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  if (PROVIDER === "email" && SMTP.host) {
    try {
      // Keep the SMTP client separate from next-auth's optional Nodemailer 7
      // peer. This app does not use next-auth's email provider.
      const nodemailer = await import("nodemailer-secure");
      const transport = nodemailer.default.createTransport({
        host: SMTP.host,
        port: SMTP.port,
        secure: false,
        auth: SMTP.user ? { user: SMTP.user, pass: SMTP.pass } : undefined,
      });
      const info = await transport.sendMail({
        from: SMTP.user || "portal@localhost",
        to: NOTIFICATION_EMAIL_TO,
        subject: `[Equipment Portal] Collected: ${payload.assetTag} — ${payload.employeeName}`,
        text,
      });
      return { ok: true, reference: info.messageId ? `email:${info.messageId}` : "email:accepted" };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  return { ok: false, error: "No notification channel configured" };
}
