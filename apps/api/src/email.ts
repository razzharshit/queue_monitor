import nodemailer from "nodemailer";
import type { ApiConfig } from "./config.js";
import type { InvitationSummary, PasswordResetRequest } from "./store.js";

export type InvitationSender = (invitation: InvitationSummary, acceptUrl: string) => Promise<void>;
export type PasswordResetSender = (request: PasswordResetRequest, resetUrl: string) => Promise<void>;

function createTransport(config: NonNullable<ApiConfig["smtp"]>) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user && config.password ? { user: config.user, pass: config.password } : undefined,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}

export function createInvitationSender(config: ApiConfig["smtp"]): InvitationSender | undefined {
  if (!config) return undefined;
  const transport = createTransport(config);
  return async (invitation, acceptUrl) => {
    await transport.sendMail({
      from: config.from,
      to: invitation.email,
      subject: `Join ${invitation.organizationName} on Queue Monitor`,
      text: [
        `You were invited to join ${invitation.organizationName} as ${invitation.role}.`,
        "",
        `Accept the invitation: ${acceptUrl}`,
        "",
        `This invitation expires at ${invitation.expiresAt}. If you did not expect it, ignore this email.`,
      ].join("\n"),
    });
  };
}

export function createPasswordResetSender(config: ApiConfig["smtp"]): PasswordResetSender | undefined {
  if (!config) return undefined;
  const transport = createTransport(config);
  return async (request, resetUrl) => {
    await transport.sendMail({
      from: config.from,
      to: request.email,
      subject: "Reset your Queue Monitor password",
      text: [
        "A password reset was requested for your Queue Monitor account.",
        "",
        `Reset your password: ${resetUrl}`,
        "",
        `This link expires at ${request.expiresAt}. If you did not request it, ignore this email.`,
      ].join("\n"),
    });
  };
}
