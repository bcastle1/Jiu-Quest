# Verified Unity player

`player.bundle.gz` is a compressed, allowlisted distribution of the Unity Web player. `release.json` pins its size, SHA-256, source fingerprint, and the separate authored animation hashes. It contains no Unity installation, editor license, credentials, cache, or duplicate GLB animation files.

The player is built on an authorized local Unity installation. GitHub Actions restores this exact player and the canonical GLBs already in `public/animations/bjj`. CI does not activate Unity, need a license secret, fetch an unpinned external player, or silently ship React without its engine.

After changing Unity source, project settings, packages, or animation assets:

```powershell
pnpm unity:test
pnpm unity:build
pnpm release:pack
pnpm test
pnpm release:build
pnpm test:browser
```

Review and commit the source changes, `player.bundle.gz`, and `release.json` together. The Unity builder records source hashes after preparing its generated scene and verifies them again after compilation. Packaging rejects a changed source tree, a changed staged clip, missing privacy checks, or a file hash mismatch. The restore step validates the entire archive before replacing only the generated `public/unity` directory.

`pnpm release:build` enables Unity for explicitly supported Training/Arena moves. `?engine=snapshot` remains an immediate per-browser fallback; `?preview=unity` opens the isolated scene reviewer. Neither route changes the combat outcome rules. A deployment rollback restores the previous approved commit through the normal Pages workflow; it must not erase player progress.

Pull requests build and test a downloadable website artifact but cannot run the production deployment job. Only an approved merge to `main` or approved manual workflow run on `main` deploys to jiuquest.com. Do not merge or deploy without Erik's approval.
