# StoreHub repository instructions

## Release convention

- Unless the user explicitly says otherwise, every completed fix, change, or optimization must be released to both `v2-development` (test) and `manage-system` (production) in the same task.
- Every such release must increment the StoreHub patch version in both `package.json` and the newest entry of `src/config/version.ts`.
- Run `pnpm run release:check` for the development commit and again for the production merge commit. Do not describe a change as released until both branches are pushed and their deployed `version.json` files are verified.
- Preserve unrelated working-tree files and changes.
