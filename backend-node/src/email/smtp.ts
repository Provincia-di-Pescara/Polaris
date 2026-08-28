import nodemailer, { type Transporter } from 'nodemailer';

// SMTP di bootstrap: configurato SOLO da variabili d'ambiente (vedi .env.example).
// È il canale usato dal wizard del primo avvio (attivazione primo admin), quando non
// esiste ancora nessun admin che possa configurare un SMTP da UI.

export interface ConfigSmtp {
  host: string;
  port: number;
  secure: boolean;
  from: string;
  user?: string;
  password?: string;
}

export interface TrasportoEmail {
  transporter: Transporter;
  from: string;
}

export function creaTrasportoSmtp(config: ConfigSmtp): TrasportoEmail {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.user ? { auth: { user: config.user, pass: config.password ?? '' } } : {}),
  });
  return { transporter, from: config.from };
}

// null se l'SMTP di bootstrap non è configurato: il chiamante decide se è un errore
// (endpoint bootstrap → 503) o se può proseguire senza email.
export function creaTrasportoDaEnv(env: NodeJS.ProcessEnv = process.env): TrasportoEmail | null {
  if (!env.SMTP_HOST) {
    return null;
  }
  return creaTrasportoSmtp({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT ?? '587'),
    secure: env.SMTP_SECURE === 'true',
    from: env.SMTP_FROM ?? `polaris@${env.SMTP_HOST}`,
    ...(env.SMTP_USER ? { user: env.SMTP_USER, password: env.SMTP_PASSWORD ?? '' } : {}),
  });
}

export interface Email {
  a: string;
  oggetto: string;
  testo: string;
  html?: string;
}

export async function inviaEmail(trasporto: TrasportoEmail, email: Email): Promise<void> {
  await trasporto.transporter.sendMail({
    from: trasporto.from,
    to: email.a,
    subject: email.oggetto,
    text: email.testo,
    ...(email.html ? { html: email.html } : {}),
  });
}

function escapeHtml(valore: string): string {
  return valore
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// HTML minimale per email transazionali con link di attivazione: nessun client
// email plain-text-only nel 2026, ma senza <a> molti client non rendono l'URL
// cliccabile — solo testo, senza formattazione, un link vero basta. `paragrafiPrima`
// precede il link (saluto, spiegazione), `paragrafiDopo` lo segue (scadenza, avvisi).
export function corpoEmailConLink(paragrafiPrima: string[], url: string, paragrafiDopo: string[] = []): string {
  return [
    ...paragrafiPrima.map((p) => `<p>${escapeHtml(p)}</p>`),
    `<p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`,
    ...paragrafiDopo.map((p) => `<p>${escapeHtml(p)}</p>`),
  ].join('\n');
}
