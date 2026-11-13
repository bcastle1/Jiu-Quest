// Vite plugin: name the heading typeface in the built index.html.
//
// The Barlow Condensed files are named only inside the stylesheet. On a first
// visit the browser therefore asks for them last: after the stylesheet and the
// script have arrived and the first screen has been laid out in a fallback
// face. The text changes width when the real face arrives, and the page moves.
// A preload link in the HTML starts those downloads together with the page.

// The font files in src/assets/fonts, without their extension. The game's home
// screen draws text in all three as soon as it appears, and each one resizes
// something there when it arrives late. The links are written in this order:
// the bold italic first, because the headlines set in it move the page the
// most. The preview page (/?preview=unreal) shares this index.html and does not
// draw anything in the 600 weight when it opens, so it downloads that one file
// (22 KB) without needing it.
export const PRELOADED_FACES = Object.freeze([
  'barlow-condensed-latin-700-italic',
  'barlow-condensed-latin-700-normal',
  'barlow-condensed-latin-600-normal',
]);

/**
 * The preload links for the Barlow Condensed files a build emitted.
 *
 * @param {Record<string, { type: string, fileName: string }> | null | undefined} bundle
 *   Vite's output bundle. The dev server has none, and gets no links.
 * @param {string} base Vite's resolved `base`, the path the site is served from.
 * @returns {Array<{ tag: 'link', attrs: Record<string, string | boolean>, injectTo: 'head-prepend' }>}
 */
export function fontPreloadTags(bundle, base = '/') {
  if (!bundle) return [];
  const prefix = base === '' || base.endsWith('/') ? base : `${base}/`;
  const emitted = Object.values(bundle)
    .filter((output) => output && output.type === 'asset' && typeof output.fileName === 'string')
    .map((output) => output.fileName)
    .sort();
  const tags = [];
  for (const face of PRELOADED_FACES) {
    // Vite writes an asset as <folder>/<name>-<8 character hash>.<extension>.
    const built = new RegExp(`(?:^|/)${face}-[A-Za-z0-9_-]{8}\\.woff2$`);
    const fileName = emitted.find((name) => built.test(name));
    if (!fileName) continue;
    tags.push({
      tag: 'link',
      attrs: {
        rel: 'preload',
        as: 'font',
        type: 'font/woff2',
        // A browser always fetches a font as a CORS request that sends cookies
        // only to the page's own origin. A bare crossorigin attribute asks for
        // the same kind of request. Without it, or with
        // crossorigin="use-credentials", the preload is not reused and the
        // file is fetched twice.
        crossorigin: true,
        href: `${prefix}${fileName}`,
      },
      // At the start of <head>, ahead of the script tag Vite adds. A browser
      // gives the script and these fonts the same priority, and a host may
      // send files of the same priority one after another in the order they
      // were asked for. Asked for after the script, the fonts would then
      // arrive after the first screen is drawn on a slow connection.
      injectTo: 'head-prepend',
    });
  }
  return tags;
}

export default function fontPreload() {
  let base = '/';
  let logger = console;
  return {
    name: 'jiuquest-font-preload',
    // Only a build has hashed file names to point at.
    apply: 'build',
    configResolved(config) {
      base = config.base;
      logger = config.logger;
    },
    transformIndexHtml: {
      // A 'post' hook is handed the bundle, which lists the font files under
      // their final names.
      order: 'post',
      handler(_html, ctx) {
        const tags = fontPreloadTags(ctx.bundle, base);
        if (tags.length < PRELOADED_FACES.length) {
          // A renamed font file would otherwise drop its preload silently.
          logger.warn(`font preload: found ${tags.length} of ${PRELOADED_FACES.length} Barlow Condensed files in the build; the missing ones load late.`);
        }
        return tags;
      },
    },
  };
}
