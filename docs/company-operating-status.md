# Existing company operations

An existing title company can already be operating while its records are still being collected in this workspace. The Companies page lets a workspace owner or an administrator with all-company access confirm that fact for a reviewed selection of companies.

The Active display is separate from the workspace onboarding stage. Confirming operations does not complete the profile, create ownership data, check off setup steps, approve credentials, or establish licensing authority. Missing records remain in the setup and review queues.

The server stamps the authenticated actor and time. The confirmation requires a note, respects company access, and can be cleared from the company overview. Imported unconfirmed profiles are selected initially; names marked as QA, test, demo, fictional, or sample are excluded from automatic selection. Selecting a company still requires review before saving.

Partner views receive the business status without the confirmation note or administrator identity. Assistant context distinguishes business status from workspace setup stage.

Regression checks: `npm run test:company-status`, `npm run test:backend`, and `npm run test:workspace:views` from `web`.
