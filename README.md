# claw-scripts

Small, reviewable scripts used by OpenClaw cron jobs and automations.

Principles:
- deterministic scripts (no hidden marketplace skills)
- secrets pulled at runtime (e.g. via 1Password `op read`)
- produce concise, auditable output
