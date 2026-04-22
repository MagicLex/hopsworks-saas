# agent-browser — UI smoke tests on run.hopsworks.ai

`agent-browser` (`/opt/homebrew/bin/agent-browser`) is a headless-browser CLI used to drive the Hopsworks portal end-to-end without Puppeteer/Playwright boilerplate. It keeps a persistent browser session between commands. Reach for it when a DB trace isn't enough and you need to see what a real user sees.

## Core loop

```bash
agent-browser open <url>          # navigate
agent-browser wait <ms>           # wait for load / async
agent-browser snapshot            # a11y tree with [ref=eN] selectors
agent-browser eval "<js>"         # run arbitrary JS (e.g. window.location.href)
agent-browser screenshot <path>   # save PNG
agent-browser click "@eN"         # click by ref from snapshot
agent-browser fill "@eN" "text"   # fill input by ref
agent-browser scrollintoview "@eN"
```

Auth0 and dynamic pages re-render on submit, so `snapshot` refs change between steps — re-snapshot after each navigation.

## Pattern: fresh signup (password auth)

Use `hops+test-<purpose>-$(date +%s)@hopsworks.ai` to get unique Auth0 accounts that forward to a real inbox. Password must pass Auth0 rules (≥8 chars, 3 of: lower/upper/digit/special).

```bash
TS=$(date +%s)
EMAIL="hops+test-x-$TS@hopsworks.ai"
PASS="TestX${TS}!x"

agent-browser open "https://run.hopsworks.ai/"
agent-browser wait 2000

# Click "Sign Up" (ref varies — grep snapshot)
REF=$(agent-browser snapshot | grep '"Sign Up"' | grep -oE 'ref=e[0-9]+' | head -1 | cut -d= -f2)
agent-browser click "@$REF"
agent-browser wait 3000

# Email + password step
SNAP=$(agent-browser snapshot)
E=$(echo "$SNAP" | grep -i email | grep -oE 'ref=e[0-9]+' | head -1 | cut -d= -f2)
P=$(echo "$SNAP" | grep -i password | grep -oE 'ref=e[0-9]+' | head -1 | cut -d= -f2)
C=$(echo "$SNAP" | grep Continue | grep -oE 'ref=e[0-9]+' | head -1 | cut -d= -f2)
agent-browser fill "@$E" "$EMAIL"
agent-browser fill "@$P" "$PASS"
agent-browser scrollintoview "@$C"   # password-rules panel can push Continue offscreen
agent-browser click "@$C"
agent-browser wait 8000

# Auth0 custom prompt: first + last name
SNAP=$(agent-browser snapshot)
F=$(echo "$SNAP" | grep -i 'first name' | grep -oE 'ref=e[0-9]+' | head -1 | cut -d= -f2)
L=$(echo "$SNAP" | grep -i 'last name' | grep -oE 'ref=e[0-9]+' | head -1 | cut -d= -f2)
C=$(echo "$SNAP" | grep Continue | grep -oE 'ref=e[0-9]+' | head -1 | cut -d= -f2)
agent-browser fill "@$F" "First"
agent-browser fill "@$L" "Last"
agent-browser click "@$C"
agent-browser wait 8000
# lands on /billing-setup
```

Gotcha: the email+password submit sometimes needs a second click after password rules panel appears. Scroll into view first, then click. Don't re-fill the password — it's still there, just hidden.

## Pattern: re-login (existing password user)

```bash
agent-browser open "https://run.hopsworks.ai/api/auth/logout"  # kill session first
agent-browser wait 3000

SNAP=$(agent-browser snapshot)
L=$(echo "$SNAP" | grep '"Log In"' | grep -oE 'ref=e[0-9]+' | head -1 | cut -d= -f2)
agent-browser click "@$L"
agent-browser wait 3000
# then same email/password fill as signup
```

## Pattern: simulate limbo / bad state via DB

Faster than clicking through full flow when you want a specific user state (e.g. `billing_mode=NULL + terms_accepted`). Sign up fresh, then:

```bash
psql "$SUPABASE_POOLER" -c "UPDATE users SET terms_accepted_at=NOW() WHERE email='$EMAIL';"
agent-browser open "https://run.hopsworks.ai/dashboard"  # now triggers the redirect logic with that exact state
agent-browser wait 5000
agent-browser eval "window.location.href"   # verify redirect target
```

## Pattern: cleanup after test

Always delete the row — don't leave noise in prod DB. Auth0 side can stay (cheap, no impact).

```bash
psql "$SUPABASE_POOLER" -c "DELETE FROM users WHERE email='$EMAIL';"
agent-browser open "https://run.hopsworks.ai/api/auth/logout"
```

## Known time costs

- Fresh signup → /billing-setup: ~25s total (Auth0 round-trips + sync-user)
- Start Free click → /dashboard with cluster: ~20–30s (Hopsworks user creation + assignment)
- Simple re-login: ~10s
