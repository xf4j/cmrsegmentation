# CMR Segmentation

Browser-based cardiac MRI segmentation at [cmrsegmentation.org](https://cmrsegmentation.org).

All inference, pre-processing, and post-processing run locally on the user's
device via ONNX Runtime Web (WebAssembly). No images, intermediate outputs,
or measurements are transmitted to any server.

## Models

| Contrast | Architecture | Parameters | ONNX size | Mean Dice |
|---|---|---:|---:|---:|
| Cine | MobileUNetV2, KD (T=3.0, W=0.99) on ACDC + M&Ms | 2.09M | 8.3 MB | 0.883 |
| Scar / LGE | Teacher (residual-encoder U-Net) on EMIDEC + MYOSAIQ | 9.22M | 36.9 MB (split into two parts) | — |

Browser inference for the cine student is ~50–100 ms per frame on a typical
laptop (single-threaded WebAssembly with SIMD).

## Development

Serve the static site locally:

```bash
python3 -m http.server 8080
```

Then open <http://localhost:8080>.

## Deployment

The site is a fully static set of files (HTML, JS, WASM, ONNX). It can be
served from any static host — Cloudflare Pages, GitHub Pages, Netlify,
Amazon S3 + CloudFront, or just a `python3 -m http.server` instance behind
nginx. There are no server-side endpoints and no API keys to configure.

## Reference

Feng X, Meyer CH. CPU-based fast cardiac cine MRI segmentation using
lightweight CNNs and knowledge distillation. *Journal of Cardiovascular
Magnetic Resonance* (under review).
