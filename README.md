# CMR Segmentation

Browser-based cardiac MRI segmentation at [cmrsegmentation.org](https://cmrsegmentation.org).

All inference runs locally via ONNX Runtime Web (WebAssembly). No patient data leaves the browser.

## Model

MobileUNetV2 trained with knowledge distillation (T=3.0, W=0.99) on ACDC + M&Ms datasets.

| Metric | Value |
|--------|-------|
| Parameters | 2.09M |
| ONNX size | 8.3 MB |
| Mean Dice | 0.883 |
| Browser inference | ~50-100 ms/frame |

## Development

Serve locally:
```bash
python3 -m http.server 8080
```

## Deployment

Automated via GitHub Actions to Cloudflare Pages on push to `main`.

Required secrets:
- `CLOUDFLARE_API_TOKEN` — API token with Cloudflare Pages edit permission
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account ID

## Reference

Feng X, Huang G, Meyer CH. CPU-based fast cardiac cine MRI segmentation using lightweight CNNs and knowledge distillation. *NMR in Biomedicine* (under review).
