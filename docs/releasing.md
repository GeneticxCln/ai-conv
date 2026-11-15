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

## 2. CI variables (GitLab → Settings → CI/CD → Variables)

| Variable | Value |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Full contents of `src-tauri/keys/aiconv.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | *(empty — leave unset/empty string)* |

## 3. Publishing a release

The version must match in four places — CI (`scripts/check-version-sync.mjs`)
fails the release job when they disagree, and the updater would loop forever if
the built app reported a version different from `latest.json`:

```bash
NEW=0.2.1
npm pkg set version=$NEW
npm pkg set version=$NEW --workspace=backend
npm pkg set version=$NEW --workspace=frontend
npm pkg set version=$NEW --workspace=packages/types
# then set "version" in src-tauri/tauri.conf.json AND src-tauri/Cargo.toml
# (Cargo.lock picks the new crate version up on the next cargo build)
node scripts/check-version-sync.mjs        # package.json vs tauri.conf.json vs Cargo.toml
git commit -am "release: v$NEW"
git tag "v$NEW"
git push --follow-tags                     # .gitlab-ci.yml release:tauri job takes over
```

`TAURI_SIGNING_PRIVATE_KEY` must be present (protected variable), otherwise the
release job refuses to build unsigned updater artifacts.

Before cutting a tag, prove the job on `main` without publishing anything:
trigger the manual `release:tauri:dry-run` job from any `main` pipeline (GitLab
CI/CD → Pipelines → Play, or `glab ci run` and click Play). It shares the
release job's script with `RELEASE_DRY_RUN=true` hard-set, so it can never
upload anything.

That run builds and signs the bundle, lists the outputs, and exits before the
upload and Release steps — nothing is published to the package registry and no
Release is created. A passed dry run means the tagged run has nothing left to
prove except the tag itself.

The `release:tauri` job builds the signed bundle and publishes to GitLab:

- `AI_Conv_0.x.y_amd64.deb` / `AI_Conv-0.x.y-1.x86_64.rpm` — installers
- `AI_Conv_0.x.y_amd64.AppImage` — portable build
- `AI_Conv_0.x.y_amd64.AppImage` + `.AppImage.sig` — **updater artifacts**
- `AI-Conv-0.x.y-linux-x86_64.tar.gz` — portable archive
- `latest.json` — the manifest the running app polls

All artifacts are uploaded to the **generic package registry**
(`packages/generic/ai-conv-desktop/<tag>/...`) and linked from the release.
The updater polls the release permalink:
`https://gitlab.com/GeneticxClm/ai-conv/-/releases/permalink/latest/downloads/latest.json`
(configured in `src-tauri/tauri.conf.json`).

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
