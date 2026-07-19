export const ONBOARDING_LABELS: Record<string, string> = {
  create_organization: "Create organization",
  create_project: "Create first project",
  create_production_environment: "Create production environment",
  generate_api_key: "Generate API key",
  install_sdk: "Install the SDK",
  send_first_event: "Send first event",
  view_telemetry: "View telemetry",
  invite_teammate: "Invite a teammate",
};

export function onboardingPercent(completedSteps: readonly string[]): number {
  const completed = Object.keys(ONBOARDING_LABELS).filter((step) => completedSteps.includes(step)).length;
  return Math.round((completed / Object.keys(ONBOARDING_LABELS).length) * 100);
}
