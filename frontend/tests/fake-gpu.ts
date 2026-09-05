// Shared between playwright.config.ts (backend webServer env) and the E2E
// specs (expected badge math). Single source of truth for the fake GPU the
// backend reports during E2E runs, so badge tests are deterministic on
// GPU-less CI machines and on dev machines with wildly different cards.
//
// totalMiB=1350 sits between typical model sizes: nomic-embed-text (~261 MiB)
// FITS, while qwen2.5:0.5b (~380 MiB + 1 GiB overhead) does NOT — giving the
// badge test one row of each class in CI.
export const FAKE_GPU = {
  totalMiB: 1350,
  usedMiB: 0,
  name: 'Fake GPU (AICONV_FAKE_GPU)',
} as const;
