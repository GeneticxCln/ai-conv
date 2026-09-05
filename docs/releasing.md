# Releasing AI Conv (desktop auto-updates)

The Tauri app self-updates via `tauri-plugin-updater`. Updates are **minisign-signed**;
the app refuses anything that doesn't match the baked-in public key.

## 1. Signing keys

- Private key: `src-tauri/keys/aiconv.key` — **gitignored, never commit it.**
  If lost, updates can never be signed again (users must reinstall manually).
- Public key: `src-tauri/keys/aiconv.key.pub` — also baked into
  `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`.
- Generated with an **empty password**; if you regenerate with a password, set it
  as the `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secret.

Regenerate (burns the old key — all existing installs stop auto-updating):
```bash
npx @tauri-apps/cli signer generate -w src-tauri/keys/aiconv.key --password "" --ci --force
```

## 2. CI secrets (GitHub → Settings → Secrets and variables → Actions)

| Secret | Value |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Full contents of `src-tauri/keys/aiconv.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | *(empty — leave unset/empty string)* |

## 3. Publishing a release

```bash
npm version patch          # bumps root + creates v0.x.y git tag
git push --follow-tags     # .github/workflows/release.yml takes over
```

The workflow builds the signed bundle on GitHub Actions and `tauri-action`
creates the release with:

- `AI.Conv_0.x.y_amd64.{deb,rpm}` — installers
- `ai-conv_0.x.y_amd64.AppImage` — portable build
- `ai-conv_0.x.y_amd64.AppImage.tar.gz` + `.sig` — **updater artifacts**
- `latest.json` — the manifest the running app polls
  (endpoint: `https://github.com/<owner>/<repo>/releases/latest/download/latest.json`
  — set the real `<owner>/<repo>` in `src-tauri/tauri.conf.json`).

## 4. What the app does with it

`frontend/src/lib/updater.ts` checks that endpoint ~4 s after launch
(`frontend/src/components/UpdateNotification.tsx`), shows a toast when a newer
version exists, downloads + verifies the signature, then relaunches on click.
All failures are silent no-ops — a dead endpoint never blocks the app.

## 5. Testing an update locally (no CI)

```bash
export TAURI_SIGNING_PRIVATE_KEY_PATH="$PWD/src-tauri/keys/aiconv.key"
npm run tauri:build -- --cli
```
Serve a fake `latest.json` on localhost and temporarily point
`plugins.updater.endpoints` at it, then bump `version` in `tauri.conf.json` and
relaunch to see the toast.
