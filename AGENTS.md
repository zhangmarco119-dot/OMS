# StoreHub repository instructions

## Release convention

- Unless the user explicitly says otherwise, every completed fix, change, or optimization must be released to both `v2-development` (test) and `manage-system` (production) in the same task.
- Every such release must increment the StoreHub patch version in both `package.json` and the newest entry of `src/config/version.ts`.
- Run `pnpm run release:check` for the development commit and again for the production merge commit. Do not describe a change as released until both branches are pushed and their deployed `version.json` files are verified.
- Preserve unrelated working-tree files and changes.

## Image-loading UX convention

- Page data and layout must render as soon as their non-image data is available. Never await image signing, downloading, or browser decoding before displaying the page, list, detail card, editor, or modal.
- Resolve image URLs in a secondary asynchronous phase. While a URL or image is still loading, reserve its layout space and show `正在加载图片`; show `图片预览加载失败` only after URL resolution or browser image loading has actually failed.
- An image failure must not replace otherwise available page content with a page-level loading or error state. New image-bearing pages and regressions must be covered by tests for metadata-first rendering and image-local loading/failure states.
